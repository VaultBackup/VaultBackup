# Silent-style installer without MSI (copies EXE + creates optional scheduled task).
# Run elevated PowerShell:
#   .\install-agent.ps1
#   .\install-agent.ps1 -InstallDir "C:\Program Files\VaultBackup Agent" -Token "..."

param(
    [string]$InstallDir = "$env:ProgramFiles\VaultBackup Agent",
    [string]$Token = "",
    [string]$WebUIPassword = "",
    [switch]$NoTask
)

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot

$exeSrc = Join-Path $Here "vaultbackup-agent-windows-amd64.exe"
if (-not (Test-Path $exeSrc)) {
    $exeSrc = Join-Path $Here "vaultbackup-agent.exe"
}
if (-not (Test-Path $exeSrc)) {
    throw "Place vaultbackup-agent-windows-amd64.exe next to this script."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$dataDir = Join-Path $env:ProgramData "VaultBackup\data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$exeDst = Join-Path $InstallDir "vaultbackup-agent.exe"
Copy-Item -Force $exeSrc $exeDst

$cfgPath = Join-Path $InstallDir "config.json"
$example = Join-Path $Here "config.example.json"
if (-not (Test-Path $cfgPath)) {
    if (Test-Path $example) {
        Copy-Item $example $cfgPath
    } else {
        @"
{
  "name": "$env:COMPUTERNAME",
  "schedule": "0 3 * * *",
  "work_dir": $($dataDir -replace '\\','\\' | ForEach-Object { '"' + $_ + '"' }),
  "log_file": "$((Join-Path $dataDir 'agent.log') -replace '\\','\\')",
  "license": { "token": "$Token" },
  "security": { "encrypt": true, "key_file": "$((Join-Path $dataDir 'agent.key') -replace '\\','\\')" },
  "database": { "type": "postgres", "uri": "", "backup_type": "full" },
  "destination": { "mode": "local", "local_dir": "$((Join-Path $dataDir 'out') -replace '\\','\\')" }
}
"@ | Set-Content -Encoding UTF8 $cfgPath
    }
}

if ($Token) {
    $json = Get-Content $cfgPath -Raw | ConvertFrom-Json
    $json.license.token = $Token
    $json | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $cfgPath
}

# ACL: restrict config to Administrators + SYSTEM
icacls $cfgPath /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" | Out-Null

$arg = "-config `"$cfgPath`" -webui 127.0.0.1:8787"
if ($WebUIPassword) {
    $arg += " -webui-password `"$WebUIPassword`""
}

if (-not $NoTask) {
    $action = New-ScheduledTaskAction -Execute $exeDst -Argument $arg -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "VaultBackupAgent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName "VaultBackupAgent"
    Write-Host "Scheduled task VaultBackupAgent registered and started."
}

Write-Host "Installed to $InstallDir"
Write-Host "Open UI: http://127.0.0.1:8787"
Write-Host "Config:  $cfgPath"
