package db

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// dumpQuickBooks backs up a QuickBooks Desktop company file.
//
// backupType:
//   - native  → AutoBackupEXE when available (produces .qbb)
//   - files   → company folder / companions via file archive (VSS optional)
//   - full / "" → prefer native when PreferNativeTools, else files
func dumpQuickBooks(workDir, name, uri string, opts Options) (string, error) {
	src := strings.TrimSpace(strings.TrimPrefix(uri, "file:"))
	if src == "" {
		return "", fmt.Errorf("quickbooks: path to .qbw (or company folder) required")
	}
	st, err := os.Stat(src)
	if err != nil {
		return "", fmt.Errorf("quickbooks path: %w", err)
	}

	mode := strings.ToLower(opts.BackupType)
	if mode == "" || mode == "full" {
		if opts.PreferNativeTools {
			mode = "native"
		} else {
			mode = "files"
		}
	}

	if mode == "native" || mode == "both" {
		qbb, nerr := runQuickBooksNative(workDir, name, src, st)
		if nerr == nil {
			if mode != "both" {
				return qbb, nil
			}
			// both: keep native artifact and also produce file archive
			_, _ = dumpQuickBooksFiles(workDir, name+"-files", src, st, opts)
			return qbb, nil
		}
		if mode == "native" && !opts.PreferNativeTools {
			return "", nerr
		}
		// fall through to files
	}

	return dumpQuickBooksFiles(workDir, name, src, st, opts)
}

