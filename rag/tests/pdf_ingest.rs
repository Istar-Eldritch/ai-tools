//! Integration test: PDF ingest -> search round-trip.
//!
//! Requires:
//!   - Docker (for pgvector container via testcontainers)
//!   - PDFium library at PDFIUM_LIB_PATH
//!   - Test fixture PDFs (run tests/fixtures/generate.py)
//!
//! Run with:
//!   PDFIUM_LIB_PATH=/path/to/libpdfium.so \
//!   cargo test --test pdf_ingest -- --include-ignored

mod common;

use std::path::Path;
use std::sync::Arc;

use rag_mcp::chunking::ChunkConfig;
use rag_mcp::embedding::EmbeddingService;
use rag_mcp::pipelines::ingest::IngestPipeline;
use rag_mcp::pipelines::pdf::PdfExtractor;
use rag_mcp::pipelines::search::{SearchFilter, SearchPipeline};

/// Helper: build a test IngestPipeline with PDF support.
fn build_pipelines(
    pool: sqlx::PgPool,
) -> (IngestPipeline, SearchPipeline) {
    let lib_path = std::env::var("PDFIUM_LIB_PATH")
        .unwrap_or_else(|_| "/usr/local/lib/libpdfium.so".into());
    let pdf_extractor = PdfExtractor::new(Path::new(&lib_path))
        .expect("failed to load PDFium -- set PDFIUM_LIB_PATH");

    let embedding = EmbeddingService::new("nomic-embed-text-v1.5q")
        .expect("failed to load embedding model");

    let chunk_config = ChunkConfig {
        chunk_size: 2048,
        overlap: 200,
        min_chunk_size: 50,
    };

    let ingest = IngestPipeline::new(
        pool.clone(),
        None, // no S3 in test
        chunk_config,
        embedding.clone(),
        Some(Arc::new(pdf_extractor)),
        104_857_600, // 100 MB
    );

    let search = SearchPipeline::new(pool, embedding, 0.97, 3);

    (ingest, search)
}

#[tokio::test]
#[ignore] // Requires PDFium library + embedding model
async fn pdf_ingest_search_round_trip() {
    let (pool, _container) = common::setup_db().await;
    let (ingest, search) = build_pipelines(pool);

    // Read fixture PDF
    let pdf_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/simple.pdf"
    ))
    .expect("tests/fixtures/simple.pdf not found -- run tests/fixtures/generate.py");

    // Ingest the PDF
    let source = ingest
        .ingest_pdf(
            &pdf_bytes,
            "simple.pdf",
            serde_json::json!({"test": true}),
            None,
            None,
        )
        .await
        .expect("PDF ingestion failed");

    assert_eq!(source.filename, "simple.pdf");
    assert_eq!(source.content_type, "application/pdf");

    // Verify S3 key follows spec convention: {namespace}/{sha256_hex}.pdf
    // With no project supplied, namespace defaults to "default".
    assert!(
        source.s3_key.ends_with(".pdf"),
        "s3_key must end with '.pdf', got: {}",
        source.s3_key,
    );
    assert!(
        source.s3_key.starts_with("default/"),
        "s3_key must start with 'default/' (namespace) when no project is set, got: {}",
        source.s3_key,
    );
    // The segment between '/' and '.pdf' must be a 64-char hex SHA-256 digest.
    let key_stem = source.s3_key
        .strip_prefix("default/").unwrap()
        .strip_suffix(".pdf").unwrap();
    assert_eq!(
        key_stem.len(),
        64,
        "s3_key stem must be a 64-char SHA-256 hex digest, got: {}",
        key_stem,
    );
    assert!(
        key_stem.chars().all(|c| c.is_ascii_hexdigit()),
        "s3_key stem must be lowercase hex, got: {}",
        key_stem,
    );

    // Search for the known text content
    let results = search
        .search("Hello", 5, SearchFilter::default())
        .await
        .expect("search failed");

    assert!(
        !results.is_empty(),
        "expected at least one search result for 'Hello'"
    );

    // Verify chunk metadata contains page_number and bbox
    let first = &results[0];
    assert!(
        first.content.contains("Hello"),
        "expected chunk to contain 'Hello', got: {:?}",
        first.content
    );
    assert_eq!(first.source_filename, "simple.pdf");

    let meta = &first.chunk_metadata;
    assert!(
        meta.get("page_number").is_some(),
        "expected 'page_number' in chunk metadata, got: {meta}"
    );
    assert_eq!(
        meta["page_number"].as_u64().unwrap(),
        1,
        "expected page_number=1 for simple single-page PDF"
    );
    // bbox may be null if no character rects, but should be present as a key
    assert!(
        meta.get("bbox").is_some(),
        "expected 'bbox' key in chunk metadata, got: {meta}"
    );
}

