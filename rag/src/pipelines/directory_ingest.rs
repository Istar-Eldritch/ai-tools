use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use bytes::Bytes;
use futures::stream::{self, StreamExt};
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::chunking::{chunk_code, chunk_markdown, chunk_text, detect_language, ChunkConfig};
use crate::db::models::Source;
use crate::db::queries;
use crate::error::{AppError, AppResult};
use crate::pipelines::delete::DeletePipeline;
use crate::pipelines::ingest::IngestPipeline;

const CONCURRENCY_LIMIT: usize = 1;
const MAX_ERRORS: usize = 50;

#[derive(Clone)]
pub struct DirectoryIngestPipeline {
    ingest: IngestPipeline,
    delete: DeletePipeline,
    pool: PgPool,
}

#[derive(Debug, Default, Serialize)]
pub struct IngestDirectorySummary {
    pub ingested: u64,
    pub renamed: u64,
    pub deleted_orphans: u64,
    pub skipped_unchanged: u64,
    pub skipped_binary: u64,
    pub skipped_empty: u64,
    pub failed: u64,
    pub errors: Vec<String>,
    pub total_files_matched: u64,
}

/// Callback for reporting progress: `(current, total, message)`.
pub type ProgressCallback = Arc<dyn Fn(f64, Option<f64>, &str) + Send + Sync>;

struct PreparedFile {
    relative_path: String,
    content: String,
    content_type: String,
    content_hash: String,
}

enum FileAction {
    New(PreparedFile, serde_json::Value),
    Update {
        file: PreparedFile,
        metadata: serde_json::Value,
        old_source: Source,
    },
    Rename {
        file: PreparedFile,
        metadata: serde_json::Value,
        orphan_source: Source,
    },
    RenameModify {
        file: PreparedFile,
        metadata: serde_json::Value,
        orphan_source: Source,
    },
}

enum ActionResult {
    Ingested,
    Renamed,
}

