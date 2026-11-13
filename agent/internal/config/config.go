package config

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"sync"

	"github.com/vaultbackup/agent/internal/crypto"
	"github.com/vaultbackup/agent/internal/secure"
)

// Config is the on-disk agent configuration.
type Config struct {
	Name            string          `json:"name"`
	Schedule        string          `json:"schedule"`
	WorkDir         string          `json:"work_dir"`
	LogFile         string          `json:"log_file"`
	LogMaxMB        int             `json:"log_max_mb"`
	Compression     string          `json:"compression"`
	Retention       int             `json:"retention"`
	RetentionPolicy RetentionPolicy `json:"retention_policy"`
	License         License         `json:"license"`
	Notify          Notify          `json:"notify"`
	Security        Security        `json:"security"`
	Database        Database        `json:"database"`
	Destination     Destination     `json:"destination"`
	Jobs            []Job           `json:"jobs,omitempty"`
	// TermsAccepted is set after the user accepts the agent EULA (once per agent).
	TermsAccepted bool `json:"terms_accepted,omitempty"`
	// TermsVersion is the EULA version string that was accepted.
	TermsVersion string `json:"terms_version,omitempty"`
}

type RetentionPolicy struct {
	Daily   int `json:"daily"`
	Weekly  int `json:"weekly"`
	Monthly int `json:"monthly"`
	Yearly  int `json:"yearly"`
	Keep    int `json:"keep,omitempty"`
}

type License struct {
	ServerURL       string `json:"server_url"`
	Token           string `json:"token"`
	CheckEveryHours int    `json:"check_every_hours"`
	TokenSet        bool   `json:"token_set,omitempty"`
}

type Notify struct {
	WebhookURL string `json:"webhook_url"`
}

type Security struct {
	Encrypt bool   `json:"encrypt"`
	KeyFile string `json:"key_file"`
}

type Database struct {
	Type              string `json:"type"`
	URI               string `json:"uri"`
	BackupType        string `json:"backup_type"`
	UseVSS            bool   `json:"use_vss"`
	PreferNativeTools bool   `json:"prefer_native_tools"`
}

type Destination struct {
	Mode string `json:"mode"`

	S3Endpoint  string `json:"s3_endpoint"`
	S3Region    string `json:"s3_region"`
	S3Bucket    string `json:"s3_bucket"`
	S3Prefix    string `json:"s3_prefix"`
	S3AccessKey string `json:"s3_access_key"`
	S3SecretKey string `json:"s3_secret_key"`
	S3SecretSet bool   `json:"s3_secret_set,omitempty"`

	LocalDir  string `json:"local_dir"`
	LocalPath string `json:"local_path"`

	AzureAccount   string `json:"azure_account"`
	AzureKey       string `json:"azure_key"`
	AzureKeySet    bool   `json:"azure_key_set,omitempty"`
	AzureContainer string `json:"azure_container"`
	AzurePrefix    string `json:"azure_prefix"`
	AzureEndpoint  string `json:"azure_endpoint"`

	WebDAVURL      string `json:"webdav_url"`
	WebDAVUser     string `json:"webdav_user"`
	WebDAVPassword string `json:"webdav_password"`

	SFTPHost     string `json:"sftp_host"`
	SFTPUser     string `json:"sftp_user"`
	SFTPPassword string `json:"sftp_password"`
	SFTPKeyFile  string `json:"sftp_key_file"`
	SFTPPath     string `json:"sftp_path"`
	SFTPInsecure bool   `json:"sftp_insecure"`
}

type Job struct {
	Name       string `json:"name"`
	Schedule   string `json:"schedule"`
	BackupType string `json:"backup_type"`
}

var (
	mu      sync.RWMutex
	current *Config
	path    string
)

func Path() string { return path }

func Get() Config {
	mu.RLock()
	defer mu.RUnlock()
	if current == nil {
		return Default()
	}
	return *current
}

func Default() Config {
	return Config{
		Name:        "agent-1",
		Schedule:    "0 3 * * *",
		WorkDir:     "./data",
		LogFile:     "./data/agent.log",
		LogMaxMB:    20,
		Compression: "gzip",
		Retention:   14,
		License:     License{ServerURL: "https://backup.enadoctemp.workers.dev", CheckEveryHours: 6},
		Security:    Security{Encrypt: true, KeyFile: "./data/agent.key"},
		Database:    Database{Type: "postgres", BackupType: "full", PreferNativeTools: true},
		Destination: Destination{Mode: "s3"},
	}
}

