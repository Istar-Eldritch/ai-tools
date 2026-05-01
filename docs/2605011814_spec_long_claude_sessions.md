# Long-Lived Claude Native Provider Sessions

**Status:** Draft  
**Created:** 2026-05-01  
**Spec ID:** 2605011814

## PART I: Requirements

## 1. Problem Statement

### Business Context

The `claude-native-provider` extension lets Pi delegate model inference and tool execution to the official Claude Code CLI, preserving Claude Code authentication, subscription behavior, permissions, and session handling. This provider is useful foundation functionality, but the current per-turn process model makes the interactive feedback loop feel slow and may reduce the benefits of Claude Code's own in-process session/cache behavior.

Improving this provider to use long-lived Claude Code processes should reduce turn startup latency, improve session continuity, and provide a better foundation for future Claude-native features without replacing the Claude Code CLI with a separate SDK integration.

### Current State

The current implementation in `extensions/claude-native-provider/index.ts`:

- Registers a custom Pi provider named `claude-native`.
- Implements `streamSimple` by spawning a fresh `claude -p --output-format stream-json --verbose --model <alias>` subprocess for each model request.
- Sends only the latest user text to the subprocess via stdin, then closes stdin.
- Tracks a single module-level `claudeSessionId` and passes it to future calls via `--resume <session_id>` unless disabled.
- Extracts session IDs, assistant text, usage, result status, and stderr/status events from newline-delimited JSON output.
- Kills the per-request subprocess on timeout or abort.
- Provides `/claude-native-reset`, which clears the single remembered session ID.

This means the extension preserves Claude Code session continuity via `--resume`, but it does **not** keep a single Claude Code process alive across Pi turns.

### Key Issues

1. **Per-turn startup overhead:** Every request pays process spawn, CLI initialization, authentication/config loading, and resume/session loading costs.
2. **Slow feedback loop:** The time to first useful CLI event/token is slower than necessary for active conversations.
3. **Weak session model:** One global `claudeSessionId` is not branch-aware and can be incorrect when Pi sessions fork, tree navigation changes the active leaf, the model changes, or the working directory changes.
4. **No lifecycle management:** There is no process pool, idle cleanup, crash recovery, or explicit invalidation strategy.
5. **Correctness risk with Pi tree features:** Pi exposes session-tree navigation and fork events (`session_before_tree`, `session_tree`, `session_before_fork`, `session_shutdown`, etc.). A long-lived provider must avoid mixing Claude state across divergent Pi conversation branches.

## 2. Requirements

### Provider Behavior

**R1.** The `claude-native` provider MUST replace the current per-request `claude -p` execution path with a long-lived Claude Code process model for all provider calls.

**R2.** The provider MUST continue to use the official Claude Code CLI rather than switching to the Anthropic SDK or another API client.

**R3.** The provider MUST use Claude Code's streaming JSON protocol for long-lived interaction, using CLI input/output formats that support streaming structured messages over stdin/stdout.

**R4.** The provider MUST preserve the existing registered provider identity, model list, model aliases, and Pi-facing provider API unless a change is required for correctness.

**R5.** The provider MUST continue to support existing environment configuration for binary path, permission mode, allowed tools, max turns, timeout, heartbeat/status updates, and session-resume behavior where compatible with the long-lived process model.

**R6.** The new long-lived path MUST be the only normal execution path. No feature flag or fallback to the old per-request spawn behavior is required.

### Process Pool and Session Identity

**R7.** The provider MUST manage a process pool keyed by Claude model alias, working directory, and Claude session identity.

**R8.** The provider MUST NOT share a single Claude process across different models, working directories, or session identities.

**R9.** The provider MUST keep pool and session state in memory only. It MUST NOT persist process metadata or Claude session mappings to disk across Pi restarts.

**R10.** The provider MUST track the last known Claude Code `session_id` for each active pool entry when the CLI emits it.

**R11.** When a process is restarted for a pool entry and a valid previous Claude session ID is known, the provider SHOULD resume using `--resume <session_id>` unless resume is disabled by configuration or the session was explicitly invalidated.

**R12.** When no valid session ID exists for a key, the provider MUST start a fresh Claude Code session and update the key/session mapping after the CLI emits a new session ID.

**R13.** The provider MUST support multiple active warm processes for distinct keys, but MUST NOT multiplex unrelated Pi branches through the same process.

### Pi Tree, Fork, Model, and CWD Correctness

**R14.** The provider MUST invalidate or retire warm Claude processes when Pi's session tree changes in a way that can alter the active conversation lineage.

**R15.** The provider MUST treat Pi tree navigation and branch/fork operations as hard invalidation points for the active Claude process/session mapping.

**R16.** The provider MUST invalidate or retire warm Claude processes when the selected model changes.

