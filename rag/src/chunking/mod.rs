use text_splitter::{ChunkConfig as TSChunkConfig, MarkdownSplitter, TextSplitter};
use tree_sitter::Language;

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
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            chunk_size: 2048,
            overlap: 200,
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
        Self { chunk_size, overlap }
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
        }
        let config = ChunkConfig::from_env();
        assert_eq!(config.chunk_size, 512);
        assert_eq!(config.overlap, 50);

        // Test invalid env var falls back to default
        unsafe {
            std::env::set_var("CHUNK_SIZE", "notanumber");
        }
        let config = ChunkConfig::from_env();
        assert_eq!(config.chunk_size, 2048); // falls back to default

        // Cleanup
        unsafe {
            std::env::remove_var("CHUNK_SIZE");
            std::env::remove_var("CHUNK_OVERLAP");
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
}