fn hash_chunk_content(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn chunk_and_hash(
    content: &str,
    filename: &str,
    content_type: &str,
    chunk_config: &ChunkConfig,
) -> HashSet<String> {
    if let Some(lang) = detect_language(filename) {
        chunk_code(content, lang, chunk_config)
            .into_iter()
            .map(|c| hash_chunk_content(&c.content))
            .collect()
    } else {
        let text_chunks = if content_type.to_lowercase().contains("markdown") {
            chunk_markdown(content, chunk_config)
        } else {
            chunk_text(content, chunk_config)
        };
        text_chunks
            .into_iter()
            .map(|c| hash_chunk_content(&c.content))
            .collect()
    }
}

impl DirectoryIngestPipeline {
    pub fn new(ingest: IngestPipeline, delete: DeletePipeline, pool: PgPool) -> Self {
        Self {
            ingest,
            delete,
            pool,
        }
    }

    pub async fn ingest_directory(
        &self,
        path: &str,
        include: &[String],
        exclude: &[String],
        metadata: serde_json::Value,
        project: Option<String>,
        on_progress: Option<&ProgressCallback>,
        ct: &CancellationToken,
    ) -> AppResult<IngestDirectorySummary> {
        let root = Path::new(path);
        if !root.is_dir() {
            return Err(AppError::Validation(format!(
                "path is not an existing directory: {path}"
            )));
        }
        if include.is_empty() {
            return Err(AppError::Validation(
                "include must contain at least one glob pattern".into(),
            ));
        }
        if !metadata.is_object() {
            return Err(AppError::Validation(
                "metadata must be a JSON object".into(),
            ));
        }

        let include_set = compile_glob_set(include)?;
        let exclude_set = compile_glob_set(exclude)?;

        let mut summary = IngestDirectorySummary::default();

        // Walk directory and filter by patterns
        let mut walk_errors: Vec<String> = Vec::new();
        let eligible_paths: Vec<std::path::PathBuf> = WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|entry| match entry {
                Ok(e) => {
                    if !e.file_type().is_file() {
                        return None;
                    }
                    let abs_path = e.path().to_path_buf();
                    let rel_path = abs_path.strip_prefix(root).ok()?;
                    let rel_str = rel_path.to_str()?;
                    if include_set.is_match(rel_str) && !exclude_set.is_match(rel_str) {
                        Some(abs_path)
                    } else {
                        None
                    }
                }
                Err(e) => {
                    walk_errors.push(e.to_string());
                    None
                }
            })
            .collect();

        for msg in walk_errors {
            summary.failed += 1;
            push_error(&mut summary.errors, msg);
        }

        // Read files, detect binary, compute hashes
        let mut prepared: Vec<PreparedFile> = Vec::new();
        for abs_path in &eligible_paths {
            let rel_path = abs_path.strip_prefix(root).unwrap();
            let rel_str = rel_path.to_str().expect("validated as UTF-8 in walk step").to_string();

            let raw_bytes = match std::fs::read(abs_path) {
                Ok(b) => b,
                Err(e) => {
                    summary.failed += 1;
                    push_error(&mut summary.errors, format!("{rel_str}: {e}"));
                    continue;
                }
            };

            if is_binary(&raw_bytes) {
                summary.skipped_binary += 1;
                continue;
            }

            let content = match String::from_utf8(raw_bytes) {
                Ok(s) => s,
                Err(e) => {
                    summary.failed += 1;
                    push_error(
                        &mut summary.errors,
                        format!("{rel_str}: invalid UTF-8: {e}"),
                    );
                    continue;
                }
            };

            if content.trim().is_empty() {
                summary.skipped_empty += 1;
                continue;
            }

            let content_type = infer_content_type(&rel_str).to_string();
            let hash = content_hash(&content);

            prepared.push(PreparedFile {
                relative_path: rel_str,
                content,
                content_type,
                content_hash: hash,
            });
        }

        if prepared.is_empty() {
            return Ok(summary);
        }

        // Batch dedup lookup
        let filenames: Vec<&str> = prepared.iter().map(|f| f.relative_path.as_str()).collect();
        let existing_sources = queries::get_sources_by_filenames(&self.pool, &filenames, project.as_deref()).await?;

        let mut source_map: HashMap<&str, &Source> = HashMap::new();
        for source in &existing_sources {
            let entry = source_map.entry(source.filename.as_str());
            entry
                .and_modify(|existing| {
                    if source.created_at > existing.created_at {
                        *existing = source;
                    }
                })
                .or_insert(source);
        }

        // Partition into skip / update / new
        let mut actions: Vec<FileAction> = Vec::new();

        for file in prepared {
            let file_metadata = build_file_metadata(&metadata, path, &file.content_hash);

            if let Some(existing) = source_map.get(file.relative_path.as_str()) {
                let existing_hash = existing
                    .metadata
                    .get("content_hash")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if existing_hash == file.content_hash {
                    summary.skipped_unchanged += 1;
                    continue;
                }
                actions.push(FileAction::Update {
                    old_source: (*existing).clone(),
                    metadata: file_metadata,
                    file,
                });
            } else {
                actions.push(FileAction::New(file, file_metadata));
            }
        }

        // -- Orphan detection --
        let all_dir_sources =
            queries::get_sources_by_directory(&self.pool, path, project.as_deref()).await?;

        let accounted_filenames: HashSet<&str> = source_map
            .keys()
            .copied()
            .chain(
                actions.iter().filter_map(|a| match a {
                    FileAction::Update { file, .. } => Some(file.relative_path.as_str()),
                    _ => None,
                }),
            )
            .collect();

        let mut orphans: Vec<Source> = all_dir_sources
            .into_iter()
            .filter(|s| !accounted_filenames.contains(s.filename.as_str()))
            .collect();

        // -- Rename detection --
        let chunk_config = *self.ingest.chunk_config();
        let mut new_action_indices: Vec<usize> = Vec::new();
        for (i, action) in actions.iter().enumerate() {
            if matches!(action, FileAction::New(..)) {
                new_action_indices.push(i);
            }
        }

        // Pre-compute chunk hashes for orphans
        let mut orphan_hashes: HashMap<uuid::Uuid, HashSet<String>> = HashMap::new();
        for orphan in &orphans {
            let chunks = queries::get_chunks_by_source(&self.pool, orphan.id).await?;
            let hashes: HashSet<String> = chunks
                .iter()
                .map(|c| hash_chunk_content(&c.content))
                .collect();
            orphan_hashes.insert(orphan.id, hashes);
        }

        // For each New action, find the best orphan match
        let mut matched_orphan_ids: HashSet<uuid::Uuid> = HashSet::new();
        let mut rename_conversions: Vec<(usize, uuid::Uuid, f64)> = Vec::new();

        for &idx in &new_action_indices {
            let (file, meta) = match &actions[idx] {
                FileAction::New(f, m) => (f, m),
                _ => unreachable!(),
            };
            let _ = meta; // used later during conversion

            let new_hashes =
                chunk_and_hash(&file.content, &file.relative_path, &file.content_type, &chunk_config);

            let mut best_match: Option<(uuid::Uuid, f64)> = None;
            for orphan in &orphans {
                if matched_orphan_ids.contains(&orphan.id) {
                    continue;
                }
                let o_hashes = match orphan_hashes.get(&orphan.id) {
                    Some(h) => h,
                    None => continue,
                };
                if o_hashes.is_empty() {
                    continue;
                }
                let intersection = o_hashes.intersection(&new_hashes).count();
                let overlap = intersection as f64 / o_hashes.len() as f64;
                if overlap >= 0.5 {
                    if best_match.map_or(true, |(_, best_o)| overlap > best_o) {
                        best_match = Some((orphan.id, overlap));
                    }
                }
            }

            if let Some((orphan_id, overlap)) = best_match {
                matched_orphan_ids.insert(orphan_id);
                rename_conversions.push((idx, orphan_id, overlap));
            }
        }

        // Apply rename conversions (replace New actions with Rename/RenameModify)
        // Build a lookup of orphan id -> Source
        let orphan_by_id: HashMap<uuid::Uuid, &Source> =
            orphans.iter().map(|s| (s.id, s)).collect();

        // Process in reverse index order so indices remain valid
        let mut sorted_conversions = rename_conversions;
        sorted_conversions.sort_by(|a, b| b.0.cmp(&a.0));
        for (idx, orphan_id, overlap) in sorted_conversions {
            let orphan_source = orphan_by_id[&orphan_id].clone();
            // Take out the New action and replace
            let old_action = std::mem::replace(
                &mut actions[idx],
                // placeholder – will be replaced immediately below
                FileAction::New(
                    PreparedFile {
                        relative_path: String::new(),
                        content: String::new(),
                        content_type: String::new(),
                        content_hash: String::new(),
                    },
                    serde_json::Value::Null,
                ),
            );
            let (file, meta) = match old_action {
                FileAction::New(f, m) => (f, m),
                _ => unreachable!(),
            };
            if overlap >= 1.0 {
                actions[idx] = FileAction::Rename {
                    file,
                    metadata: meta,
                    orphan_source,
                };
            } else {
                actions[idx] = FileAction::RenameModify {
                    file,
                    metadata: meta,
                    orphan_source,
                };
            }
        }

        // Remaining orphans to delete (not matched by rename)
        let orphans_to_delete: Vec<Source> = orphans
            .drain(..)
            .filter(|s| !matched_orphan_ids.contains(&s.id))
            .collect();

        // Bounded-concurrency ingestion with progress reporting
        let total_actions = actions.len() as f64;
        let mut completed = 0u64;
        let project_clone = project.clone();
        let pool = self.pool.clone();
        let storage = self.ingest.storage().clone();
        let mut result_stream = stream::iter(actions)
            .map(move |action| {
                let ingest = self.ingest.clone();
                let project = project_clone.clone();
                let pool = pool.clone();
                let storage = storage.clone();
                async move {
                    match action {
                        FileAction::New(file, meta) => ingest
                            .ingest(
                                &file.content,
                                &file.relative_path,
                                &file.content_type,
                                meta,
                                project,
                            )
                            .await
                            .map(|_| ActionResult::Ingested)
                            .map_err(|e| (file.relative_path, e.to_string())),
                        FileAction::Update {
                            file,
                            metadata: meta,
                            old_source,
                        } => ingest
                            .update_in_place(
                                &old_source,
                                &file.content,
                                &file.content_type,
                                meta,
                                project,
                            )
                            .await
                            .map(|_| ActionResult::Ingested)
                            .map_err(|e| (file.relative_path, e.to_string())),
                        FileAction::Rename {
                            file,
                            metadata: meta,
                            orphan_source,
                        } => {
                            // Update filename/metadata in DB
                            let rename_res = queries::rename_source(
                                &pool,
                                orphan_source.id,
                                &file.relative_path,
                                &meta,
                                &file.content_type,
                            )
                            .await;
                            if let Err(e) = rename_res {
                                return Err((file.relative_path, e.to_string()));
                            }
                            // PUT new content to S3 under orphan's existing key
                            let data = Bytes::from(file.content.into_bytes());
                            if let Err(e) =
                                storage.put_object(&orphan_source.s3_key, data, &file.content_type).await
                            {
                                return Err((file.relative_path, e.to_string()));
                            }
                            Ok(ActionResult::Renamed)
                        }
                        FileAction::RenameModify {
                            file,
                            metadata: meta,
                            orphan_source,
                        } => {
                            // Rename the source first
                            if let Err(e) = queries::rename_source(
                                &pool,
                                orphan_source.id,
                                &file.relative_path,
                                &meta,
                                &file.content_type,
                            )
                            .await
                            {
                                return Err((file.relative_path, e.to_string()));
                            }
                            // Then update content in place (re-chunk + re-embed changed chunks)
                            let mut renamed_source = orphan_source;
                            renamed_source.filename = file.relative_path.clone();
                            ingest
                                .update_in_place(
                                    &renamed_source,
                                    &file.content,
                                    &file.content_type,
                                    meta,
                                    project,
                                )
                                .await
                                .map(|_| ActionResult::Renamed)
                                .map_err(|e| (file.relative_path, e.to_string()))
                        }
                    }
                }
            })
            .buffer_unordered(CONCURRENCY_LIMIT);

        let mut cancelled = false;
        loop {
            tokio::select! {
                biased;
                _ = ct.cancelled() => {
                    tracing::info!(
                        completed,
                        total = total_actions as u64,
                        "directory ingest cancelled by client"
                    );
                    cancelled = true;
                    break;
                }
                item = result_stream.next() => {
                    match item {
                        None => break,
                        Some(result) => {
                            completed += 1;
                            match result {
                                Ok(ActionResult::Ingested) => summary.ingested += 1,
                                Ok(ActionResult::Renamed) => summary.renamed += 1,
                                Err((filename, err_msg)) => {
                                    summary.failed += 1;
                                    push_error(&mut summary.errors, format!("{filename}: {err_msg}"));
                                }
                            }
                            if let Some(cb) = &on_progress {
                                let total = total_actions as u64;
                                cb(
                                    completed as f64,
                                    Some(total_actions),
                                    &format!("Processed {completed}/{total} files"),
                                );
                            }
                        }
                    }
                }
            }
        }

        // Delete remaining orphans (files removed from directory)
        if !cancelled {
            for orphan in orphans_to_delete {
                match self.delete.delete(orphan.id).await {
                    Ok(()) => summary.deleted_orphans += 1,
                    Err(e) => {
                        summary.failed += 1;
                        push_error(
                            &mut summary.errors,
                            format!("{}: orphan delete failed: {e}", orphan.filename),
                        );
                    }
                }
            }
        }

        // total_files_matched is the union of all outcomes
        summary.total_files_matched = summary.ingested
            + summary.renamed
            + summary.skipped_unchanged
            + summary.skipped_binary
            + summary.skipped_empty
            + summary.failed;

        // Add overflow sentinel if errors were truncated
        let total_errors = summary.failed as usize;
        if total_errors > MAX_ERRORS {
            summary.errors.push(format!(
                "... and {} more",
                total_errors - MAX_ERRORS
            ));
        }

        Ok(summary)
    }
}