**R17.** The provider MUST invalidate or retire warm Claude processes when the working directory changes.

**R18.** The provider MUST invalidate or retire warm Claude processes when Pi session replacement/shutdown events indicate a new, resumed, forked, or otherwise replaced session context.

**R19.** The provider MUST invalidate or retire warm Claude processes after Pi compaction events if continuing the existing Claude process could cause Claude Code's internal conversation state to diverge from Pi's compacted context.

**R20.** In ambiguous lifecycle situations, the provider MUST prefer correctness over reuse by killing or retiring the warm process and starting/resuming a safe process for the new context.

### Idle Lifecycle and Cleanup

**R21.** The provider MUST stop warm Claude processes after approximately 10 minutes of inactivity.

**R22.** Idle reaping MUST terminate only the process; it SHOULD keep the last known Claude session ID in memory so the next request can resume with `--resume`.

**R23.** Idle timeout duration SHOULD be configurable via environment variable, with a default of 600,000 milliseconds.

**R24.** The provider MUST clean up all live Claude subprocesses on extension/session shutdown and process exit where practical.

**R25.** The provider MUST avoid leaking timers, readline interfaces, stdin/stdout listeners, or child processes when a pool entry is reaped, invalidated, crashes, or is reset.

### Crash Recovery and Health

**R26.** If a warm Claude process crashes, exits unexpectedly, or becomes unhealthy before or between turns, the provider MUST remove it from the active pool.

**R27.** After a crash, the provider SHOULD transparently start a replacement process and resume with the last known session ID when possible.

**R28.** If a request is already in flight when a process crashes, the provider MUST either retry safely once against a replacement process or surface a clear error to Pi; it MUST NOT hang the `AssistantMessageEventStream`.

**R29.** The provider MUST detect malformed JSON output and stderr/error conditions without corrupting the pool's session state.

**R30.** The provider MUST maintain timeout behavior for in-flight requests. A timed-out turn MUST terminate or retire the affected process to avoid reusing an unknown state.

### Request Serialization and Concurrency

**R31.** The provider MUST allow at most one in-flight request per warm Claude process.

**R32.** Concurrent calls for the same process key MUST either be queued in order or rejected with a clear error; they MUST NOT interleave JSON messages on stdin/stdout.

**R33.** Concurrent calls for different process keys MAY run independently in separate Claude processes.

**R34.** Aborting a Pi request MUST stop the in-flight Claude turn and leave the pool in a known-safe state. If the CLI protocol cannot guarantee safe in-process interruption, the provider MUST terminate and retire that process.

### Streaming and Pi Message Compatibility

**R35.** The provider MUST continue to return a Pi `AssistantMessageEventStream` with `start`, text content events, status/thinking events, error events, and final `done` events compatible with the current provider.

**R36.** The provider MUST continue to parse Claude Code assistant messages, streamlined text, tool summaries, result events, usage, stop reasons, and session IDs from stream-json output.

**R37.** Usage accounting MUST continue to populate Pi `AssistantMessage.usage` and cost fields using the existing cost calculation behavior.

**R38.** Status/heartbeat updates MUST remain suppressible via `CLAUDE_NATIVE_STATUS_UPDATES=0` and configurable via heartbeat environment settings.

**R39.** Text-only input behavior MAY remain unchanged for this feature. Image forwarding is not required.

**R40.** The provider MUST continue to surface Claude Code tool activity in a user-visible way at least as well as the current implementation.

### Commands and Operations

**R41.** `/claude-native-reset` MUST be updated to clear all in-memory Claude native session/process state, not just a single module-level session ID.

**R42.** `/claude-native-reset` MUST terminate any live warm Claude processes before clearing their session mappings.

**R43.** The command's user-facing notification MUST make clear that Claude native process/session state was reset.

**R44.** The provider SHOULD expose enough debug/status information in logs or status updates to distinguish process start, reuse, idle reap, invalidation, resume, crash, and reset events.

### Testing and Validation

**R45.** The implementation MUST include automated tests for process-pool keying, idle reaping, invalidation, reset behavior, crash cleanup, and request serialization using mocked child processes where practical.

**R46.** The implementation MUST include tests or documented manual validation for Pi lifecycle events: session tree navigation, fork/session replacement, model selection, compaction, and shutdown.

**R47.** Existing provider behavior for parsing stream-json output, usage accounting, stop reasons, status updates, timeout handling, and abort handling MUST remain covered by tests or validated manually if direct testing is impractical.

**R48.** The project test command `npm test` MUST pass after implementation.

## 3. Success Criteria

