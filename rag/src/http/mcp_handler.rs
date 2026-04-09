use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::acl::context::UserContext;

use super::middleware::extract_user_from_api_key;
use super::AppState;

/// A JSON-RPC 2.0 request.
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<serde_json::Value>,
    pub id: Option<serde_json::Value>,
}

/// A JSON-RPC 2.0 response.
#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    fn success(id: Option<serde_json::Value>, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            result: Some(result),
            error: None,
            id,
        }
    }

    fn error(id: Option<serde_json::Value>, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: None,
            }),
            id,
        }
    }
}

/// POST /mcp — main JSON-RPC handler
pub async fn handle_mcp(
    req: HttpRequest,
    state: web::Data<AppState>,
    body: web::Json<JsonRpcRequest>,
) -> HttpResponse {
    let rpc = body.into_inner();

    // For initialize, we don't require auth (MCP spec: client sends initialize first)
    if rpc.method == "initialize" {
        return handle_initialize(rpc.id);
    }

    // notifications/ping doesn't require auth either
    if rpc.method == "notifications/ping" {
        return HttpResponse::Ok().json(JsonRpcResponse::success(
            rpc.id,
            json!({}),
        ));
    }

    // All other methods require authentication
    let user_ctx = match extract_user_from_api_key(&req, &state.pool, &state.api_key_cache).await {
        Ok(ctx) => ctx,
        Err(msg) => {
            return HttpResponse::Unauthorized().json(json!({"error": msg}));
        }
    };

    // Check/create session from Mcp-Session-Id header
    let session_id = req
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| uuid::Uuid::parse_str(s).ok());

    match rpc.method.as_str() {
        "tools/list" => handle_tools_list(rpc.id, &state, &user_ctx).await,
        "tools/call" => handle_tools_call(rpc.id, rpc.params, &state, &user_ctx).await,
        "session/close" => {
            if let Some(sid) = session_id {
                state.sessions.remove(&sid);
            }
            HttpResponse::Ok().json(JsonRpcResponse::success(rpc.id, json!({})))
        }
        _ => HttpResponse::Ok().json(JsonRpcResponse::error(
            rpc.id,
            -32601,
            format!("method not found: {}", rpc.method),
        )),
    }
}

/// GET /mcp — SSE endpoint (placeholder for streaming)
pub async fn handle_mcp_get(
    req: HttpRequest,
    state: web::Data<AppState>,
) -> HttpResponse {
    // Verify auth
    let _user_ctx = match extract_user_from_api_key(&req, &state.pool, &state.api_key_cache).await {
        Ok(ctx) => ctx,
        Err(msg) => {
            return HttpResponse::Unauthorized().json(json!({"error": msg}));
        }
    };

    // SSE streaming is used for long-running operations.
    // For now, return 200 with keep-alive as a basic SSE endpoint.
    HttpResponse::Ok()
        .content_type("text/event-stream")
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("Connection", "keep-alive"))
        .body("event: endpoint\ndata: {\"status\": \"connected\"}\n\n")
}

/// DELETE /mcp — close session
pub async fn handle_mcp_delete(
    req: HttpRequest,
    state: web::Data<AppState>,
) -> HttpResponse {
    let _user_ctx = match extract_user_from_api_key(&req, &state.pool, &state.api_key_cache).await {
        Ok(ctx) => ctx,
        Err(msg) => {
            return HttpResponse::Unauthorized().json(json!({"error": msg}));
        }
    };

    let session_id = req
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| uuid::Uuid::parse_str(s).ok());

    if let Some(sid) = session_id {
        state.sessions.remove(&sid);
        HttpResponse::Ok().json(json!({"status": "session closed"}))
    } else {
        HttpResponse::BadRequest().json(json!({"error": "missing Mcp-Session-Id header"}))
    }
}

fn handle_initialize(id: Option<serde_json::Value>) -> HttpResponse {
    HttpResponse::Ok().json(JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": "2025-03-26",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "rag-mcp",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
    ))
}

async fn handle_tools_list(
    id: Option<serde_json::Value>,
    state: &web::Data<AppState>,
    ctx: &UserContext,
) -> HttpResponse {
    let tools = state.authorized_server.tool_list(ctx);
    let tools_json: Vec<serde_json::Value> = tools
        .into_iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.input_schema,
            })
        })
        .collect();
    HttpResponse::Ok().json(JsonRpcResponse::success(
        id,
        json!({"tools": tools_json}),
    ))
}

async fn handle_tools_call(
    id: Option<serde_json::Value>,
    params: Option<serde_json::Value>,
    state: &web::Data<AppState>,
    ctx: &UserContext,
) -> HttpResponse {
    let params = params.unwrap_or(json!({}));

    let tool_name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if tool_name.is_empty() {
        return HttpResponse::Ok().json(JsonRpcResponse::error(
            id,
            -32602,
            "missing tool name in params.name".into(),
        ));
    }

    // Reject ingest_directory over HTTP
    if tool_name == "ingest_directory" {
        return HttpResponse::Ok().json(JsonRpcResponse::error(
            id,
            -32000,
            "ingest_directory is not supported over HTTP".into(),
        ));
    }

    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or(json!({}));

    let result = state
        .authorized_server
        .call_tool(ctx, tool_name, arguments)
        .await;

    if result.is_error == Some(true) {
        let msg = result
            .content
            .first()
            .map(|c| c.text.clone())
            .unwrap_or_default();

        // Map PERMISSION_DENIED to a JSON-RPC error
        if msg.contains("PERMISSION_DENIED") {
            return HttpResponse::Ok().json(JsonRpcResponse::error(
                id,
                -32000,
                msg,
            ));
        }

        return HttpResponse::Ok().json(JsonRpcResponse::error(
            id,
            -32000,
            msg,
        ));
    }

    HttpResponse::Ok().json(JsonRpcResponse::success(
        id,
        serde_json::to_value(&result).unwrap_or(json!({})),
    ))
}