func runQuickBooksNative(workDir, name, src string, st os.FileInfo) (string, error) {
	qbw := src
	if st.IsDir() {
		// Find a .qbw inside the folder
		matches, _ := filepath.Glob(filepath.Join(src, "*.qbw"))
		if len(matches) == 0 {
			matches, _ = filepath.Glob(filepath.Join(src, "*.QBW"))
		}
		if len(matches) == 0 {
			return "", fmt.Errorf("quickbooks native: no .qbw in %s", src)
		}
		qbw = matches[0]
	} else if !strings.EqualFold(filepath.Ext(src), ".qbw") {
		return "", fmt.Errorf("quickbooks native: expected .qbw file, got %s", src)
	}

	exe := findQuickBooksAutoBackup()
	if exe == "" {
		return "", fmt.Errorf("quickbooks native: AutoBackupEXE.exe not found (install QuickBooks Desktop or use backup_type=files)")
	}

	// Output directory for the .qbb
	outDir := filepath.Join(workDir, name+"-qbb")
	_ = os.MkdirAll(outDir, 0o755)

	// AutoBackupEXE common flags: /F<path> forces company file.
	// /S silent. Additional /I ids come from scheduled tasks; omit when possible.
	cmd := exec.Command(exe, "/F"+qbw, "/S")
	cmd.Dir = outDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Some builds require working directory = company folder
		cmd = exec.Command(exe, "/F"+qbw, "/S")
		cmd.Dir = filepath.Dir(qbw)
		out2, err2 := cmd.CombinedOutput()
		if err2 != nil {
			return "", fmt.Errorf("AutoBackupEXE: %v (%s); retry: %v (%s)", err, bytesPreview(out), err2, bytesPreview(out2))
		}
	}

	// Locate newest .qbb near company file or outDir
	qbb := findNewestWithExt([]string{outDir, filepath.Dir(qbw), workDir}, ".qbb", 2*time.Minute)
	if qbb == "" {
		return "", fmt.Errorf("AutoBackupEXE finished but no .qbb found near %s", qbw)
	}
	// Move into workDir with stable name
	dst := outPath(workDir, name, ".qbb")
	if err := moveOrCopy(qbb, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func dumpQuickBooksFiles(workDir, name, src string, st os.FileInfo, opts Options) (string, error) {
	// Collect company set: directory of the .qbw, or the folder itself.
	root := src
	if !st.IsDir() {
		root = filepath.Dir(src)
	}
	stage := filepath.Join(workDir, name+"-stage")
	_ = os.RemoveAll(stage)
	_ = os.MkdirAll(stage, 0o755)

	var staged string
	var err error
	if opts.UseVSS {
		staged, err = withVSSCopy(root, stage)
	} else {
		staged, err = directCopyTree(root, stage, true)
	}
	if err != nil {
		return "", fmt.Errorf("quickbooks files: %w", err)
	}

	// If source was a single .qbw, prefer only companions for that company name.
	if !st.IsDir() {
		base := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
		filterCompanySet(staged, base)
	}

	out := outPath(workDir, name, ".tar.gz")
	if err := tarGzDir(staged, out); err != nil {
		return "", err
	}
	_ = os.RemoveAll(stage)
	return out, nil
}

func findQuickBooksAutoBackup() string {
	// Explicit env override for locked-down installs.
	if p := os.Getenv("QUICKBOOKS_AUTOBACKUP"); p != "" {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	candidates := []string{
		`C:\Program Files\Intuit\QuickBooks 2024\AutoBackupEXE.exe`,
		`C:\Program Files\Intuit\QuickBooks 2023\AutoBackupEXE.exe`,
		`C:\Program Files\Intuit\QuickBooks 2022\AutoBackupEXE.exe`,
		`C:\Program Files\Intuit\QuickBooks 2021\AutoBackupEXE.exe`,
		`C:\Program Files (x86)\Intuit\QuickBooks 2024\AutoBackupEXE.exe`,
		`C:\Program Files (x86)\Intuit\QuickBooks 2023\AutoBackupEXE.exe`,
		`C:\Program Files (x86)\Intuit\QuickBooks 2022\AutoBackupEXE.exe`,
		`C:\Program Files\Intuit\QuickBooks Enterprise Solutions 24.0\AutoBackupEXE.exe`,
		`C:\Program Files\Intuit\QuickBooks Enterprise Solutions 23.0\AutoBackupEXE.exe`,
		`C:\Program Files (x86)\Intuit\QuickBooks Enterprise Solutions 24.0\AutoBackupEXE.exe`,
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	if p := findExeUnderProgramFiles("AutoBackupEXE.exe"); p != "" {
		return p
	}
	if p, err := exec.LookPath("AutoBackupEXE.exe"); err == nil {
		return p
	}
	return ""
}

// filterCompanySet removes unrelated files, keeping base.* companions (.qbw, .tlg, .nd, .log, …).
func filterCompanySet(dir, base string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	prefix := strings.ToLower(base)
	for _, e := range entries {
		name := e.Name()
		low := strings.ToLower(name)
		// Keep files that share the company basename or are QB network helpers.
		if strings.HasPrefix(low, prefix+".") || strings.HasPrefix(low, prefix) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(dir, name))
	}
}

// dumpSage50 backs up Sage 50 / Peachtree company data.
func dumpSage50(workDir, name, uri string, opts Options) (string, error) {
	src := strings.TrimSpace(strings.TrimPrefix(uri, "file:"))
	if src == "" {
		return "", fmt.Errorf("sage50: path to company folder (or .ptb target dir) required")
	}
	st, err := os.Stat(src)
	if err != nil {
		return "", fmt.Errorf("sage50 path: %w", err)
	}

	mode := strings.ToLower(opts.BackupType)
	if mode == "" || mode == "full" {
		if opts.PreferNativeTools {
			mode = "native"
		} else {
			mode = "files"
		}
	}

	if mode == "native" || mode == "both" {
		ptb, nerr := runSageNative(workDir, name, src)
		if nerr == nil {
			return ptb, nil
		}
		if mode == "native" && !opts.PreferNativeTools {
			return "", nerr
		}
	}

	// File-set of company directory
	stage := filepath.Join(workDir, name+"-stage")
	_ = os.RemoveAll(stage)
	root := src
	if !st.IsDir() {
		root = filepath.Dir(src)
	}
	var staged string
	if opts.UseVSS {
		staged, err = withVSSCopy(root, stage)
	} else {
		staged, err = directCopyTree(root, stage, true)
	}
	if err != nil {
		return "", fmt.Errorf("sage50 files: %w", err)
	}
	out := outPath(workDir, name, ".tar.gz")
	if err := tarGzDir(staged, out); err != nil {
		return "", err
	}
	_ = os.RemoveAll(stage)
	return out, nil
}

func runSageNative(workDir, name, src string) (string, error) {
	// PeachtreeBackup.exe / Automatic Backup utility — often needs a .ptc config.
	// Support env override: SAGE50_BACKUP_CMD as a full command template with {src} {out}.
	if tmpl := os.Getenv("SAGE50_BACKUP_CMD"); tmpl != "" {
		out := outPath(workDir, name, ".ptb")
		cmdline := strings.ReplaceAll(tmpl, "{src}", src)
		cmdline = strings.ReplaceAll(cmdline, "{out}", out)
		cmd := exec.Command("cmd", "/C", cmdline)
		if b, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("sage50 cmd: %w (%s)", err, bytesPreview(b))
		}
		if _, err := os.Stat(out); err == nil {
			return out, nil
		}
	}

	exe := findSageBackupExe()
	if exe == "" {
		return "", fmt.Errorf("sage50 native: PeachtreeBackup.exe not found; set SAGE50_BACKUP_CMD or use backup_type=files")
	}
	outDir := filepath.Join(workDir, name+"-ptb")
	_ = os.MkdirAll(outDir, 0o755)
	// Best-effort invocation; many installs need a .ptc — document SAGE50_BACKUP_CMD for production.
	cmd := exec.Command(exe, src)
	cmd.Dir = outDir
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("PeachtreeBackup: %w (%s)", err, bytesPreview(b))
	}
	ptb := findNewestWithExt([]string{outDir, src, workDir}, ".ptb", 2*time.Minute)
	if ptb == "" {
		return "", fmt.Errorf("sage50 native: no .ptb produced")
	}
	dst := outPath(workDir, name, ".ptb")
	if err := moveOrCopy(ptb, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func findSageBackupExe() string {
	if p := os.Getenv("SAGE50_BACKUP_EXE"); p != "" {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	candidates := []string{
		`C:\Program Files (x86)\Sage\Peachtree\PeachtreeBackup.exe`,
		`C:\Program Files\Sage\Peachtree\PeachtreeBackup.exe`,
		`C:\Program Files (x86)\Sage\Sage 50\PeachtreeBackup.exe`,
		`C:\Program Files\Sage\Sage 50\PeachtreeBackup.exe`,
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	if p := findExeUnderProgramFiles("PeachtreeBackup.exe"); p != "" {
		return p
	}
	return ""
}

// dumpAccess backs up Microsoft Access databases (.accdb / .mdb) with optional VSS.
func dumpAccess(workDir, name, uri string, opts Options) (string, error) {
	src := strings.TrimSpace(strings.TrimPrefix(uri, "file:"))
	if src == "" {
		return "", fmt.Errorf("access: path to .accdb/.mdb required")
	}
	if _, err := os.Stat(src); err != nil {
		return "", fmt.Errorf("access path: %w", err)
	}
	stage := filepath.Join(workDir, name+"-stage")
	_ = os.RemoveAll(stage)
	_ = os.MkdirAll(stage, 0o755)

	var err error
	if opts.UseVSS {
		_, err = withVSSCopy(src, stage)
	} else {
		_, err = directCopyTree(src, stage, false)
	}
	if err != nil {
		return "", err
	}
	// Also grab lock files / companions next to the db when present.
	dir := filepath.Dir(src)
	base := strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))
	for _, ext := range []string{".laccdb", ".ldb", ".mdw"} {
		p := filepath.Join(dir, base+ext)
		if _, e := os.Stat(p); e == nil {
			_, _ = directCopyTree(p, stage, false)
		}
	}
	out := outPath(workDir, name, ".tar.gz")
	if err := tarGzDir(stage, out); err != nil {
		return "", err
	}
	_ = os.RemoveAll(stage)
	return out, nil
}

func findNewestWithExt(dirs []string, ext string, maxAge time.Duration) string {
	var best string
	var bestMod time.Time
	cutoff := time.Now().Add(-maxAge)
	for _, d := range dirs {
		_ = filepath.Walk(d, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if !strings.EqualFold(filepath.Ext(path), ext) {
				return nil
			}
			if info.ModTime().Before(cutoff) {
				return nil
			}
			if best == "" || info.ModTime().After(bestMod) {
				best = path
				bestMod = info.ModTime()
			}
			return nil
		})
	}
	return best
}

func moveOrCopy(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyFilePath(src, dst); err != nil {
		return err
	}
	_ = os.Remove(src)
	return nil
}

func bytesPreview(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 240 {
		return s[:240] + "…"
	}
	return s
}

func tarGzDir(srcDir, outFile string) error {
	// tar -czf out -C parent basename
	parent := filepath.Dir(srcDir)
	base := filepath.Base(srcDir)
	cmd := exec.Command("tar", "-czf", outFile, "-C", parent, base)
	if b, err := cmd.CombinedOutput(); err != nil {
		// Windows without tar: fall back to PowerShell Compress-Archive as zip
		zipOut := strings.TrimSuffix(outFile, ".tar.gz") + ".zip"
		ps := fmt.Sprintf(`Compress-Archive -Path '%s\*' -DestinationPath '%s' -Force`,
			strings.ReplaceAll(srcDir, `'`, `''`),
			strings.ReplaceAll(zipOut, `'`, `''`))
		if b2, err2 := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps).CombinedOutput(); err2 != nil {
			return fmt.Errorf("tar: %w (%s); zip: %v (%s)", err, bytesPreview(b), err2, bytesPreview(b2))
		}
		// Prefer returning the zip path by renaming expectation — caller uses returned path from dump*
		// Replace outFile with zip if tar missing.
		_ = os.Remove(outFile)
		if err := os.Rename(zipOut, outFile); err != nil {
			// leave as .zip
			return copyFilePath(zipOut, outFile)
		}
		return nil
	}
	return nil
}
