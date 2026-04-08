use pgvector::Vector;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppResult;
use super::models::{Chunk, NewChunk, NewSource, SearchResult, Source, SourceSummary};

pub async fn insert_source(pool: &PgPool, source: &NewSource) -> AppResult<Source> {
    let row = sqlx::query_as::<_, Source>(
        "INSERT INTO sources (id, s3_key, filename, content_type, metadata, project)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *"
    )
    .bind(source.id)
    .bind(&source.s3_key)
    .bind(&source.filename)
    .bind(&source.content_type)
    .bind(&source.metadata)
    .bind(&source.project)
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

pub async fn get_sources_by_filenames(
    pool: &PgPool,
    filenames: &[&str],
    project: Option<&str>,
) -> AppResult<Vec<Source>> {
    let rows = sqlx::query_as::<_, Source>(
        "SELECT * FROM sources WHERE filename = ANY($1)
           AND ($2::text IS NULL OR project = $2)"
    )
    .bind(filenames)
    .bind(project)
    .fetch_all(pool)
    .await?;
    Ok(rows)
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
            "INSERT INTO chunks (id, source_id, chunk_index, content, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (source_id, chunk_index) DO NOTHING"
        )
        .bind(chunk.id)
        .bind(chunk.source_id)
        .bind(chunk.chunk_index)
        .bind(&chunk.content)
        .bind(&chunk.embedding)
        .bind(&chunk.metadata)
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
    filename_like: Option<&str>,
    source_metadata: Option<&serde_json::Value>,
    project: Option<&str>,
) -> AppResult<Vec<SearchResult>> {
    let rows = sqlx::query_as::<_, SearchResult>(
        "SELECT
             c.id          AS chunk_id,
             c.source_id,
             c.chunk_index,
             c.content,
             c.embedding,
             s.filename    AS source_filename,
             s.metadata    AS source_metadata,
             c.metadata    AS chunk_metadata,
             1.0 - (c.embedding <=> $1) AS similarity,
             s.project     AS source_project
         FROM chunks c
         JOIN sources s ON s.id = c.source_id
         WHERE ($3::text IS NULL OR s.filename LIKE $3 ESCAPE '\\')
           AND ($4::jsonb IS NULL OR s.metadata @> $4)
           AND ($5::text IS NULL OR s.project = $5)
         ORDER BY c.embedding <=> $1
         LIMIT $2"
    )
    .bind(embedding)
    .bind(k)
    .bind(filename_like)
    .bind(source_metadata)
    .bind(project)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_sources(
    pool: &PgPool,
    project: Option<&str>,
    filename_like: Option<&str>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<SourceSummary>> {
    let rows = sqlx::query_as::<_, SourceSummary>(
        "SELECT s.id, s.filename, s.content_type, s.project, s.metadata,
                s.created_at, COUNT(c.id) AS chunk_count
         FROM sources s
         LEFT JOIN chunks c ON c.source_id = s.id
         WHERE ($1::text IS NULL OR s.project = $1)
           AND ($2::text IS NULL OR s.filename LIKE $2 ESCAPE '\\')
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT $3 OFFSET $4"
    )
    .bind(project)
    .bind(filename_like)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_chunks_by_source(pool: &PgPool, source_id: Uuid) -> AppResult<Vec<Chunk>> {
    let rows = sqlx::query_as::<_, Chunk>(
        "SELECT id, source_id, chunk_index, content, embedding, metadata, created_at
         FROM chunks WHERE source_id = $1"
    )
    .bind(source_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn update_source_metadata(
    pool: &PgPool,
    id: Uuid,
    metadata: &serde_json::Value,
    content_type: &str,
) -> AppResult<Source> {
    let row = sqlx::query_as::<_, Source>(
        "UPDATE sources SET metadata = $2, content_type = $3 WHERE id = $1 RETURNING *"
    )
    .bind(id)
    .bind(metadata)
    .bind(content_type)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn get_sources_by_directory(
    pool: &PgPool,
    directory: &str,
    project: Option<&str>,
) -> AppResult<Vec<Source>> {
    let rows = sqlx::query_as::<_, Source>(
        "SELECT * FROM sources WHERE metadata->>'directory' = $1
           AND ($2::text IS NULL OR project = $2)"
    )
    .bind(directory)
    .bind(project)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn rename_source(
    pool: &PgPool,
    id: Uuid,
    new_filename: &str,
    new_metadata: &serde_json::Value,
    new_content_type: &str,
) -> AppResult<Source> {
    let row = sqlx::query_as::<_, Source>(
        "UPDATE sources SET filename = $2, metadata = $3, content_type = $4 WHERE id = $1 RETURNING *"
    )
    .bind(id)
    .bind(new_filename)
    .bind(new_metadata)
    .bind(new_content_type)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn replace_chunks(pool: &PgPool, source_id: Uuid, new_chunks: &[NewChunk]) -> AppResult<u64> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM chunks WHERE source_id = $1")
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
    let mut count: u64 = 0;
    for chunk in new_chunks {
        let result = sqlx::query(
            "INSERT INTO chunks (id, source_id, chunk_index, content, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(chunk.id)
        .bind(chunk.source_id)
        .bind(chunk.chunk_index)
        .bind(&chunk.content)
        .bind(&chunk.embedding)
        .bind(&chunk.metadata)
        .execute(&mut *tx)
        .await?;
        count += result.rows_affected();
    }
    tx.commit().await?;
    Ok(count)
}

pub async fn delete_chunks_by_source(pool: &PgPool, source_id: Uuid) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM chunks WHERE source_id = $1")
        .bind(source_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Translates a glob pattern to a SQL LIKE pattern.
///
/// Metacharacter mapping:
/// - `*`  ->  `%`  (match any sequence)
/// - `?`  ->  `_`  (match exactly one character)
///
/// SQL LIKE special characters that appear literally in the input are escaped
/// with a backslash so they are treated as literals:
/// - `%`  ->  `\%`
/// - `_`  ->  `\_`
/// - `\`  ->  `\\`
///
/// Use the result with `LIKE $n ESCAPE '\'` in SQL.
pub fn glob_to_like(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() + 4);
    for ch in pattern.chars() {
        match ch {
            '*' => out.push('%'),
            '?' => out.push('_'),
            '%' => {
                out.push('\\');
                out.push('%');
            }
            '_' => {
                out.push('\\');
                out.push('_');
            }
            '\\' => {
                out.push('\\');
                out.push('\\');
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod glob_tests {
    use super::glob_to_like;

    #[test]
    fn star_becomes_percent() {
        assert_eq!(glob_to_like("*.md"), "%.md");
    }

    #[test]
    fn question_becomes_underscore() {
        assert_eq!(glob_to_like("src/?.rs"), "src/_.rs");
    }

    #[test]
    fn literal_percent_escaped() {
        assert_eq!(glob_to_like("100%off"), r"100\%off");
    }

    #[test]
    fn literal_underscore_escaped() {
        assert_eq!(glob_to_like("some_file"), r"some\_file");
    }

    #[test]
    fn backslash_doubled() {
        assert_eq!(glob_to_like(r"path\to"), r"path\\to");
    }

    #[test]
    fn combined_metacharacters() {
        assert_eq!(glob_to_like("docs/*.md"), "docs/%.md");
    }

    #[test]
    fn empty_pattern() {
        assert_eq!(glob_to_like(""), "");
    }

    #[test]
    fn no_metacharacters() {
        assert_eq!(glob_to_like("README.md"), "README.md");
    }
}
