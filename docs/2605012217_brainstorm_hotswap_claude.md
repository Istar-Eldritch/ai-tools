# Brainstorm: is there a way to change the thinking mode and model of extensions/claude-native-provider/ without having to recreate the session?

**Status**: Draft
**Created**: 2026-05-01
**Timestamp**: 2605012217

## Problem / Opportunity

Explore whether `extensions/claude-native-provider/` can change Claude Code model and thinking mode without losing session continuity.

The key distinction that emerged is between two different meanings of "session":

- **Live Claude Code subprocess**: the spawned `claude -p` process. Model and effort are startup flags, so this process cannot be hot-swapped in place with the current stream-json protocol.
- **Claude Code conversation/session ID**: the persisted Claude conversation. This can survive subprocess replacement via `--resume <session_id>`.

The opportunity is not true live hot-swap, but **respawn with continuity**: recreate the subprocess with new startup flags while preserving the Claude conversation through a shared session ID.

## Context & Background

Current observed behavior in `extensions/claude-native-provider/`:

- The provider spawns Claude Code in print/stream-json mode.
- `--model` is passed as a startup argument in `buildClaudeArgs`.
- Thinking mode was not wired initially; Claude Code exposes this as `--effort <low|medium|high|xhigh|max>`.
- The pool key currently includes `modelAlias`, `cwd`, and `sessionIdentity`.
- `model_select` calls `retireAll()`, killing live Claude subprocesses while preserving remembered Claude session IDs.
- However, because remembered session IDs are keyed by model as part of the process key, switching models can strand the prior session ID and start a fresh Claude conversation under the new model.

What was verified manually:

- A Claude Code session ID can be minted up front with `--session-id <uuid>`.
- A later process can resume that same conversation with `--resume <uuid>`.
- Resuming with a different `--model` works: a session started with haiku could be resumed with sonnet, and the `system/init` event reported the new model while preserving the same session ID.
- `--effort high` is accepted on resume without error. The quick test did not conclusively prove behavioral difference because the prompt was trivial, but the flag is valid and not rejected.
- If a generated UUID has already been used, Claude Code can reject `--session-id <uuid>` with `Session ID <uuid> is already in use`, because sessions persist on disk under `~/.claude/projects/...`.

Important protocol finding:

- Stream-json input appears to only support user-message turns. There is no documented in-band control message for changing model or effort on a live subprocess.
- Interactive slash commands like `/model` and `/effort` are client-side behavior in Claude Code, not a reusable control path available through `claude -p` stream-json mode.

## Proposed Directions

- **Option A: Respawn subprocess, preserve Claude conversation via `--resume`**
  - Description: Treat model and effort as subprocess attributes. When they change, terminate or switch to a different process, but keep the same Claude conversation by passing `--resume <session_id>`.
  - Pros:
    - Preserves conversation continuity across model changes.
    - Verified that model override on resume works.
    - Fits Claude Code's existing CLI model.
    - Avoids pretending true hot-swap is possible.
  - Cons:
    - Still recreates the subprocess.
    - First turn after a cold switch pays Claude Code startup cost.
    - Requires careful session identity management.

- **Option B: Mint Claude session UUIDs up front**
  - Description: Instead of waiting for Claude Code to emit a generated session ID, generate a fresh UUID per Pi session/conversation and pass `--session-id` on first spawn, then `--resume` thereafter.
  - Pros:
    - Removes race where the provider does not know the session ID until after first init/result.
    - Makes continuity explicit and controlled by the provider.
    - Cleaner mapping between Pi session identity and Claude Code session identity.
  - Cons:
    - Must never reuse a UUID after reset, because Claude Code persists sessions and rejects duplicate `--session-id` values.
    - Requires a durable mapping from Pi session identity to generated Claude UUID.
    - Session files will continue accumulating on disk, though that already happens today.

