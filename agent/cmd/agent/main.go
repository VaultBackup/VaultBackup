package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/crypto"
	"github.com/vaultbackup/agent/internal/db"
	"github.com/vaultbackup/agent/internal/errcode"
	"github.com/vaultbackup/agent/internal/history"
	"github.com/vaultbackup/agent/internal/license"
	"github.com/vaultbackup/agent/internal/logging"
	"github.com/vaultbackup/agent/internal/notify"
	"github.com/vaultbackup/agent/internal/retention"
	"github.com/vaultbackup/agent/internal/schedule"
	"github.com/vaultbackup/agent/internal/secure"
	"github.com/vaultbackup/agent/internal/sysinfo"
	"github.com/vaultbackup/agent/internal/update"
	"github.com/vaultbackup/agent/internal/upload"
	"github.com/vaultbackup/agent/internal/webui"
)

var version = "1.3.0"

func main() {
	if isWindowsService() {
		runWindowsService()
		return
	}
	if err := runInteractive(); err != nil {
		log.Fatalf("%v", err)
	}
}

func runInteractive() error {
	configPath := flag.String("config", "config.yaml", "Config path")
	webuiAddr := flag.String("webui", "127.0.0.1:8787", "Web UI listen address")
	webuiPass := flag.String("webui-password", os.Getenv("WEBUI_PASSWORD"), "Optional UI password")
	webuiTLSCert := flag.String("webui-tls-cert", firstEnv("WEBUI_TLS_CERT", "VAULTBACKUP_WEBUI_TLS_CERT"), "PEM certificate for HTTPS Web UI")
	webuiTLSKey := flag.String("webui-tls-key", firstEnv("WEBUI_TLS_KEY", "VAULTBACKUP_WEBUI_TLS_KEY"), "PEM private key for HTTPS Web UI")
	noWebUI := flag.Bool("no-webui", false, "Disable Web UI")
	once := flag.Bool("once", false, "Run one backup then exit")
	backupType := flag.String("type", "", "Override backup type for this run")
	restore := flag.String("restore", "", "Decrypt encrypted backup file")
	restoreOut := flag.String("restore-out", "", "Output path for decrypted file")
	selfUpdate := flag.Bool("self-update", false, "Download and install the latest agent binary, then exit")
	flag.Parse()

	if *selfUpdate {
		cfg := config.LoadSoft(*configPath)
		server := cfg.License.ServerURL
		if server == "" {
			server = "https://backup.enadoctemp.workers.dev"
		}
		log.Printf("self-update: checking %s (current %s)", server, version)
		latest, err := update.Apply(server, version)
		if err != nil {
			return fmt.Errorf("self-update: %w", err)
		}
		log.Printf("self-update: installed %s — restart the agent/service to run the new binary", latest)
		return nil
	}

	if *restore != "" {
		runRestore(*configPath, *restore, *restoreOut)
		return nil
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	_ = os.MkdirAll(cfg.WorkDir, 0o700)
	history.Init(cfg.WorkDir)
	setupLogging(cfg)

	log.Printf("VaultBackup Agent %s starting (name=%s)", version, cfg.Name)

	var runMu sync.Mutex
	runBackup := func(typeOverride string) error {
		if !runMu.TryLock() {
			return fmt.Errorf("backup already running")
		}
		defer runMu.Unlock()
		ov := typeOverride
		if ov == "" {
			ov = *backupType
		}
		return doBackup(config.Get(), ov)
	}

	if *once {
		if err := runBackup(""); err != nil {
			return fmt.Errorf("backup: %w", err)
		}
		return nil
	}

	go licenseLoop()
	go statusLoop()
	go scheduleLoop(runBackup)

	if *noWebUI || *webuiAddr == "" {
		log.Printf("Web UI disabled")
		select {}
	}

	srv := webui.New(*webuiAddr, *webuiPass).WithTLS(*webuiTLSCert, *webuiTLSKey)
	srv.Version = version
	srv.OnRun = func() error { return runBackup("") }
	log.Printf("Web UI listening on %s://%s", srv.Scheme(), *webuiAddr)
	if strings.TrimSpace(*webuiPass) == "" {
		log.Printf("Web UI password not set — OK for loopback only; use -webui-password or WEBUI_PASSWORD if binding on LAN")
	} else {
		log.Printf("Web UI basic auth enabled")
	}
	if srv.TLSEnabled() {
		log.Printf("Web UI TLS enabled cert=%s", *webuiTLSCert)
	}
	if err := srv.Start(); err != nil {
		return fmt.Errorf("webui: %w", err)
	}
	return nil
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func doBackup(cfg config.Config, typeOverride string) error {
	// EULA: block all backup paths (UI, schedule, -once) until current terms accepted.
	if !cfg.TermsAccepted || cfg.TermsVersion != webui.TermsVersion {
		msg := "backup blocked: terms must be accepted (open Web UI and accept the EULA)"
		if cfg.TermsAccepted && cfg.TermsVersion != "" && cfg.TermsVersion != webui.TermsVersion {
			msg = "backup blocked: EULA updated — re-accept terms in the Web UI (version " + webui.TermsVersion + ")"
		}
		log.Print(msg)
		notify.Failure(cfg, "Terms required", msg)
		_ = license.PushEvent(cfg, map[string]any{
			"event": "backup_finished", "ok": false, "code": errcode.Unknown,
			"error": msg, "name": cfg.Name,
		})
		return fmt.Errorf("%s", msg)
	}

	ok, reason := license.Allowed()
	if !ok {
		if st, err := license.Check(cfg); err == nil && st.Allowed {
			ok, reason = true, ""
		} else if err != nil {
			reason = err.Error()
		} else if st.Reason != "" {
			reason = st.Reason
		}
	}
	if !ok {
		msg := "backup blocked: " + reason
		log.Print(msg)
		notify.Failure(cfg, "License blocked", reason)
		code := errcode.LicenseBlocked
		_ = license.PushCritical(cfg, msg)
		_ = license.PushEvent(cfg, map[string]any{
			"event": "backup_finished", "ok": false, "code": code,
			"error": msg, "name": cfg.Name,
		})
		return fmt.Errorf("%s", msg)
	}

	bt := cfg.Database.BackupType
	if typeOverride != "" {
		bt = typeOverride
	}
	const minWorkFree = 512 << 20
	if err := sysinfo.EnsureWorkSpace(cfg.WorkDir, minWorkFree); err != nil {
		log.Printf("backup blocked: %v", err)
		notify.Failure(cfg, "Disk space", err.Error())
		code := errcode.DiskFull
		_ = license.PushCritical(cfg, err.Error())
		_ = license.PushEvent(cfg, map[string]any{
			"event": "backup_finished", "ok": false, "code": code,
			"error": err.Error(), "type": bt, "name": cfg.Name,
		})
		return err
	}
	start := time.Now()
	_ = history.Append(history.Entry{Started: start, Status: "running", Type: bt})
	_ = license.PushEvent(cfg, map[string]any{
		"event": "backup_started", "type": bt, "name": cfg.Name,
		"db": cfg.Database.Type, "dest": cfg.Destination.Mode,
	})

	log.Printf("backup starting type=%s db=%s vss=%v native=%v", bt, cfg.Database.Type, cfg.Database.UseVSS, cfg.Database.PreferNativeTools)
	res, err := db.DumpWithOptions(cfg.WorkDir, cfg.Database.Type, cfg.Database.URI, db.Options{
		BackupType: bt, UseVSS: cfg.Database.UseVSS, PreferNativeTools: cfg.Database.PreferNativeTools,
	})
	if err != nil {
		code := errcode.Classify(err)
		red := secure.RedactText(err.Error())
		_ = history.Complete(start, history.Entry{
			Started: start, Finished: time.Now(), Status: "failed", Type: bt,
			Error: red, Code: code, Duration: time.Since(start).String(),
		})
		notify.Failure(cfg, "Backup failed", err.Error())
		_ = license.PushCritical(cfg, "backup failed: "+err.Error())
		_ = license.PushEvent(cfg, map[string]any{
			"event": "backup_finished", "ok": false, "code": code,
			"error": red, "type": bt, "name": cfg.Name, "duration": time.Since(start).Seconds(),
		})
		_ = license.PushLog(cfg, map[string]any{"level": "error", "code": code, "message": red, "name": cfg.Name})
		return err
	}

	uploadPath := res.Path
	if cfg.Security.Encrypt {
		key, kerr := crypto.LoadOrCreateKey(cfg.Security.KeyFile)
		if kerr != nil {
			code := errcode.EncryptFailed
			red := secure.RedactText(kerr.Error())
			_ = history.Complete(start, history.Entry{
				Started: start, Finished: time.Now(), Status: "failed", Type: bt,
				Error: red, Code: code, Duration: time.Since(start).String(),
			})
			_ = license.PushCritical(cfg, "encrypt key: "+kerr.Error())
			_ = license.PushEvent(cfg, map[string]any{"event": "backup_finished", "ok": false, "code": code, "error": red, "type": bt, "name": cfg.Name})
			return kerr
		}
		encPath := res.Path + ".vbenc"
		if err := crypto.EncryptFile(res.Path, encPath, key); err != nil {
			code := errcode.EncryptFailed
			red := secure.RedactText(err.Error())
			_ = history.Complete(start, history.Entry{
				Started: start, Finished: time.Now(), Status: "failed", Type: bt,
				Error: red, Code: code, Duration: time.Since(start).String(),
			})
			notify.Failure(cfg, "Encrypt failed", err.Error())
			_ = license.PushCritical(cfg, "encrypt failed: "+err.Error())
			_ = license.PushEvent(cfg, map[string]any{"event": "backup_finished", "ok": false, "code": code, "error": red, "type": bt, "name": cfg.Name})
			return err
		}
		_ = os.Remove(res.Path)
		uploadPath = encPath
		if st, e := os.Stat(uploadPath); e == nil {
			res.SizeBytes = st.Size()
		}
	}

	var progMu sync.Mutex
	var lastPct int = -1
	var lastProgAt time.Time
	upload.SetProgress(func(transferred, total int64) {
		if total <= 0 {
			return
		}
		pct := int(transferred * 100 / total)
		progMu.Lock()
		if pct/10 == lastPct/10 && time.Since(lastProgAt) < 15*time.Second && pct < 100 {
			progMu.Unlock()
			return
		}
		lastPct = pct
		lastProgAt = time.Now()
		progMu.Unlock()
		log.Printf("upload progress %d%% (%d / %d bytes)", pct, transferred, total)
		_ = license.PushEvent(cfg, map[string]any{
			"event": "upload_progress", "name": cfg.Name, "type": bt,
			"transferred": transferred, "total": total, "percent": pct,
			"dest": cfg.Destination.Mode,
		})
	})
	defer upload.SetProgress(nil)

	remote, err := upload.Put(cfg, uploadPath)
	if err != nil {
		code := errcode.Classify(err)
		if code == errcode.Unknown {
			code = errcode.UploadFailed
		}
		red := secure.RedactText(err.Error())
		_ = history.Complete(start, history.Entry{
			Started: start, Finished: time.Now(), Status: "failed", Type: bt,
			Error: red, Code: code, Path: uploadPath, Duration: time.Since(start).String(),
		})
		notify.Failure(cfg, "Upload failed", err.Error())
		_ = license.PushCritical(cfg, "upload failed: "+err.Error())
		_ = license.PushEvent(cfg, map[string]any{
			"event": "backup_finished", "ok": false, "code": code,
			"error": red, "type": bt, "name": cfg.Name, "duration": time.Since(start).Seconds(),
		})
		return err
	}

	dur := time.Since(start)
	_ = history.Complete(start, history.Entry{
		Started: start, Finished: time.Now(), Status: "ok", Type: bt, Code: errcode.OK,
		SizeBytes: res.SizeBytes, Path: remote, Message: "uploaded", Duration: dur.String(),
	})
	log.Printf("backup ok size=%d remote=%s in %s", res.SizeBytes, remote, dur)
	notify.Success(cfg, "Backup OK", fmt.Sprintf("size=%d remote=%s in %s", res.SizeBytes, remote, dur.Round(time.Second)))
	_ = license.PushEvent(cfg, map[string]any{
		"event": "backup_finished", "ok": true, "code": errcode.OK, "type": bt,
		"size": res.SizeBytes, "duration": dur.Seconds(), "remote": remote, "name": cfg.Name,
	})
	applyRetention(cfg)
	return nil
}

func applyRetention(cfg config.Config) {
	keep := cfg.Retention
	if keep <= 0 {
		keep = 14
	}
	pol := retention.Policy{
		Daily: cfg.RetentionPolicy.Daily, Weekly: cfg.RetentionPolicy.Weekly,
		Monthly: cfg.RetentionPolicy.Monthly, Yearly: cfg.RetentionPolicy.Yearly, Keep: keep,
	}
	if err := pol.Apply(cfg.WorkDir); err != nil {
		log.Printf("retention workdir: %v", err)
	}
	if err := upload.ApplyRetention(cfg, keep); err != nil {
		log.Printf("retention destination (%s): %v", cfg.Destination.Mode, err)
	}
}

func licenseLoop() {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		cfg := config.Get()
		if _, err := license.Check(cfg); err != nil {
			log.Printf("license: %v", err)
		}
		<-t.C
	}
}

func statusLoop() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		cfg := config.Get()
		host := sysinfo.Snapshot()
		status := map[string]any{"name": cfg.Name, "host": host, "version": version}
		server := cfg.License.ServerURL
		if server == "" {
			server = "https://backup.enadoctemp.workers.dev"
		}
		if latest, avail, err := update.Check(server, version); err == nil && avail {
			status["updateAvailable"] = true
			status["latestVersion"] = latest
		}
		_ = license.ReportStatus(cfg, status)
	}
}