fn infer_content_type(filename: &str) -> &'static str {
    match Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("rs") => "text/x-rust",
        Some("py") => "text/x-python",
        Some("ts" | "tsx") => "text/typescript",
        Some("java") => "text/x-java",
        Some("js" | "jsx") => "text/javascript",
        Some("md") => "text/markdown",
        Some("html" | "htm") => "text/html",
        Some("yaml" | "yml") => "text/yaml",
        Some("toml") => "text/toml",
        Some("json") => "application/json",
        Some("sql") => "text/sql",
        Some("sh") => "text/x-shellscript",
        _ => "text/plain",
    }
}

fn is_binary(content: &[u8]) -> bool {
    let check_len = content.len().min(8192);
    content[..check_len].contains(&0)
}

fn content_hash(content: &str) -> String {
    let hash = Sha256::digest(content.as_bytes());
    format!("sha256:{hash:x}")
}

fn build_file_metadata(
    user_metadata: &serde_json::Value,
    directory: &str,
    hash: &str,
) -> serde_json::Value {
    let mut meta = user_metadata.clone();
    let obj = meta.as_object_mut().unwrap();
    obj.insert(
        "directory".into(),
        serde_json::Value::String(directory.into()),
    );
    obj.insert(
        "content_hash".into(),
        serde_json::Value::String(hash.into()),
    );
    meta
}

