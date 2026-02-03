use reqwest::header;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Configuration error: {0}")]
    Config(#[from] config::ConfigError),

    #[error("API request error: {0}")]
    Api(#[from] reqwest::Error),

    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("URL parsing error: {0}")]
    Url(#[from] url::ParseError),

    #[error("Invalid HTTP header value: {0}")]
    InvalidHeaderValue(#[from] header::InvalidHeaderValue),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Inquire error: {0}")]
    Inquire(#[from] inquire::InquireError),

    #[error("TOML serialization error: {0}")]
    Toml(#[from] toml::ser::Error),

    #[error("{0}")]
    General(String),
}
