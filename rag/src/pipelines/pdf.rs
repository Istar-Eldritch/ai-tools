use std::path::Path;
use std::sync::Arc;

use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

use crate::chunking::TextChunk;
use crate::error::{AppError, AppResult};

/// Bounding rectangle in PDF points (1 pt = 1/72 inch).
/// Origin is at the bottom-left corner of the page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PdfBbox {
    pub top: f32,
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
}

impl PdfBbox {
    /// Merge two bounding boxes, taking the min/max of each edge to produce
    /// the smallest rectangle containing both.
    pub fn merge(&self, other: &PdfBbox) -> PdfBbox {
        PdfBbox {
            top: self.top.max(other.top),
            left: self.left.min(other.left),
            bottom: self.bottom.min(other.bottom),
            right: self.right.max(other.right),
        }
    }
}

/// A contiguous run of text from a single page, with positional metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct PageTextSpan {
    /// 1-based page index.
    pub page_number: u32,
    /// Text content of this span (one per page after normalisation).
    pub text: String,
    /// Bounding rectangle computed from the min/max bounds of all characters in this span.
    /// `None` when no character bounding boxes could be obtained from pdfium (the spec
    /// requires storing `null` in metadata rather than failing or fabricating a zero bbox).
    pub bbox: Option<PdfBbox>,
    /// Byte offset of `text` within the joined document string (set by join_spans).
    pub byte_offset: usize,
}

/// PDF text extractor backed by pdfium-render.
///
/// All methods are synchronous — callers MUST use `tokio::task::spawn_blocking`.
#[derive(Debug)]
pub struct PdfExtractor {
    pdfium: Arc<Pdfium>,
}

impl PdfExtractor {
    /// Load pdfium dynamic library from the given path.
    ///
    /// # Errors
    /// Returns `AppError::PdfExtraction` if the library cannot be loaded.
    pub fn new(pdfium_lib_path: &Path) -> AppResult<Self> {
        let path_str = pdfium_lib_path
            .to_str()
            .ok_or_else(|| AppError::PdfExtraction("invalid library path".into()))?;
        let bindings = Pdfium::bind_to_library(path_str).map_err(|e| {
            AppError::PdfExtraction(format!(
                "failed to load pdfium library from {}: {e}",
                pdfium_lib_path.display()
            ))
        })?;
        let pdfium = Pdfium::new(bindings);
        Ok(Self {
            pdfium: Arc::new(pdfium),
        })
    }

    /// Extract text with positional metadata from a PDF byte buffer.
    ///
    /// Returns a Vec of `PageTextSpan` ordered by page, and the joined document
    /// string (spans concatenated with `"\n\n"` separators).
    ///
    /// Runs synchronously — callers MUST use `spawn_blocking`.
    ///
    /// # Errors
    /// - `AppError::PdfExtraction` if the PDF cannot be opened (e.g. encrypted).
    /// - `AppError::PdfExtraction` if no text could be extracted from any page.
    pub fn extract(&self, pdf_bytes: &[u8]) -> AppResult<(Vec<PageTextSpan>, String)> {
        let document = self
            .pdfium
            .load_pdf_from_byte_slice(pdf_bytes, None)
            .map_err(|e| {
                let msg = e.to_string().to_lowercase();
                if msg.contains("password") || msg.contains("encrypt") {
                    AppError::PdfExtraction(
                        "PDF is encrypted and cannot be ingested".into(),
                    )
                } else {
                    AppError::PdfExtraction(format!("failed to open PDF: {e}"))
                }
            })?;

        let mut spans: Vec<PageTextSpan> = Vec::new();

        for (page_index, page) in document.pages().iter().enumerate() {
            let page_number = (page_index as u32) + 1;

            match extract_page_span(&page, page_number) {
                Ok(Some(span)) => spans.push(span),
                Ok(None) => {
                    // Page had no extractable text — skip silently
                }
                Err(e) => {
                    tracing::warn!(
                        page_number,
                        error = %e,
                        "failed to extract text from page; skipping"
                    );
                }
            }
        }

        if spans.is_empty() {
            return Err(AppError::PdfExtraction(
                "No text could be extracted from PDF".into(),
            ));
        }

        // Join spans with \n\n, recording byte offsets
        let joined = join_spans(&mut spans);

        Ok((spans, joined))
    }
}

