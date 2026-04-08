use text_splitter::{ChunkConfig as TSChunkConfig, MarkdownSplitter, TextSplitter};
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeLanguage {
    Rust,
    Python,
    TypeScript,
    Java,
}

impl CodeLanguage {
    pub fn ts_language(&self) -> Language {
        match self {
            CodeLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
            CodeLanguage::Python => tree_sitter_python::LANGUAGE.into(),
            CodeLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            CodeLanguage::Java => tree_sitter_java::LANGUAGE.into(),
        }
    }
}

pub fn detect_language(filename: &str) -> Option<CodeLanguage> {
    // Find the last dot that is not at position 0 (hidden files like ".rs" have no real extension).
    let dot_pos = filename.rfind('.')?;
    if dot_pos == 0 {
        return None;
    }
    let ext = &filename[dot_pos + 1..];
    match ext {
        "rs" => Some(CodeLanguage::Rust),
        "py" => Some(CodeLanguage::Python),
        "ts" | "tsx" => Some(CodeLanguage::TypeScript),
        "java" => Some(CodeLanguage::Java),
        // ".js" is intentionally not mapped — JavaScript support is out of scope per spec.
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct CodeChunk {
    pub index: usize,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub node_type: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TextChunk {
    pub index: usize,
    pub content: String,
}

#[derive(Debug, Clone, Copy)]
pub struct ChunkConfig {
    pub chunk_size: usize,
    pub overlap: usize,
    pub min_chunk_size: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 50,
        }
    }
}

impl ChunkConfig {
    pub fn from_env() -> Self {
        let chunk_size = std::env::var("CHUNK_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2048);
        let overlap = std::env::var("CHUNK_OVERLAP")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(200);
        let min_chunk_size = std::env::var("MIN_CHUNK_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50);
        Self {
            chunk_size,
            overlap,
            min_chunk_size,
        }
    }

    fn to_ts_config(self) -> TSChunkConfig<text_splitter::Characters> {
        let config = TSChunkConfig::new(self.chunk_size);
        if self.overlap > 0 {
            config
                .with_overlap(self.overlap)
                .expect("overlap must be less than chunk_size")
        } else {
            config
        }
    }
}

pub fn chunk_text(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    if text.trim().is_empty() {
        return Vec::new();
    }

    let splitter = TextSplitter::new(config.to_ts_config());
    splitter
        .chunks(text)
        .enumerate()
        .map(|(index, content)| TextChunk {
            index,
            content: content.to_string(),
        })
        .collect()
}

pub fn chunk_markdown(text: &str, config: &ChunkConfig) -> Vec<TextChunk> {
    if text.trim().is_empty() {
        return Vec::new();
    }

    let splitter = MarkdownSplitter::new(config.to_ts_config());
    splitter
        .chunks(text)
        .enumerate()
        .map(|(index, content)| TextChunk {
            index,
            content: content.to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Phase 2 – Tree-sitter code-aware chunking helpers
// ---------------------------------------------------------------------------

fn is_preamble_node(kind: &str, language: CodeLanguage) -> bool {
    match language {
        // "mod_item" covers both `mod foo;` (external module declarations) and inline `mod foo { … }`
        // blocks. Inline modules are a rare edge case but are intentionally included so that a
        // top-level `mod tests { … }` at the very beginning of a file is treated as preamble rather
        // than being expanded as a container.
        CodeLanguage::Rust => matches!(kind, "use_declaration" | "mod_item" | "attribute_item"),
        CodeLanguage::Python => matches!(kind, "import_statement" | "import_from_statement"),
        CodeLanguage::TypeScript => matches!(kind, "import_statement"),
        CodeLanguage::Java => matches!(kind, "package_declaration" | "import_declaration"),
    }
}

fn is_extractable_node(kind: &str, language: CodeLanguage) -> bool {
    match language {
        CodeLanguage::Rust => matches!(
            kind,
            "function_item"
                | "struct_item"
                | "enum_item"
                | "trait_item"
                | "impl_item"
                // NOTE: tree-sitter-rust ≥0.24 emits "type_item" for `type Foo = …` declarations.
                // The spec calls this node "type_alias", which was the name used in older grammar
                // versions. Use "type_item" here to match the actual grammar at the pinned version.
                | "type_item"
                | "const_item"
                | "macro_definition"
        ),
        CodeLanguage::Python => matches!(
            kind,
            "function_definition" | "class_definition" | "decorated_definition"
        ),
        CodeLanguage::TypeScript => matches!(
            kind,
            "function_declaration"
                | "class_declaration"
                | "method_definition"
                | "interface_declaration"
                | "type_alias_declaration"
                | "export_statement"
        ),
        CodeLanguage::Java => matches!(
            kind,
            "method_declaration"
                | "class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "constructor_declaration"
        ),
    }
}

fn is_container_node(kind: &str, language: CodeLanguage) -> bool {
    match language {
        CodeLanguage::Rust => matches!(kind, "impl_item" | "trait_item"),
        CodeLanguage::Python => matches!(kind, "class_definition"),
        CodeLanguage::TypeScript => matches!(kind, "class_declaration"),
        CodeLanguage::Java => matches!(
            kind,
            "class_declaration" | "interface_declaration" | "enum_declaration"
        ),
    }
}

/// Extracts the opening signature of a container node (text up to and including `{` or `:`).
/// Falls back to first line.
fn container_signature(node: &Node, source: &str) -> String {
    let text = &source[node.byte_range()];
    // Try to find `{` or `:` as the end-of-signature marker.
    if let Some(pos) = text.find('{') {
        return text[..=pos].trim_end().to_string();
    }
    if let Some(pos) = text.find(':') {
        return text[..=pos].trim_end().to_string();
    }
    // Fallback: first line
    text.lines().next().unwrap_or("").to_string()
}

/// Returns the body child of a container node via `child_by_field_name("body")`.
fn container_body<'a>(node: &Node<'a>, _source: &str) -> Option<Node<'a>> {
    node.child_by_field_name("body")
}

/// Falls back to `chunk_text`, promoting each `TextChunk` to `CodeChunk`.
fn error_fallback(source: &str, config: &ChunkConfig) -> Vec<CodeChunk> {
    // R9 mandates zero overlap for all code splitting paths (oversized leaves, oversized preamble,
    // and this error-fallback path). Overlap is intentionally forced to 0 here rather than using
    // `config.overlap` directly, consistent with the same pattern applied elsewhere in this module.
    let no_overlap = ChunkConfig {
        chunk_size: config.chunk_size,
        overlap: 0,
        min_chunk_size: 0,
    };
    chunk_text(source, &no_overlap)
        .into_iter()
        .map(|tc| CodeChunk {
            index: tc.index,
            content: tc.content,
            start_line: 0,
            end_line: 0,
            node_type: "text".to_string(),
            context: None,
        })
        .collect()
}

/// Recursively process a single tree-sitter node into `CodeChunk`s.
fn process_node(
    node: &Node,
    source: &str,
    language: CodeLanguage,
    config: &ChunkConfig,
    context: Option<&str>,
    chunks: &mut Vec<CodeChunk>,
) {
    let kind = node.kind();
    let node_text = &source[node.byte_range()];
    let start_line = node.start_position().row + 1; // 1-based
    let end_line = node.end_position().row + 1;

    // R7 – Container with extractable children → expand
    if is_container_node(kind, language) {
        let sig = container_signature(node, source);

        // Check if container has any extractable children
        let body_opt = container_body(node, source);
        let has_extractable = if let Some(body) = body_opt {
            let mut cursor = body.walk();
            body.children(&mut cursor)
                .any(|child| is_extractable_node(child.kind(), language))
        } else {
            false
        };

        if has_extractable {
            let body = body_opt.unwrap();
            let mut cursor = body.walk();
            for child in body.children(&mut cursor) {
                if is_extractable_node(child.kind(), language) {
                    process_node(
                        &child,
                        source,
                        language,
                        config,
                        Some(&sig),
                        chunks,
                    );
                }
            }
            return;
        }
        // No extractable children → emit as single chunk (fall through)
    }

    // Build content with optional context prefix
    let content = match context {
        Some(ctx) => format!("{}\n{}", ctx, node_text),
        None => node_text.to_string(),
    };

    // R8 – Oversized leaf: split via chunk_text with overlap=0
    if content.len() > config.chunk_size {
        let no_overlap = ChunkConfig {
            chunk_size: config.chunk_size,
            overlap: 0,
            min_chunk_size: 0,
        };
        let sub_chunks = chunk_text(&content, &no_overlap);
        // When this node is a child of a container (i.e. `context` is Some), the container
        // signature is already embedded at the top of `content` (see the `format!` above).
        // `context` in the emitted chunks is therefore set to the node's own first source line
        // (the function/method signature) rather than propagating the incoming container context —
        // the container identity is not lost; it is present in the content field of each sub-chunk.
        let first_source_line = node_text.lines().next().unwrap_or("").to_string();
        for tc in sub_chunks {
            let idx = chunks.len();
            chunks.push(CodeChunk {
                index: idx,
                content: tc.content,
                start_line,
                end_line,
                node_type: kind.to_string(),
                context: Some(first_source_line.clone()),
            });
        }
        return;
    }

    // Normal-sized node → single chunk
    let idx = chunks.len();
    chunks.push(CodeChunk {
        index: idx,
        content,
        start_line,
        end_line,
        node_type: kind.to_string(),
        context: context.map(|s| s.to_string()),
    });
}

/// Parse and chunk source code using tree-sitter for structure-aware splitting.
pub fn chunk_code(source: &str, language: CodeLanguage, config: &ChunkConfig) -> Vec<CodeChunk> {
    // 1. Empty / whitespace → empty vec
    if source.trim().is_empty() {
        return Vec::new();
    }

    // 2. Parse with tree-sitter
    let mut parser = Parser::new();
    parser
        .set_language(&language.ts_language())
        .expect("failed to set tree-sitter language");
    let tree = parser.parse(source, None).expect("tree-sitter parse failed");
    let root = tree.root_node();

    // R10. If root has error nodes, fall back
    if root.has_error() {
        return error_fallback(source, config);
    }

    let mut chunks: Vec<CodeChunk> = Vec::new();

    // R5 – Collect contiguous preamble from top-level nodes
    let mut cursor = root.walk();
    let top_level: Vec<Node> = root.children(&mut cursor).collect();

    let mut preamble_end = 0;
    for node in &top_level {
        if is_preamble_node(node.kind(), language) {
            preamble_end += 1;
        } else {
            break;
        }
    }

    if preamble_end > 0 {
        // Gather preamble text (byte range from first preamble node start to last preamble node end)
        let preamble_start_byte = top_level[0].byte_range().start;
        let preamble_end_byte = top_level[preamble_end - 1].byte_range().end;
        let preamble_text = &source[preamble_start_byte..preamble_end_byte];
        let preamble_start_line = top_level[0].start_position().row + 1;
        let preamble_end_line = top_level[preamble_end - 1].end_position().row + 1;

        if preamble_text.len() <= config.chunk_size {
            chunks.push(CodeChunk {
                index: 0,
                content: preamble_text.to_string(),
                start_line: preamble_start_line,
                end_line: preamble_end_line,
                node_type: "preamble".to_string(),
                context: None,
            });
        } else {
            // Oversized preamble → split via chunk_text with overlap=0
            let no_overlap = ChunkConfig {
                chunk_size: config.chunk_size,
                overlap: 0,
                min_chunk_size: 0,
            };
            for tc in chunk_text(preamble_text, &no_overlap) {
                let idx = chunks.len();
                chunks.push(CodeChunk {
                    index: idx,
                    content: tc.content,
                    start_line: preamble_start_line,
                    end_line: preamble_end_line,
                    node_type: "preamble".to_string(),
                    context: None,
                });
            }
        }
    }

    // R6/R7/R8 – Process remaining top-level nodes
    for node in &top_level[preamble_end..] {
        process_node(node, source, language, config, None, &mut chunks);
    }

    // Fix up indices to be contiguous
    for (i, chunk) in chunks.iter_mut().enumerate() {
        chunk.index = i;
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_empty_input() {
        let config = ChunkConfig::default();
        assert!(chunk_text("", &config).is_empty());
    }

    #[test]
    fn chunk_text_whitespace_input() {
        let config = ChunkConfig::default();
        assert!(chunk_text("   \n\t  ", &config).is_empty());
    }

    #[test]
    fn chunk_text_short_input() {
        let config = ChunkConfig::default();
        let chunks = chunk_text("Hello, world!", &config);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].index, 0);
        assert_eq!(chunks[0].content, "Hello, world!");
    }

    #[test]
    fn chunk_text_long_input() {
        let config = ChunkConfig {
            chunk_size: 100,
            overlap: 10,
            min_chunk_size: 0,
        };
        let text = "a ".repeat(5000); // 10000 chars
        let chunks = chunk_text(&text, &config);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.content.len() <= config.chunk_size);
        }
        // Indices are contiguous from 0
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.index, i);
        }
    }

    #[test]
    fn chunk_markdown_empty_input() {
        let config = ChunkConfig::default();
        assert!(chunk_markdown("", &config).is_empty());
    }

    #[test]
    fn chunk_markdown_heading_boundary() {
        let config = ChunkConfig {
            chunk_size: 500,
            overlap: 0,
            min_chunk_size: 0,
        };
        let md = "# Section 1\n\nShort paragraph.\n\n# Section 2\n\nAnother paragraph.";
        let chunks = chunk_markdown(md, &config);
        // Both sections fit in one chunk each
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].index, 0);
    }

    /// Combined env test to avoid parallel test race conditions.
    /// Tests both valid and invalid env var parsing.
    #[test]
    fn chunk_config_from_env() {
        // Test valid env vars
        unsafe {
            std::env::set_var("CHUNK_SIZE", "512");
            std::env::set_var("CHUNK_OVERLAP", "50");
            std::env::set_var("MIN_CHUNK_SIZE", "25");
        }
        let config = ChunkConfig::from_env();
        assert_eq!(config.chunk_size, 512);
        assert_eq!(config.overlap, 50);
        assert_eq!(config.min_chunk_size, 25);

        // Test invalid env var falls back to default
        unsafe {
            std::env::set_var("CHUNK_SIZE", "notanumber");
            std::env::set_var("MIN_CHUNK_SIZE", "notanumber");
        }
        let config = ChunkConfig::from_env();
        assert_eq!(config.chunk_size, 2048); // falls back to default
        assert_eq!(config.min_chunk_size, 50); // falls back to default

        // Cleanup
        unsafe {
            std::env::remove_var("CHUNK_SIZE");
            std::env::remove_var("CHUNK_OVERLAP");
            std::env::remove_var("MIN_CHUNK_SIZE");
        }
    }

    #[test]
    fn detect_language_rust() {
        assert_eq!(detect_language("main.rs"), Some(CodeLanguage::Rust));
    }

    #[test]
    fn detect_language_python() {
        assert_eq!(detect_language("script.py"), Some(CodeLanguage::Python));
    }

    #[test]
    fn detect_language_typescript() {
        assert_eq!(detect_language("app.ts"), Some(CodeLanguage::TypeScript));
    }

    #[test]
    fn detect_language_tsx() {
        assert_eq!(detect_language("component.tsx"), Some(CodeLanguage::TypeScript));
    }

    #[test]
    fn detect_language_java() {
        assert_eq!(detect_language("Main.java"), Some(CodeLanguage::Java));
    }

    #[test]
    fn detect_language_unknown_extension() {
        assert_eq!(detect_language("style.css"), None);
    }

    #[test]
    fn detect_language_no_extension() {
        assert_eq!(detect_language("Makefile"), None);
    }

    #[test]
    fn detect_language_nested_extensions() {
        assert_eq!(detect_language("foo.test.ts"), Some(CodeLanguage::TypeScript));
    }

    #[test]
    fn detect_language_hidden_file() {
        assert_eq!(detect_language(".gitignore"), None);
    }

    #[test]
    fn detect_language_dot_only_extension() {
        // ".rs" is a hidden file with no real extension — must return None.
        assert_eq!(detect_language(".rs"), None);
    }

    // --- ts_language() smoke tests ---
    // Each variant must produce a valid tree-sitter Language (node_kind_count > 0).

    #[test]
    fn ts_language_rust_is_valid() {
        let lang = CodeLanguage::Rust.ts_language();
        assert!(lang.node_kind_count() > 0);
    }

    #[test]
    fn ts_language_python_is_valid() {
        let lang = CodeLanguage::Python.ts_language();
        assert!(lang.node_kind_count() > 0);
    }

    #[test]
    fn ts_language_typescript_is_valid() {
        let lang = CodeLanguage::TypeScript.ts_language();
        assert!(lang.node_kind_count() > 0);
    }

    #[test]
    fn ts_language_java_is_valid() {
        let lang = CodeLanguage::Java.ts_language();
        assert!(lang.node_kind_count() > 0);
    }

    // --- chunk_code tests ---

    #[test]
    fn chunk_code_rust_preamble() {
        let source = r#"use std::io;
use std::collections::HashMap;

fn main() {
    println!("hello");
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].node_type, "preamble");
        assert!(chunks[0].content.contains("use std::io"));
        assert!(chunks[0].content.contains("use std::collections::HashMap"));
    }

    #[test]
    fn chunk_code_rust_function_extraction() {
        let source = r#"fn foo() -> i32 {
    42
}

