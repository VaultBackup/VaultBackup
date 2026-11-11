//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"
	"golang.org/x/sys/windows/svc/eventlog"
)

const windowsServiceName = "VaultBackupAgent"

func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

func runWindowsService() {
	elog, err := eventlog.Open(windowsServiceName)
	if err != nil {
		_ = runService(windowsServiceName, debug.New(windowsServiceName))
		return
	}
	defer elog.Close()
	_ = elog.Info(1, "VaultBackup Agent service starting")
	if err := runService(windowsServiceName, elog); err != nil {
		_ = elog.Error(1, "service stopped: "+err.Error())
		log.Printf("service error: %v", err)
	}
}

type eventLog interface {
	Info(eid uint32, msg string) error
	Error(eid uint32, msg string) error
}

func runService(name string, elog eventLog) error {
	return svc.Run(name, &agentService{elog: elog})
}

type agentService struct {
	elog eventLog
}

func (m *agentService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown

	// Report Running ASAP so MSI ServiceControl does not time out / fail the install.
	changes <- svc.Status{State: svc.StartPending}
	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
	_ = m.elog.Info(1, "VaultBackup Agent service running")

	ensureServiceDirs()

	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := runInteractive(); err != nil {
			_ = m.elog.Error(1, "agent exit: "+err.Error())
			log.Printf("agent exit: %v", err)
		}
	}()

	for {
		select {
		case <-done:
			changes <- svc.Status{State: svc.StopPending}
			changes <- svc.Status{State: svc.Stopped}
			return false, 0
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				_ = m.elog.Info(1, "stop requested")
				changes <- svc.Status{State: svc.StopPending}
				os.Exit(0)
			default:
			}
		}
	}
}

func ensureServiceDirs() {
	roots := []string{
		filepath.Join(os.Getenv("ProgramData"), "VaultBackup", "Agent"),
		filepath.Join(os.Getenv("ProgramData"), "VaultBackup", "data"),
	}
	for _, d := range roots {
		if d != "" && d != string(filepath.Separator) {
			_ = os.MkdirAll(d, 0o700)
		}
	}
}
