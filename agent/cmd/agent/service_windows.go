//go:build windows

package main

import (
	"log"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/debug"
	"golang.org/x/sys/windows/svc/eventlog"
)

const windowsServiceName = "VaultBackupAgent"

// isWindowsService reports whether this process was started by the SCM.
func isWindowsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// runWindowsService runs the agent under the Windows Service Control Manager.
// Required for MSI ServiceInstall — a plain main() does not respond to SCM and
// Windows marks the service as failed while the same EXE still works interactively.
func runWindowsService() {
	elog, err := eventlog.Open(windowsServiceName)
	if err != nil {
		_ = runService(windowsServiceName, debug.New(windowsServiceName))
		return
	}
	defer elog.Close()
	_ = elog.Info(1, "VaultBackup Agent service starting")
	err = runService(windowsServiceName, elog)
	if err != nil {
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
	changes <- svc.Status{State: svc.StartPending}

	stop := make(chan struct{})
	errCh := make(chan error, 1)

	go func() {
		errCh <- runInteractive()
		close(stop)
	}()

	time.Sleep(500 * time.Millisecond)
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	_ = m.elog.Info(1, "VaultBackup Agent service running")

	for {
		select {
		case <-stop:
			changes <- svc.Status{State: svc.Stopped}
			if err := <-errCh; err != nil {
				_ = m.elog.Error(1, err.Error())
				return true, 1
			}
			return false, 0
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				_ = m.elog.Info(1, "VaultBackup Agent service stop requested")
				changes <- svc.Status{State: svc.StopPending}
				os.Exit(0)
			default:
				_ = m.elog.Error(1, "unexpected service control request")
			}
		}
	}
}