type secretsPayload struct {
	LicenseToken   string `json:"license_token,omitempty"`
	DatabaseURI    string `json:"database_uri,omitempty"`
	S3AccessKey    string `json:"s3_access_key,omitempty"`
	S3SecretKey    string `json:"s3_secret_key,omitempty"`
	AzureKey       string `json:"azure_key,omitempty"`
	WebDAVPassword string `json:"webdav_password,omitempty"`
	SFTPPassword   string `json:"sftp_password,omitempty"`
}

type diskEnvelope struct {
	Version int             `json:"version"`
	Config  json.RawMessage `json:"config"`
	Sealed  string          `json:"sealed"`
}

func extractSecrets(c *Config) secretsPayload {
	return secretsPayload{
		LicenseToken:   c.License.Token,
		DatabaseURI:    c.Database.URI,
		S3AccessKey:    c.Destination.S3AccessKey,
		S3SecretKey:    c.Destination.S3SecretKey,
		AzureKey:       c.Destination.AzureKey,
		WebDAVPassword: c.Destination.WebDAVPassword,
		SFTPPassword:   c.Destination.SFTPPassword,
	}
}

func applySecrets(c *Config, s secretsPayload) {
	if s.LicenseToken != "" {
		c.License.Token = s.LicenseToken
		c.License.TokenSet = true
	}
	if s.DatabaseURI != "" {
		c.Database.URI = s.DatabaseURI
	}
	if s.S3AccessKey != "" {
		c.Destination.S3AccessKey = s.S3AccessKey
	}
	if s.S3SecretKey != "" {
		c.Destination.S3SecretKey = s.S3SecretKey
		c.Destination.S3SecretSet = true
	}
	if s.AzureKey != "" {
		c.Destination.AzureKey = s.AzureKey
		c.Destination.AzureKeySet = true
	}
	if s.WebDAVPassword != "" {
		c.Destination.WebDAVPassword = s.WebDAVPassword
	}
	if s.SFTPPassword != "" {
		c.Destination.SFTPPassword = s.SFTPPassword
	}
}

func stripSecrets(c *Config) {
	c.License.Token = ""
	c.Database.URI = ""
	c.Destination.S3AccessKey = ""
	c.Destination.S3SecretKey = ""
	c.Destination.AzureKey = ""
	c.Destination.WebDAVPassword = ""
	c.Destination.SFTPPassword = ""
}

func sealKeyPath(c *Config) string {
	if c.Security.KeyFile != "" {
		return c.Security.KeyFile
	}
	return "./data/agent.key"
}

func Load(p string) (Config, error) {
	path = p
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			c := Default()
			mu.Lock()
			current = &c
			mu.Unlock()
			return c, nil
		}
		return Config{}, err
	}
	var c Config
	var env diskEnvelope
	if err := json.Unmarshal(data, &env); err == nil && env.Version >= 2 && env.Sealed != "" {
		if err := json.Unmarshal(env.Config, &c); err != nil {
			c = Default()
		}
		normalize(&c)
		key, kerr := crypto.LoadOrCreateKey(sealKeyPath(&c))
		if kerr != nil {
			return Config{}, kerr
		}
		raw, oerr := base64.StdEncoding.DecodeString(env.Sealed)
		if oerr != nil {
			return Config{}, oerr
		}
		pt, oerr := crypto.OpenBytes(key, raw)
		if oerr != nil {
			return Config{}, oerr
		}
		var sec secretsPayload
		if err := json.Unmarshal(pt, &sec); err != nil {
			return Config{}, err
		}
		applySecrets(&c, sec)
	} else if err := json.Unmarshal(data, &c); err != nil {
		c = Default()
	}
	normalize(&c)
	warnInsecureFile(p)
	mu.Lock()
	current = &c
	mu.Unlock()
	return c, nil
}

func LoadSoft(p string) Config {
	c, err := Load(p)
	if err != nil {
		return Default()
	}
	return c
}

