mod common;

use pgvector::Vector;
use serde_json::json;
use uuid::Uuid;

use rag_mcp::db::models::{NewChunk, NewSource};
use rag_mcp::db::queries;

#[tokio::test]
async fn source_chunk_lifecycle() {
    let (pool, _container) = common::setup_db().await;

    let source_id = Uuid::new_v4();

    // 1. insert_source
    let new_source = NewSource {
        id: source_id,
        s3_key: "docs/test-file.pdf".into(),
        filename: "test-file.pdf".into(),
        content_type: "application/pdf".into(),
        metadata: json!({"pages": 3}),
        project: None,
        owner_user_id: None,
    };
    let source = queries::insert_source(&pool, &new_source).await.unwrap();
    assert_eq!(source.id, source_id);
    assert_eq!(source.filename, "test-file.pdf");

    // 2. get_source_by_id
    let fetched = queries::get_source_by_id(&pool, source_id).await.unwrap();
    let fetched = fetched.expect("source should exist");
    assert_eq!(fetched.s3_key, "docs/test-file.pdf");

    // 3. get_source_by_s3_key
    let by_key = queries::get_source_by_s3_key(&pool, "docs/test-file.pdf")
        .await
        .unwrap()
        .expect("source should exist by s3_key");
    assert_eq!(by_key.id, source_id);

    // 4. insert_chunks with 768-dim test embeddings
    let dim = 768;
    let mut emb_a = vec![0.0f32; dim];
    emb_a[0] = 1.0;
    let mut emb_b = vec![0.0f32; dim];
    emb_b[1] = 1.0;

    let chunks = vec![
        NewChunk {
            id: Uuid::new_v4(),
            source_id,
            chunk_index: 0,
            content: "first chunk".into(),
            embedding: Vector::from(emb_a.clone()),
            metadata: json!({}),
        },
        NewChunk {
            id: Uuid::new_v4(),
            source_id,
            chunk_index: 1,
            content: "second chunk".into(),
            embedding: Vector::from(emb_b.clone()),
            metadata: json!({}),
        },
    ];
    let inserted = queries::insert_chunks(&pool, &chunks).await.unwrap();
    assert_eq!(inserted, 2);

    // 5. search_chunks — query near emb_a, expect chunk 0 first
    let query_emb = Vector::from(emb_a);
    let results = queries::search_chunks(&pool, &query_emb, 10, None, None, None).await.unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].content, "first chunk");
    assert!(results[0].similarity > results[1].similarity);
    assert_eq!(results[0].source_filename, "test-file.pdf");
    assert_eq!(results[0].chunk_metadata, json!({}));

    // 6. delete_chunks_by_source
    let deleted = queries::delete_chunks_by_source(&pool, source_id).await.unwrap();
    assert_eq!(deleted, 2);

    // 7. delete_source
    let removed = queries::delete_source(&pool, source_id).await.unwrap();
    assert!(removed);

    // 8. get_source_by_id returns None
    let gone = queries::get_source_by_id(&pool, source_id).await.unwrap();
    assert!(gone.is_none());
}
