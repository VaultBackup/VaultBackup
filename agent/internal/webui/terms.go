package webui

// TermsVersion bumps when the legal text changes; agents must re-accept.
const TermsVersion = "2026-11-11"

// TermsText is the end-user license / terms shown in the agent Web UI.
const TermsText = `VaultBackup Agent — End User License Agreement (EULA) and Terms of Use
Version 2026-11-11

1. License
Subject to a valid license token issued by the VaultBackup control plane, you are granted a limited, non-exclusive, non-transferable license to install and run the VaultBackup Agent software ("Agent") solely to back up databases and files you are authorized to access, and to store resulting backup objects on storage destinations you configure.

2. Your data and storage
Backups are written to destinations you choose (local disk, S3-compatible, Azure, WebDAV, SFTP, or similar). You are responsible for the security, retention, legality, and cost of that storage. VaultBackup does not claim ownership of your database contents or backup files.

3. Acceptable use
You may use the Agent only for lawful purposes and only on systems and data for which you have permission. You must not use the Agent to violate others' rights, to attack systems, or to circumvent license or security controls.

4. Capabilities and limitations
The Agent provides logical and/or file-level backups depending on engine and platform. It is not a substitute for database vendor physical backup products (for example Oracle RMAN) unless you explicitly configure native tools. Platform features such as Windows VSS apply only where documented. IBM i / AS/400 support requires appropriate network access, credentials, and authority on the IBM i system.

5. License checks
The Agent periodically validates your license token with the VaultBackup license service. Offline operation may be allowed for a limited grace period. Revocation or expiry of the license may disable backup runs.

6. Disclaimer
THE AGENT IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. YOU ASSUME ALL RISK FOR BACKUP SUCCESS, RESTORE SUCCESS, AND DATA LOSS.

7. Limitation of liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, VAULTBACKUP AND ITS SUPPLIERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR BUSINESS, ARISING FROM USE OF THE AGENT.

8. Acceptance
By checking "I agree" in the Agent setup UI, or by continuing to run backups after installing the Agent, you accept this agreement. If you do not agree, do not use the Agent and uninstall it.

For product terms on the control plane website, see your VaultBackup dashboard or operator documentation.
`
