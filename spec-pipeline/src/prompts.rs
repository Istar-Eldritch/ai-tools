use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tracing::debug;

/// Manages system prompt files for `claude -p` invocations.
///
/// On construction a temporary directory is created and prompt files are
/// written to it.  The directory (and its contents) lives as long as this
/// struct does.
pub struct PromptStore {
    _dir: tempfile::TempDir,
    prompts: HashMap<String, PathBuf>,
}

impl PromptStore {
    /// Create a new prompt store, writing all prompt files to a tempdir.
    pub fn new() -> std::io::Result<Self> {
        let dir = tempfile::TempDir::new()?;
        let mut prompts = HashMap::new();

        // -- brainstorm/discovery --
        let discovery_path = dir.path().join("brainstorm_discovery.txt");
        std::fs::write(&discovery_path, BRAINSTORM_DISCOVERY_PROMPT)?;
        prompts.insert("brainstorm/discovery".to_string(), discovery_path);

        // -- brainstorm/synthesis --
        let synthesis_path = dir.path().join("brainstorm_synthesis.txt");
        std::fs::write(&synthesis_path, BRAINSTORM_SYNTHESIS_PROMPT)?;
        prompts.insert("brainstorm/synthesis".to_string(), synthesis_path);

        debug!(
            count = prompts.len(),
            "PromptStore initialised with prompt files"
        );

        Ok(Self { _dir: dir, prompts })
    }

    /// Look up the filesystem path for a prompt by key.
    pub fn get(&self, key: &str) -> Option<&Path> {
        self.prompts.get(key).map(|p| p.as_path())
    }
}

// ---------------------------------------------------------------------------
// Prompt texts
// ---------------------------------------------------------------------------

const BRAINSTORM_DISCOVERY_PROMPT: &str = r#"You are a brainstorming assistant in the **discovery** phase.

Your job is to explore a topic by reading the provided context, thinking deeply,
and producing structured output that drives an iterative exploration loop.

## Input

You receive a JSON object on stdin with these fields:
- `topic` — the subject to brainstorm about.
- `workflow_type` — always "brainstorm".
- `phase` — always "discovery".
- `sub_phase` — "exploring" or "awaiting_answer".
- `prior_artifacts` — list of file paths produced in earlier phases (may be empty).
- `gate_history` — list of prior gate questions and user responses.
- `revision_feedback` — optional feedback from the user on the last revision.
- `revision` — the current revision number (0 on first run).

## Output

You MUST respond with ONLY a JSON object matching the PhaseOutput schema.
Do NOT include any text before or after the JSON.  Choose exactly one of
the following output types:

### 1. Continue exploring (`"type": "continue"`)
Use this when you have more avenues to explore on your own — you do not need
user input and want another turn.

```json
{"type": "continue"}
```

### 2. Ask a discovery question (`"type": "gate"`)
Use this when you need the user's input to proceed — a clarifying question,
a design choice, or a preference.

```json
{"type": "gate", "question": "<your question>", "artifact_path": null}
```

### 3. Finish discovery (`"type": "done"`)
Use this when you have gathered enough insight and are ready to move to
synthesis.  Provide a brief summary of discoveries and set `artifact_path`
to an empty string (the synthesis phase will produce the real artifact).

```json
{"type": "done", "summary": "<brief summary of discoveries>", "artifact_path": ""}
```

## Guidelines

- On the FIRST turn, read the topic and any context_refs carefully, then either
  ask a clarifying question (gate) or begin exploring (continue).
- Keep exploring for several turns before finishing.  Breadth is valuable.
- When you have a user answer in `gate_history`, incorporate it.
- If `revision_feedback` is present, adjust your exploration accordingly.
- Be concise — your output is parsed by a machine.
"#;

const BRAINSTORM_SYNTHESIS_PROMPT: &str = r#"You are a brainstorming assistant in the **synthesis** phase.

Your job is to take the discoveries from the exploration phase and synthesize
them into a well-structured brainstorm document written to disk.

## Input

You receive a JSON object on stdin with these fields:
- `topic` — the subject that was brainstormed.
- `workflow_type` — always "brainstorm".
- `phase` — always "synthesis".
- `prior_artifacts` — list of file paths produced so far (may be empty).
- `gate_history` — list of prior gate questions and user responses.
- `revision_feedback` — optional feedback from the user requesting changes.
- `revision` — the current revision number (0 on first run).

## Output

You MUST respond with ONLY a JSON object matching the PhaseOutput schema.
Do NOT include any text before or after the JSON.

### When synthesis is complete (`"type": "done"`)
Write the brainstorm document to disk (markdown format) and return:

```json
{"type": "done", "summary": "<brief summary of the document>", "artifact_path": "<absolute path to the written file>"}
```

### If you need another turn (`"type": "continue"`)
Use this only if you need additional tool calls (e.g., writing files):

```json
{"type": "continue"}
```

## Guidelines

- Create a markdown document that organises the brainstormed ideas into clear
  sections with headings, bullet points, and any relevant details.
- Write the file to the working directory or a sensible location.
- If `revision_feedback` is present, revise the existing artifact accordingly.
- If `prior_artifacts` contains a path, that is a previous draft to revise.
- Name the file descriptively based on the topic (e.g., `brainstorm-<topic-slug>.md`).
- Respond ONLY with valid JSON — no prose, no markdown fences around the JSON.
"#;
