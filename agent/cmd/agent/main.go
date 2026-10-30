package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/crypto"
	"github.com/vaultbackup/agent/internal/db"
	"github.com/vaultbackup/agent/internal/history"
	"github.com/vaultbackup/agent/internal/license"
	"github.com/vaultbackup/agent/internal/notify"
	"github.com/vaultbackup/agent/internal/sysinfo"
	"github.com/vaultbackup/agent/internal/upload"
	"github.com/vaultbackup/agent/internal/webui"
)

var version = "1.2.3"

func main() {
	configPath := flag.String("config", "config.yaml", "Config path")
	webuiAddr := flag.String("webui", "127.0.0.1:8787", "Web UI listen address")
	webuiPass := flag.String("webui-password", os.Getenv("WEBUI_PASSWORD"), "Optional UI password")
	noWebUI := flag.Bool("no-webui", false, "Disable Web UI")
	once := flag.Bool("once", false, "Run one backup then exit")
	backupType := flag.String("type", "", "Override backup type for this run")
	restore := flag.String("restore", "", "Decrypt encrypted backup file")
	restoreOut := flag.String("restore-out", "", "Output path for decrypted file")
	flag.Parse()

	if *restore != "" {
		runRestore(*configPath, *restore, *restoreOut)
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	_ = os.MkdirAll(cfg.WorkDir, 0o755)
	history.Init(cfg.WorkDir)
	setupLogging(cfg)

	log.Printf("VaultBackup Agent %s starting (name=%s)", version, cfg.Name)

	var runMu sync.Mutex
	runBackup := func() error {
		if !runMu.TryLock() {
			return fmt.Errorf("backup already running")
		}
		defer runMu.Unlock()
		return doBackup(config.Get(), *backupType)
	}

	if *once {
		if err := runBackup(); err != nil {
			log.Fatalf("backup: %v", err)
		}
		return
	}

	go licenseLoop()
	go statusLoop()
	go scheduleLoop(cfg.Schedule, runBackup)

	if *noWebUI || *webuiAddr == "" {
		log.Printf("Web UI disabled")
		select {}
	}

	srv := webui.New(*webuiAddr, *webuiPass)
	srv.OnRun = runBackup
	log.Printf("Web UI listening on http://%s", *webuiAddr)
	if err := srv.Start(); err != nil {
		log.Fatalf("webui: %v", err)
	}
}

func doBackup(cfg config.Config, typeOverride string) error {
	ok, reason := license.Allowed()
	if !ok {
		msg := "backup blocked: " + reason
		log.Print(msg)
		notify.Failure(cfg, "License blocked",", reason)
		return fmt.Errorf("%s", msg)
	}

	bt := cfg.Database.BackupType
	if typeOverride != "" {
		bt = typeOverride
	}
	start := time.Now()
	_ = history.Append(history.Entry{Started: start, Status: "running", Type: bt})

	log.Printf("backup starting type=%s db=%s", bt, cfg.Database.Type)
	res, err := db.Dump(cfg.WorkDir, cfg.Database.Type, cfg.Database.URI, bt)
	if err != nil {
		_ = history.Append(history.Entry{
			Started: start, Finished: time.Now(), Status: "failed", Type: bt,
			Error: err.Error(), Duration: time.Since(start).String(),
		})
		notify.Failure(cfg, "Backup failed", err.Error())
		_ = license.PushEvent(cfg, map[string]any{"event": "backup_finished", "ok": false, "error": err.Error(), "type": bt, "name": cfg.Name})
		return err
	}

	uploadPath := res.Path
	if cfg.Security.Encrypt {
		key, kerr := crypto.LoadOrCreateKey(cfg.Security.KeyFile)
		if kerr != nil {
			return kerr
		}
		encPath := res.Path + ".vbenc"
		if err := crypto.EncryptFile(res.Path, encPath, key); err != nil {
			return err
		}
		_ = os.Remove(res.Path)
		uploadPath = encPath
		if st, e := os.Stat(uploadPath); e == nil {
			res.SizeBytes = st.Size()
		}
	}

	remote, err := upload.Put(cfg, uploadPath)
	if err != nil {
		_ = history.Append(history.Entry{
			Started: start, Finished: time.Now(), Status: "failed", Type: bt,
			Error: err.Error(), Path: uploadPath, Duration: time.Since(start).String(),
		})
		notify.Failure(cfg, "Upload failed", err.Error())
		return err
	}

	dur := time.Since(start)
	_ = history.Append(history.Entry{
		Started: start, Finished: time.Now(), Status: "ok", Type: bt,
		SizeBytes: res.SizeBytes, Path: remote, Message: "uploaded", Duration: dur.String(),
	})
	log.Printf("backup ok size=%d remote=%s in %s", res.SizeBytes, remote, dur)
	_ = license.PushEvent(cfg, map[string]any{
		"event": "backup_finished", "ok": true, "type": bt, "size": res.SizeBytes,
		"duration": dur.Seconds(), "remote": remote, "name": cfg.Name,
	})
	return nil
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
		_ = license.ReportStatus(cfg, map[string]any{"name": cfg.Name, "host": host, "version": version})
	}
}

func scheduleLoop(spec string, fn func() error) {
	var minute, hour int = 0, 3
	fmt.Sscanf(spec, "%d %d", &minute, &hour)
	for {
		now := time.Now().UTC()
		next := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, time.UTC)
		if !next.After(now) {
			next = next.Add(24 * time.Hour)
		}
		time.Sleep(time.Until(next))
		if err := fn(); err != nil {
			log.Printf("scheduled backup failed: %v", err)
		}
	}
}

func setupLogging(cfg config.Config) {
	if cfg.LogFile == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(cfg.LogFile), 0o755)
	f, err := os.OpenFile(cfg.LogFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("log file: %v", err)
		return
	}
	log.SetOutput(f)
}

func runRestore(configPath, src, dst string) {
	cfg := config.LoadSoft(configPath)
	key, err := crypto.LoadKeyProtected(cfg.Security.KeyFile)
	if err != nil {
		log.Fatalf("key: %v", err)
	}
	if dst == "" {
		dst = src + ".decrypted"
	}
	if err := crypto.DecryptFile(src, dst, key); err != nil {
		log.Fatalf("decrypt: %v", err)
	}
	log.Printf("decrypted → %s", dst)
}
