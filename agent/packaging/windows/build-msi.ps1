# Build VaultBackup Agent MSI (run on Windows with WiX Toolset installed).
# Prerequisites:
#   - Go 1.22+ (or use a pre-built .exe in this folder)
#   - WiX Toolset v3: https://wixtoolset.org/ (candle.exe + light.exe on PATH)
#
# Usage:
#   .\build-msi.ps1
#   .\build-msi.ps1 -Version 1.2.4 -SkipBuild
#
# CI: .github/workflows/build-agents.yml job "msi" builds this automatically.

param(
    [string]$Version = "1.2.3",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "cmd\agent"))) {
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

$Icon = Join-Path $Pack "icon.ico"
if (-not (Test-Path $Icon)) {
    Write-Host "icon.ico missing — writing a minimal placeholder icon for WiX."
    # Minimal valid ICO header + 1x1 pixel (WiX requires the file to exist)
    $bytes = [byte[]](
        0x00,0x00,0x01,0x00,0x01,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x18,0x00,
        0x30,0x00,0x00,0x00,0x16,0x00,0x00,0x00,
        0x28,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x01,0x00,0x18,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x80,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
    )
    [IO.File]::WriteAllBytes($Icon, $bytes)
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

# WiX Product/@Version must be numeric (major.minor.build.revision)
if ($Version -notmatch '^\d+(\.\d+){0,3}$') {
    Write-Host "Version '$Version' is not WiX-safe; using 1.2.3"
    $Version = "1.2.3"
}

Push-Location $Pack
try {
    & candle.exe -dVersion=$Version -arch x64 -out (Join-Path $OutDir "VaultBackupAgent.wixobj") VaultBackupAgent.wxs
    if ($LASTEXITCODE -ne 0) { throw "candle failed" }
    $msi = Join-Path $OutDir "vaultbackup-agent-$Version-x64.msi"
    & light.exe -ext WixUIExtension -out $msi (Join-Path $OutDir "VaultBackupAgent.wixobj")
    if ($LASTEXITCODE -ne 0) { throw "light failed" }
    Write-Host "MSI built: $msi"
} finally {
    Pop-Location
}