/// Extract a single `PageTextSpan` from a page, or `None` if the page has no text.
fn extract_page_span(page: &PdfPage, page_number: u32) -> AppResult<Option<PageTextSpan>> {
    let text_page = page.text().map_err(|e| {
        AppError::PdfExtraction(format!("page {page_number}: {e}"))
    })?;

    let mut raw_text = String::new();
    let mut bbox: Option<PdfBbox> = None;

    for segment in text_page.segments().iter() {
        let chars = match segment.chars() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(
                    page_number,
                    error = %e,
                    "failed to iterate chars in segment; skipping"
                );
                continue;
            }
        };
        for char_item in chars.iter() {
            let ch = match char_item.unicode_char() {
                Some(c) => c,
                None => continue,
            };
            if ch == '\0' {
                continue;
            }
            raw_text.push(ch);

            // Accumulate bounding box from character bounds
            if let Ok(char_rect) = char_item.loose_bounds() {
                let char_bbox = PdfBbox {
                    top: char_rect.top().value,
                    left: char_rect.left().value,
                    bottom: char_rect.bottom().value,
                    right: char_rect.right().value,
                };
                bbox = Some(match bbox {
                    Some(existing) => existing.merge(&char_bbox),
                    None => char_bbox,
                });
            }
        }
    }

    if raw_text.trim().is_empty() {
        return Ok(None);
    }

    // Normalise: strip control characters (keep \n, \t), collapse 3+ newlines to \n\n
    let normalised: String = raw_text
        .chars()
        .filter(|&c| !c.is_control() || c == '\n' || c == '\t')
        .collect();
    let normalised = collapse_newlines(&normalised);

    // `bbox` remains `None` if no character rects were available; the spec requires
    // storing `null` in this case rather than fabricating a zero-filled rectangle.
    Ok(Some(PageTextSpan {
        page_number,
        text: normalised,
        bbox, // Option<PdfBbox>: Some(rect) or None
        byte_offset: 0, // set later by join_spans
    }))
}

/// Collapse runs of 3 or more consecutive newlines into exactly `\n\n`.
fn collapse_newlines(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut newline_count = 0u32;
    for ch in text.chars() {
        if ch == '\n' {
            newline_count += 1;
            if newline_count <= 2 {
                result.push(ch);
            }
        } else {
            newline_count = 0;
            result.push(ch);
        }
    }
    result
}

/// Join spans with `\n\n` separators, recording each span's `byte_offset`
/// in the joined string. Mutates spans in-place to set `byte_offset`.
fn join_spans(spans: &mut [PageTextSpan]) -> String {
    let total_len: usize = spans.iter().map(|s| s.text.len()).sum::<usize>()
        + spans.len().saturating_sub(1) * 2; // "\n\n" separators
    let mut joined = String::with_capacity(total_len);

    for (i, span) in spans.iter_mut().enumerate() {
        if i > 0 {
            joined.push_str("\n\n");
        }
        span.byte_offset = joined.len();
        joined.push_str(&span.text);
    }

    joined
}

