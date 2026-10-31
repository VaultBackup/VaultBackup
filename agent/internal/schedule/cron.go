package schedule

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Spec is a schedule expression.
// Supported:
//   - standard 5-field cron: "M H dom mon dow" (UTC)
//   - "@every 30m" / "@every 2h"
//   - "@daily" (03:00 UTC), "@hourly"
type Spec struct {
	raw string
	// interval mode
	every time.Duration
	// cron fields (nil = any)
	min, hour, dom, mon, dow *field
}

type field struct {
	// values allowed; empty means any after parse error fallback
	all    bool
	values map[int]bool
}

// Parse parses a schedule expression.
func Parse(expr string) (*Spec, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		expr = "0 3 * * *"
	}
	low := strings.ToLower(expr)
	s := &Spec{raw: expr}
	switch {
	case low == "@hourly":
		s.every = time.Hour
		return s, nil
	case low == "@daily":
		return Parse("0 3 * * *")
	case strings.HasPrefix(low, "@every "):
		d, err := time.ParseDuration(strings.TrimSpace(expr[7:]))
		if err != nil || d < time.Minute {
			return nil, fmt.Errorf("invalid @every duration")
		}
		s.every = d
		return s, nil
	}

	parts := strings.Fields(expr)
	if len(parts) == 2 {
		// legacy "M H"
		parts = []string{parts[0], parts[1], "*", "*", "*"}
	}
	if len(parts) != 5 {
		return nil, fmt.Errorf("cron must have 5 fields (min hour dom mon dow)")
	}
	var err error
	if s.min, err = parseField(parts[0], 0, 59); err != nil {
		return nil, fmt.Errorf("minute: %w", err)
	}
	if s.hour, err = parseField(parts[1], 0, 23); err != nil {
		return nil, fmt.Errorf("hour: %w", err)
	}
	if s.dom, err = parseField(parts[2], 1, 31); err != nil {
		return nil, fmt.Errorf("dom: %w", err)
	}
	if s.mon, err = parseField(parts[3], 1, 12); err != nil {
		return nil, fmt.Errorf("month: %w", err)
	}
	if s.dow, err = parseField(parts[4], 0, 6); err != nil { // 0=Sunday
		return nil, fmt.Errorf("dow: %w", err)
	}
	return s, nil
}

func parseField(tok string, min, max int) (*field, error) {
	tok = strings.TrimSpace(tok)
	f := &field{values: map[int]bool{}}
	if tok == "*" {
		f.all = true
		return f, nil
	}
	// step: */n or a-b/n
	for _, part := range strings.Split(tok, ",") {
		part = strings.TrimSpace(part)
		step := 1
		rangePart := part
		if i := strings.Index(part, "/"); i >= 0 {
			rangePart = part[:i]
			st, err := strconv.Atoi(part[i+1:])
			if err != nil || st <= 0 {
				return nil, fmt.Errorf("bad step in %q", part)
			}
			step = st
		}
		start, end := min, max
		if rangePart != "*" {
			if j := strings.Index(rangePart, "-"); j >= 0 {
				a, err1 := strconv.Atoi(rangePart[:j])
				b, err2 := strconv.Atoi(rangePart[j+1:])
				if err1 != nil || err2 != nil {
					return nil, fmt.Errorf("bad range %q", rangePart)
				}
				start, end = a, b
			} else {
				v, err := strconv.Atoi(rangePart)
				if err != nil {
					return nil, fmt.Errorf("bad value %q", rangePart)
				}
				start, end = v, v
			}
		}
		for v := start; v <= end; v += step {
			if v < min || v > max {
				continue
			}
			f.values[v] = true
		}
	}
	if len(f.values) == 0 {
		f.all = true
	}
	return f, nil
}

func (f *field) match(v int) bool {
	if f == nil || f.all {
		return true
	}
	return f.values[v]
}

// Next returns the next fire time after `from` (exclusive-ish: first minute strictly after from).
func (s *Spec) Next(from time.Time) time.Time {
	from = from.UTC()
	if s.every > 0 {
		return from.Add(s.every)
	}
	// search up to 2 years of minutes
	t := from.Truncate(time.Minute).Add(time.Minute)
	limit := t.Add(2 * 365 * 24 * time.Hour)
	for t.Before(limit) {
		if s.min.match(t.Minute()) &&
			s.hour.match(t.Hour()) &&
			s.dom.match(t.Day()) &&
			s.mon.match(int(t.Month())) &&
			s.dow.match(int(t.Weekday())) {
			return t
		}
		t = t.Add(time.Minute)
	}
	return from.Add(24 * time.Hour)
}

// String returns the raw expression.
func (s *Spec) String() string {
	if s == nil {
		return ""
	}
	return s.raw
}
