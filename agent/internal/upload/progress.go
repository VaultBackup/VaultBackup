package upload

import (
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// ProgressFunc is called with bytes transferred and total size (total may be 0 if unknown).
type ProgressFunc func(transferred, total int64)

var (
	progressMu sync.Mutex
	progressFn ProgressFunc
)

// SetProgress installs a package-level progress reporter used by Put backends.
// Pass nil to disable. Safe for concurrent use.
func SetProgress(fn ProgressFunc) {
	progressMu.Lock()
	progressFn = fn
	progressMu.Unlock()
}

func reportProgress(transferred, total int64) {
	progressMu.Lock()
	fn := progressFn
	progressMu.Unlock()
	if fn != nil {
		fn(transferred, total)
	}
}

// progressReader wraps an io.Reader and reports cumulative bytes read.
// Reports are throttled to at most once per interval or every step bytes.
type progressReader struct {
	r        io.Reader
	total    int64
	n        int64
	lastN    int64
	lastT    time.Time
	interval time.Duration
	step     int64
}

func newProgressReader(r io.Reader, total int64) *progressReader {
	return &progressReader{
		r:        r,
		total:    total,
		lastT:    time.Now(),
		interval: 2 * time.Second,
		step:     8 << 20, // 8 MiB
	}
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	if n > 0 {
		p.n += int64(n)
		if p.n-p.lastN >= p.step || time.Since(p.lastT) >= p.interval || err == io.EOF {
			reportProgress(p.n, p.total)
			p.lastN = p.n
			p.lastT = time.Now()
		}
	}
	return n, err
}

// countingWriter is a thin counter used where we only have a Writer sink.
type countingWriter struct {
	w     io.Writer
	total int64
	n     atomic.Int64
	last  atomic.Int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	if n > 0 {
		cur := c.n.Add(int64(n))
		prev := c.last.Load()
		if cur-prev >= 8<<20 {
			c.last.Store(cur)
			reportProgress(cur, c.total)
		}
	}
	return n, err
}
