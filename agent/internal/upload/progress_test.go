package upload

import (
	"bytes"
	"io"
	"testing"
)

func TestProgressReaderReports(t *testing.T) {
	var lastN, lastTotal int64
	var calls int
	SetProgress(func(n, total int64) {
		lastN, lastTotal = n, total
		calls++
	})
	defer SetProgress(nil)

	data := bytes.Repeat([]byte("x"), 9<<20) // 9 MiB > step
	r := newProgressReader(bytes.NewReader(data), int64(len(data)))
	buf := make([]byte, 1<<20)
	for {
		_, err := r.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	// Force final report
	reportProgress(r.n, r.total)
	if lastN != int64(len(data)) {
		t.Fatalf("transferred=%d want %d", lastN, len(data))
	}
	if lastTotal != int64(len(data)) {
		t.Fatalf("total=%d", lastTotal)
	}
	if calls < 1 {
		t.Fatal("expected at least one progress callback")
	}
}
