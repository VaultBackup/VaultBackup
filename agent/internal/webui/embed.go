package webui

import (
	_ "embed"
	"strings"
)

//go:embed ui_shell.html
var uiShell string

//go:embed app.js
var appJS string

// EmbeddedUI is the agent dashboard. CSP-safe (no inline handlers/styles).
// License server URL is fixed in the binary and not user-editable.
var EmbeddedUI = strings.Replace(uiShell, "__APP_JS__", appJS, 1)
