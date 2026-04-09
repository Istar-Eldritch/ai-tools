use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::acl::context::UserContext;
use crate::auth::api_key::{self, ApiKeyCache};
use crate::db::queries::{self, glob_to_like};
use crate::pipelines::delete::DeletePipeline;
use crate::pipelines::ingest::IngestPipeline;
use crate::pipelines::search::{SearchFilter, SearchPipeline};

/// JSON-RPC error code for permission denied.
pub const ERR_PERMISSION_DENIED: i32 = -32000;
/// JSON-RPC error code for unsupported operations.
pub const ERR_UNSUPPORTED: i32 = -32001;

/// Wraps the core pipelines with ACL enforcement and admin tools.
#[derive(Clone)]
pub struct AuthorizedMcpServer {
    pool: PgPool,
    ingest: IngestPipeline,
    search: SearchPipeline,
    delete: DeletePipeline,
    api_key_cache: Arc<ApiKeyCache>,
}

/// Tool metadata for listing available tools.
#[derive(Debug, Clone, Serialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Result of a tool call.
#[derive(Debug, Serialize)]
pub struct ToolCallResult {
    pub content: Vec<ContentItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ContentItem {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

impl ToolCallResult {
    pub fn success(text: String) -> Self {
        Self {
            content: vec![ContentItem {
                content_type: "text".into(),
                text,
            }],
            is_error: None,
        }
    }

    pub fn error(text: String) -> Self {
        Self {
            content: vec![ContentItem {
                content_type: "text".into(),
                text,
            }],
            is_error: Some(true),
        }
    }
}

impl AuthorizedMcpServer {
    pub fn new(
        pool: PgPool,
        ingest: IngestPipeline,
        search: SearchPipeline,
        delete: DeletePipeline,
        api_key_cache: Arc<ApiKeyCache>,
    ) -> Self {
        Self {
            pool,
            ingest,
            search,
            delete,
            api_key_cache,
        }
    }

    /// List available tools, showing admin tools only if user is admin.
    pub fn tool_list(&self, ctx: &UserContext) -> Vec<ToolDef> {
        let mut tools = vec![
            ToolDef {
                name: "ingest".into(),
                description: "Ingest a document into the knowledge base.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "Full text content"},
                        "filename": {"type": "string", "description": "Human-readable filename"},
                        "content_type": {"type": "string", "description": "MIME content type"},
                        "metadata": {"type": "object", "description": "Arbitrary metadata"},
                        "project": {"type": "string", "description": "Project name"}
                    },
                    "required": ["content", "filename", "content_type"]
                }),
            },
            ToolDef {
                name: "search".into(),
                description: "Search the knowledge base with a natural language query.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Natural language query"},
                        "k": {"type": "integer", "description": "Number of results (1-100)"},
                        "filename_glob": {"type": "string", "description": "Glob pattern filter"},
                        "source_metadata": {"type": "object", "description": "JSONB containment filter"},
                        "project": {"type": "string", "description": "Project filter"}
                    },
                    "required": ["query"]
                }),
            },
            ToolDef {
                name: "delete_source".into(),
                description: "Delete a source document and all its chunks.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "string", "description": "UUID of source to delete"}
                    },
                    "required": ["source_id"]
                }),
            },
            ToolDef {
                name: "list_sources".into(),
                description: "List sources in the knowledge base.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "project": {"type": "string"},
                        "filename_glob": {"type": "string"},
                        "limit": {"type": "integer"},
                        "offset": {"type": "integer"}
                    }
                }),
            },
            ToolDef {
                name: "project_list".into(),
                description: "List projects accessible to you.".into(),
                input_schema: json!({"type": "object", "properties": {}}),
            },
            ToolDef {
                name: "api_key_rotate".into(),
                description: "Revoke all existing API keys and generate a new one.".into(),
                input_schema: json!({"type": "object", "properties": {}}),
            },
        ];

        if ctx.is_admin {
            tools.extend(vec![
                ToolDef {
                    name: "project_create".into(),
                    description: "Create a new project (admin only).".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "description": {"type": "string"}
                        },
                        "required": ["name"]
                    }),
                },
                ToolDef {
                    name: "access_grant".into(),
                    description: "Grant a user access to a project (admin only).".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "project": {"type": "string"},
                            "role": {"type": "string", "enum": ["reader", "writer", "admin"]}
                        },
                        "required": ["email", "project", "role"]
                    }),
                },
                ToolDef {
                    name: "access_revoke".into(),
                    description: "Revoke a user's access to a project (admin only).".into(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "project": {"type": "string"}
                        },
                        "required": ["email", "project"]
                    }),
                },
            ]);
        }

        tools
    }

    /// Dispatch a tool call, enforcing ACL.
    pub async fn call_tool(
        &self,
        ctx: &UserContext,
        name: &str,
        arguments: serde_json::Value,
    ) -> ToolCallResult {
        match name {
            "ingest" => self.tool_ingest(ctx, arguments).await,
            "search" => self.tool_search(ctx, arguments).await,
            "delete_source" => self.tool_delete_source(ctx, arguments).await,
            "list_sources" => self.tool_list_sources(ctx, arguments).await,
            "ingest_directory" => ToolCallResult::error(format!(
                "ERR_UNSUPPORTED: ingest_directory is not supported over HTTP (code {ERR_UNSUPPORTED})"
            )),
            "project_list" => self.tool_project_list(ctx).await,
            "api_key_rotate" => self.tool_api_key_rotate(ctx).await,
            "project_create" => self.tool_project_create(ctx, arguments).await,
            "access_grant" => self.tool_access_grant(ctx, arguments).await,
            "access_revoke" => self.tool_access_revoke(ctx, arguments).await,
            _ => ToolCallResult::error(format!("unknown tool: {name}")),
        }
    }

    // -- Core tool implementations with ACL --

    async fn tool_ingest(&self, ctx: &UserContext, args: serde_json::Value) -> ToolCallResult {
        #[derive(Deserialize)]
        struct Params {
            content: String,
            filename: String,
            content_type: String,
            metadata: Option<serde_json::Value>,
            project: Option<String>,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        // ACL check: non-admin users must have writer or admin role on the target project.
        if !ctx.is_admin {
            if let Some(ref project_name) = params.project {
                match queries::check_project_write_access(&self.pool, ctx.user_id, project_name)
                    .await
                {
                    Ok(true) => {}
                    Ok(false) => {
                        return ToolCallResult::error(
                            "PERMISSION_DENIED: writer or admin role required on this project"
                                .into(),
                        )
                    }
                    Err(e) => {
                        return ToolCallResult::error(format!("ACL check failed: {e}"))
                    }
                }
            }
            // If no project specified, ingesting into the global namespace is allowed for
            // any authenticated user (the source will be owned by them via owner_user_id).
        }

        let metadata = params
            .metadata
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));

        match self
            .ingest
            .ingest(
                &params.content,
                &params.filename,
                &params.content_type,
                metadata,
                params.project,
                Some(ctx.user_id),
            )
            .await
        {
            Ok(source) => match serde_json::to_string(&source) {
                Ok(json) => ToolCallResult::success(json),
                Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
            },
            Err(e) => ToolCallResult::error(format!("ingest failed: {e}")),
        }
    }

    async fn tool_search(&self, ctx: &UserContext, args: serde_json::Value) -> ToolCallResult {
        #[derive(Deserialize)]
        struct Params {
            query: String,
            k: Option<i64>,
            filename_glob: Option<String>,
            source_metadata: Option<serde_json::Value>,
            project: Option<String>,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        let k = params.k.unwrap_or(5);

        if ctx.is_admin {
            // Admins bypass ACL
            let filters = SearchFilter {
                filename_glob: params.filename_glob,
                source_metadata: params.source_metadata,
                project: params.project,
            };
            match self.search.search(&params.query, k, filters).await {
                Ok(results) => match serde_json::to_string(&results) {
                    Ok(json) => ToolCallResult::success(json),
                    Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
                },
                Err(e) => ToolCallResult::error(format!("search failed: {e}")),
            }
        } else {
            // Non-admins: use ACL-aware search
            match self
                .search
                .search_with_acl(&params.query, k, SearchFilter {
                    filename_glob: params.filename_glob,
                    source_metadata: params.source_metadata,
                    project: params.project,
                }, ctx.user_id)
                .await
            {
                Ok(results) => match serde_json::to_string(&results) {
                    Ok(json) => ToolCallResult::success(json),
                    Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
                },
                Err(e) => ToolCallResult::error(format!("search failed: {e}")),
            }
        }
    }

    async fn tool_delete_source(
        &self,
        ctx: &UserContext,
        args: serde_json::Value,
    ) -> ToolCallResult {
        #[derive(Deserialize)]
        struct Params {
            source_id: String,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        let uuid = match Uuid::parse_str(&params.source_id) {
            Ok(u) => u,
            Err(_) => {
                return ToolCallResult::error(format!(
                    "source_id is not a valid UUID: '{}'",
                    params.source_id
                ))
            }
        };

        // ACL check: admin can delete any, others only their own or accessible
        if !ctx.is_admin {
            match queries::check_source_access(&self.pool, uuid, ctx.user_id).await {
                Ok(true) => {}
                Ok(false) => return ToolCallResult::error("PERMISSION_DENIED".into()),
                Err(e) => return ToolCallResult::error(format!("ACL check failed: {e}")),
            }
        }

        match self.delete.delete(uuid).await {
            Ok(()) => ToolCallResult::success("source deleted".into()),
            Err(e) => ToolCallResult::error(format!("delete failed: {e}")),
        }
    }

    async fn tool_list_sources(
        &self,
        ctx: &UserContext,
        args: serde_json::Value,
    ) -> ToolCallResult {
        #[derive(Deserialize)]
        struct Params {
            project: Option<String>,
            filename_glob: Option<String>,
            limit: Option<i64>,
            offset: Option<i64>,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        let limit = params.limit.unwrap_or(100).min(500).max(1);
        let offset = params.offset.unwrap_or(0).max(0);
        let filename_like: Option<String> = params.filename_glob.as_deref().map(glob_to_like);

        let result = if ctx.is_admin {
            queries::list_sources(
                &self.pool,
                params.project.as_deref(),
                filename_like.as_deref(),
                limit,
                offset,
            )
            .await
        } else {
            queries::list_sources_with_acl(
                &self.pool,
                params.project.as_deref(),
                filename_like.as_deref(),
                limit,
                offset,
                ctx.user_id,
            )
            .await
        };

        match result {
            Ok(sources) => match serde_json::to_string(&sources) {
                Ok(json) => ToolCallResult::success(json),
                Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
            },
            Err(e) => ToolCallResult::error(format!("list failed: {e}")),
        }
    }

    // -- Admin tools --

    async fn tool_project_list(&self, ctx: &UserContext) -> ToolCallResult {
        let result = if ctx.is_admin {
            queries::list_projects(&self.pool).await
        } else {
            queries::list_projects_for_user(&self.pool, ctx.user_id).await
        };

        match result {
            Ok(projects) => match serde_json::to_string(&projects) {
                Ok(json) => ToolCallResult::success(json),
                Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
            },
            Err(e) => ToolCallResult::error(format!("project list failed: {e}")),
        }
    }

    async fn tool_api_key_rotate(&self, ctx: &UserContext) -> ToolCallResult {
        // Fetch active key hashes for this user so we can evict them from the cache.
        let old_hashes =
            match queries::get_active_api_key_hashes_for_user(&self.pool, ctx.user_id).await {
                Ok(h) => h,
                Err(e) => return ToolCallResult::error(format!("failed to fetch keys: {e}")),
            };

        // Revoke all existing keys in the database.
        if let Err(e) = queries::revoke_api_keys_for_user(&self.pool, ctx.user_id).await {
            return ToolCallResult::error(format!("failed to revoke keys: {e}"));
        }

        // Evict revoked keys from the LRU cache so they stop working immediately.
        for hash in &old_hashes {
            self.api_key_cache.remove(hash);
        }

        // Generate a new key
        let plaintext = api_key::generate_key();
        let hash = api_key::hash_key(&plaintext);

        match queries::insert_api_key(&self.pool, ctx.user_id, &hash, "rotated").await {
            Ok(_) => ToolCallResult::success(
                json!({"api_key": plaintext, "message": "All previous keys revoked. Store this key securely; it cannot be retrieved again."}).to_string(),
            ),
            Err(e) => ToolCallResult::error(format!("failed to create key: {e}")),
        }
    }

    async fn tool_project_create(
        &self,
        ctx: &UserContext,
        args: serde_json::Value,
    ) -> ToolCallResult {
        if !ctx.is_admin {
            return ToolCallResult::error("PERMISSION_DENIED: admin only".into());
        }

        #[derive(Deserialize)]
        struct Params {
            name: String,
            description: Option<String>,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        match queries::create_project(&self.pool, &params.name, params.description.as_deref())
            .await
        {
            Ok(project) => match serde_json::to_string(&project) {
                Ok(json) => ToolCallResult::success(json),
                Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
            },
            Err(e) => ToolCallResult::error(format!("project creation failed: {e}")),
        }
    }

    async fn tool_access_grant(
        &self,
        ctx: &UserContext,
        args: serde_json::Value,
    ) -> ToolCallResult {
        if !ctx.is_admin {
            return ToolCallResult::error("PERMISSION_DENIED: admin only".into());
        }

        #[derive(Deserialize)]
        struct Params {
            email: String,
            project: String,
            role: String,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        if !["reader", "writer", "admin"].contains(&params.role.as_str()) {
            return ToolCallResult::error(format!("invalid role: {}", params.role));
        }

        let user = match queries::get_user_by_email(&self.pool, &params.email).await {
            Ok(Some(u)) => u,
            Ok(None) => return ToolCallResult::error(format!("user not found: {}", params.email)),
            Err(e) => return ToolCallResult::error(format!("user lookup failed: {e}")),
        };

        let project = match queries::get_project_by_name(&self.pool, &params.project).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return ToolCallResult::error(format!("project not found: {}", params.project))
            }
            Err(e) => return ToolCallResult::error(format!("project lookup failed: {e}")),
        };

        match queries::grant_access(&self.pool, user.id, project.id, &params.role).await {
            Ok(access) => match serde_json::to_string(&access) {
                Ok(json) => ToolCallResult::success(json),
                Err(e) => ToolCallResult::error(format!("serialization error: {e}")),
            },
            Err(e) => ToolCallResult::error(format!("grant failed: {e}")),
        }
    }

    async fn tool_access_revoke(
        &self,
        ctx: &UserContext,
        args: serde_json::Value,
    ) -> ToolCallResult {
        if !ctx.is_admin {
            return ToolCallResult::error("PERMISSION_DENIED: admin only".into());
        }

        #[derive(Deserialize)]
        struct Params {
            email: String,
            project: String,
        }

        let params: Params = match serde_json::from_value(args) {
            Ok(p) => p,
            Err(e) => return ToolCallResult::error(format!("invalid params: {e}")),
        };

        let user = match queries::get_user_by_email(&self.pool, &params.email).await {
            Ok(Some(u)) => u,
            Ok(None) => return ToolCallResult::error(format!("user not found: {}", params.email)),
            Err(e) => return ToolCallResult::error(format!("user lookup failed: {e}")),
        };

        let project = match queries::get_project_by_name(&self.pool, &params.project).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return ToolCallResult::error(format!("project not found: {}", params.project))
            }
            Err(e) => return ToolCallResult::error(format!("project lookup failed: {e}")),
        };

        match queries::revoke_access(&self.pool, user.id, project.id).await {
            Ok(true) => ToolCallResult::success("access revoked".into()),
            Ok(false) => ToolCallResult::error("no access entry found to revoke".into()),
            Err(e) => ToolCallResult::error(format!("revoke failed: {e}")),
        }
    }
}