fn compile_glob_set(patterns: &[String]) -> AppResult<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = Glob::new(pattern).map_err(|e| {
            AppError::Validation(format!("invalid glob pattern '{pattern}': {e}"))
        })?;
        builder.add(glob);
    }
    builder
        .build()
        .map_err(|e| AppError::Validation(format!("failed to compile glob set: {e}")))
}

fn push_error(errors: &mut Vec<String>, msg: String) {
    if errors.len() < MAX_ERRORS {
        errors.push(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_content_type_rust() {
        assert_eq!(infer_content_type("main.rs"), "text/x-rust");
    }

    #[test]
    fn infer_content_type_python() {
        assert_eq!(infer_content_type("script.py"), "text/x-python");
    }

    #[test]
    fn infer_content_type_typescript() {
        assert_eq!(infer_content_type("app.ts"), "text/typescript");
        assert_eq!(infer_content_type("component.tsx"), "text/typescript");
    }

    #[test]
    fn infer_content_type_java() {
        assert_eq!(infer_content_type("Main.java"), "text/x-java");
    }

    #[test]
    fn infer_content_type_javascript() {
        assert_eq!(infer_content_type("app.js"), "text/javascript");
        assert_eq!(infer_content_type("component.jsx"), "text/javascript");
    }

    #[test]
    fn infer_content_type_markdown() {
        assert_eq!(infer_content_type("readme.md"), "text/markdown");
    }

    #[test]
    fn infer_content_type_html() {
        assert_eq!(infer_content_type("index.html"), "text/html");
        assert_eq!(infer_content_type("page.htm"), "text/html");
    }

    #[test]
    fn infer_content_type_yaml() {
        assert_eq!(infer_content_type("config.yaml"), "text/yaml");
        assert_eq!(infer_content_type("config.yml"), "text/yaml");
    }

    #[test]
    fn infer_content_type_toml() {
        assert_eq!(infer_content_type("Cargo.toml"), "text/toml");
    }

    #[test]
    fn infer_content_type_json() {
        assert_eq!(infer_content_type("data.json"), "application/json");
    }

    #[test]
    fn infer_content_type_sql() {
        assert_eq!(infer_content_type("schema.sql"), "text/sql");
    }

    #[test]
    fn infer_content_type_shell() {
        assert_eq!(infer_content_type("build.sh"), "text/x-shellscript");
    }

    #[test]
    fn infer_content_type_unknown() {
        assert_eq!(infer_content_type("data.csv"), "text/plain");
        assert_eq!(infer_content_type("Makefile"), "text/plain");
    }

    #[test]
    fn is_binary_with_nul() {
        assert!(is_binary(b"hello\x00world"));
    }

    #[test]
    fn is_binary_text_only() {
        assert!(!is_binary(b"hello world"));
    }

    #[test]
    fn is_binary_empty() {
        assert!(!is_binary(b""));
    }

    #[test]
    fn content_hash_deterministic() {
        let h1 = content_hash("hello");
        let h2 = content_hash("hello");
        assert_eq!(h1, h2);
        assert!(h1.starts_with("sha256:"));
    }

    #[test]
    fn content_hash_different_for_different_content() {
        assert_ne!(content_hash("hello"), content_hash("world"));
    }

    #[test]
    fn build_file_metadata_injects_fields() {
        let user = serde_json::json!({"project": "test"});
        let meta = build_file_metadata(&user, "/some/dir", "sha256:abc123");
        assert_eq!(meta["project"], "test");
        assert_eq!(meta["directory"], "/some/dir");
        assert_eq!(meta["content_hash"], "sha256:abc123");
    }

    #[test]
    fn compile_glob_set_valid() {
        let set = compile_glob_set(&["**/*.rs".into(), "**/*.md".into()]).unwrap();
        assert!(set.is_match("src/main.rs"));
        assert!(set.is_match("docs/readme.md"));
        assert!(!set.is_match("data.json"));
    }

    #[test]
    fn compile_glob_set_invalid_pattern() {
        assert!(compile_glob_set(&["[invalid".into()]).is_err());
    }

    #[test]
    fn push_error_respects_limit() {
        let mut errors = Vec::new();
        for i in 0..60 {
            push_error(&mut errors, format!("error {i}"));
        }
        assert_eq!(errors.len(), MAX_ERRORS);
    }

    #[test]
    fn build_file_metadata_overwrites_reserved_keys() {
        let user = serde_json::json!({"directory": "old", "content_hash": "old"});
        let meta = build_file_metadata(&user, "/new/dir", "sha256:new");
        assert_eq!(meta["directory"], "/new/dir");
        assert_eq!(meta["content_hash"], "sha256:new");
    }
}
