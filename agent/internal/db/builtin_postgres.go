package db

import (
	"compress/gzip"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// dumpPostgresBuiltin logical dump via pure Go (no pg_dump).
func dumpPostgresBuiltin(workDir, name, uri string) (string, error) {
	dsn := uri
	if !strings.Contains(dsn, "://") && !strings.Contains(dsn, "=") {
		return "", fmt.Errorf("postgres: invalid URI")
	}
	if u, err := url.Parse(dsn); err == nil && u.Host != "" {
		h := u.Hostname()
		if h == "localhost" {
			u.Host = "127.0.0.1"
			if p := u.Port(); p != "" {
				u.Host = "127.0.0.1:" + p
			}
			dsn = u.String()
		}
	}
	sqldb, err := sql.Open("postgres", dsn)
	if err != nil {
		return "", fmt.Errorf("postgres open: %w", err)
	}
	defer sqldb.Close()
	sqldb.SetMaxOpenConns(2)
	if err := sqldb.Ping(); err != nil {
		return "", fmt.Errorf("postgres ping: %w", err)
	}
	out := outPath(workDir, name, ".sql.gz")
	f, err := os.Create(out)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	write := func(s string) error {
		_, err := gz.Write([]byte(s))
		return err
	}
	_ = write("-- VaultBackup built-in PostgreSQL dump\n")
	_ = write(fmt.Sprintf("-- generated: %s\n\n", time.Now().UTC().Format(time.RFC3339)))
	_ = write("SET session_replication_role = replica;\n\n")
	rows, err := sqldb.Query(`
		SELECT n.nspname, c.relname
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r'
		  AND n.nspname NOT IN ('pg_catalog','information_schema')
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		return "", err
	}
	type tbl struct{ schema, name string }
	var tables []tbl
	for rows.Next() {
		var t tbl
		if err := rows.Scan(&t.schema, &t.name); err != nil {
			rows.Close()
			return "", err
		}
		tables = append(tables, t)
	}
	rows.Close()
	for _, t := range tables {
		full := quotePGIdent(t.schema) + "." + quotePGIdent(t.name)
		_ = write(fmt.Sprintf("-- data for %s\n", full))
		colRows, err := sqldb.Query(`
			SELECT a.attname FROM pg_attribute a
			JOIN pg_class c ON c.oid = a.attrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = $1 AND c.relname = $2
			  AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY a.attnum`, t.schema, t.name)
		if err != nil {
			return "", err
		}
		var cols []string
		for colRows.Next() {
			var c string
			if err := colRows.Scan(&c); err != nil {
				colRows.Close()
				return "", err
			}
			cols = append(cols, c)
		}
		colRows.Close()
		if len(cols) == 0 {
			continue
		}
		qcols := make([]string, len(cols))
		for i, c := range cols {
			qcols[i] = quotePGIdent(c)
		}
		q := "SELECT " + strings.Join(qcols, ",") + " FROM " + full
		data, err := sqldb.Query(q)
		if err != nil {
			return "", fmt.Errorf("select %s: %w", full, err)
		}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		for data.Next() {
			if err := data.Scan(ptrs...); err != nil {
				data.Close()
				return "", err
			}
			var b strings.Builder
			b.WriteString("INSERT INTO " + full + " (" + strings.Join(qcols, ",") + ") VALUES (")
			for i, v := range vals {
				if i > 0 {
					b.WriteByte(',')
				}
				b.WriteString(pgLiteral(v))
			}
			b.WriteString(");\n")
			if err := write(b.String()); err != nil {
				data.Close()
				return "", err
			}
		}
		data.Close()
		_ = write("\n")
	}
	_ = write("SET session_replication_role = DEFAULT;\n")
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out, nil
}

func quotePGIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func pgLiteral(v any) string {
	if v == nil {
		return "NULL"
	}
	switch x := v.(type) {
	case []byte:
		return "'" + strings.ReplaceAll(string(x), "'", "''") + "'"
	case string:
		return "'" + strings.ReplaceAll(x, "'", "''") + "'"
	case time.Time:
		return "'" + x.UTC().Format(time.RFC3339Nano) + "'"
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int64:
		return fmt.Sprintf("%d", x)
	case float64:
		return fmt.Sprintf("%v", x)
	default:
		return "'" + strings.ReplaceAll(fmt.Sprint(x), "'", "''") + "'"
	}
}
