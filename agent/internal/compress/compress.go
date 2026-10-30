package compress

import (
	"compress/gzip"
	"io"
	"os"
)

// Ext returns the file extension for the compression algorithm.
func Ext(algo string) string {
	switch algo {
	case "zstd":
		return ".zst"
	default:
		return ".gz"
	}
}

// Writer wraps w with a gzip compressor (stdlib).
func Writer(w io.Writer, algo string) (io.WriteCloser, error) {
	return gzip.NewWriterLevel(w, gzip.DefaultCompression)
}

// File compresses src to dst with gzip.
func File(src, dst, algo string) error {
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
	cw, err := Writer(out, algo)
	if err != nil {
		return err
	}
	if _, err := io.Copy(cw, in); err != nil {
		cw.Close()
		return err
	}
	return cw.Close()
}
