use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, Peer, RoleServer, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolResult, Content, Implementation, Meta, ProgressNotificationParam,
        ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use rag_mcp::db::queries::{self as db_queries, glob_to_like};
use rag_mcp::error::AppError;
use rag_mcp::pipelines::{
    delete::DeletePipeline,
    directory_ingest::{DirectoryIngestPipeline, ProgressCallback},
    ingest::IngestPipeline,
    search::{SearchFilter, SearchPipeline},
};

// -- Request parameter structs --

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestParams {
    /// The full text content of the document to ingest.
    pub content: String,
    /// Human-readable filename (e.g. "design.md").
    pub filename: String,
    /// MIME content type (e.g. "text/plain" or "text/markdown").
    pub content_type: String,
    /// Arbitrary JSON metadata to attach to the source record.
    pub metadata: Option<serde_json::Value>,
    /// Project name to associate with this source.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchParams {
    /// Natural language query string.
    pub query: String,
    /// Number of results to return (1–100). Defaults to 5.
    pub k: Option<i64>,
    /// Glob pattern to filter results by source filename (case-sensitive).
    /// Supports `*` (any sequence) and `?` (single character).
    /// Example: `"docs/*.md"` matches any `.md` file under `docs/`.
    pub filename_glob: Option<String>,
    /// JSONB containment filter on source metadata.
    /// Must be a JSON object. A source matches if its metadata contains
    /// every key/value pair in this object.
    /// Example: `{"project": "rag", "lang": "en"}`.
    pub source_metadata: Option<serde_json::Value>,
    /// Filter results to a specific project name.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteSourceParams {
    /// UUID of the source to delete (as returned by the ingest tool).
    pub source_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestDirectoryParams {
    /// Absolute path to a directory on the local filesystem.
    pub path: String,
    /// Glob patterns for files to include (e.g., ["**/*.rs", "**/*.md"]).
    /// At least one pattern is required.
    pub include: Vec<String>,
    /// Glob patterns for files to exclude (e.g., ["**/target/**"]).
    /// Applied after include. Defaults to empty.
    pub exclude: Option<Vec<String>>,
    /// Arbitrary JSON metadata attached to every ingested source.
    /// Must be a JSON object if provided.
    pub metadata: Option<serde_json::Value>,
    /// Project name to associate with all ingested sources.
    pub project: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListSourcesParams {
    /// Filter results to a specific project name.
    pub project: Option<String>,
    /// Glob pattern to filter results by source filename (case-sensitive).
    /// Supports `*` (any sequence) and `?` (single character).
    /// Example: `"docs/*.md"` matches any `.md` file under `docs/`.
    pub filename_glob: Option<String>,
    /// Maximum number of results to return (1–500). Defaults to 100.
    pub limit: Option<i64>,
    /// Pagination offset. Defaults to 0.
    pub offset: Option<i64>,
}

// -- McpServer --

#[derive(Clone)]
pub struct McpServer {
    tool_router: ToolRouter<McpServer>,
    pool: sqlx::PgPool,
    ingest: IngestPipeline,
    search: SearchPipeline,
    delete: DeletePipeline,
    directory_ingest: DirectoryIngestPipeline,
}

impl McpServer {
    pub fn new(
        pool: sqlx::PgPool,
        ingest: IngestPipeline,
        search: SearchPipeline,
        delete: DeletePipeline,
        directory_ingest: DirectoryIngestPipeline,
    ) -> Self {
        Self {
            tool_router: Self::tool_router(),
            pool,
            ingest,
            search,
            delete,
            directory_ingest,
        }
    }
}

// -- Tool implementations --

#[tool_router]
impl McpServer {
    #[tool(description = "Ingest a document into the knowledge base. Stores the original to S3 when configured, chunks the text, embeds the chunks, and persists everything to PostgreSQL. Returns a JSON object with the source record (id, filename, content_type, metadata, created_at).")]
    async fn ingest(
        &self,
        Parameters(params): Parameters<IngestParams>,
    ) -> Result<CallToolResult, McpError> {
        let metadata = params
            .metadata
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        let result: Result<_, McpError> = self
            .ingest
            .ingest(&params.content, &params.filename, &params.content_type, metadata, params.project, None)
            .await
            .map_err(app_error_to_mcp_error);
        let source = result?;
        let json = serde_json::to_string(&source)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Search the knowledge base with a natural language query. Returns a JSON array of the top-k most semantically relevant chunks, each with content, source_filename, chunk_index, similarity score, and source_metadata. k defaults to 5 (range: 1-100). Optional: filename_glob filters by source filename (glob pattern, case-sensitive); source_metadata filters by JSONB containment (must be a JSON object). When a source was ingested via ingest_directory, its filename is the relative path within that directory. To reconstruct the full file path, join the directory value from source_metadata with the filename.")]
    async fn search(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let k = params.k.unwrap_or(5);
        let filters = SearchFilter {
            filename_glob: params.filename_glob,
            source_metadata: params.source_metadata,
            project: params.project,
        };
        let result: Result<_, McpError> = self
            .search
            .search(&params.query, k, filters)
            .await
            .map_err(app_error_to_mcp_error);
        let results = result?;
        let json = serde_json::to_string(&results)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Delete a source document and all its associated chunks from the knowledge base. Removes the original from S3 (if configured) and all chunk/vector records from PostgreSQL. The source_id is the UUID returned by the ingest tool.")]
    async fn delete_source(
        &self,
        Parameters(params): Parameters<DeleteSourceParams>,
    ) -> Result<CallToolResult, McpError> {
        let uuid = Uuid::parse_str(&params.source_id).map_err(|_| {
            McpError::invalid_params(
                format!("source_id is not a valid UUID: '{}'", params.source_id),
                None,
            )
        })?;
        let result: Result<_, McpError> = self
            .delete
            .delete(uuid)
            .await
            .map_err(app_error_to_mcp_error);
        result?;
        Ok(CallToolResult::success(vec![Content::text(
            "source deleted",
        )]))
    }

    #[tool(description = "Ingest all matching files from a local directory into the knowledge base. Walks the directory recursively, filters by include/exclude glob patterns, detects binary files, deduplicates by content hash, and ingests with bounded concurrency. Updates preserve source IDs and reuse embeddings for unchanged chunks. Detects renamed files by chunk-hash overlap: exact renames keep existing source IDs, modified renames re-chunk changed content. Files removed from the directory are automatically deleted from the knowledge base. Returns a summary with counts of ingested, renamed, deleted_orphans, skipped, and failed files.")]
    async fn ingest_directory(
        &self,
        ct: CancellationToken,
        meta: Meta,
        client: Peer<RoleServer>,
        Parameters(params): Parameters<IngestDirectoryParams>,
    ) -> Result<CallToolResult, McpError> {
        let metadata = params
            .metadata
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        let exclude = params.exclude.unwrap_or_default();

        let on_progress: Option<ProgressCallback> =
            meta.get_progress_token().map(|token| {
                let client = client.clone();
                Arc::new(move |progress: f64, total: Option<f64>, message: &str| {
                    let client = client.clone();
                    let token = token.clone();
                    let message = message.to_string();
                    tokio::spawn(async move {
                        let _ = client
                            .notify_progress(ProgressNotificationParam {
                                progress_token: token,
                                progress,
                                total,
                                message: Some(message),
                            })
                            .await;
                    });
                }) as ProgressCallback
            });

        let summary = self
            .directory_ingest
            .ingest_directory(
                &params.path,
                &params.include,
                &exclude,
                metadata,
                params.project,
                on_progress.as_ref(),
                &ct,
            )
            .await
            .map_err(app_error_to_mcp_error)?;
        let json = serde_json::to_string(&summary)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "List sources in the knowledge base with optional project and filename filtering. Returns a JSON array of source records, each with id, filename, content_type, project, metadata, created_at, and chunk_count. Supports pagination via limit/offset. When a source was ingested via ingest_directory, its filename is the relative path within that directory. To reconstruct the full file path, join the directory value from metadata with the filename.")]
    async fn list_sources(
        &self,
        Parameters(params): Parameters<ListSourcesParams>,
    ) -> Result<CallToolResult, McpError> {
        let limit = params.limit.unwrap_or(100).min(500).max(1);
        let offset = params.offset.unwrap_or(0).max(0);
        let filename_like: Option<String> =
            params.filename_glob.as_deref().map(glob_to_like);

        let results = db_queries::list_sources(
            &self.pool,
            params.project.as_deref(),
            filename_like.as_deref(),
            limit,
            offset,
        )
        .await
        .map_err(app_error_to_mcp_error)?;

        let json = serde_json::to_string(&results)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }
}

// -- ServerHandler --

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "rag-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
    }
}

// -- Error translation --

fn app_error_to_mcp_error(e: AppError) -> McpError {
    match e {
        AppError::Validation(msg) => McpError::invalid_params(msg, None),
        AppError::NotFound(msg) => McpError::invalid_params(msg, None),
        other => {
            tracing::error!(error = %other, "tool call internal error");
            McpError::internal_error("internal error", None)
        }
    }
}
