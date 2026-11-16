package upload

import (
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"github.com/vaultbackup/agent/internal/config"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func putSFTP(d config.Destination, localPath string) (string, error) {
	if d.SFTPHost == "" || d.SFTPUser == "" {
		return "", fmt.Errorf("sftp_host and sftp_user required")
	}
	host := d.SFTPHost
	if !strings.Contains(host, ":") {
		host = host + ":22"
	}

	auth, err := sftpAuthMethods(d)
	if err != nil {
		return "", err
	}
	hkcb, err := hostKeyCallback(d.SFTPInsecure)
	if err != nil {
		return "", err
	}
	cfg := &ssh.ClientConfig{
		User:            d.SFTPUser,
		Auth:            auth,
		HostKeyCallback: hkcb,
		Timeout:         30 * time.Second,
	}
	conn, err := ssh.Dial("tcp", host, cfg)
	if err != nil {
		return "", fmt.Errorf("sftp ssh dial: %w", err)
	}
	defer conn.Close()

	sc, err := sftp.NewClient(conn)
	if err != nil {
		return "", fmt.Errorf("sftp client: %w", err)
	}
	defer sc.Close()

	remoteDir := strings.TrimSpace(d.SFTPPath)
	if remoteDir == "" {
		remoteDir = "."
	}
	remotePath := path.Join(remoteDir, path.Base(localPath))
	// Ensure parent exists
	_ = sc.MkdirAll(path.Dir(remotePath))

	src, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer src.Close()
	st, _ := src.Stat()
	var total int64
	if st != nil {
		total = st.Size()
	}

	dst, err := sc.OpenFile(remotePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return "", fmt.Errorf("sftp open remote: %w", err)
	}
	defer dst.Close()

	reportProgress(0, total)
	pr := newProgressReader(src, total)
	if _, err := io.Copy(dst, pr); err != nil {
		return "", fmt.Errorf("sftp copy: %w", err)
	}
	reportProgress(total, total)
	return remotePath, nil
}

func sftpAuthMethods(d config.Destination) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod
	if d.SFTPKeyFile != "" {
		key, err := os.ReadFile(d.SFTPKeyFile)
		if err != nil {
			return nil, fmt.Errorf("sftp key file: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			return nil, fmt.Errorf("sftp parse key: %w", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}
	if d.SFTPPassword != "" {
		methods = append(methods, ssh.Password(d.SFTPPassword))
	}
	if len(methods) == 0 {
		return nil, fmt.Errorf("sftp: provide sftp_password or sftp_key_file")
	}
	return methods, nil
}

// hostKeyCallback returns a proper known_hosts verifier when available,
// or InsecureIgnoreHostKey when the operator explicitly opts in.
func hostKeyCallback(insecure bool) (ssh.HostKeyCallback, error) {
	if insecure {
		return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec // explicit operator choice
	}
	var files []string
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".ssh", "known_hosts")
		if _, err := os.Stat(p); err == nil {
			files = append(files, p)
		}
	}
	// Also honor system-wide known_hosts when present (common on Linux agents).
	for _, p := range []string{"/etc/ssh/ssh_known_hosts", "/etc/ssh/known_hosts"} {
		if _, err := os.Stat(p); err == nil {
			files = append(files, p)
		}
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("sftp: no known_hosts found (tried ~/.ssh/known_hosts and /etc/ssh/*); run ssh-keyscan or set sftp_insecure=true")
	}
	cb, err := knownhosts.New(files...)
	if err != nil {
		return nil, fmt.Errorf("sftp: load known_hosts: %w (or set sftp_insecure=true)", err)
	}
	// Wrap to produce a clearer agent-oriented error on mismatch / unknown host.
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if err := cb(hostname, remote, key); err != nil {
			return fmt.Errorf("sftp: host key verification failed for %s: %w (add host via ssh-keyscan or set sftp_insecure=true)", hostname, err)
		}
		return nil
	}, nil
}
