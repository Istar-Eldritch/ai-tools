mod common;

use bytes::Bytes;
use rag_mcp::config::Config;
use rag_mcp::storage::S3Storage;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

async fn setup_minio() -> (S3Storage, ContainerAsync<GenericImage>) {
    let container = GenericImage::new("minio/minio", "latest")
        .with_exposed_port(9000.tcp())
        .with_wait_for(WaitFor::message_on_stderr("API:"))
        .with_env_var("MINIO_ROOT_USER", "minioadmin")
        .with_env_var("MINIO_ROOT_PASSWORD", "minioadmin")
        .with_cmd(["server", "/data"])
        .start()
        .await
        .expect("failed to start minio container");

    let host_port = container
        .get_host_port_ipv4(9000)
        .await
        .expect("failed to get minio port");

    let config = Config {
        database_url: String::new(),
        s3_endpoint: format!("http://127.0.0.1:{}", host_port),
        s3_bucket: "test-bucket".into(),
        s3_access_key: "minioadmin".into(),
        s3_secret_key: "minioadmin".into(),
        db_max_connections: 1,
        embedding_model: String::new(),
        chunk_size: 2048,
        chunk_overlap: 200,
        min_chunk_size: 0,
        dedup_threshold: 0.97,
        dedup_candidate_factor: 3,
    };

    let storage = S3Storage::new(&config)
        .await
        .expect("failed to create S3Storage");

    storage
        .create_bucket()
        .await
        .expect("failed to create test bucket");

    (storage, container)
}

#[tokio::test]
async fn put_and_delete_object() {
    let (storage, _container) = setup_minio().await;

    let key = "test/hello.txt";
    let data = Bytes::from_static(b"hello world");

    // 1. Put object
    storage
        .put_object(key, data.clone(), "text/plain")
        .await
        .expect("put_object should succeed");

    // 2. Delete object
    storage
        .delete_object(key)
        .await
        .expect("delete_object should succeed");

    // 3. Idempotent delete (deleting non-existent key should not error)
    storage
        .delete_object(key)
        .await
        .expect("idempotent delete should succeed");

    // 4. Re-put after delete
    storage
        .put_object(key, data, "text/plain")
        .await
        .expect("re-put after delete should succeed");
}
