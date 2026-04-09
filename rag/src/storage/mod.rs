use std::sync::Arc;

use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Builder as S3ConfigBuilder, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

use crate::config::{Config, S3Params};
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct S3Storage {
    inner: Arc<S3StorageInner>,
}

struct S3StorageInner {
    client: Client,
    bucket: String,
}

impl S3Storage {
    /// Create an `S3Storage` from validated `S3Params`.
    pub fn from_params(params: &S3Params) -> Self {
        let creds = Credentials::new(
            &params.access_key,
            &params.secret_key,
            None,
            None,
            "rag-static",
        );

        let s3_config = S3ConfigBuilder::new()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(&params.endpoint)
            .region(Region::new("us-east-1"))
            .credentials_provider(creds)
            .force_path_style(true)
            .build();

        let client = Client::from_conf(s3_config);

        Self {
            inner: Arc::new(S3StorageInner {
                client,
                bucket: params.bucket.clone(),
            }),
        }
    }

    /// Try to create an `S3Storage` from `Config`.
    ///
    /// Returns `Ok(Some(Self))` when all S3 fields are set, `Ok(None)` when
    /// all are absent, and `Err` when only partially configured.
    pub fn from_config(config: &Config) -> AppResult<Option<Self>> {
        config.s3_params().map(|opt| opt.map(|p| Self::from_params(&p)))
    }

    /// Create a bucket. Exposed for integration-test setup only.
    #[doc(hidden)]
    pub async fn create_bucket(&self) -> AppResult<()> {
        self.inner
            .client
            .create_bucket()
            .bucket(&self.inner.bucket)
            .send()
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub async fn put_object(
        &self,
        key: &str,
        data: bytes::Bytes,
        content_type: &str,
    ) -> AppResult<()> {
        self.inner
            .client
            .put_object()
            .bucket(&self.inner.bucket)
            .key(key)
            .body(ByteStream::from(data))
            .content_type(content_type)
            .send()
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
    }

    pub async fn delete_object(&self, key: &str) -> AppResult<()> {
        self.inner
            .client
            .delete_object()
            .bucket(&self.inner.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(())
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
            pdfium_lib_path: None,
            max_pdf_bytes: 104_857_600,
        }
    }

    #[test]
    fn from_config_all_present_returns_some() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());
        config.s3_bucket = Some("test-bucket".into());
        config.s3_access_key = Some("key".into());
        config.s3_secret_key = Some("secret".into());

        let result = S3Storage::from_config(&config).unwrap();
        assert!(result.is_some());
    }

    #[test]
    fn from_config_all_absent_returns_none() {
        let config = base_config();
        let result = S3Storage::from_config(&config).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn from_config_partial_returns_error() {
        let mut config = base_config();
        config.s3_endpoint = Some("http://localhost:9000".into());
        // bucket, access_key, secret_key are all None

        match S3Storage::from_config(&config) {
            Err(e) => assert!(
                e.to_string().contains("partial S3 configuration"),
                "unexpected error message: {e}"
            ),
            Ok(_) => panic!("expected error for partial S3 config"),
        }
    }
}
