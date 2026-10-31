VaultBackup Agent for Windows
=============================

Files
-----
  vaultbackup-agent.exe     Agent binary
  config.example.json       Sample configuration
  README.txt                This file

Quick start (EXE)
-----------------
1. Copy vaultbackup-agent.exe to a folder (e.g. C:\Program Files\VaultBackup Agent\).
2. Copy config.example.json to config.json and edit token / database / destination.
3. Run:

     vaultbackup-agent.exe -config config.json

4. Open the setup UI:

     http://127.0.0.1:8787

5. Paste your agent token (from the VaultBackup dashboard → Desktop Agents).

HTTPS Web UI (optional)
-----------------------
  vaultbackup-agent.exe -config config.json ^
    -webui 0.0.0.0:8787 ^
    -webui-password "your-long-password" ^
    -webui-tls-cert C:\certs\ui.crt ^
    -webui-tls-key  C:\certs\ui.key

MSI install
-----------
  msiexec /i vaultbackup-agent-VERSION-x64.msi /qn

  Optional properties:
    WEBUIPASSWORD=...   Local UI password
    AGENTTOKEN=...      (prefer setting token via UI after install)

Uninstall
---------
  Settings → Apps → VaultBackup Agent
  or: msiexec /x vaultbackup-agent-VERSION-x64.msi /qn

Support
-------
  Dashboard: https://backup.enadoctemp.workers.dev/

Icon
----
  icon.ico is embedded in vaultbackup-agent.exe (Windows).
  The MSI uses the same icon.ico for Add/Remove Programs.
