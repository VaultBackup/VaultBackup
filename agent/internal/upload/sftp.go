package upload

import (
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
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
	cfg := &ssh.ClientConfig{
		User:            d.SFTPUser,
		Auth:            auth,
		HostKeyCallback: hostKeyCallback(d.SFTPInsecure),
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

func hostKeyCallback(insecure bool) ssh.HostKeyCallback {
	if insecure {
		return ssh.InsecureIgnoreHostKey() //nolint:gosec // explicit operator choice
	}
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("sftp: host key verification failed (set sftp_insecure=true to skip): no home dir")
		}
		khPath := home + "/.ssh/known_hosts"
		_, err = os.ReadFile(khPath)
		if err != nil {
			return fmt.Errorf("sftp: host key verification failed (missing known_hosts; set sftp_insecure=true): %w", err)
		}
		_ = key
		return fmt.Errorf("sftp: strict host key check requires pre-provisioned trust; set sftp_insecure=true for first deploy or pin keys via automation")
	}
}
