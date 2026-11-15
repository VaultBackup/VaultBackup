package update

import "testing"

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.2.9", "1.2.9", 0},
		{"1.3.0", "1.2.9", 1},
		{"1.2.8", "1.2.9", -1},
		{"v1.10.0", "1.9.9", 1},
		{"1.2.9-dev", "1.2.8", 1},
		{"2.0.0", "1.9.9", 1},
	}
	for _, c := range cases {
		got := Compare(c.a, c.b)
		if got != c.want {
			t.Errorf("Compare(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestDownloadURL(t *testing.T) {
	u := DownloadURL("https://backup.enadoctemp.workers.dev")
	if u == "" || !contains(u, "/download/") {
		t.Fatalf("unexpected url %q", u)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(func() bool {
			for i := 0; i+len(sub) <= len(s); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		})())
}
