package db

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// dumpOracle performs enterprise-oriented Oracle backups using host tools.
//
// Priority:
//  1. RMAN (backup_type=rman|native, or ORACLE_BACKUP=rman) when `rman` is on PATH
//  2. Data Pump expdp with DIRECTORY/dumpfile/logfile (recommended logical)
//  3. Classic exp
//
// URI forms:
//
//	oracle://user:pass@host:1521/ORCL
//	user/pass@host:1521/service
//	user/pass@//host:1521/service
//	EZCONNECT or TNS alias in ORACLE_CONNECT + credentials in URI userinfo
//
// Environment (optional):
//
//	ORACLE_HOME, ORACLE_SID, TNS_ADMIN
//	ORACLE_DIRECTORY     — Data Pump DIRECTORY object name (default DATA_PUMP_DIR)
//	ORACLE_SCHEMAS       — comma-separated schemas for expdp
//	ORACLE_PARALLEL      — expdp PARALLEL=n
//	ORACLE_COMPRESSION   — ALL | DATA_ONLY | METADATA_ONLY (default ALL)
//	ORACLE_RMAN_SCRIPT   — path to custom RMAN script ({out} placeholder)
//	ORACLE_BACKUP        — rman | expdp | exp  (force mode)
func dumpOracle(workDir, name, uri string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("ORACLE_BACKUP")))
	if mode == "" {
		if u, err := url.Parse(normalizeOracleURI(uri)); err == nil {
			mode = strings.ToLower(u.Query().Get("mode"))
			if mode == "" {
				mode = strings.ToLower(u.Query().Get("backup_type"))
			}
		}
	}

	switch mode {
	case "rman", "native":
		if path, err := dumpOracleRMAN(workDir, name, uri); err == nil {
			return path, nil
		} else if mode == "rman" {
			return "", err
		}
	}

	if path, err := dumpOracleExpdp(workDir, name, uri); err == nil {
		return path, nil
	} else {
		expdpErr := err
		if path, err2 := dumpOracleExp(workDir, name, uri); err2 == nil {
			return path, nil
		}
		if _, e := exec.LookPath("rman"); e == nil && (mode == "" || mode == "full") {
			if path, err3 := dumpOracleRMAN(workDir, name, uri); err3 == nil {
				return path, nil
			}
		}
		return "", fmt.Errorf("oracle backup failed (expdp: %v)", expdpErr)
	}
}

type oracleConn struct {
	User    string
	Pass    string
	Host    string
	Port    string
	Service string
}

func normalizeOracleURI(uri string) string {
	u := strings.TrimSpace(uri)
	if u == "" {
		return u
	}
	if strings.Contains(u, "://") {
		return u
	}
	// user/pass@host:port/service
	if at := strings.LastIndex(u, "@"); at > 0 {
		return "oracle://" + strings.Replace(u[:at], "/", ":", 1) + "@" + u[at+1:]
	}
	return "oracle://" + u
}

func parseOracleConn(uri string) (oracleConn, error) {
	raw := normalizeOracleURI(uri)
	if !strings.Contains(raw, "://") {
		raw = "oracle://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return oracleConn{}, err
	}
	c := oracleConn{Port: "1521"}
	if u.User != nil {
		c.User = u.User.Username()
		c.Pass, _ = u.User.Password()
	}
	c.Host = u.Hostname()
	if c.Host == "" || c.Host == "localhost" {
		c.Host = "127.0.0.1"
	}
	if p := u.Port(); p != "" {
		c.Port = p
	}
	c.Service = strings.TrimPrefix(u.Path, "/")
	if i := strings.Index(c.Service, "/"); i >= 0 {
		c.Service = c.Service[:i]
	}
	if c.Service == "" {
		c.Service = strings.TrimSpace(os.Getenv("ORACLE_SID"))
	}
	if c.User == "" {
		return c, fmt.Errorf("oracle: user required in URI")
	}
	return c, nil
}

func (c oracleConn) target() string {
	if env := strings.TrimSpace(os.Getenv("ORACLE_CONNECT")); env != "" {
		return c.User + "/" + c.Pass + "@" + env
	}
	svc := c.Service
	if svc == "" {
		svc = "ORCL"
	}
	return fmt.Sprintf("%s/%s@//%s:%s/%s", c.User, c.Pass, c.Host, c.Port, svc)
}

