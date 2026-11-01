# Build VaultBackup Agent MSI (run on Windows with WiX Toolset installed).
# Prerequisites:
#   - Go 1.22+ (or use a pre-built .exe in this folder)
#   - WiX Toolset v3: https://wixtoolset.org/ (candle.exe + light.exe on PATH)
#
# Usage:
#   .\build-msi.ps1
#   .\build-msi.ps1 -Version 1.2.4 -SkipBuild

param(
    [string]$Version = "1.2.3",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "cmd\agent"))) {
    # packaging/windows -> repo root may be agent-source
    $Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
}
$Pack = $PSScriptRoot
$OutDir = Join-Path $Pack "out"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$ExeName = "vaultbackup-agent-windows-amd64.exe"
$ExePath = Join-Path $Pack $ExeName

if (-not $SkipBuild) {
    Write-Host "Building Windows amd64 exe..."
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $ldflags = "-s -w -X main.version=$Version"
    Push-Location $Root
    try {
        go build -ldflags $ldflags -o $ExePath ./cmd/agent
    } finally {
        Pop-Location
        Remove-Item Env:GOOS -ErrorAction SilentlyContinue
        Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $ExePath)) {
    throw "Missing $ExePath — build the agent first or copy the exe here."
}

# Placeholder icon if missing (WiX requires the file reference; create empty skip by copying exe as dummy not valid)
$Icon = Join-Path $Pack "icon.ico"
if (-not (Test-Path $Icon)) {
    throw "Missing icon.ico next to VaultBackupAgent.wxs"
}

$candle = Get-Command candle.exe -ErrorAction SilentlyContinue
$light  = Get-Command light.exe  -ErrorAction SilentlyContinue
if (-not $candle -or -not $light) {
    Write-Host ""
    Write-Host "WiX Toolset not found on PATH."
    Write-Host "Install WiX v3, then re-run this script."
    Write-Host "EXE is ready at: $ExePath"
    Write-Host ""
    Write-Host "Manual WiX commands:"
    Write-Host "  candle -dVersion=$Version -arch x64 VaultBackupAgent.wxs"
    Write-Host "  light  -ext WixUIExtension -out vaultbackup-agent-$Version-x64.msi VaultBackupAgent.wixobj"
    exit 2
}

Push-Location $Pack
try {
    & candle.exe -dVersion=$Version -arch x64 -out (Join-Path $OutDir "VaultBackupAgent.wixobj") VaultBackupAgent.wxs
    $msi = Join-Path $OutDir "vaultbackup-agent-$Version-x64.msi"
    & light.exe -ext WixUIExtension -out $msi (Join-Path $OutDir "VaultBackupAgent.wixobj")
    Write-Host "MSI built: $msi"
} finally {
    Pop-Location
}
