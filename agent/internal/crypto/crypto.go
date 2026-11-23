package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

const (
	magicV2   = "VBK2"
	nonceSize = 12
)

// LoadOrCreateKey loads a 32-byte key from path or creates one.
func LoadOrCreateKey(path string) ([]byte, error) {
	if path == "" {
		return nil, errors.New("key_file not set")
	}
	data, err := os.ReadFile(path)
	if err == nil {
		if len(data) < 32 {
			return nil, errors.New("existing key file is too short; refusing to replace it because backups may depend on this key")
		}
		return data[:32], nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read existing key file: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := SaveKeyProtected(path, key); err != nil {
		return nil, err
	}
	return key, nil
}

// LoadKeyProtected loads a key (file mode 0600 on Unix).
func LoadKeyProtected(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) < 32 {
		return nil, errors.New("key file too short")
	}
	return data[:32], nil
}

// SaveKeyProtected writes key with restrictive permissions.
func SaveKeyProtected(path string, key []byte) error {
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	return nil
}

// EncryptFile encrypts src to dst using AES-256-GCM (format VBK2).
func EncryptFile(src, dst string, key []byte) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if err := out.Chmod(0o600); err != nil {
		_ = out.Close()
		return err
	}
	defer out.Close()
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	if _, err := out.Write([]byte(magicV2)); err != nil {
		return err
	}
	if _, err := out.Write(nonce); err != nil {
		return err
	}
	buf := make([]byte, 64*1024)
	var seq uint64
	for {
		n, err := in.Read(buf)
		if n > 0 {
			aad := make([]byte, 8)
			binary.BigEndian.PutUint64(aad, seq)
			ct := gcm.Seal(nil, nonceFor(nonce, seq), buf[:n], aad)
			lenBuf := make([]byte, 4)
			binary.BigEndian.PutUint32(lenBuf, uint32(len(ct)))
			if _, werr := out.Write(lenBuf); werr != nil {
				return werr
			}
			if _, werr := out.Write(ct); werr != nil {
				return werr
			}
			seq++
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// DecryptFile decrypts a VBK2 file (or legacy v1) to dst.
func DecryptFile(src, dst string, key []byte) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	magic := make([]byte, 4)
	if _, err := io.ReadFull(in, magic); err != nil {
		return err
	}
	if string(magic) != magicV2 {
		_ = in.Close()
		return decryptV1(src, dst, key)
	}
	nonce := make([]byte, nonceSize)
	if _, err := io.ReadFull(in, nonce); err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if err := out.Chmod(0o600); err != nil {
		_ = out.Close()
		return err
	}
	defer out.Close()
	var seq uint64
	for {
		var lenBuf [4]byte
		_, err := io.ReadFull(in, lenBuf[:])
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		n := binary.BigEndian.Uint32(lenBuf[:])
		if n == 0 || n > 8*1024*1024 {
			return fmt.Errorf("invalid ciphertext chunk size %d", n)
		}
		ct := make([]byte, n)
		if _, err := io.ReadFull(in, ct); err != nil {
			return err
		}
		aad := make([]byte, 8)
		binary.BigEndian.PutUint64(aad, seq)
		pt, err := gcm.Open(nil, nonceFor(nonce, seq), ct, aad)
		if err != nil {
			return err
		}
		if _, err := out.Write(pt); err != nil {
			return err
		}
		seq++
	}
	return nil
}

func decryptV1(src, dst string, key []byte) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if len(data) < nonceSize+16 {
		return errors.New("ciphertext too short")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce, ct := data[:nonceSize], data[nonceSize:]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, pt, 0o600)
}

func nonceFor(base []byte, seq uint64) []byte {
	n := make([]byte, nonceSize)
	copy(n, base)
	for i := 0; i < 8; i++ {
		n[nonceSize-1-i] ^= byte(seq >> (8 * i))
	}
	return n
}

// SealBytes encrypts plaintext with AES-256-GCM. Returns nonce||ciphertext||tag.
func SealBytes(key, plaintext []byte) ([]byte, error) {
	if len(key) < 32 {
		return nil, errors.New("key must be 32 bytes")
	}
	block, err := aes.NewCipher(key[:32])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := gcm.Seal(nonce, nonce, plaintext, []byte("vaultbackup-config-v1"))
	return out, nil
}

// OpenBytes decrypts output of SealBytes.
func OpenBytes(key, sealed []byte) ([]byte, error) {
	if len(key) < 32 {
		return nil, errors.New("key must be 32 bytes")
	}
	if len(sealed) < nonceSize+16 {
		return nil, errors.New("sealed blob too short")
	}
	block, err := aes.NewCipher(key[:32])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce, ct := sealed[:nonceSize], sealed[nonceSize:]
	return gcm.Open(nil, nonce, ct, []byte("vaultbackup-config-v1"))
}

// FileSHA256 returns hex SHA-256 of a file.
func FileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
