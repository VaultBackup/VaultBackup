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
	if err == nil && len(data) >= 32 {
		return data[:32], nil
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
	return os.WriteFile(path, key, 0o600)
}

// EncryptFile encrypts src → dst using AES-256-GCM (format VBK2).
func EncryptFile(src, dst string, key []byte) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
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
		n, rerr := in.Read(buf)
		if n > 0 {
			aad := make([]byte, 8)
			binary.BigEndian.PutUint64(aad, seq)
			ct := gcm.Seal(nil, nonceFor(nonce, seq), buf[:n], aad)
			var lenBuf [4]byte
			binary.BigEndian.PutUint32(lenBuf[:], uint32(len(ct)))
			if _, err := out.Write(lenBuf[:]); err != nil {
				return err
			}
			if _, err := out.Write(ct); err != nil {
				return err
			}
			seq++
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	return out.Close()
}

// DecryptFile decrypts a VBK1/VBK2 file.
func DecryptFile(src, dst string, key []byte) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	hdr := make([]byte, 4)
	if _, err := io.ReadFull(in, hdr); err != nil {
		return err
	}
	switch string(hdr) {
	case magicV2:
		return decryptV2(in, dst, key)
	default:
		return decryptV1(src, dst, key)
	}
}

func decryptV2(in *os.File, dst string, key []byte) error {
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
	out, err := os.Create(dst)
	if err != nil {
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
