use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use serde::Deserialize;

// -- Request parameter structs --

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpecStatusParams {
    /// Optional session ID to query status for. If omitted, returns general server status.
    pub session_id: Option<String>,
}

// -- McpServer --

#[derive(Clone)]
pub struct McpServer {
    tool_router: ToolRouter<McpServer>,
}

impl McpServer {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

// -- Tool implementations --

#[tool_router]
impl McpServer {
    #[tool(description = "Check the status of the spec pipeline server. Returns a static status message confirming the server is operational.")]
    async fn spec_status(
        &self,
        Parameters(_params): Parameters<SpecStatusParams>,
    ) -> Result<CallToolResult, McpError> {
        Ok(CallToolResult::success(vec![Content::text(
            "spec-pipeline-mcp is running",
        )]))
    }
}

// -- ServerHandler --

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "spec-pipeline-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
    }
}
