package webui

import (
	"strings"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/license"
)

func applyUIBody(cfg *config.Config, body map[string]any) {
	if v, ok := body["terms_accepted"].(bool); ok {
		cfg.TermsAccepted = v
	}
	if v, ok := body["terms_version"].(string); ok {
		cfg.TermsVersion = strings.TrimSpace(v)
	}
	if v, ok := body["name"].(string); ok {
		cfg.Name = strings.TrimSpace(v)
	}
	if v, ok := body["schedule"].(string); ok {
		cfg.Schedule = strings.TrimSpace(v)
	}
	if v, ok := body["retention"].(float64); ok {
		cfg.Retention = int(v)
	}
	cfg.License.ServerURL = license.ServerURL()
	if lic, ok := body["license"].(map[string]any); ok {
		if v, ok := lic["token"].(string); ok {
			v = strings.TrimSpace(v)
			if v != "" && !containsMask(v) {
				cfg.License.Token = v
			}
		}
	}
	if sec, ok := body["security"].(map[string]any); ok {
		if v, ok := sec["encrypt"].(bool); ok {
			cfg.Security.Encrypt = v
		}
	}
	if db, ok := body["database"].(map[string]any); ok {
		if v, ok := db["type"].(string); ok {
			cfg.Database.Type = v
		}
		if v, ok := db["uri"].(string); ok {
			cfg.Database.URI = strings.TrimSpace(v)
		}
		if v, ok := db["backup_type"].(string); ok {
			cfg.Database.BackupType = v
		}
	}
	if dest, ok := body["destination"].(map[string]any); ok {
		str := func(k string) string {
			if v, ok := dest[k].(string); ok {
				return strings.TrimSpace(v)
			}
			return ""
		}
		if v := str("mode"); v != "" {
			cfg.Destination.Mode = v
		}
		cfg.Destination.S3Endpoint = str("s3_endpoint")
		cfg.Destination.S3Region = str("s3_region")
		cfg.Destination.S3Bucket = str("s3_bucket")
		cfg.Destination.S3Prefix = str("s3_prefix")
		cfg.Destination.S3AccessKey = str("s3_access_key")
		if sk := str("s3_secret_key"); sk != "" && !containsMask(sk) {
			cfg.Destination.S3SecretKey = sk
		}
		cfg.Destination.LocalDir = str("local_dir")
		cfg.Destination.AzureAccount = str("azure_account")
		cfg.Destination.AzureContainer = str("azure_container")
		cfg.Destination.AzurePrefix = str("azure_prefix")
		cfg.Destination.AzureEndpoint = str("azure_endpoint")
		if ak := str("azure_key"); ak != "" && !containsMask(ak) {
			cfg.Destination.AzureKey = ak
		}
		cfg.Destination.WebDAVURL = str("webdav_url")
		cfg.Destination.WebDAVUser = str("webdav_user")
		if wp := str("webdav_password"); wp != "" && !containsMask(wp) {
			cfg.Destination.WebDAVPassword = wp
		}
		cfg.Destination.SFTPHost = str("sftp_host")
		cfg.Destination.SFTPUser = str("sftp_user")
		cfg.Destination.SFTPKeyFile = str("sftp_key_file")
		cfg.Destination.SFTPPath = str("sftp_path")
		if sp := str("sftp_password"); sp != "" && !containsMask(sp) {
			cfg.Destination.SFTPPassword = sp
		}
		if v, ok := dest["sftp_insecure"].(bool); ok {
			cfg.Destination.SFTPInsecure = v
		}
	}
}
