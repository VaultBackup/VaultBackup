# Build VaultBackup Agent MSI (run on Windows with WiX Toolset installed).
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
$License = Join-Path $Pack "License.rtf"

if (-not (Test-Path $License)) {
    throw "Missing License.rtf next to VaultBackupAgent.wxs (required for EULA dialog)"
}

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
    throw "Missing $ExePath"
}

$Icon = Join-Path $Pack "icon.ico"
if (-not (Test-Path $Icon)) {
    throw "Missing icon.ico"
}

$candle = Get-Command candle.exe -ErrorAction SilentlyContinue
$light  = Get-Command light.exe  -ErrorAction SilentlyContinue
if (-not $candle -or -not $light) {
    Write-Host "WiX Toolset not found on PATH."
    exit 2
}

Push-Location $Pack
try {
    $licFull = (Resolve-Path $License).Path
    Write-Host "Embedding license: $licFull"
    & candle.exe -dVersion=$Version "-dLicenseRtf=$licFull" -arch x64 -out (Join-Path $OutDir "VaultBackupAgent.wixobj") VaultBackupAgent.wxs
    if ($LASTEXITCODE -ne 0) { throw "candle failed" }
    $msi = Join-Path $OutDir "vaultbackup-agent-$Version-x64.msi"
    & light.exe -ext WixUIExtension -out $msi (Join-Path $OutDir "VaultBackupAgent.wixobj")
    if ($LASTEXITCODE -ne 0) { throw "light failed" }
    Write-Host "MSI built: $msi"
} finally {
    Pop-Location
}
