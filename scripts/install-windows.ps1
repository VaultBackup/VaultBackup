# VaultBackup Agent — Windows installer (Task Scheduler + aggressive auto-restart)
# Run as Administrator:  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# Optional:  -BinaryPath .\dist\vaultbackup-agent-windows-amd64.exe

param(
    [string]$BinaryPath = "",
    [string]$Prefix = "C:\VaultBackup",
    [string]$TaskName = "VaultBackupAgent"
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this script as Administrator."
}

if (-not $BinaryPath) {
    if (Test-Path ".\vaultbackup-agent.exe") { $BinaryPath = ".\vaultbackup-agent.exe" }
    elseif (Test-Path ".\dist\vaultbackup-agent-windows-amd64.exe") { $BinaryPath = ".\dist\vaultbackup-agent-windows-amd64.exe" }
    elseif (Test-Path ".\vaultbackup-agent-windows-amd64.exe") { $BinaryPath = ".\vaultbackup-agent-windows-amd64.exe" }
    else { Write-Error "Pass -BinaryPath to the agent .exe" }
}

Write-Host "==> Installing VaultBackup Agent to $Prefix"

New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
New-Item -ItemType Directory -Force -Path "$Prefix\work" | Out-Null
New-Item -ItemType Directory -Force -Path "$Prefix\logs" | Out-Null

Copy-Item -Force $BinaryPath "$Prefix\vaultbackup-agent.exe"

if (-not (Test-Path "$Prefix\config.yaml")) {
    if (Test-Path ".\config.example.yaml") {
        Copy-Item ".\config.example.yaml" "$Prefix\config.yaml"
        # Force absolute Windows paths
        (Get-Content "$Prefix\config.yaml") `
            -replace 'work_dir:\s*.*', "work_dir: $Prefix\work" `
            -replace 'log_file:\s*.*', "log_file: $Prefix\logs\agent.log" `
            | Set-Content -Path "$Prefix\config.yaml" -Encoding UTF8
    } else {
        @"
name: agent
work_dir: $Prefix\work
log_file: $Prefix\logs\agent.log
log_max_mb: 20
schedule: "0 2 * * *"
compression: gzip

license:
  server_url: ""
  token: ""
  check_every_hours: 6

notify:
  webhook_url: ""

database:
  type: ""
  uri: ""

destination:
  mode: ""
"@ | Set-Content -Path "$Prefix\config.yaml" -Encoding UTF8
    }
}

# Remove old task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$exe = "$Prefix\vaultbackup-agent.exe"
$arg = "-config `"$Prefix\config.yaml`" -webui=127.0.0.1:8787"

# Explicit WorkingDirectory so relative paths in config never break after reboot
$action = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $Prefix

# Start at boot
$triggerStartup = New-ScheduledTaskTrigger -AtStartup

# Daily safety-net trigger (03:15) — re-enables / restarts the agent even if the
# task was somehow disabled or the process is stuck
$triggerDaily = New-ScheduledTaskTrigger -Daily -At "03:15"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -MultipleInstances IgnoreNew `
    -Priority 4

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger @($triggerStartup, $triggerDaily) `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

# Also start immediately
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Installed scheduled task '$TaskName' (runs as SYSTEM, restarts on failure)."
Write-Host "  Config : $Prefix\config.yaml"
Write-Host "  Binary : $Prefix\vaultbackup-agent.exe"
Write-Host "  Web UI : http://127.0.0.1:8787  (localhost only)"
Write-Host "  Status : Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "IMPORTANT:"
Write-Host "  1. Edit $Prefix\config.yaml — set license.server_url + token"
Write-Host "  2. Open http://127.0.0.1:8787 → Test license → confirm License OK"
Write-Host "  3. Set notify.webhook_url for alerts on critical errors"
Write-Host "  4. Restart: Restart-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "License: agent must reach the Worker at least once every 72 hours."
Write-Host "Monitor console for agents offline > 48 h."
Write-Host "Daily safety-net trigger at 03:15 keeps the task alive."
