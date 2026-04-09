use clap::Args;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Args)]
pub struct HttpConfig {
    /// Google OAuth2 Client ID
    #[arg(long, env = "GOOGLE_CLIENT_ID")]
    pub google_client_id: String,

    /// Google OAuth2 Client Secret
    #[arg(long, env = "GOOGLE_CLIENT_SECRET")]
    pub google_client_secret: String,

    /// OAuth redirect URI (e.g. http://localhost:8080/auth/callback)
    #[arg(long, env = "OAUTH_REDIRECT_URI")]
    pub oauth_redirect_uri: String,

    /// HTTP bind address
    #[arg(long, env = "HTTP_BIND", default_value = "0.0.0.0:8080")]
    pub http_bind: String,

    /// API key cache TTL in seconds
    #[arg(long, env = "API_KEY_CACHE_TTL_SECS", default_value = "60")]
    pub api_key_cache_ttl_secs: u64,

    /// MCP session idle timeout in seconds
    #[arg(long, env = "MCP_SESSION_IDLE_SECS", default_value = "1800")]
    pub mcp_session_idle_secs: u64,

    /// Email of the first admin user (auto-promoted on first login)
    #[arg(long, env = "FIRST_ADMIN_EMAIL")]
    pub first_admin_email: Option<String>,

    /// Comma-separated list of allowed OAuth redirect_uri values.
    /// When set, /auth/google rejects redirect_uri values not in this list.
    /// Supports exact matches only. Example: "http://localhost:3000/callback,https://app.example.com/callback"
    #[arg(long, env = "ALLOWED_REDIRECT_URIS", value_delimiter = ',')]
    pub allowed_redirect_uris: Vec<String>,

    /// All base Config fields are flattened in
    #[command(flatten)]
    pub base: Config,
}

/// Validated S3 connection parameters extracted from `Config`.
#[derive(Debug, Clone)]
pub struct S3Params {
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
}

#[derive(Debug, Clone, Args)]
pub struct Config {
    /// PostgreSQL connection URL
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: String,

    /// S3-compatible endpoint URL (e.g., http://localhost:9000 for MinIO)
    #[arg(long, env = "S3_ENDPOINT")]
    pub s3_endpoint: Option<String>,

    /// S3 bucket name for document storage
    #[arg(long, env = "S3_BUCKET")]
    pub s3_bucket: Option<String>,

    /// S3 access key ID
    #[arg(long, env = "S3_ACCESS_KEY")]
    pub s3_access_key: Option<String>,

    /// S3 secret access key
    #[arg(long, env = "S3_SECRET_KEY")]
    pub s3_secret_key: Option<String>,

    /// Maximum number of database connections in the pool
    #[arg(long, env = "DB_MAX_CONNECTIONS", default_value = "5")]
    pub db_max_connections: u32,

    /// Embedding model name for FastEmbed
    #[arg(long, env = "EMBEDDING_MODEL", default_value = "nomic-embed-text-v1.5q")]
    pub embedding_model: String,

    /// Maximum chunk size in characters
    #[arg(long, env = "CHUNK_SIZE", default_value = "2048")]
    pub chunk_size: usize,

    /// Overlap between consecutive chunks in characters
    #[arg(long, env = "CHUNK_OVERLAP", default_value = "200")]
    pub chunk_overlap: usize,

    /// Minimum chunk size in characters; chunks smaller than this are merged
    #[arg(long, env = "MIN_CHUNK_SIZE", default_value = "50")]
    pub min_chunk_size: usize,

    /// Cosine similarity threshold for search-time deduplication (0.0–1.0).
    /// Candidates whose similarity to an already-selected result exceeds this
    /// threshold are discarded. 1.0 disables dedup; 0.0 keeps only one result.
    #[arg(long, env = "DEDUP_THRESHOLD", default_value = "0.97")]
    pub dedup_threshold: f64,

    /// Candidate fetch multiplier for dedup. The search pipeline fetches
    /// k * this factor candidates before applying the dedup filter.
    #[arg(long, env = "DEDUP_CANDIDATE_FACTOR", default_value = "3")]
    pub dedup_candidate_factor: i64,
}

