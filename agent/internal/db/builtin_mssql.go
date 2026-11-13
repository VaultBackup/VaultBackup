package db

import (
	"compress/gzip"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	_ "github.com/microsoft/go-mssqldb"
)

// dumpMSSQLBuiltin logical table dump via TDS driver (no sqlcmd).
// When schemaOnly is true, emits CREATE TABLE DDL without row data.
func dumpMSSQLBuiltin(workDir, name, uri string, schemaOnly bool) (string, error) {
	dsn, err := mssqlDSN(uri)
	if err != nil {
		return "", err
	}
	sqldb, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return "", fmt.Errorf("mssql open: %w", err)
	}
	defer sqldb.Close()
	sqldb.SetMaxOpenConns(2)
	sqldb.SetConnMaxLifetime(time.Minute)
	if err := sqldb.Ping(); err != nil {
		return "", fmt.Errorf("mssql ping: %w", err)
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
	_ = write("-- VaultBackup built-in SQL Server dump\n")
	if schemaOnly {
		_ = write("-- mode: schema-only\n")
	}
	_ = write(fmt.Sprintf("-- generated: %s\n\n", time.Now().UTC().Format(time.RFC3339)))

	rows, err := sqldb.Query(`
		SELECT TABLE_SCHEMA, TABLE_NAME
		FROM INFORMATION_SCHEMA.TABLES
		WHERE TABLE_TYPE = 'BASE TABLE'
		ORDER BY TABLE_SCHEMA, TABLE_NAME`)
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
		full := quoteMSSQL(t.schema) + "." + quoteMSSQL(t.name)
		colRows, err := sqldb.Query(`
			SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
			ORDER BY ORDINAL_POSITION`, t.schema, t.name)
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
			qcols[i] = quoteMSSQL(c)
		}
		if schemaOnly {
			typeRows, err := sqldb.Query(`
				SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
				FROM INFORMATION_SCHEMA.COLUMNS
				WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
				ORDER BY ORDINAL_POSITION`, t.schema, t.name)
			if err == nil {
				var parts []string
				for typeRows.Next() {
					var cn, dt, nullable string
					var maxlen sql.NullInt64
					if err := typeRows.Scan(&cn, &dt, &maxlen, &nullable); err != nil {
						break
					}
					part := quoteMSSQL(cn) + " " + dt
					if maxlen.Valid && maxlen.Int64 > 0 && dt != "text" && dt != "ntext" {
						part += fmt.Sprintf("(%d)", maxlen.Int64)
					}
					if nullable == "NO" {
						part += " NOT NULL"
					}
					parts = append(parts, part)
				}
				typeRows.Close()
				if len(parts) > 0 {
					_ = write(fmt.Sprintf("IF OBJECT_ID(N'%s', N'U') IS NOT NULL DROP TABLE %s;\n", full, full))
					_ = write(fmt.Sprintf("CREATE TABLE %s (\n  %s\n);\n\n", full, strings.Join(parts, ",\n  ")))
				}
			}
			continue
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
				b.WriteString(mssqlLiteral(v))
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
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out, nil
}

func quoteMSSQL(s string) string {
	return "[" + strings.ReplaceAll(s, "]", "]]") + "]"
}

func mssqlLiteral(v any) string {
	if v == nil {
		return "NULL"
	}
	switch x := v.(type) {
	case []byte:
		return "0x" + strings.ToUpper(fmt.Sprintf("%x", x))
	case string:
		return "N'" + strings.ReplaceAll(x, "'", "''") + "'"
	case time.Time:
		return "'" + x.UTC().Format("2006-01-02 15:04:05.000") + "'"
	case bool:
		if x {
			return "1"
		}
		return "0"
	case int64:
		return fmt.Sprintf("%d", x)
	case float64:
		return fmt.Sprintf("%v", x)
	default:
		return "N'" + strings.ReplaceAll(fmt.Sprint(x), "'", "''") + "'"
	}
}

func mssqlDSN(uri string) (string, error) {
	u := strings.TrimSpace(uri)
	if u == "" {
		return "", fmt.Errorf("mssql URI is empty")
	}
	if strings.Contains(u, "=") && !strings.Contains(u, "://") {
		return u, nil
	}
	raw := u
	if strings.HasPrefix(strings.ToLower(raw), "mssql://") {
		raw = "sqlserver://" + raw[8:]
	}
	if !strings.Contains(raw, "://") {
		raw = "sqlserver://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	host := parsed.Hostname()
	if host == "" || host == "localhost" {
		host = "127.0.0.1"
	}
	port := parsed.Port()
	if port == "" {
		port = "1433"
	}
	user := ""
	pass := ""
	if parsed.User != nil {
		user = parsed.User.Username()
		pass, _ = parsed.User.Password()
	}
	db := strings.TrimPrefix(parsed.Path, "/")
	if i := strings.Index(db, "/"); i >= 0 {
		db = db[:i]
	}
	q := url.Values{}
	q.Set("database", db)
	if parsed.Query().Get("encrypt") != "" {
		q.Set("encrypt", parsed.Query().Get("encrypt"))
	} else {
		q.Set("encrypt", "disable")
	}
	if parsed.Query().Get("TrustServerCertificate") != "" {
		q.Set("TrustServerCertificate", parsed.Query().Get("TrustServerCertificate"))
	}
	dsn := fmt.Sprintf("sqlserver://%s:%s@%s:%s?%s",
		url.QueryEscape(user), url.QueryEscape(pass), host, port, q.Encode())
	return dsn, nil
}
