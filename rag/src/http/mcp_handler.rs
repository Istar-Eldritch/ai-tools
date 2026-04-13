use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::acl::authorized_server::{ERR_PERMISSION_DENIED, ERR_UNSUPPORTED};
use crate::acl::context::UserContext;
use crate::db::queries;

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

    // notifications/ping doesn't require auth
    if rpc.method == "notifications/ping" {
        return HttpResponse::Ok().json(JsonRpcResponse::success(
            rpc.id,
            json!({}),
        ));
    }

    // All methods (including initialize) require authentication
    let user_ctx = match extract_user_from_api_key(&req, &state.pool, &state.api_key_cache).await {
        Ok(ctx) => ctx,
        Err(msg) => {
            return HttpResponse::Unauthorized().json(json!({"error": msg}));
        }
    };

    // On initialize, create a new session and return Mcp-Session-Id
    if rpc.method == "initialize" {
        let session_id = state.sessions.create(user_ctx);
        return HttpResponse::Ok()
            .insert_header(("Mcp-Session-Id", session_id.to_string()))
            .json(handle_initialize_payload(rpc.id));
    }

    // Parse Mcp-Session-Id from header for subsequent requests
    let session_id = req
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| uuid::Uuid::parse_str(s).ok());

    // Touch session to keep it alive
    if let Some(ref sid) = session_id {
        state.sessions.get(sid);
    }

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
///
/// TODO: Implement full SSE streaming for long-running MCP operations.
/// Currently returns a minimal "connected" event to satisfy MCP clients
/// that probe the SSE endpoint; real server-sent event streaming is not yet
/// implemented.
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

    // TODO: Implement real SSE streaming. This stub returns a single event so
    // clients can detect the endpoint is alive.
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

fn handle_initialize_payload(id: Option<serde_json::Value>) -> JsonRpcResponse {
    JsonRpcResponse::success(
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
    )
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
            ERR_UNSUPPORTED,
            "ingest_directory is not supported over HTTP".into(),
        ));
    }

    // Reject file_path on ingest over HTTP (stdio-only; use POST /upload instead)
    if tool_name == "ingest" {
        if let Some(args) = params.get("arguments") {
            if args.get("file_path").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty()) {
                return HttpResponse::Ok().json(JsonRpcResponse::error(
                    id,
                    ERR_UNSUPPORTED,
                    "file_path is not supported over HTTP; use POST /upload instead".into(),
                ));
            }
        }
    }

    // Resolve upload_token directly: bypass MCP dispatch to avoid
    // passing raw PDF bytes through the JSON arguments map.
    if tool_name == "ingest"
        && let Some(args) = params.get("arguments")
        && let Some(token_str) = args.get("upload_token").and_then(|v| v.as_str())
        && !token_str.is_empty()
    {
        let token = match uuid::Uuid::parse_str(token_str) {
            Ok(t) => t,
            Err(_) => {
                return HttpResponse::Ok().json(JsonRpcResponse::error(
                    id,
                    -32602,
                    "invalid upload_token: not a valid UUID".into(),
                ));
            }
        };

        let staged = match state.upload_store.take(&token) {
            Some(s) => s,
            None => {
                return HttpResponse::Ok().json(JsonRpcResponse::error(
                    id,
                    -32602,
                    "upload_token not found or expired".into(),
                ));
            }
        };

        // Extract remaining ingest params from arguments
        let filename = args
            .get("filename")
            .and_then(|v| v.as_str())
            .unwrap_or(&staged.filename)
            .to_string();
        let metadata = args
            .get("metadata")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let project = args
            .get("project")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // ACL check for project access (mirror authorized_server logic)
        if !ctx.is_admin
            && let Some(ref project_name) = project
        {
            match queries::check_project_write_access(
                &state.pool,
                ctx.user_id,
                project_name,
            )
            .await
            {
                Ok(true) => {}
                Ok(false) => {
                    return HttpResponse::Ok().json(JsonRpcResponse::error(
                        id,
                        ERR_PERMISSION_DENIED,
                        "PERMISSION_DENIED: writer or admin role required on this project".into(),
                    ));
                }
                Err(e) => {
                    return HttpResponse::Ok().json(JsonRpcResponse::error(
                        id,
                        -32603,
                        format!("ACL check failed: {e}"),
                    ));
                }
            }
        }

        // Call ingest_pdf directly on the pipeline
        let pipeline = state.authorized_server.ingest_pipeline();
        match pipeline
            .ingest_pdf(
                &staged.bytes,
                &filename,
                metadata,
                project,
                Some(ctx.user_id),
            )
            .await
        {
            Ok(source) => {
                let json = serde_json::to_value(&source).unwrap_or(serde_json::json!({}));
                let result = serde_json::json!({
                    "content": [{"type": "text", "text": json.to_string()}],
                });
                return HttpResponse::Ok().json(JsonRpcResponse::success(id, result));
            }
            Err(e) => {
                return HttpResponse::Ok().json(JsonRpcResponse::error(
                    id,
                    -32603,
                    format!("ingest failed: {e}"),
                ));
            }
        }
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

        let code = if msg.contains("PERMISSION_DENIED") {
            ERR_PERMISSION_DENIED
        } else if msg.contains("ERR_UNSUPPORTED") {
            ERR_UNSUPPORTED
        } else {
            -32603 // internal error
        };
        return HttpResponse::Ok().json(JsonRpcResponse::error(id, code, msg));
    }

    HttpResponse::Ok().json(JsonRpcResponse::success(
        id,
        serde_json::to_value(&result).unwrap_or(json!({})),
    ))
}
