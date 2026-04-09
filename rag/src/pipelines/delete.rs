use sqlx::PgPool;
use uuid::Uuid;

use crate::db::queries;
use crate::error::{AppError, AppResult};
use crate::storage::S3Storage;

#[derive(Clone)]
pub struct DeletePipeline {
    pool: PgPool,
    storage: Option<S3Storage>,
}

impl DeletePipeline {
    pub fn new(pool: PgPool, storage: Option<S3Storage>) -> Self {
        Self { pool, storage }
    }

    pub async fn delete(&self, source_id: Uuid) -> AppResult<()> {
        let source = queries::get_source_by_id(&self.pool, source_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("source {source_id} not found")))?;

        let s3_key = source.s3_key;

        queries::delete_source(&self.pool, source_id).await?;

        if let Some(ref storage) = self.storage {
            if let Err(e) = storage.delete_object(&s3_key).await {
                tracing::warn!(
                    source_id = %source_id,
                    s3_key = %s3_key,
                    error = %e,
                    "delete: S3 object removal failed after successful DB delete; object may be orphaned"
                );
            }
        }

        Ok(())
    }
}
