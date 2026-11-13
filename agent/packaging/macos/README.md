# macOS packaging

## Artifacts

| Item | Status |
|------|--------|
| `vaultbackup-agent-darwin-arm64` / `darwin-amd64` | Built by CI |
| `scripts/install-macos.sh` | launchd installer (script) |
| `packaging/macos/build-pkg.sh` | Builds a `.pkg` (run on macOS) |
| `packaging/macos/entitlements.plist` | Hardened Runtime entitlements |
| Codesign + notarize | CI job `sign-macos` when Apple secrets are set |

## Install options

1. **Script (works without Apple Developer ID)**
   ```bash
   chmod +x vaultbackup-agent-darwin-arm64
   sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64
   open http://127.0.0.1:8787
   ```

2. **PKG** (build on a Mac with Xcode CLT):
   ```bash
   ./agent/packaging/macos/build-pkg.sh ./vaultbackup-agent-darwin-arm64 1.2.6
   sudo installer -pkg agent/packaging/macos/out/vaultbackup-agent-1.2.6-darwin-arm64.pkg -target /
   ```

## Signing secrets (GitHub Actions)

- `APPLE_CERTIFICATE_BASE64` — Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_IDENTITY` — e.g. `Developer ID Application: …`
- Optional notarization: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_BASE64`

Without these, CI still publishes **unsigned** Darwin binaries (Gatekeeper may require right-click → Open).

## Worker public downloads

Set Worker secret `GH_TOKEN` (repo contents:read) **or** upload binaries to R2 under `agents/<filename>` so `/download/darwin-arm64` works without authentication.
