package webui

import _ "embed"

// EmbeddedUI is the agent dashboard. CSP-safe (no inline handlers/styles).
// License server URL is fixed in the binary and not user-editable.
//
//go:embed ui.html
var EmbeddedUI string