- **Option C: Split process identity from conversation identity**
  - Description: Keep process pool keys specific to runtime startup flags, e.g. `{cwd, sessionIdentity, modelAlias, effort}`, but store Claude conversation identity separately, e.g. keyed only by `{cwd, sessionIdentity}` or by an explicit generated UUID mapping.
  - Pros:
    - Allows multiple warm subprocesses for different model/effort combinations while sharing one conversation.
    - Avoids the current bug where model switches can strand the prior session ID.
    - Makes it natural to preserve context across model and effort changes.
  - Cons:
    - More complex pool bookkeeping.
    - Multiple live processes for the same conversation may raise concurrency questions if used simultaneously.
    - Needs clear invalidation behavior for reset, fork, and hard invalidate.

- **Option D: Keep prior model/effort processes warm instead of retiring all**
  - Description: Do not call `retireAll()` on `model_select`. Let the pool retain subprocesses for previously used model/effort combinations until idle timeout.
  - Pros:
    - Reduces perceived latency when toggling between models or effort levels.
    - Simple performance improvement once pool keys include model/effort.
    - Idle timeout already provides cleanup pressure.
  - Cons:
    - Uses more memory and background resources.
    - Does not remove cold-start cost for first use of a new combination.
    - Must avoid multiple processes racing on the same Claude conversation.

- **Option E: Pre-warm destination process on model/effort change**
  - Description: Spawn the new model/effort process as soon as the selection changes, rather than lazily waiting for the next user turn.
  - Pros:
    - Hides some or all Claude Code startup latency from the next response.
    - Can be layered on top of resume-based continuity.
  - Cons:
    - Requires a provider/API hook at the right moment.
    - May waste resources if the user changes selection but never sends another turn.
    - Startup may still be long due to CLAUDE.md discovery, plugin sync, MCP config, and auth checks.

- **Option F: Prompt-cue thinking mode**
  - Description: Instead of using `--effort`, inject textual cues like "think", "think hard", "think harder", or "ultrathink" into the user prompt.
  - Pros:
    - Can change per turn without subprocess restart.
    - Very simple to implement.
    - Avoids CLI startup costs.
  - Cons:
    - Less explicit and less reliable than the real `--effort` flag.
    - Pollutes the prompt/conversation.
    - Does not help with model switching.
    - May diverge from Claude Code's native behavior.

- **Option G: True live hot-swap via stream-json control message**
  - Description: Send an in-band control event to the live Claude Code process to change model or effort.
  - Pros:
    - Ideal UX if supported: no subprocess restart and no cold-start latency.
  - Cons:
    - No evidence this exists in the current `claude -p` stream-json protocol.
    - Interactive `/model` and `/effort` appear to be client-side slash commands, not stream-json control messages.
    - Likely requires upstream Claude Code support.

## Out of Scope

- Implementing the provider changes during this brainstorm.
- Designing a full UI for effort selection.
- Replacing Claude Code CLI with a direct Anthropic API provider.
- Guaranteeing exact behavioral impact of `--effort` without deeper non-trivial prompts and measurement.
- Cleaning up persisted Claude Code session files under `~/.claude/projects/...`.
- Solving all concurrency cases for multiple live subprocesses sharing one conversation.

## Open Questions

- Should the provider generate and persist a Claude session UUID per Pi session, or keep using Claude-generated IDs but re-key the session map separately from process keys?
- What should reset semantics mean?
  - Soft reset: new subprocess but same Claude conversation?
  - Hard reset: mint a brand-new Claude UUID and abandon the old persisted session?
- Should effort be configured globally via env var, per model definition, or through a provider command/slash command?
- Should pool keys include effort as well as model, allowing warm processes for multiple effort levels?
- Is it safe to keep multiple subprocesses alive that all point at the same Claude conversation, as long as only one is actively processing a turn at a time?
- Does Pi expose a lifecycle hook early enough to pre-warm a destination model when the model picker opens or model selection changes?
- Should the provider document that model/effort changes recreate the subprocess but preserve the Claude Code conversation?

## Rough Scope Assessment

This is a **feature-level to small-epic effort**.

A minimal feature would be:

- Re-key conversation/session identity separately from process identity.
- Verify model switching preserves `--resume` behavior in a test/manual check.
- Add `--effort` plumbing behind an env var or simple config.
- Stop retiring all processes unnecessarily on model switch.

It becomes a small epic if it includes:

- Provider commands for changing effort interactively.
- Pre-warming behavior.
- Robust reset/fork semantics.
- Tests or diagnostics for session UUID mapping and process-pool behavior.
