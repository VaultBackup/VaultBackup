VaultBackup Agent for Windows
=============================

Public downloads
----------------
  MSI (recommended):
    https://backup.enadoctemp.workers.dev/download/windows-msi

  Portable EXE:
    https://backup.enadoctemp.workers.dev/download/windows-amd64

  Install guide:
    https://backup.enadoctemp.workers.dev/install

Files (this package / repo)
---------------------------
  vaultbackup-agent-windows-amd64.exe   Portable agent
  vaultbackup-agent-windows-amd64.msi   Windows installer (repo root)
  vaultbackup-agent-1.2.3-x64.msi       Versioned MSI (repo root)
  config.example.json                   Sample configuration
  VaultBackupAgent.wxs                  WiX source
  build-msi.ps1                         Build MSI on Windows + WiX v3
  README.txt                            This file

MSI install (recommended)
-------------------------
  msiexec /i vaultbackup-agent-windows-amd64.msi
  msiexec /i vaultbackup-agent-windows-amd64.msi /qn
  msiexec /i vaultbackup-agent-windows-amd64.msi WEBUIPASSWORD=secret

  Then open:
    http://127.0.0.1:8787

  Paste your agent token (Dashboard → Desktop Agents → Create token).

Quick start (EXE)
-----------------
1. Copy vaultbackup-agent-windows-amd64.exe to a folder
   (e.g. C:\Program Files\VaultBackup Agent\).
2. Run:

     vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787

3. Open http://127.0.0.1:8787 and complete setup.

HTTPS Web UI (optional)
-----------------------
  vaultbackup-agent-windows-amd64.exe -config config.json ^
    -webui 0.0.0.0:8787 ^
    -webui-password "your-long-password" ^
    -webui-tls-cert C:\certs\ui.crt ^
    -webui-tls-key  C:\certs\ui.key

Build MSI from source
---------------------
  Prerequisites: Go 1.22+, WiX Toolset v3 (candle + light on PATH)

    .\build-msi.ps1 -Version 1.2.3

Uninstall
---------
  Settings → Apps → VaultBackup Agent
  or: msiexec /x vaultbackup-agent-windows-amd64.msi /qn

Support
-------
  Dashboard: https://backup.enadoctemp.workers.dev/
  Docs: INSTALL.md, RUN.md, CAPABILITIES.md in the repo root