#[tokio::test]
#[ignore] // Requires PDFium library + embedding model
async fn pdf_ingest_multi_page_metadata() {
    let (pool, _container) = common::setup_db().await;
    let (ingest, search) = build_pipelines(pool);

    let pdf_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/multi_page.pdf"
    ))
    .expect("tests/fixtures/multi_page.pdf not found");

    let source = ingest
        .ingest_pdf(
            &pdf_bytes,
            "multi_page.pdf",
            serde_json::json!({}),
            None,
            None,
        )
        .await
        .expect("PDF ingestion failed");

    assert_eq!(source.content_type, "application/pdf");

    // Search for page 2 content
    let results = search
        .search("Page two", 5, SearchFilter::default())
        .await
        .expect("search failed");

    assert!(
        !results.is_empty(),
        "expected results for 'Page two'"
    );

    // At least one result should have page_number in metadata
    let has_page_meta = results.iter().any(|r| {
        r.chunk_metadata
            .get("page_number")
            .and_then(|v| v.as_u64())
            .is_some()
    });
    assert!(has_page_meta, "expected page_number in at least one result's metadata");
}

#[tokio::test]
#[ignore] // Requires PDFium library
async fn pdf_ingest_encrypted_rejected() {
    let (pool, _container) = common::setup_db().await;
    let (ingest, _search) = build_pipelines(pool);

    let pdf_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/encrypted.pdf"
    ))
    .expect("tests/fixtures/encrypted.pdf not found");

    let result = ingest
        .ingest_pdf(
            &pdf_bytes,
            "encrypted.pdf",
            serde_json::json!({}),
            None,
            None,
        )
        .await;

    assert!(result.is_err(), "expected error for encrypted PDF");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.to_lowercase().contains("encrypt"),
        "expected encryption error, got: {err_msg}"
    );
}

#[tokio::test]
#[ignore] // Requires PDFium library
async fn pdf_ingest_size_limit_enforced() {
    let (pool, _container) = common::setup_db().await;

    let lib_path = std::env::var("PDFIUM_LIB_PATH")
        .unwrap_or_else(|_| "/usr/local/lib/libpdfium.so".into());
    let pdf_extractor = PdfExtractor::new(Path::new(&lib_path))
        .expect("failed to load PDFium");

    let embedding = EmbeddingService::new("nomic-embed-text-v1.5q")
        .expect("failed to load embedding model");

    let chunk_config = ChunkConfig::default();

    // Set max_pdf_bytes to 100 bytes (tiny limit for testing)
    let ingest = IngestPipeline::new(
        pool,
        None,
        chunk_config,
        embedding,
        Some(Arc::new(pdf_extractor)),
        100, // 100 bytes max
    );

    let pdf_bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/simple.pdf"
    ))
    .expect("tests/fixtures/simple.pdf not found");

    // simple.pdf is ~980 bytes, exceeds our 100 byte limit
    let result = ingest
        .ingest_pdf(
            &pdf_bytes,
            "simple.pdf",
            serde_json::json!({}),
            None,
            None,
        )
        .await;

    assert!(result.is_err(), "expected error for oversized PDF");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("exceeds maximum"),
        "expected size limit error, got: {err_msg}"
    );
}

#[tokio::test]
#[ignore] // Requires PDFium library
async fn pdf_ingest_empty_rejected() {
    let (pool, _container) = common::setup_db().await;
    let (ingest, _search) = build_pipelines(pool);

    let result = ingest
        .ingest_pdf(
            b"",
            "empty.pdf",
            serde_json::json!({}),
            None,
            None,
        )
        .await;

    assert!(result.is_err(), "expected error for empty PDF");
}

#[tokio::test]
#[ignore] // Requires PDFium library
async fn pdf_ingest_not_enabled_error() {
    let (pool, _container) = common::setup_db().await;

    let embedding = EmbeddingService::new("nomic-embed-text-v1.5q")
        .expect("failed to load embedding model");

    // Create pipeline WITHOUT pdf_extractor
    let ingest = IngestPipeline::new(
        pool,
        None,
        ChunkConfig::default(),
        embedding,
        None,  // No PDF extractor
        104_857_600,
    );

    let result = ingest
        .ingest_pdf(
            b"%PDF-1.4 fake",
            "test.pdf",
            serde_json::json!({}),
            None,
            None,
        )
        .await;

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("not enabled"),
        "expected 'not enabled' error, got: {err_msg}"
    );
}
