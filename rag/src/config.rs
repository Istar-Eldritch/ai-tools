use clap::Args;

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

#[derive(Debug, Clone, Args)]
pub struct Config {
    /// PostgreSQL connection URL
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: String,

    /// S3-compatible endpoint URL (e.g., http://localhost:9000 for MinIO)
    #[arg(long, env = "S3_ENDPOINT")]
    pub s3_endpoint: String,

    /// S3 bucket name for document storage
    #[arg(long, env = "S3_BUCKET")]
    pub s3_bucket: String,

    /// S3 access key ID
    #[arg(long, env = "S3_ACCESS_KEY")]
    pub s3_access_key: String,

    /// S3 secret access key
    #[arg(long, env = "S3_SECRET_KEY")]
    pub s3_secret_key: String,

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
