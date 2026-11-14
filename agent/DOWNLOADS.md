# Agent downloads

Binaries are published by the **Build Agent Binaries** workflow and served from the license worker:

```
https://backup.enadoctemp.workers.dev/download/linux-amd64
https://backup.enadoctemp.workers.dev/download/linux-arm64
https://backup.enadoctemp.workers.dev/download/darwin-amd64
https://backup.enadoctemp.workers.dev/download/darwin-arm64
https://backup.enadoctemp.workers.dev/download/windows-amd64
https://backup.enadoctemp.workers.dev/download/windows-arm64
```

Notes:
- Use **GET** (curl/browser download). Some **HEAD** probes return 401; that is cosmetic when `GH_TOKEN` is set on the worker.
- Windows MSI is produced by the same workflow when WiX steps succeed.
- macOS `.pkg`: build on a Mac with `packaging/macos/build-pkg.sh`.
- Linux `.deb`: `packaging/linux/build-deb.sh`.

## Verify

```bash
curl -fsSL -o vaultbackup-agent https://backup.enadoctemp.workers.dev/download/linux-amd64
chmod +x vaultbackup-agent
./vaultbackup-agent -h
```
