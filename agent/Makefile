.PHONY: build release clean

VERSION ?= 1.2.3
LDFLAGS := -s -w -X main.version=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent ./cmd/agent

release:
	mkdir -p dist
	GOOS=linux   GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-linux-amd64 ./cmd/agent
	GOOS=linux   GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-linux-arm64 ./cmd/agent
	GOOS=darwin  GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-darwin-amd64 ./cmd/agent
	GOOS=darwin  GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-darwin-arm64 ./cmd/agent
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-windows-amd64.exe ./cmd/agent
	GOOS=windows GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o dist/vaultbackup-agent-windows-arm64.exe ./cmd/agent

clean:
	rm -rf dist
