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

    /// Embedding model name for FastEmbed
    #[arg(long, env = "EMBEDDING_MODEL", default_value = "nomic-embed-text-v2-moe")]
    pub embedding_model: String,
}
