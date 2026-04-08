use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;
use uuid::Uuid;

use rag_mcp::error::AppError;
use rag_mcp::pipelines::{
    delete::DeletePipeline,
    ingest::IngestPipeline,
    search::SearchPipeline,
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
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchParams {
    /// Natural language query string.
    pub query: String,
    /// Number of results to return (1–100). Defaults to 5.
    pub k: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteSourceParams {
    /// UUID of the source to delete (as returned by the ingest tool).
    pub source_id: String,
}

// -- McpServer --

#[derive(Clone)]
pub struct McpServer {
    tool_router: ToolRouter<McpServer>,
    ingest: IngestPipeline,
    search: SearchPipeline,
    delete: DeletePipeline,
}

impl McpServer {
    pub fn new(
        ingest: IngestPipeline,
        search: SearchPipeline,
        delete: DeletePipeline,
    ) -> Self {
        Self {
            tool_router: Self::tool_router(),
            ingest,
            search,
            delete,
        }
    }
}

// -- Tool implementations --

#[tool_router]
impl McpServer {
    #[tool(description = "Ingest a document into the knowledge base. Uploads the original to S3, chunks the text, embeds the chunks, and persists everything to PostgreSQL. Returns a JSON object with the source record (id, filename, content_type, metadata, created_at).")]
    async fn ingest(
        &self,
        Parameters(params): Parameters<IngestParams>,
    ) -> Result<CallToolResult, McpError> {
        let metadata = params
            .metadata
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        let result: Result<_, McpError> = self
            .ingest
            .ingest(&params.content, &params.filename, &params.content_type, metadata)
            .await
            .map_err(app_error_to_mcp_error);
        let source = result?;
        let json = serde_json::to_string(&source)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Search the knowledge base with a natural language query. Returns a JSON array of the top-k most semantically relevant chunks, each with content, source_filename, chunk_index, similarity score, and source_metadata. k defaults to 5 (range: 1-100).")]
    async fn search(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let k = params.k.unwrap_or(5);
        let result: Result<_, McpError> = self
            .search
            .search(&params.query, k)
            .await
            .map_err(app_error_to_mcp_error);
        let results = result?;
        let json = serde_json::to_string(&results)
            .map_err(|e| McpError::internal_error(format!("serialization error: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "Delete a source document and all its associated chunks from the knowledge base. Removes the original from S3 and all chunk/vector records from PostgreSQL. The source_id is the UUID returned by the ingest tool.")]
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