/// Given a list of text chunks and the original `PageTextSpan`s, resolve each
/// chunk's page number and bounding box.
///
/// The `joined` string is the concatenated document text that was fed to the chunker.
/// Each chunk's `content` is a substring of `joined`.
///
/// Returns one `serde_json::Value` per chunk, suitable for the `metadata JSONB` column.
/// When a span's `bbox` is `None` (no character rects were available), the `"bbox"` field
/// in the returned JSON is `null`.
pub fn map_chunks_to_pdf_metadata(
    chunks: &[TextChunk],
    spans: &[PageTextSpan],
    joined: &str,
) -> Vec<serde_json::Value> {
    // Guard: `PdfExtractor::extract` always returns a non-empty spans vec (it errors on
    // empty), but this function is `pub`, so a defensive early-return prevents an index
    // panic if called directly with an empty slice.
    if spans.is_empty() {
        return chunks
            .iter()
            .map(|_| serde_json::json!({"page_number": null, "bbox": null}))
            .collect();
    }

    chunks
        .iter()
        .map(|chunk| {
            // Find the byte offset of this chunk within the joined string.
            // TextChunk doesn't carry byte offsets, so we locate via find().
            let chunk_start = match joined.find(&chunk.content) {
                Some(pos) => pos,
                None => {
                    tracing::warn!(
                        chunk_index = chunk.index,
                        "chunk content not found in joined document string; attributing to page 1"
                    );
                    0
                }
            };

            // Binary search: find the last span whose byte_offset <= chunk_start
            let span_idx = spans
                .partition_point(|s| s.byte_offset <= chunk_start)
                .saturating_sub(1);

            let span = &spans[span_idx];

            let bbox_value = match &span.bbox {
                Some(b) => serde_json::json!({
                    "top": b.top,
                    "left": b.left,
                    "bottom": b.bottom,
                    "right": b.right,
                }),
                None => serde_json::Value::Null,
            };

            serde_json::json!({
                "page_number": span.page_number,
                "bbox": bbox_value,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- collapse_newlines tests ----

    #[test]
    fn collapse_newlines_no_change() {
        assert_eq!(collapse_newlines("hello\nworld"), "hello\nworld");
    }

    #[test]
    fn collapse_newlines_double_preserved() {
        assert_eq!(collapse_newlines("hello\n\nworld"), "hello\n\nworld");
    }

    #[test]
    fn collapse_newlines_triple_collapsed() {
        assert_eq!(collapse_newlines("hello\n\n\nworld"), "hello\n\nworld");
    }

    #[test]
    fn collapse_newlines_many_collapsed() {
        assert_eq!(
            collapse_newlines("hello\n\n\n\n\n\nworld"),
            "hello\n\nworld"
        );
    }

    #[test]
    fn collapse_newlines_multiple_groups() {
        assert_eq!(
            collapse_newlines("a\n\n\n\nb\n\n\nc"),
            "a\n\nb\n\nc"
        );
    }

    #[test]
    fn collapse_newlines_empty() {
        assert_eq!(collapse_newlines(""), "");
    }

    // ---- join_spans tests ----

    #[test]
    fn join_spans_single() {
        let mut spans = vec![PageTextSpan {
            page_number: 1,
            text: "Hello".into(),
            bbox: Some(PdfBbox { top: 10.0, left: 0.0, bottom: 0.0, right: 50.0 }),
            byte_offset: 0,
        }];
        let joined = join_spans(&mut spans);
        assert_eq!(joined, "Hello");
        assert_eq!(spans[0].byte_offset, 0);
    }

    #[test]
    fn join_spans_multiple() {
        let mut spans = vec![
            PageTextSpan {
                page_number: 1,
                text: "Page one".into(),
                bbox: Some(PdfBbox { top: 10.0, left: 0.0, bottom: 0.0, right: 50.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 2,
                text: "Page two".into(),
                bbox: Some(PdfBbox { top: 10.0, left: 0.0, bottom: 0.0, right: 50.0 }),
                byte_offset: 0,
            },
        ];
        let joined = join_spans(&mut spans);
        assert_eq!(joined, "Page one\n\nPage two");
        assert_eq!(spans[0].byte_offset, 0);
        assert_eq!(spans[1].byte_offset, 10); // "Page one" (8) + "\n\n" (2) = 10
    }

    #[test]
    fn join_spans_three_pages() {
        let mut spans = vec![
            PageTextSpan {
                page_number: 1,
                text: "A".into(),
                bbox: Some(PdfBbox { top: 1.0, left: 0.0, bottom: 0.0, right: 1.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 2,
                text: "BB".into(),
                bbox: Some(PdfBbox { top: 1.0, left: 0.0, bottom: 0.0, right: 1.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 3,
                text: "CCC".into(),
                bbox: Some(PdfBbox { top: 1.0, left: 0.0, bottom: 0.0, right: 1.0 }),
                byte_offset: 0,
            },
        ];
        let joined = join_spans(&mut spans);
        assert_eq!(joined, "A\n\nBB\n\nCCC");
        assert_eq!(spans[0].byte_offset, 0);
        assert_eq!(spans[1].byte_offset, 3);  // "A" (1) + "\n\n" (2)
        assert_eq!(spans[2].byte_offset, 7);  // 3 + "BB" (2) + "\n\n" (2)
    }

    // ---- PdfBbox::merge tests ----

    #[test]
    fn bbox_merge_takes_extremes() {
        let a = PdfBbox { top: 10.0, left: 5.0, bottom: 2.0, right: 20.0 };
        let b = PdfBbox { top: 15.0, left: 3.0, bottom: 1.0, right: 18.0 };
        let merged = a.merge(&b);
        assert_eq!(merged.top, 15.0);   // max
        assert_eq!(merged.left, 3.0);   // min
        assert_eq!(merged.bottom, 1.0); // min
        assert_eq!(merged.right, 20.0); // max
    }

    #[test]
    fn bbox_merge_identity_when_same() {
        let a = PdfBbox { top: 10.0, left: 5.0, bottom: 2.0, right: 20.0 };
        let merged = a.merge(&a);
        assert_eq!(merged, a);
    }

    // ---- map_chunks_to_pdf_metadata tests ----

    #[test]
    fn map_single_chunk_single_span() {
        let spans = vec![PageTextSpan {
            page_number: 1,
            text: "Hello world".into(),
            bbox: Some(PdfBbox { top: 742.5, left: 72.0, bottom: 580.1, right: 523.0 }),
            byte_offset: 0,
        }];
        let chunks = vec![TextChunk {
            index: 0,
            content: "Hello world".into(),
        }];
        let joined = "Hello world";
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, joined);
        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0]["page_number"], 1);
        assert!((metadata[0]["bbox"]["top"].as_f64().unwrap() - 742.5).abs() < 0.01);
        assert!((metadata[0]["bbox"]["left"].as_f64().unwrap() - 72.0).abs() < 0.01);
    }

    #[test]
    fn map_chunk_null_bbox_when_no_chars() {
        // Spec error-handling table: "Bbox computation yields no characters ->
        // Store `null` for `bbox` in metadata rather than failing."
        let spans = vec![PageTextSpan {
            page_number: 1,
            text: "Hello world".into(),
            bbox: None, // no character rects were available
            byte_offset: 0,
        }];
        let chunks = vec![TextChunk {
            index: 0,
            content: "Hello world".into(),
        }];
        let joined = "Hello world";
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, joined);
        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0]["page_number"], 1);
        assert!(
            metadata[0]["bbox"].is_null(),
            "expected bbox to be JSON null when span.bbox is None, got: {}",
            metadata[0]["bbox"]
        );
    }

    #[test]
    fn map_chunk_attributed_to_correct_page() {
        let mut spans = vec![
            PageTextSpan {
                page_number: 1,
                text: "First page text here".into(),
                bbox: Some(PdfBbox { top: 800.0, left: 72.0, bottom: 700.0, right: 500.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 2,
                text: "Second page text here".into(),
                bbox: Some(PdfBbox { top: 800.0, left: 72.0, bottom: 700.0, right: 500.0 }),
                byte_offset: 0,
            },
        ];
        let joined = join_spans(&mut spans);

        // Chunk from page 2
        let chunks = vec![TextChunk {
            index: 0,
            content: "Second page text here".into(),
        }];
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, &joined);
        assert_eq!(metadata[0]["page_number"], 2);
    }

    #[test]
    fn map_multiple_chunks_across_pages() {
        let mut spans = vec![
            PageTextSpan {
                page_number: 1,
                text: "Page 1 content".into(),
                bbox: Some(PdfBbox { top: 800.0, left: 72.0, bottom: 700.0, right: 500.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 2,
                text: "Page 2 content".into(),
                bbox: Some(PdfBbox { top: 790.0, left: 72.0, bottom: 690.0, right: 510.0 }),
                byte_offset: 0,
            },
        ];
        let joined = join_spans(&mut spans);

        let chunks = vec![
            TextChunk { index: 0, content: "Page 1 content".into() },
            TextChunk { index: 1, content: "Page 2 content".into() },
        ];
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, &joined);
        assert_eq!(metadata[0]["page_number"], 1);
        assert_eq!(metadata[1]["page_number"], 2);
    }

    #[test]
    fn map_chunk_spanning_page_boundary() {
        // A TextChunk whose content straddles the page boundary must be attributed
        // to the *starting* page (page 1), because `chunk_start` falls within
        // span[0]'s byte range.
        //
        //   joined = "Hello from page one\n\nGreetings from page two"
        //             ^byte 0 (span 0)       ^byte 21 (span 1)
        //
        // The cross-page chunk "page one\n\nGreetings" starts at byte 11, which
        // is inside span 0's range → page_number must be 1.
        let mut spans = vec![
            PageTextSpan {
                page_number: 1,
                text: "Hello from page one".into(),
                bbox: Some(PdfBbox { top: 800.0, left: 72.0, bottom: 700.0, right: 500.0 }),
                byte_offset: 0,
            },
            PageTextSpan {
                page_number: 2,
                text: "Greetings from page two".into(),
                bbox: Some(PdfBbox { top: 790.0, left: 72.0, bottom: 690.0, right: 510.0 }),
                byte_offset: 0,
            },
        ];
        let joined = join_spans(&mut spans);
        // Sanity-check: span 1's byte_offset should be len("Hello from page one") + 2 = 21
        assert_eq!(spans[1].byte_offset, 21);

        // Chunk content spans the "\n\n" separator and begins inside page 1's range.
        let cross_page_content = "page one\n\nGreetings";
        assert!(joined.contains(cross_page_content), "test precondition: chunk must be a substring of joined");

        let chunks = vec![TextChunk { index: 0, content: cross_page_content.into() }];
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, &joined);
        // Starting page is page 1 — the chunk's leading byte falls in span 0.
        assert_eq!(metadata[0]["page_number"], 1);
        // bbox should come from span 0 (page 1's bbox), not null.
        assert!(!metadata[0]["bbox"].is_null());
    }

    // ---- map_chunks_to_pdf_metadata: empty spans guard ----

    #[test]
    fn map_chunks_empty_spans_returns_nulls() {
        // Defensive guard: calling with an empty spans slice must not panic.
        let spans: Vec<PageTextSpan> = vec![];
        let chunks = vec![
            TextChunk { index: 0, content: "some text".into() },
            TextChunk { index: 1, content: "more text".into() },
        ];
        let metadata = map_chunks_to_pdf_metadata(&chunks, &spans, "some text\n\nmore text");
        assert_eq!(metadata.len(), 2);
        assert!(metadata[0]["page_number"].is_null());
        assert!(metadata[0]["bbox"].is_null());
        assert!(metadata[1]["page_number"].is_null());
        assert!(metadata[1]["bbox"].is_null());
    }

    // ---- PdfExtractor tests (require PDFium library + fixture PDFs) ----
    //
    // Run with:
    //   PDFIUM_LIB_PATH=/path/to/libpdfium.so \
    //   cargo test --lib pipelines::pdf -- --include-ignored
    //
    // Fixture PDFs live in tests/fixtures/ and are generated by
    // tests/fixtures/generate.py (requires fpdf2).

    /// Helper: build a `PdfExtractor` from `PDFIUM_LIB_PATH` env var.
    #[cfg(test)]
    fn extractor_from_env() -> PdfExtractor {
        let lib_path = std::env::var("PDFIUM_LIB_PATH")
            .unwrap_or_else(|_| "/usr/local/lib/libpdfium.so".into());
        PdfExtractor::new(Path::new(&lib_path))
            .expect("failed to load PDFium library — set PDFIUM_LIB_PATH")
    }

    #[test]
    fn extractor_new_with_nonexistent_path() {
        let result = PdfExtractor::new(Path::new("/nonexistent/libpdfium.so"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("failed to load pdfium library"));
    }

    #[test]
    #[ignore] // Requires PDFium library at PDFIUM_LIB_PATH
    fn extractor_rejects_invalid_pdf_bytes() {
        let extractor = extractor_from_env();
        let result = extractor.extract(b"not a real pdf");
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("failed to open PDF"),
            "expected 'failed to open PDF' in error"
        );
    }

    #[test]
    #[ignore] // Requires PDFium library at PDFIUM_LIB_PATH + tests/fixtures/simple.pdf
    fn extractor_single_page_pdf() {
        let extractor = extractor_from_env();
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/simple.pdf"
        ))
        .expect("tests/fixtures/simple.pdf not found — run tests/fixtures/generate.py first");

        let (spans, joined) = extractor.extract(&bytes).expect("extraction failed");

        assert!(!spans.is_empty(), "expected at least one span");
        assert_eq!(spans[0].page_number, 1);
        assert!(
            joined.contains("Hello"),
            "expected 'Hello' in extracted text, got: {joined:?}"
        );
    }

    #[test]
    #[ignore] // Requires PDFium library at PDFIUM_LIB_PATH + tests/fixtures/multi_page.pdf
    fn extractor_multi_page_pdf() {
        let extractor = extractor_from_env();
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/multi_page.pdf"
        ))
        .expect("tests/fixtures/multi_page.pdf not found — run tests/fixtures/generate.py first");

        let (spans, joined) = extractor.extract(&bytes).expect("extraction failed");

        assert!(spans.len() >= 2, "expected spans from at least 2 pages");
        assert_eq!(spans[0].page_number, 1);
        assert_eq!(spans[1].page_number, 2);
        assert!(
            joined.contains("Page one"),
            "expected 'Page one' in extracted text"
        );
        assert!(
            joined.contains("Page two"),
            "expected 'Page two' in extracted text"
        );
    }

    #[test]
    #[ignore] // Requires PDFium library at PDFIUM_LIB_PATH + tests/fixtures/encrypted.pdf
    fn extractor_rejects_encrypted_pdf() {
        // Spec error-handling table: password-protected PDF →
        // "PDF is encrypted and cannot be ingested"
        let extractor = extractor_from_env();
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/encrypted.pdf"
        ))
        .expect(
            "tests/fixtures/encrypted.pdf not found — run tests/fixtures/generate.py first",
        );

        let result = extractor.extract(&bytes);
        assert!(result.is_err(), "expected an error for encrypted PDF");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("PDF is encrypted and cannot be ingested"),
            "expected encryption error message, got: {msg:?}"
        );
    }

    #[test]
    #[ignore] // Requires PDFium library at PDFIUM_LIB_PATH + tests/fixtures/image_only.pdf
    fn extractor_rejects_image_only_pdf() {
        // Spec error-handling table: all pages fail text extraction →
        // "No text could be extracted from PDF"
        let extractor = extractor_from_env();
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/image_only.pdf"
        ))
        .expect(
            "tests/fixtures/image_only.pdf not found — run tests/fixtures/generate.py first",
        );

        let result = extractor.extract(&bytes);
        assert!(result.is_err(), "expected an error for image-only PDF");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("No text could be extracted from PDF"),
            "expected no-text error message, got: {msg:?}"
        );
    }
}
