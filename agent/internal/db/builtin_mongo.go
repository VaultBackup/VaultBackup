package db

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// dumpMongoBuiltin exports all databases/collections as JSONL.gzip (no mongodump).
func dumpMongoBuiltin(workDir, name, uri string) (string, error) {
	uri = mongoURIOrDefault(uri)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return "", fmt.Errorf("mongo connect: %w", err)
	}
	defer client.Disconnect(context.Background())
	if err := client.Ping(ctx, nil); err != nil {
		return "", fmt.Errorf("mongo ping: %w", err)
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

	dbs, err := client.ListDatabaseNames(ctx, bson.D{})
	if err != nil {
		return "", fmt.Errorf("list databases: %w", err)
	}
	for _, dbn := range dbs {
		if dbn == "admin" || dbn == "local" || dbn == "config" {
			continue
		}
		db := client.Database(dbn)
		cols, err := db.ListCollectionNames(ctx, bson.D{})
		if err != nil {
			return "", err
		}
		for _, col := range cols {
			cur, err := db.Collection(col).Find(ctx, bson.D{})
			if err != nil {
				return "", fmt.Errorf("%s.%s find: %w", dbn, col, err)
			}
			for cur.Next(ctx) {
				var doc bson.M
				if err := cur.Decode(&doc); err != nil {
					cur.Close(ctx)
					return "", err
				}
				rec := map[string]any{"db": dbn, "collection": col, "doc": doc}
				if err := enc.Encode(rec); err != nil {
					cur.Close(ctx)
					return "", err
				}
			}
			cur.Close(ctx)
			if err := cur.Err(); err != nil {
				return "", err
			}
		}
	}
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out, nil
}

func mongoURIOrDefault(uri string) string {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return "mongodb://127.0.0.1:27017"
	}
	if !strings.Contains(uri, "://") {
		return "mongodb://" + uri
	}
	return uri
}
