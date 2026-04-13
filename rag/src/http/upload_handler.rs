use actix_multipart::Multipart;
use actix_web::{web, HttpRequest, HttpResponse};
use bytes::BytesMut;
use futures::StreamExt;
use serde_json::json;
use std::time::Instant;

use super::middleware::extract_user_from_api_key;
use super::upload::StagedUpload;
use super::AppState;

/// POST /upload — stage a file for later ingestion via upload_token.
///
/// Accepts multipart/form-data with a field named "file".
/// Returns `{"upload_token": "<uuid>", "expires_in": 300}`.
pub async fn handle_upload(
    req: HttpRequest,
    state: web::Data<AppState>,
    mut payload: Multipart,
) -> HttpResponse {
    // 1. Authenticate (same as POST /mcp)
    let _user_ctx = match extract_user_from_api_key(
        &req,
        &state.pool,
        &state.api_key_cache,
    )
    .await
    {
        Ok(ctx) => ctx,
        Err(msg) => {
            return HttpResponse::Unauthorized().json(json!({"error": msg}));
        }
    };

    // 2. Parse multipart — find the "file" field
    let mut file_bytes = BytesMut::new();
    let mut filename = String::from("upload.pdf");
    let mut content_type = String::from("application/pdf");
    let mut found_file = false;

    let max_bytes = state.max_upload_bytes;

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return HttpResponse::BadRequest()
                    .json(json!({"error": format!("multipart error: {e}")}));
            }
        };

        // We only process the "file" field
        let field_name = field.name().map(|s| s.to_string()).unwrap_or_default();
        if field_name != "file" {
            continue;
        }

        found_file = true;

        // Extract filename from Content-Disposition if available
        if let Some(cd) = field.content_disposition()
            && let Some(name) = cd.get_filename()
        {
            filename = name.to_string();
        }

        // Extract content type if available
        if let Some(ct) = field.content_type() {
            content_type = ct.to_string();
        }

        // 3. Stream bytes with running size enforcement
        while let Some(chunk) = field.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    return HttpResponse::BadRequest()
                        .json(json!({"error": format!("read error: {e}")}));
                }
            };

            if (file_bytes.len() + chunk.len()) as u64 > max_bytes {
                return HttpResponse::PayloadTooLarge().json(json!({
                    "error": format!(
                        "file exceeds maximum upload size ({} bytes)",
                        max_bytes
                    )
                }));
            }

            file_bytes.extend_from_slice(&chunk);
        }

        // Only process the first "file" field
        break;
    }

    if !found_file || file_bytes.is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"error": "missing or empty 'file' field in multipart body"}));
    }

    // 4. Stage in UploadStore
    let staged = StagedUpload {
        bytes: file_bytes.freeze(),
        filename,
        content_type,
        created_at: Instant::now(),
    };

    let token = state.upload_store.insert(staged);
    let expires_in = 300u64;

    HttpResponse::Ok().json(json!({
        "upload_token": token.to_string(),
        "expires_in": expires_in
    }))
}
