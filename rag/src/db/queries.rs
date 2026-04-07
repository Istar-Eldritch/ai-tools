use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;
use super::models::{NewChunk, NewSource, SearchResult, Source};

pub async fn insert_source(pool: &PgPool, source: &NewSource) -> AppResult<Source> {
    let row = sqlx::query_as::<_, Source>(
        "INSERT INTO sources (id, s3_key, filename, content_type, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *"
    )
    .bind(source.id)
    .bind(&source.s3_key)
    .bind(&source.filename)
    .bind(&source.content_type)
    .bind(&source.metadata)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn get_source_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Source>> {
    let row = sqlx::query_as::<_, Source>("SELECT * FROM sources WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn get_source_by_s3_key(pool: &PgPool, s3_key: &str) -> AppResult<Option<Source>> {
    let row = sqlx::query_as::<_, Source>("SELECT * FROM sources WHERE s3_key = $1")
        .bind(s3_key)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

/// Deletes a source by ID. Associated chunks are removed automatically via
/// the `ON DELETE CASCADE` foreign key constraint on the `chunks` table.
pub async fn delete_source(pool: &PgPool, id: Uuid) -> AppResult<bool> {
    let result = sqlx::query("DELETE FROM sources WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn insert_chunks(pool: &PgPool, chunks: &[NewChunk]) -> AppResult<u64> {
    if chunks.is_empty() {
        return Ok(0);
    }
    let mut tx = pool.begin().await?;
    let mut count: u64 = 0;
    for chunk in chunks {
        let result = sqlx::query(
            "INSERT INTO chunks (id, source_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (source_id, chunk_index) DO NOTHING"
        )
        .bind(chunk.id)
        .bind(chunk.source_id)
        .bind(chunk.chunk_index)
        .bind(&chunk.content)
        .bind(&chunk.embedding)
        .execute(&mut *tx)
        .await?;
        count += result.rows_affected();
    }
    tx.commit().await?;
    Ok(count)
}

pub async fn search_chunks(
    pool: &PgPool,
    embedding: &Vector,
    k: i64,
) -> AppResult<Vec<SearchResult>> {
    let rows = sqlx::query_as::<_, SearchResult>(
        "SELECT
             c.id          AS chunk_id,
             c.source_id,
             c.chunk_index,
             c.content,
             s.filename    AS source_filename,
             s.metadata    AS source_metadata,
             1.0 - (c.embedding <=> $1) AS similarity
         FROM chunks c
         JOIN sources s ON s.id = c.source_id
         ORDER BY c.embedding <=> $1
         LIMIT $2"
    )
    .bind(embedding)
    .bind(k)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn delete_chunks_by_source(pool: &PgPool, source_id: Uuid) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM chunks WHERE source_id = $1")
        .bind(source_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
