package upload

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

const (
	webdavChunkThreshold = 64 << 20 // 64 MiB
	webdavPartSize       = 8 << 20  // 8 MiB
)

// putWebDAV uploads with adaptive large-file fallbacks.
func putWebDAV(d config.Destination, localPath string) (string, error) {
	if d.WebDAVURL == "" {
		return "", fmt.Errorf("webdav_url required")
	}
	base := strings.TrimRight(d.WebDAVURL, "/")
	_ = webdavEnsureCollection(d, base)
	remote := base + "/" + path.Base(localPath)

	st, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	size := st.Size()

	if size < webdavChunkThreshold {
		if err := putWebDAVSingle(d, remote, localPath, size); err != nil {
			return "", err
		}
		return remote, nil
	}

	var errs []string
	if looksLikeNextcloud(base) {
		if key, err := putWebDAVNextcloudChunked(d, base, localPath, size); err == nil {
			return key, nil
		} else {
			errs = append(errs, "nextcloud-chunk: "+err.Error())
		}
	}
	if err := putWebDAVContentRange(d, remote, localPath, size); err == nil {
		return remote, nil
	} else {
		errs = append(errs, "content-range: "+err.Error())
	}
	if err := putWebDAVSabreAppend(d, remote, localPath, size); err == nil {
		return remote, nil
	} else {
		errs = append(errs, "sabre-patch: "+err.Error())
	}
	if err := putWebDAVSingle(d, remote, localPath, size); err == nil {
		return remote, nil
	} else {
		errs = append(errs, "single-put: "+err.Error())
	}
	return "", fmt.Errorf("webdav large upload failed (%s)", strings.Join(errs, "; "))
}

