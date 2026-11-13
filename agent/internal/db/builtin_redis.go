package db

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// dumpRedisBuiltin scans all keys and writes JSONL (type, key, value/ttl).
func dumpRedisBuiltin(workDir, name, uri string) (string, error) {
	opt, err := redis.ParseURL(normalizeRedisURI(uri))
	if err != nil {
		// fallback: redis://host:port
		opt = &redis.Options{Addr: strings.TrimPrefix(uri, "redis://")}
		if opt.Addr == "" {
			opt.Addr = "127.0.0.1:6379"
		}
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return "", fmt.Errorf("redis ping: %w", err)
	}

	out := outPath(workDir, name, ".jsonl.gz")
	f, err := os.Create(out)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	enc := json.NewEncoder(gz)

	var cursor uint64
	for {
		keys, next, err := rdb.Scan(ctx, cursor, "*", 200).Result()
		if err != nil {
			return "", fmt.Errorf("redis scan: %w", err)
		}
		for _, key := range keys {
			typ, err := rdb.Type(ctx, key).Result()
			if err != nil {
				continue
			}
			ttl, _ := rdb.TTL(ctx, key).Result()
			rec := map[string]any{"key": key, "type": typ, "ttl_ms": ttl.Milliseconds()}
			switch typ {
			case "string":
				v, _ := rdb.Get(ctx, key).Result()
				rec["value"] = v
			case "list":
				v, _ := rdb.LRange(ctx, key, 0, -1).Result()
				rec["value"] = v
			case "set":
				v, _ := rdb.SMembers(ctx, key).Result()
				rec["value"] = v
			case "zset":
				v, _ := rdb.ZRangeWithScores(ctx, key, 0, -1).Result()
				rec["value"] = v
			case "hash":
				v, _ := rdb.HGetAll(ctx, key).Result()
				rec["value"] = v
			default:
				rec["value"] = nil
			}
			if err := enc.Encode(rec); err != nil {
				return "", err
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out, nil
}

func normalizeRedisURI(uri string) string {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return "redis://127.0.0.1:6379"
	}
	if !strings.Contains(uri, "://") {
		return "redis://" + uri
	}
	return uri
}
