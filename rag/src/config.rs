use clap::Args;

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
    #[arg(long, env = "EMBEDDING_MODEL", default_value = "nomic-embed-text-v2-moe")]
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
}
