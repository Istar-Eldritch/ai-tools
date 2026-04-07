use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::error::AppResult;

pub async fn connect(database_url: &str, max_connections: u32) -> AppResult<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;
    Ok(pool)
}
