package db

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// dumpAS400 backs up IBM i (AS/400) libraries/objects.
//
// URI forms:
//
//	file:/path/to/save.savf
//	file:/path/to/export-dir
//	as400-ssh://user:pass@host/LIB1,LIB2?savsec=1&savcfg=0&tmpdir=/tmp
//	ibmi-ssh://user:pass@host/MYLIB?objects=FILE1,FILE2&key=/path/id_rsa
//
// Query parameters:
//
//	libraries / path — libraries to save (comma-separated)
//	objects          — optional SAVOBJ list (single library)
//	savsec=1         — also SAVSECDTA
//	savcfg=1         — also SAVCFG
//	tmpdir           — IFS staging path (default /tmp)
//	key              — SSH private key path
//	port             — SSH port (default 22)
//	cmd              — remote command override ({libs} {lib} {savf} {path})
func dumpAS400(workDir, name, uri string, opts Options) (string, error) {
	u := strings.TrimSpace(uri)
	if u == "" {
		return "", fmt.Errorf("as400: URI is required (file:/path or as400-ssh://user:pass@host/MYLIB)")
	}
	lower := strings.ToLower(u)
	switch {
	case strings.HasPrefix(lower, "file:"):
		return dumpAS400File(workDir, name, strings.TrimPrefix(u, "file:"), opts)
	case strings.HasPrefix(lower, "as400-ssh://"), strings.HasPrefix(lower, "ibmi-ssh://"), strings.HasPrefix(lower, "ssh://"):
		return dumpAS400SSH(workDir, name, u)
	case strings.HasPrefix(lower, "as400://"), strings.HasPrefix(lower, "ibmi://"):
		return dumpAS400SSH(workDir, name, "as400-ssh://"+u[strings.Index(u, "://")+3:])
	default:
		if _, err := os.Stat(u); err == nil {
			return dumpAS400File(workDir, name, u, opts)
		}
		return "", fmt.Errorf("as400: unsupported URI %q", u)
	}
}

func dumpAS400File(workDir, name, path string, opts Options) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("as400: empty file path")
	}
	st, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("as400 path: %w", err)
	}
	if st.IsDir() {
		stage := filepath.Join(workDir, name+"-stage")
		_ = os.RemoveAll(stage)
		var staged string
		if opts.UseVSS {
			staged, err = withVSSCopy(path, stage)
		} else {
			staged, err = directCopyTree(path, stage, true)
		}
		if err != nil {
			return "", err
		}
		out := outPath(workDir, name, ".tar.gz")
		if err := tarGzDir(staged, out); err != nil {
			return "", err
		}
		_ = os.RemoveAll(stage)
		return out, nil
	}
	tmp := outPath(workDir, name, ".savf")
	if err := copyFilePath(path, tmp); err != nil {
		return "", err
	}
	return gzipFile(tmp, outPath(workDir, name, ".savf.gz"))
}

type as400SSHOpts struct {
	Host      string
	Port      string
	User      string
	Pass      string
	KeyPath   string
	Libraries []string
	Objects   []string
	SavSec    bool
	SavCfg    bool
	TmpDir    string
	Cmd       string
}

func parseAS400SSH(rawURL string) (as400SSHOpts, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return as400SSHOpts{}, err
	}
	o := as400SSHOpts{
		Host:   u.Hostname(),
		Port:   u.Port(),
		TmpDir: "/tmp",
	}
	if o.Port == "" {
		o.Port = "22"
	}
	if u.User != nil {
		o.User = u.User.Username()
		o.Pass, _ = u.User.Password()
	}
	q := u.Query()
	if k := q.Get("key"); k != "" {
		o.KeyPath = k
	}
	if t := q.Get("tmpdir"); t != "" {
		o.TmpDir = t
	}
	if q.Get("savsec") == "1" || strings.EqualFold(q.Get("savsec"), "true") {
		o.SavSec = true
	}
	if q.Get("savcfg") == "1" || strings.EqualFold(q.Get("savcfg"), "true") {
		o.SavCfg = true
	}
	if c := q.Get("cmd"); c != "" {
		o.Cmd = c
	}
	if objs := q.Get("objects"); objs != "" {
		o.Objects = splitCSV(objs)
	}
	libs := strings.TrimPrefix(u.Path, "/")
	if q.Get("libraries") != "" {
		libs = q.Get("libraries")
	}
	o.Libraries = splitCSV(libs)
	if len(o.Libraries) == 0 {
		return o, fmt.Errorf("as400-ssh: at least one library required in path or ?libraries=")
	}
	if o.Host == "" || o.User == "" {
		return o, fmt.Errorf("as400-ssh: host and user required")
	}
	if o.Pass == "" && o.KeyPath == "" {
		return o, fmt.Errorf("as400-ssh: password or key= required")
	}
	return o, nil
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func dumpAS400SSH(workDir, name, rawURL string) (string, error) {
	o, err := parseAS400SSH(rawURL)
	if err != nil {
		return "", err
	}
	var auths []ssh.AuthMethod
	if o.KeyPath != "" {
		m, err := publicKeyFileAuth(o.KeyPath)
		if err != nil {
			return "", fmt.Errorf("as400 ssh key: %w", err)
		}
		auths = append(auths, m)
	}
	if o.Pass != "" {
		auths = append(auths, ssh.Password(o.Pass))
	}
	cfg := &ssh.ClientConfig{
		User:            o.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // IBM i host keys vary; pin via known_hosts in a later release
		Timeout:         30 * time.Second,
	}
	addr := net.JoinHostPort(o.Host, o.Port)
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", fmt.Errorf("as400 ssh dial: %w", err)
	}
	defer client.Close()

	savfName := sanitizeIBMiName("VB" + name)
	remoteSTMF := strings.TrimRight(o.TmpDir, "/") + "/" + savfName + ".savf"
	cmd := buildAS400SaveCommand(o, savfName, remoteSTMF)
	out, err := sshRunOut(client, cmd, 30*time.Minute)
	if err != nil {
		return "", fmt.Errorf("as400 remote save: %w: %s", err, out)
	}

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return "", fmt.Errorf("as400 sftp: %w", err)
	}
	defer sftpClient.Close()
	src, err := sftpClient.Open(remoteSTMF)
	if err != nil {
		return "", fmt.Errorf("as400 sftp open %s: %w", remoteSTMF, err)
	}
	defer src.Close()
	local := outPath(workDir, name, ".savf")
	dst, err := os.Create(local)
	if err != nil {
		return "", err
	}
	if _, err := dst.ReadFrom(src); err != nil {
		dst.Close()
		return "", err
	}
	dst.Close()
	// best-effort remote cleanup
	_, _ = sshRunOut(client, fmt.Sprintf("rm -f '%s'; system \"DLTF FILE(QGPL/%s)\" || true", remoteSTMF, savfName), 2*time.Minute)
	return gzipFile(local, outPath(workDir, name, ".savf.gz"))
}