impl Config {
    /// Extract and validate S3 parameters from the config.
    ///
    /// Returns `Ok(Some(S3Params))` when all four S3 fields are set,
    /// `Ok(None)` when all four are absent, and `Err` when only some are set.
    pub fn require_s3(&self) -> AppResult<S3Params> {
        match (&self.s3_endpoint, &self.s3_bucket, &self.s3_access_key, &self.s3_secret_key) {
            (Some(endpoint), Some(bucket), Some(access_key), Some(secret_key)) => {
                Ok(S3Params {
                    endpoint: endpoint.clone(),
                    bucket: bucket.clone(),
                    access_key: access_key.clone(),
                    secret_key: secret_key.clone(),
                })
            }
            (None, None, None, None) => {
                Err(AppError::Config(
                    "S3 storage is required but S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are all missing".into(),
                ))
            }
            _ => {
                let mut missing = Vec::new();
                if self.s3_endpoint.is_none() { missing.push("S3_ENDPOINT"); }
                if self.s3_bucket.is_none() { missing.push("S3_BUCKET"); }
                if self.s3_access_key.is_none() { missing.push("S3_ACCESS_KEY"); }
                if self.s3_secret_key.is_none() { missing.push("S3_SECRET_KEY"); }
                Err(AppError::Config(format!(
                    "partial S3 configuration: missing {}",
                    missing.join(", "),
                )))
            }
        }
    }

    /// Try to extract S3 parameters, returning `Ok(None)` when all S3 fields
    /// are absent and `Err` when only partially configured.
    pub fn s3_params(&self) -> AppResult<Option<S3Params>> {
        match (&self.s3_endpoint, &self.s3_bucket, &self.s3_access_key, &self.s3_secret_key) {
            (Some(endpoint), Some(bucket), Some(access_key), Some(secret_key)) => {
                Ok(Some(S3Params {
                    endpoint: endpoint.clone(),
                    bucket: bucket.clone(),
                    access_key: access_key.clone(),
                    secret_key: secret_key.clone(),
                }))
            }
            (None, None, None, None) => Ok(None),
            _ => {
                let mut missing = Vec::new();
                if self.s3_endpoint.is_none() { missing.push("S3_ENDPOINT"); }
                if self.s3_bucket.is_none() { missing.push("S3_BUCKET"); }
                if self.s3_access_key.is_none() { missing.push("S3_ACCESS_KEY"); }
                if self.s3_secret_key.is_none() { missing.push("S3_SECRET_KEY"); }
                Err(AppError::Config(format!(
                    "partial S3 configuration: missing {}",
                    missing.join(", "),
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> Config {
        Config {
            database_url: "postgres://localhost/test".into(),
            s3_endpoint: None,
            s3_bucket: None,
            s3_access_key: None,
            s3_secret_key: None,
            db_max_connections: 5,
            embedding_model: "test-model".into(),
            chunk_size: 2048,
            chunk_overlap: 200,
            min_chunk_size: 50,
            dedup_threshold: 0.97,
            dedup_candidate_factor: 3,
        }
    }

    #[test]
    fn require_s3_all_present() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());
        config.s3_bucket = Some("test-bucket".into());
        config.s3_access_key = Some("key".into());
        config.s3_secret_key = Some("secret".into());

        let params = config.require_s3().unwrap();
        assert_eq!(params.endpoint, "http://localhost:9000");
        assert_eq!(params.bucket, "test-bucket");
        assert_eq!(params.access_key, "key");
        assert_eq!(params.secret_key, "secret");
    }

    #[test]
    fn require_s3_all_absent() {
        let config = base_config();
        let err = config.require_s3().unwrap_err();
        assert!(err.to_string().contains("S3 storage is required"));
    }

    #[test]
    fn require_s3_partial_config() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());
        // bucket, access_key, secret_key are all None

        let err = config.require_s3().unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("partial S3 configuration"));
        assert!(msg.contains("S3_BUCKET"));
        assert!(msg.contains("S3_ACCESS_KEY"));
        assert!(msg.contains("S3_SECRET_KEY"));
    }

    #[test]
    fn s3_params_all_present() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());
        config.s3_bucket = Some("test-bucket".into());
        config.s3_access_key = Some("key".into());
        config.s3_secret_key = Some("secret".into());

        let params = config.s3_params().unwrap().unwrap();
        assert_eq!(params.endpoint, "http://localhost:9000");
    }

    #[test]
    fn s3_params_all_absent_returns_none() {
        let config = base_config();
        assert!(config.s3_params().unwrap().is_none());
    }

    #[test]
    fn s3_params_partial_config_errors() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());

        let err = config.s3_params().unwrap_err();
        assert!(err.to_string().contains("partial S3 configuration"));
    }
}