func scheduleLoop(run func(typeOverride string) error) {
	lastFire := map[string]time.Time{}
	for {
		cfg := config.Get()
		logging.MaybeRotate(cfg.LogFile, cfg.LogMaxMB)
		now := time.Now().UTC()
		type jobRun struct{ key, name, spec, btype string }
		var jobs []jobRun
		if len(cfg.Jobs) > 0 {
			for i, j := range cfg.Jobs {
				spec := j.Schedule
				if spec == "" {
					spec = cfg.Schedule
				}
				bt := j.BackupType
				if bt == "" {
					bt = cfg.Database.BackupType
				}
				name := j.Name
				if name == "" {
					name = fmt.Sprintf("job-%d", i+1)
				}
				jobs = append(jobs, jobRun{key: name, name: name, spec: spec, btype: bt})
			}
		} else {
			jobs = append(jobs, jobRun{key: "default", name: cfg.Name, spec: cfg.Schedule, btype: ""})
		}
		wake := now.Add(time.Hour)
		for _, j := range jobs {
			spec, err := schedule.Parse(j.spec)
			if err != nil {
				log.Printf("schedule %s: %v", j.key, err)
				continue
			}
			next := spec.Next(now)
			if next.Before(wake) {
				wait := time.Until(next)
				if wait < 0 {
					wait = 0
				}
				lf := lastFire[j.key]
				sameMin := !lf.IsZero() && lf.Truncate(time.Minute).Equal(now.Truncate(time.Minute))
				if wait <= 30*time.Second && !sameMin {
					log.Printf("schedule: running job %q type=%s", j.name, j.btype)
					if err := run(j.btype); err != nil {
						log.Printf("scheduled job %q failed: %v", j.name, err)
					}
					lastFire[j.key] = time.Now().UTC()
					next = spec.Next(time.Now().UTC())
				}
				if next.Before(wake) {
					wake = next
				}
			}
		}
		sleep := time.Until(wake)
		if sleep < 5*time.Second {
			sleep = 5 * time.Second
		}
		if sleep > 5*time.Minute {
			sleep = 5 * time.Minute
		}
		log.Printf("schedule: sleeping %s", sleep.Round(time.Second))
		time.Sleep(sleep)
	}
}