- [ ] Active conversations reuse a warm Claude Code process instead of spawning a new process for every turn.
- [ ] Time-to-first Claude CLI event/token is reduced for a second turn in the same `(model, cwd, session)` context.
- [ ] Warm processes are keyed by model, cwd, and session identity.
- [ ] `/tree` navigation or branch/fork lifecycle events do not reuse an unsafe Claude process from a divergent branch.
- [ ] Model changes invalidate or select an appropriate process instead of reusing a process launched for another model.
- [ ] Working-directory changes invalidate or select an appropriate process instead of reusing a process launched in another cwd.
- [ ] Idle processes are stopped after roughly 10 minutes while retaining resumable session IDs in memory.
- [ ] A killed or crashed Claude process is removed from the pool and does not leave Pi streams hanging.
- [ ] `/claude-native-reset` kills live Claude processes and clears all in-memory session state.
- [ ] Provider streams remain compatible with Pi's current assistant message rendering and usage accounting.
- [ ] No disk persistence is introduced for Claude native process/session metadata.
- [ ] `npm test` passes.

## 4. Out of Scope

- Replacing the Claude Code CLI with the Anthropic SDK, Claude Code SDK, or direct Anthropic API calls.
- Persisting Claude native session/process metadata across Pi restarts.
- Supporting images or multimodal input in `claude-native`.
- Implementing advanced stdin/stdout multiplexing across multiple simultaneous turns in one Claude process.
- Building a full UI for inspecting the process pool.
- Changing Pi's core session-tree implementation.
- Changing Claude Code's authentication, permissions, or tool execution semantics beyond CLI flags already supported by the provider.
- Keeping old per-request `claude -p` behavior as a fallback or feature-flagged rollout path.

## 5. Open Questions

1. What exact JSON message shape does the installed Claude Code CLI require for multi-turn `--input-format stream-json` operation, and does it support true multi-request operation in one process without EOF?
2. Can an in-flight Claude Code stream-json request be interrupted safely while preserving the process, or must abort always retire the process?
3. What is the best available Pi-side identifier for the `sessionId` part of the pool key: active session file path, current leaf entry ID, Claude `session_id`, or a provider-managed composite branch key?
4. Should compaction always invalidate Claude native processes, or only when the compacted branch affects the currently active pool key?
5. Should concurrent calls for the same key queue or fail fast? The safer default is queueing one-at-a-time, but the expected Pi runtime behavior may make same-key concurrency rare.

## PART II: High-Level Implementation Plan

## 6. Phase Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Claude native process lifecycle and stream-json protocol validation | 1 day |
| Phase 2 | Process pool keyed by model, cwd, and session identity | 1.5 days |
| Phase 3 | Pi lifecycle invalidation for tree, fork, model, cwd, compaction, and shutdown events | 1 day |
| Phase 4 | Request streaming compatibility, abort/timeout handling, and crash recovery | 1.5 days |
| Phase 5 | Reset command updates, diagnostics, and automated/manual validation | 1 day |

## 7. High-Level Implementation Guidance

- Keep the provider implemented as a Pi extension registered through `pi.registerProvider` and `streamSimple`.
- The current `index.ts` already contains useful parsing and Pi event-stream conversion helpers; preserve those behaviors while moving subprocess ownership into a dedicated lifecycle/pool abstraction.
- Use Pi extension events for correctness boundaries. Relevant events are available in the extension API, including `session_before_tree`, `session_tree`, `session_before_fork`, `session_shutdown`, `session_before_compact`, `session_compact`, and `model_select`.
- Prefer terminating and recreating a Claude process when there is uncertainty about whether the process still matches Pi's active conversation branch.
- Keep session metadata in memory and intentionally simple. The goal is fast active-session reuse, not cross-restart recovery.
- Treat the installed Claude Code CLI protocol as an integration dependency that must be validated before finalizing stdin message handling. If true long-lived multi-turn stdin is not supported by the CLI, implementation should document the blocker and choose the closest safe CLI-supported behavior that still reduces unnecessary process/session mismatch.
- Ensure all process lifecycle code is robust around Node child process events: `error`, `close`, stdout line parsing, stderr draining, stdin write errors, abort signals, timers, and listener cleanup.

## 8. Validation Plan

- Unit test the pool independently from Pi by mocking child process spawn behavior.
- Unit test idle reaping with fake timers.
- Unit test reset and invalidation by verifying live child processes receive termination and pool maps are cleared or retired.
- Unit test JSON parsing and Pi stream event emission using representative Claude Code stream-json messages.
- Manually validate with the real Claude Code CLI:
  - first turn starts a process;
  - second turn reuses it;
  - idle timeout kills it;
  - subsequent turn resumes with the last session ID;
  - model switch starts a separate/safe process;
  - `/tree` or fork navigation does not leak prior branch state;
  - `/claude-native-reset` kills warm processes and starts fresh on the next turn.
- Run `npm test` before considering the feature complete.
