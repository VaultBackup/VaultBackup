package errcode

import (
	"errors"
	"testing"
)

func TestClassifyText(t *testing.T) {
	cases := []struct {
		msg  string
		want string
	}{
		{"", Unknown},
		{"backup already running", AlreadyRunning},
		{"license token invalid", LicenseBlocked},
		{"token_bound_to_another_device", LicenseBlocked},
		{"insufficient free disk in work dir", DiskFull},
		{"no space left on device", DiskFull},
		{"required tool not found: mysqldump", ToolMissing},
		{"encrypt failed: bad key", EncryptFailed},
		{"azure put HTTP 403", UploadFailed},
		{"s3 multipart complete failed", UploadFailed},
		{"destination test failed", DestProbeFailed},
		{"dial tcp: connection refused", DBUnreachable},
		{"pg_dump: dump failed", DBDumpFailed},
		{"invalid config field", ConfigInvalid},
		{"something odd happened", Unknown},
	}
	for _, c := range cases {
		if got := ClassifyText(c.msg); got != c.want {
			t.Errorf("ClassifyText(%q)=%q want %q", c.msg, got, c.want)
		}
	}
	if Classify(nil) != OK {
		t.Errorf("Classify(nil) want OK")
	}
	if Classify(errors.New("upload failed")) != UploadFailed {
		t.Errorf("Classify(upload) want UploadFailed")
	}
}