fn bar() -> String {
    "hello".to_string()
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "function_item");
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 3);
        assert_eq!(chunks[1].node_type, "function_item");
        assert_eq!(chunks[1].start_line, 5);
        assert_eq!(chunks[1].end_line, 7);
    }

    #[test]
    fn chunk_code_rust_impl_container_expansion() {
        let source = r#"struct Foo;

impl Foo {
    fn method_a(&self) -> i32 {
        1
    }

    fn method_b(&self) -> i32 {
        2
    }
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        // struct chunk + 2 method chunks
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].node_type, "struct_item");
        assert_eq!(chunks[1].node_type, "function_item");
        assert!(chunks[1].context.is_some());
        assert!(chunks[1].context.as_ref().unwrap().contains("impl Foo {"));
        assert_eq!(chunks[2].node_type, "function_item");
        assert!(chunks[2].context.is_some());
    }

    #[test]
    fn chunk_code_rust_impl_no_extractable_children() {
        let source = r#"impl Foo {
    // just a comment
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].node_type, "impl_item");
        assert!(chunks[0].context.is_none());
    }

    #[test]
    fn chunk_code_python_preamble() {
        let source = "import os\nfrom sys import argv\n\ndef main():\n    pass\n";
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Python, &config);
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].node_type, "preamble");
        assert!(chunks[0].content.contains("import os"));
        assert!(chunks[0].content.contains("from sys import argv"));
    }

    #[test]
    fn chunk_code_python_class_expansion() {
        let source = r#"class MyClass:
    def method_a(self):
        pass

    def method_b(self):
        pass
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Python, &config);
        // class is a container → 2 method chunks
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "function_definition");
        assert!(chunks[0].context.as_ref().unwrap().contains("class MyClass:"));
        assert_eq!(chunks[1].node_type, "function_definition");
        assert!(chunks[1].context.as_ref().unwrap().contains("class MyClass:"));
    }

    #[test]
    fn chunk_code_oversized_leaf_fallback() {
        // Create a function whose body is larger than chunk_size
        let body_lines: String = (0..100)
            .map(|i| format!("    let x{} = {};", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let source = format!("fn big_function() {{\n{}\n}}", body_lines);
        let config = ChunkConfig {
            chunk_size: 200,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(&source, CodeLanguage::Rust, &config);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert_eq!(chunk.node_type, "function_item");
            assert!(chunk.context.is_some());
            assert!(chunk.context.as_ref().unwrap().contains("fn big_function()"));
        }
    }

    #[test]
    fn chunk_code_error_node_fallback() {
        // Deliberately invalid Rust syntax
        let source = "fn broken( { {{ }}}}} let x = ;;\n\nsome text here";
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert_eq!(chunk.node_type, "text");
            assert!(chunk.context.is_none());
        }
    }

    #[test]
    fn chunk_code_empty_file() {
        let config = ChunkConfig::default();
        assert!(chunk_code("", CodeLanguage::Rust, &config).is_empty());
        assert!(chunk_code("   \n\t  ", CodeLanguage::Rust, &config).is_empty());
    }

    #[test]
    fn chunk_code_preamble_only() {
        let source = "use std::io;\nuse std::fmt;\n";
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 200,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Rust, &config);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].node_type, "preamble");
    }

    #[test]
    fn chunk_code_oversized_preamble() {
        // Create a preamble larger than chunk_size
        let imports: String = (0..100)
            .map(|i| format!("use crate::module_{}::SomeVeryLongTypeName{};", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let source = format!("{}\n\nfn main() {{}}", imports);
        let config = ChunkConfig {
            chunk_size: 200,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(&source, CodeLanguage::Rust, &config);
        // There should be multiple preamble chunks plus at least one function chunk
        let preamble_chunks: Vec<_> =
            chunks.iter().filter(|c| c.node_type == "preamble").collect();
        assert!(preamble_chunks.len() > 1);
        // Also has a function chunk
        assert!(chunks.iter().any(|c| c.node_type == "function_item"));
    }

    // --- TypeScript chunk_code tests ---

    #[test]
    fn chunk_code_ts_import_preamble() {
        let source = r#"import { foo } from "foo";
import { bar } from "bar";

function greet() {
    console.log("hello");
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::TypeScript, &config);
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].node_type, "preamble");
        assert!(chunks[0].content.contains("import { foo }"));
        assert!(chunks[0].content.contains("import { bar }"));
    }

    #[test]
    fn chunk_code_ts_function_extraction() {
        let source = r#"function add(a: number, b: number): number {
    return a + b;
}

function subtract(a: number, b: number): number {
    return a - b;
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::TypeScript, &config);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "function_declaration");
        assert!(chunks[0].content.contains("function add"));
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 3);
        assert_eq!(chunks[1].node_type, "function_declaration");
        assert!(chunks[1].content.contains("function subtract"));
        assert_eq!(chunks[1].start_line, 5);
        assert_eq!(chunks[1].end_line, 7);
    }

    #[test]
    fn chunk_code_ts_class_expansion() {
        let source = r#"class Calculator {
    add(a: number, b: number): number {
        return a + b;
    }

    multiply(a: number, b: number): number {
        return a * b;
    }
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::TypeScript, &config);
        // class is a container → 2 method chunks
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "method_definition");
        assert!(chunks[0].context.is_some());
        assert!(chunks[0].context.as_ref().unwrap().contains("class Calculator {"));
        assert!(chunks[0].content.contains("add(a: number"));
        assert_eq!(chunks[1].node_type, "method_definition");
        assert!(chunks[1].context.is_some());
        assert!(chunks[1].context.as_ref().unwrap().contains("class Calculator {"));
        assert!(chunks[1].content.contains("multiply(a: number"));
    }

    #[test]
    fn chunk_code_ts_interface_extraction() {
        let source = r#"interface User {
    name: string;
    age: number;
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::TypeScript, &config);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].node_type, "interface_declaration");
        assert!(chunks[0].content.contains("interface User"));
        assert!(chunks[0].content.contains("name: string"));
        assert!(chunks[0].content.contains("age: number"));
    }

    #[test]
    fn chunk_code_ts_export_statement() {
        let source = r#"export function greet(name: string): string {
    return `Hello, ${name}`;
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::TypeScript, &config);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].node_type, "export_statement");
        assert!(chunks[0].content.contains("export function greet"));
    }

    // --- Java chunk_code tests ---

    #[test]
    fn chunk_code_java_package_import_preamble() {
        let source = r#"package com.example.app;

import java.util.List;
import java.util.Map;

public class App {
    public static void main(String[] args) {
        System.out.println("hello");
    }
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Java, &config);
        assert!(!chunks.is_empty());
        assert_eq!(chunks[0].node_type, "preamble");
        assert!(chunks[0].content.contains("package com.example.app"));
        assert!(chunks[0].content.contains("import java.util.List"));
        assert!(chunks[0].content.contains("import java.util.Map"));
    }

    #[test]
    fn chunk_code_java_class_with_methods() {
        let source = r#"public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int multiply(int a, int b) {
        return a * b;
    }
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Java, &config);
        // class is a container → 2 method chunks
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "method_declaration");
        assert!(chunks[0].context.is_some());
        assert!(chunks[0].context.as_ref().unwrap().contains("public class Calculator {"));
        assert!(chunks[0].content.contains("public int add"));
        assert_eq!(chunks[1].node_type, "method_declaration");
        assert!(chunks[1].context.is_some());
        assert!(chunks[1].context.as_ref().unwrap().contains("public class Calculator {"));
        assert!(chunks[1].content.contains("public int multiply"));
    }

    #[test]
    fn chunk_code_java_interface_extraction() {
        let source = r#"public interface Repository {
    void save(Object entity);

    Object findById(int id);
}
"#;
        let config = ChunkConfig {
            chunk_size: 2048,
            overlap: 0,
            min_chunk_size: 0,
        };
        let chunks = chunk_code(source, CodeLanguage::Java, &config);
        // interface is a container in Java → expands into method_declaration chunks.
        // Verified: tree-sitter-java emits "method_declaration" (not "abstract_method_declaration"
        // or similar) for abstract interface methods, so the assertions below are correct as-is.
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].node_type, "method_declaration");
        assert!(chunks[0].context.is_some());
        assert!(chunks[0].context.as_ref().unwrap().contains("public interface Repository {"));
        assert!(chunks[0].content.contains("void save"));
        assert_eq!(chunks[1].node_type, "method_declaration");
        assert!(chunks[1].context.is_some());
        assert!(chunks[1].content.contains("Object findById"));
    }

}
