package db

import (
	"compress/gzip"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// dumpMySQLBuiltin produces a logical SQL dump using pure Go (no mysqldump).
// Covers tables (CREATE + INSERT). Views/routines/triggers are best-effort.
// When schemaOnly is true, emits DDL only (no row data).
func dumpMySQLBuiltin(workDir, name, uri string, schemaOnly bool) (string, error) {
	host, port, user, pass, dbname, err := parseMySQLURI(uri)
	if err != nil {
		return "", err
	}
	if host == "" || host == "localhost" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "3306"
	}
	if dbname == "" {
		return "", fmt.Errorf("mysql: database name required in URI for built-in dump")
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&timeout=15s&readTimeout=300s&writeTimeout=60s",
		user, pass, host, port, dbname)

	sqldb, err := sql.Open("mysql", dsn)
	if err != nil {
		return "", fmt.Errorf("mysql open: %w", err)
	}
	defer sqldb.Close()
	sqldb.SetMaxOpenConns(2)
	sqldb.SetConnMaxLifetime(time.Minute)

	if err := sqldb.Ping(); err != nil {
		return "", fmt.Errorf("mysql ping: %w", err)
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

	_ = write("-- VaultBackup built-in MySQL dump\n")
	if schemaOnly {
		_ = write("-- mode: schema-only\n")
	}
	_ = write(fmt.Sprintf("-- database: %s\n", dbname))
	_ = write(fmt.Sprintf("-- generated: %s\n\n", time.Now().UTC().Format(time.RFC3339)))
	_ = write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\n\n")

	rows, err := sqldb.Query(`SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`, dbname)
	if err != nil {
		return "", fmt.Errorf("list tables: %w", err)
	}
	type tbl struct{ name, typ string }
	var tables []tbl
	for rows.Next() {
		var t tbl
		if err := rows.Scan(&t.name, &t.typ); err != nil {
			rows.Close()
			return "", err
		}
		tables = append(tables, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}

	for _, t := range tables {
		ident := quoteMyIdent(t.name)
		if t.typ == "VIEW" {
			var create, _v string
			err := sqldb.QueryRow("SHOW CREATE VIEW "+ident).Scan(&_v, &create)
			if err != nil {
				_ = write(fmt.Sprintf("-- skip view %s: %v\n", t.name, err))
				continue
			}
			_ = write(fmt.Sprintf("DROP VIEW IF EXISTS %s;\n%s;\n\n", ident, create))
			continue
		}

		var tblName, create string
		if err := sqldb.QueryRow("SHOW CREATE TABLE "+ident).Scan(&tblName, &create); err != nil {
			return "", fmt.Errorf("show create %s: %w", t.name, err)
		}
		_ = write(fmt.Sprintf("DROP TABLE IF EXISTS %s;\n%s;\n\n", ident, create))
		if schemaOnly {
			continue
		}

		data, err := sqldb.Query("SELECT * FROM " + ident)
		if err != nil {
			return "", fmt.Errorf("select %s: %w", t.name, err)
		}
		cols, err := data.Columns()
		if err != nil {
			data.Close()
			return "", err
		}
		colList := make([]string, len(cols))
		for i, c := range cols {
			colList[i] = quoteMyIdent(c)
		}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		const batch = 100
		var buf strings.Builder
		n := 0
		flush := func() error {
			if buf.Len() == 0 {
				return nil
			}
			if err := write(buf.String()); err != nil {
				return err
			}
			buf.Reset()
			return nil
		}
		for data.Next() {
			if err := data.Scan(ptrs...); err != nil {
				data.Close()
				return "", err
			}
			if n%batch == 0 {
				if err := flush(); err != nil {
					data.Close()
					return "", err
				}
				buf.WriteString("INSERT INTO " + ident + " (" + strings.Join(colList, ",") + ") VALUES\n")
			} else {
				buf.WriteString(",\n")
			}
			buf.WriteByte('(')
			for i, v := range vals {
				if i > 0 {
					buf.WriteByte(',')
				}
				buf.WriteString(sqlLiteral(v))
			}
			buf.WriteByte(')')
			n++
			if n%batch == 0 {
				buf.WriteString(";\n")
			}
		}
		data.Close()
		if err := data.Err(); err != nil {
			return "", err
		}
		if n > 0 && n%batch != 0 {
			buf.WriteString(";\n")
		}
		if err := flush(); err != nil {
			return "", err
		}
		if n > 0 {
			_ = write("\n")
		}
	}

	_ = write("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n")
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out, nil
}

func quoteMyIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func sqlLiteral(v any) string {
	if v == nil {
		return "NULL"
	}
	switch x := v.(type) {
	case []byte:
		return quoteMyString(string(x))
	case string:
		return quoteMyString(x)
	case time.Time:
		return "'" + x.UTC().Format("2006-01-02 15:04:05.000000") + "'"
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
		return quoteMyString(fmt.Sprint(x))
	}
}

func quoteMyString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `\'`)
	s = strings.ReplaceAll(s, "\x00", `\0`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	s = strings.ReplaceAll(s, "\r", `\r`)
	s = strings.ReplaceAll(s, "\x1a", `\Z`)
	return "'" + s + "'"
}