func Save(c Config) error {
	normalize(&c)
	if path == "" {
		path = "config.yaml"
	}
	sec := extractSecrets(&c)
	mu.RLock()
	prev := current
	mu.RUnlock()
	if prev != nil {
		if sec.LicenseToken == "" {
			sec.LicenseToken = prev.License.Token
		}
		if sec.DatabaseURI == "" {
			sec.DatabaseURI = prev.Database.URI
		}
		if sec.S3AccessKey == "" {
			sec.S3AccessKey = prev.Destination.S3AccessKey
		}
		if sec.S3SecretKey == "" {
			sec.S3SecretKey = prev.Destination.S3SecretKey
		}
		if sec.AzureKey == "" {
			sec.AzureKey = prev.Destination.AzureKey
		}
		if sec.WebDAVPassword == "" {
			sec.WebDAVPassword = prev.Destination.WebDAVPassword
		}
		if sec.SFTPPassword == "" {
			sec.SFTPPassword = prev.Destination.SFTPPassword
		}
	}
	key, err := crypto.LoadOrCreateKey(sealKeyPath(&c))
	if err != nil {
		return err
	}
	secJSON, err := json.Marshal(sec)
	if err != nil {
		return err
	}
	sealed, err := crypto.SealBytes(key, secJSON)
	if err != nil {
		return err
	}
	shell := c
	stripSecrets(&shell)
	if sec.LicenseToken != "" {
		shell.License.TokenSet = true
	}
	if sec.S3SecretKey != "" {
		shell.Destination.S3SecretSet = true
	}
	if sec.AzureKey != "" {
		shell.Destination.AzureKeySet = true
	}
	shellJSON, err := json.Marshal(&shell)
	if err != nil {
		return err
	}
	env := diskEnvelope{
		Version: 2,
		Config:  shellJSON,
		Sealed:  base64.StdEncoding.EncodeToString(sealed),
	}
	data, err := json.MarshalIndent(&env, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	_ = os.Chmod(path, 0o600)
	mu.Lock()
	current = &c
	mu.Unlock()
	return nil
}

func Complete(c Config) bool {
	if c.License.Token == "" && !c.License.TokenSet {
		mu.RLock()
		prev := current
		mu.RUnlock()
		if prev == nil || prev.License.Token == "" {
			return false
		}
	}
	if c.Database.Type == "" || c.Database.URI == "" {
		return false
	}
	switch c.Destination.Mode {
	case "s3":
		return c.Destination.S3Bucket != ""
	case "local":
		return c.Destination.LocalDir != "" || c.Destination.LocalPath != ""
	case "azure":
		return c.Destination.AzureAccount != "" && c.Destination.AzureContainer != ""
	case "webdav":
		return c.Destination.WebDAVURL != ""
	case "sftp":
		return c.Destination.SFTPHost != "" && c.Destination.SFTPUser != ""
	case "vaultbackup":
		return true
	default:
		return c.Destination.Mode != ""
	}
}

func Sanitized(c Config) Config {
	out := c
	out.License.ServerURL = "https://backup.enadoctemp.workers.dev"
	if out.License.Token != "" {
		out.License.TokenSet = true
		out.License.Token = ""
	}
	if out.Destination.S3SecretKey != "" {
		out.Destination.S3SecretSet = true
		out.Destination.S3SecretKey = ""
	}
	if out.Destination.AzureKey != "" {
		out.Destination.AzureKeySet = true
		out.Destination.AzureKey = ""
	}
	out.Destination.WebDAVPassword = ""
	out.Destination.SFTPPassword = ""
	out.Destination.S3AccessKey = maskLeft(out.Destination.S3AccessKey)
	out.Database.URI = secure.RedactURI(out.Database.URI)
	return out
}

func maskLeft(s string) string {
	if len(s) <= 4 {
		if s != "" {
			return "****"
		}
		return s
	}
	return s[:2] + "****" + s[len(s)-2:]
}

func normalize(c *Config) {
	// License server is fixed in the binary; ignore any value from disk/UI/API.
	c.License.ServerURL = "https://backup.enadoctemp.workers.dev"
	if c.Schedule == "" {
		c.Schedule = "0 3 * * *"
	}
	if c.Retention <= 0 {
		c.Retention = 14
	}
	if c.Compression == "" {
		c.Compression = "gzip"
	}
	if c.License.CheckEveryHours <= 0 {
		c.License.CheckEveryHours = 6
	}
	if c.Database.BackupType == "" {
		c.Database.BackupType = "full"
	}
	switch c.Destination.Mode {
	case "r2", "b2", "minio", "wasabi":
		c.Destination.Mode = "s3"
	case "azureblob":
		c.Destination.Mode = "azure"
	}
	if c.Destination.LocalDir == "" && c.Destination.LocalPath != "" {
		c.Destination.LocalDir = c.Destination.LocalPath
	}
}

func warnInsecureFile(p string) {
	st, err := os.Stat(p)
	if err != nil {
		return
	}
	if st.Mode().Perm()&0o077 != 0 {
		_ = os.Chmod(p, 0o600)
	}
}