func buildAS400SaveCommand(o as400SSHOpts, savfName, remoteSTMF string) string {
	if o.Cmd != "" {
		cmd := o.Cmd
		cmd = strings.ReplaceAll(cmd, "{libs}", strings.Join(o.Libraries, " "))
		cmd = strings.ReplaceAll(cmd, "{lib}", o.Libraries[0])
		cmd = strings.ReplaceAll(cmd, "{savf}", savfName)
		cmd = strings.ReplaceAll(cmd, "{path}", remoteSTMF)
		return cmd
	}
	var b strings.Builder
	b.WriteString("set -e; ")
	b.WriteString(fmt.Sprintf(`system "CRTSAVF FILE(QGPL/%s) TEXT('VaultBackup')" || system "CLRSAVF FILE(QGPL/%s)"; `, savfName, savfName))
	if len(o.Objects) > 0 && len(o.Libraries) == 1 {
		objs := strings.Join(o.Objects, " ")
		b.WriteString(fmt.Sprintf(`system "SAVOBJ OBJ(%s) LIB(%s) DEV(*SAVF) SAVF(QGPL/%s)"; `, objs, o.Libraries[0], savfName))
	} else {
		for _, lib := range o.Libraries {
			b.WriteString(fmt.Sprintf(`system "SAVLIB LIB(%s) DEV(*SAVF) SAVF(QGPL/%s) PRECHECK(*NO) SAVACT(*LIB) ACCPTH(*YES)"; `, lib, savfName))
		}
	}
	if o.SavSec {
		b.WriteString(fmt.Sprintf(`system "SAVSECDTA DEV(*SAVF) SAVF(QGPL/%s)"; `, savfName))
	}
	if o.SavCfg {
		b.WriteString(fmt.Sprintf(`system "SAVCFG DEV(*SAVF) SAVF(QGPL/%s)"; `, savfName))
	}
	b.WriteString(fmt.Sprintf(`system "CPYTOSTMF FROMMBR('/QSYS.LIB/QGPL.LIB/%s.FILE') TOSTMF('%s') STMFOPT(*REPLACE) DBFCCSID(*FILE)"; `, savfName, remoteSTMF))
	b.WriteString(fmt.Sprintf(`ls -la '%s'`, remoteSTMF))
	return b.String()
}

func sshRunOut(client *ssh.Client, cmd string, timeout time.Duration) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	done := make(chan error, 1)
	var out []byte
	go func() {
		var e error
		out, e = session.CombinedOutput(cmd)
		done <- e
	}()
	select {
	case err := <-done:
		return string(out), err
	case <-time.After(timeout):
		_ = session.Close()
		return string(out), fmt.Errorf("remote command timed out after %s", timeout)
	}
}

func publicKeyFileAuth(path string) (ssh.AuthMethod, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, err
	}
	return ssh.PublicKeys(signer), nil
}

func sanitizeIBMiName(s string) string {
	s = strings.ToUpper(s)
	s = strings.Map(func(r rune) rune {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return 'X'
	}, s)
	if len(s) > 10 {
		s = s[:10]
	}
	if s == "" {
		s = "VBSAVF"
	}
	return s
}