func setupLogging(cfg config.Config) {
	if cfg.LogFile == "" {
		return
	}
	if err := logging.Setup(cfg.LogFile, cfg.LogMaxMB); err != nil {
		log.Printf("log file: %v", err)
	}
}

func runRestore(configPath, src, dst string) {
	cfg := config.LoadSoft(configPath)
	localSrc := src
	if _, err := os.Stat(src); err != nil {
		tmp := filepath.Join(cfg.WorkDir, "restore-"+filepath.Base(src))
		if err := os.MkdirAll(cfg.WorkDir, 0o755); err != nil {
			log.Fatalf("workdir: %v", err)
		}
		log.Printf("fetching %s from destination (%s)...", src, cfg.Destination.Mode)
		if err := upload.Get(cfg, src, tmp); err != nil {
			log.Fatalf("download: %v", err)
		}
		localSrc = tmp
		defer os.Remove(tmp)
	}
	key, err := crypto.LoadKeyProtected(cfg.Security.KeyFile)
	if err != nil {
		log.Fatalf("key: %v", err)
	}
	if dst == "" {
		dst = localSrc + ".decrypted"
	}
	if err := crypto.DecryptFile(localSrc, dst, key); err != nil {
		log.Fatalf("decrypt: %v", err)
	}
	log.Printf("decrypted -> %s", dst)
}
