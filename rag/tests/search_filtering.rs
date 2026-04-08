mod common;

use pgvector::Vector;
use serde_json::json;
use uuid::Uuid;

use rag_mcp::db::models::{NewChunk, NewSource};
use rag_mcp::db::queries;

/// Helper: create a 768-dim embedding with a single non-zero component at `idx`.
fn unit_embedding(idx: usize) -> Vector {
    let mut v = vec![0.0f32; 768];
    v[idx] = 1.0;
    Vector::from(v)
}

/// Helper: insert a source with one chunk carrying the given embedding.
async fn insert_source_with_chunk(
    pool: &sqlx::PgPool,
    filename: &str,
    metadata: serde_json::Value,
    content: &str,
    embedding: Vector,
) -> Uuid {
    let source_id = Uuid::new_v4();
    let source = NewSource {
        id: source_id,
        s3_key: format!("test/{}", filename),
        filename: filename.to_string(),
        content_type: "text/plain".to_string(),
        metadata,
        project: None,
    };
    queries::insert_source(pool, &source).await.unwrap();
    let chunk = NewChunk {
        id: Uuid::new_v4(),
        source_id,
        chunk_index: 0,
        content: content.to_string(),
        embedding,
        metadata: json!({}),
    };
    queries::insert_chunks(pool, &[chunk]).await.unwrap();
    source_id
}

#[tokio::test]
async fn search_no_filter_returns_all_chunks() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "readme.md", json!({}), "markdown content", unit_embedding(0),
    ).await;
    insert_source_with_chunk(
        &pool, "main.rs", json!({}), "rust content", unit_embedding(1),
    ).await;

    let query_emb = unit_embedding(0);
    let results = queries::search_chunks(&pool, &query_emb, 10, None, None, None)
        .await
        .unwrap();
    assert_eq!(results.len(), 2);
}

#[tokio::test]
async fn search_filename_glob_filters_by_extension() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "readme.md", json!({}), "markdown content", unit_embedding(0),
    ).await;
    insert_source_with_chunk(
        &pool, "main.rs", json!({}), "rust content", unit_embedding(1),
    ).await;

    let query_emb = unit_embedding(0);
    let like_pattern = queries::glob_to_like("*.md");
    let results = queries::search_chunks(
        &pool, &query_emb, 10, Some(&like_pattern), None, None,
    )
    .await
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source_filename, "readme.md");
}

#[tokio::test]
async fn search_filename_glob_question_mark() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "a.rs", json!({}), "short name", unit_embedding(0),
    ).await;
    insert_source_with_chunk(
        &pool, "ab.rs", json!({}), "longer name", unit_embedding(1),
    ).await;

    let query_emb = unit_embedding(0);
    let like_pattern = queries::glob_to_like("?.rs");
    let results = queries::search_chunks(
        &pool, &query_emb, 10, Some(&like_pattern), None, None,
    )
    .await
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source_filename, "a.rs");
}

#[tokio::test]
async fn search_filename_glob_no_match_returns_empty() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "main.rs", json!({}), "rust content", unit_embedding(0),
    ).await;

    let query_emb = unit_embedding(0);
    let like_pattern = queries::glob_to_like("*.go");
    let results = queries::search_chunks(
        &pool, &query_emb, 10, Some(&like_pattern), None, None,
    )
    .await
    .unwrap();

    assert!(results.is_empty());
}

#[tokio::test]
async fn search_metadata_containment_filter() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "doc_en.md", json!({"lang": "en"}), "english doc", unit_embedding(0),
    ).await;
    insert_source_with_chunk(
        &pool, "doc_fr.md", json!({"lang": "fr"}), "french doc", unit_embedding(1),
    ).await;

    let query_emb = unit_embedding(0);
    let meta_filter = json!({"lang": "en"});
    let results = queries::search_chunks(
        &pool, &query_emb, 10, None, Some(&meta_filter), None,
    )
    .await
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source_filename, "doc_en.md");
}

#[tokio::test]
async fn search_combined_filters_and_semantics() {
    let (pool, _container) = common::setup_db().await;

    // Matches both filters
    insert_source_with_chunk(
        &pool, "docs/guide.md", json!({"project": "rag"}), "guide", unit_embedding(0),
    ).await;
    // Matches filename but not metadata
    insert_source_with_chunk(
        &pool, "docs/other.md", json!({"project": "other"}), "other", unit_embedding(1),
    ).await;
    // Matches metadata but not filename
    insert_source_with_chunk(
        &pool, "src/lib.rs", json!({"project": "rag"}), "lib", unit_embedding(2),
    ).await;

    let query_emb = unit_embedding(0);
    let like_pattern = queries::glob_to_like("docs/*.md");
    let meta_filter = json!({"project": "rag"});
    let results = queries::search_chunks(
        &pool, &query_emb, 10, Some(&like_pattern), Some(&meta_filter), None,
    )
    .await
    .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source_filename, "docs/guide.md");
}

#[tokio::test]
async fn search_unfiltered_caller_unchanged() {
    let (pool, _container) = common::setup_db().await;

    insert_source_with_chunk(
        &pool, "file.txt", json!({}), "some content", unit_embedding(0),
    ).await;

    let query_emb = unit_embedding(0);
    // Passing None, None is equivalent to SearchFilter::default()
    let results = queries::search_chunks(&pool, &query_emb, 10, None, None, None)
        .await
        .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source_filename, "file.txt");
}