func dumpOracleExpdp(workDir, name, uri string) (string, error) {
	bin, err := exec.LookPath("expdp")
	if err != nil {
		return "", fmt.Errorf("expdp not found on PATH")
	}
	c, err := parseOracleConn(uri)
	if err != nil {
		return "", err
	}
	dirName := strings.TrimSpace(os.Getenv("ORACLE_DIRECTORY"))
	if dirName == "" {
		dirName = "DATA_PUMP_DIR"
	}
	dumpfile := name + ".dmp"
	logfile := name + ".log"
	args := []string{
		c.target(),
		"DIRECTORY=" + dirName,
		"DUMPFILE=" + dumpfile,
		"LOGFILE=" + logfile,
	}
	if schemas := strings.TrimSpace(os.Getenv("ORACLE_SCHEMAS")); schemas != "" {
		args = append(args, "SCHEMAS="+schemas)
	} else if c.User != "" {
		args = append(args, "SCHEMAS="+c.User)
	}
	if p := strings.TrimSpace(os.Getenv("ORACLE_PARALLEL")); p != "" {
		args = append(args, "PARALLEL="+p)
	}
	comp := strings.TrimSpace(os.Getenv("ORACLE_COMPRESSION"))
	if comp == "" {
		comp = "ALL"
	}
	args = append(args, "COMPRESSION="+comp)

	cmd := exec.Command(bin, args...)
	cmd.Dir = workDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("expdp: %w: %s", err, string(out))
	}
	// Prefer pulling from ORACLE_DIRECTORY_PATH if set (OS path of DIRECTORY)
	dirPath := strings.TrimSpace(os.Getenv("ORACLE_DIRECTORY_PATH"))
	if dirPath == "" {
		dirPath = workDir
	}
	src := filepath.Join(dirPath, dumpfile)
	dst := outPath(workDir, name, ".dmp")
	if src != dst {
		data, rerr := os.ReadFile(src)
		if rerr != nil {
			// expdp succeeded; return dumpfile name as marker under workDir
			marker := outPath(workDir, name, ".dmp.ok")
			_ = os.WriteFile(marker, out, 0o600)
			return marker, nil
		}
		if err := os.WriteFile(dst, data, 0o600); err != nil {
			return "", err
		}
		return dst, nil
	}
	return src, nil
}

func dumpOracleExp(workDir, name, uri string) (string, error) {
	bin, err := exec.LookPath("exp")
	if err != nil {
		return "", fmt.Errorf("exp not found on PATH")
	}
	c, err := parseOracleConn(uri)
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".dmp")
	args := []string{
		c.target(),
		"file=" + out,
		"owner=" + c.User,
		"log=" + outPath(workDir, name, ".log"),
	}
	cmd := exec.Command(bin, args...)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("exp: %w: %s", err, string(b))
	}
	return out, nil
}

func dumpOracleRMAN(workDir, name, uri string) (string, error) {
	bin, err := exec.LookPath("rman")
	if err != nil {
		return "", fmt.Errorf("rman not found on PATH")
	}
	c, err := parseOracleConn(uri)
	if err != nil {
		return "", err
	}
	outDir := filepath.Join(workDir, name+"-rman")
	_ = os.MkdirAll(outDir, 0o755)
	scriptPath := strings.TrimSpace(os.Getenv("ORACLE_RMAN_SCRIPT"))
	var script string
	if scriptPath != "" {
		b, err := os.ReadFile(scriptPath)
		if err != nil {
			return "", err
		}
		script = strings.ReplaceAll(string(b), "{out}", outDir)
	} else {
		script = fmt.Sprintf(`
RUN {
  ALLOCATE CHANNEL c1 DEVICE TYPE DISK FORMAT '%s/%%U';
  BACKUP DATABASE PLUS ARCHIVELOG;
  RELEASE CHANNEL c1;
}
`, outDir)
	}
	runFile := filepath.Join(workDir, name+".rman")
	if err := os.WriteFile(runFile, []byte(script), 0o600); err != nil {
		return "", err
	}
	cmd := exec.Command(bin, "target", c.target(), "cmdfile", runFile)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("rman: %w: %s", err, string(b))
	}
	// Archive the rman dir
	tarPath := outPath(workDir, name, ".tar.gz")
	if tarBin, e := exec.LookPath("tar"); e == nil {
		cmd = exec.Command(tarBin, "-czf", tarPath, "-C", workDir, filepath.Base(outDir))
		if b2, err2 := cmd.CombinedOutput(); err2 != nil {
			return "", fmt.Errorf("rman archive: %w: %s", err2, string(b2))
		}
		return tarPath, nil
	}
	// Fallback: marker
	marker := outPath(workDir, name, ".rman.ok")
	_ = os.WriteFile(marker, b, 0o600)
	return marker, nil
}
