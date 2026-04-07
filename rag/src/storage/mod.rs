use std::sync::Arc;

use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Builder as S3ConfigBuilder, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

use crate::config::Config;
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
    pub async fn new(config: &Config) -> AppResult<Self> {
        let creds = Credentials::new(
            &config.s3_access_key,
            &config.s3_secret_key,
            None,
            None,
            "rag-static",
        );

        let s3_config = S3ConfigBuilder::new()
            .behavior_version(BehaviorVersion::latest())
            .endpoint_url(&config.s3_endpoint)
            .region(Region::new("us-east-1"))
            .credentials_provider(creds)
            .force_path_style(true)
            .build();

        let client = Client::from_conf(s3_config);

        Ok(Self {
            inner: Arc::new(S3StorageInner {
                client,
                bucket: config.s3_bucket.clone(),
            }),
        })
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
