use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, ImageExt};
use testcontainers_modules::postgres::Postgres;

pub async fn setup_db() -> (PgPool, ContainerAsync<Postgres>) {
    let container = Postgres::default()
        .with_name("pgvector/pgvector")
        .with_tag("pg16")
        .start()
        .await
        .expect("failed to start pgvector container");

    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("failed to get container port");

    let url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/postgres",
        host_port
    );

    let tmp_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("failed to connect to test container");

    sqlx::query("CREATE EXTENSION IF NOT EXISTS vector")
        .execute(&tmp_pool)
        .await
        .expect("failed to create vector extension");

    tmp_pool.close().await;

    let pool = rag_mcp::db::connect(&url, 2)
        .await
        .expect("failed to connect and run migrations");

    (pool, container)
}