func putWebDAVSingle(d config.Destination, remote, localPath string, size int64) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	req, err := http.NewRequest(http.MethodPut, remote, f)
	if err != nil {
		return err
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", "application/octet-stream")
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("webdav put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func putWebDAVContentRange(d config.Destination, remote, localPath string, size int64) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	buf := make([]byte, webdavPartSize)
	var offset int64
	reportProgress(0, size)
	for offset < size {
		n, rerr := io.ReadFull(f, buf)
		if n == 0 {
			if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
				break
			}
			return rerr
		}
		end := offset + int64(n) - 1
		rangeHdr := fmt.Sprintf("bytes %d-%d/*", offset, end)
		req, err := http.NewRequest(http.MethodPut, remote, &byteReader{b: buf[:n]})
		if err != nil {
			return err
		}
		req.ContentLength = int64(n)
		req.Header.Set("Content-Type", "application/octet-stream")
		req.Header.Set("Content-Range", rangeHdr)
		if d.WebDAVUser != "" {
			req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
		}
		resp, err := httpx.UploadClient.Do(req)
		if err != nil {
			return fmt.Errorf("content-range put at %d: %w", offset, err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotImplemented || resp.StatusCode == http.StatusMethodNotAllowed {
			return fmt.Errorf("server rejected Content-Range PUT (HTTP %d)", resp.StatusCode)
		}
		if resp.StatusCode >= 300 {
			return fmt.Errorf("content-range put HTTP %d at offset %d: %s", resp.StatusCode, offset, string(body))
		}
		offset += int64(n)
		reportProgress(offset, size)
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

type byteReader struct {
	b []byte
	i int
}

func (r *byteReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}

func putWebDAVSabreAppend(d config.Destination, remote, localPath string, size int64) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	buf := make([]byte, webdavPartSize)
	var offset int64
	first := true
	reportProgress(0, size)
	for offset < size {
		n, rerr := io.ReadFull(f, buf)
		if n == 0 {
			if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
				break
			}
			return rerr
		}
		chunk := buf[:n]
		var req *http.Request
		if first {
			req, err = http.NewRequest(http.MethodPut, remote, &byteReader{b: chunk})
			if err != nil {
				return err
			}
			req.Header.Set("Content-Type", "application/octet-stream")
		} else {
			req, err = http.NewRequest(http.MethodPatch, remote, &byteReader{b: chunk})
			if err != nil {
				return err
			}
			req.Header.Set("Content-Type", "application/x-sabredav-partialupdate")
			req.Header.Set("X-Update-Range", "append")
		}
		req.ContentLength = int64(n)
		if d.WebDAVUser != "" {
			req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
		}
		resp, err := httpx.UploadClient.Do(req)
		if err != nil {
			return fmt.Errorf("sabre chunk at %d: %w", offset, err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotImplemented || resp.StatusCode == http.StatusMethodNotAllowed {
			return fmt.Errorf("server rejected SabreDAV PATCH (HTTP %d)", resp.StatusCode)
		}
		if resp.StatusCode >= 300 {
			return fmt.Errorf("sabre chunk HTTP %d at offset %d: %s", resp.StatusCode, offset, string(body))
		}
		first = false
		offset += int64(n)
		reportProgress(offset, size)
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return nil
}

func looksLikeNextcloud(base string) bool {
	u := strings.ToLower(base)
	return strings.Contains(u, "/remote.php/dav") ||
		strings.Contains(u, "/remote.php/webdav") ||
		strings.Contains(u, "/dav/files/") ||
		strings.Contains(u, "/ocs/v")
}

func putWebDAVNextcloudChunked(d config.Destination, base, localPath string, size int64) (string, error) {
	user := webdavUserFromURL(base, d.WebDAVUser)
	if user == "" {
		return "", fmt.Errorf("cannot derive Nextcloud username for chunked upload")
	}
	uploadsRoot := nextcloudUploadsRoot(base, user)
	uploadID := randomHex(16)
	chunkDir := strings.TrimRight(uploadsRoot, "/") + "/" + uploadID
	finalDest := strings.TrimRight(base, "/") + "/" + path.Base(localPath)
	if err := webdavMKCOL(d, chunkDir); err != nil {
		return "", fmt.Errorf("mkcol upload dir: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = webdavDelete(d, chunkDir)
		}
	}()
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, webdavPartSize)
	part := 1
	var written int64
	reportProgress(0, size)
	for written < size {
		n, rerr := io.ReadFull(f, buf)
		if n == 0 {
			if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
				break
			}
			return "", rerr
		}
		chunkName := fmt.Sprintf("%05d", part)
		chunkURL := chunkDir + "/" + chunkName
		req, err := http.NewRequest(http.MethodPut, chunkURL, &byteReader{b: buf[:n]})
		if err != nil {
			return "", err
		}
		req.ContentLength = int64(n)
		req.Header.Set("Content-Type", "application/octet-stream")
		req.Header.Set("Destination", finalDest)
		req.Header.Set("OC-Total-Length", fmt.Sprintf("%d", size))
		if d.WebDAVUser != "" {
			req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
		}
		resp, err := httpx.UploadClient.Do(req)
		if err != nil {
			return "", fmt.Errorf("chunk %s: %w", chunkName, err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			return "", fmt.Errorf("chunk %s HTTP %d: %s", chunkName, resp.StatusCode, string(body))
		}
		part++
		written += int64(n)
		reportProgress(written, size)
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return "", rerr
		}
	}
	src := chunkDir + "/.file"
	req, err := http.NewRequest("MOVE", src, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Destination", finalDest)
	req.Header.Set("OC-Total-Length", fmt.Sprintf("%d", size))
	req.Header.Set("Overwrite", "T")
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("assemble MOVE: %w", err)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("assemble MOVE HTTP %d: %s", resp.StatusCode, string(body))
	}
	cleanup = false
	return finalDest, nil
}

func nextcloudUploadsRoot(base, user string) string {
	u := base
	if i := strings.Index(strings.ToLower(u), "/remote.php/dav/files/"); i >= 0 {
		return u[:i] + "/remote.php/dav/uploads/" + user
	}
	if i := strings.Index(strings.ToLower(u), "/remote.php/webdav"); i >= 0 {
		return u[:i] + "/remote.php/dav/uploads/" + user
	}
	if i := strings.Index(strings.ToLower(u), "/dav/files/"); i >= 0 {
		return u[:i] + "/dav/uploads/" + user
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return strings.TrimRight(base, "/") + "/../uploads/" + user
	}
	return fmt.Sprintf("%s://%s/remote.php/dav/uploads/%s", parsed.Scheme, parsed.Host, user)
}

func webdavUserFromURL(base, configuredUser string) string {
	if configuredUser != "" {
		return configuredUser
	}
	low := strings.ToLower(base)
	for _, marker := range []string{"/dav/files/", "/remote.php/dav/files/"} {
		if i := strings.Index(low, marker); i >= 0 {
			rest := base[i+len(marker):]
			rest = strings.TrimPrefix(rest, "/")
			if j := strings.Index(rest, "/"); j >= 0 {
				return rest[:j]
			}
			if rest != "" {
				return rest
			}
		}
	}
	return ""
}

func webdavMKCOL(d config.Destination, collectionURL string) error {
	req, err := http.NewRequest("MKCOL", strings.TrimRight(collectionURL, "/")+"/", nil)
	if err != nil {
		return err
	}
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 405 && resp.StatusCode != 409 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("MKCOL HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func webdavDelete(d config.Destination, remote string) error {
	req, err := http.NewRequest(http.MethodDelete, remote, nil)
	if err != nil {
		return err
	}
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func webdavEnsureCollection(d config.Destination, collectionURL string) error {
	return webdavMKCOL(d, collectionURL)
}

func putVault(cfg config.Config, localPath string) (string, error) {
	_ = cfg
	_ = localPath
	return "", fmt.Errorf("managed upload through the control plane is disabled; configure local, s3, azure, webdav, or sftp so backups go directly to your storage")
}
