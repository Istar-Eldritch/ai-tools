# Specification: Push-Based Notification System for Spec-Pipeline

**Date:** 2026-04-09  
**Status:** Draft  
**Revision:** 0

---

## Overview

The spec-pipeline server currently requires clients to poll the `spec_status` MCP tool repeatedly to detect state changes such as phase transitions, gate arrivals, workflow completions, and errors. This is wasteful, introduces latency, and complicates client implementations.

The infrastructure for push notifications is **already partially implemented**: `src/notifier.rs` emits `notifications/progress` and `notifications/message` MCP notifications whenever state changes occur. However, the client interface has not been designed around receiving these events, and `spec_status` polling remains the de-facto way clients track workflow progress.

This specification defines how to complete the push-based system — standardizing the notification payload schema, ensuring all relevant events are emitted, and deprecating the need to call `spec_status` in a polling loop.

### Goals

1. Clients receive real-time progress updates over the MCP stdio channel without polling.
2. All workflow events (phase transitions, gate arrivals, completions, errors) emit structured notifications.
3. The existing `spec_status` tool is retained as a **one-shot snapshot query** — not a polling primitive.
4. No new transport (SSE, WebSocket) is required; MCP's built-in notification mechanism is sufficient.
5. Backward compatibility: clients that still poll `spec_status` continue to work.

### Non-Goals

- Adding HTTP/SSE or WebSocket transports (out of scope for this change).
- Persisting notifications for replay to clients that connect after the fact.
- Multi-subscriber fan-out within a single MCP session (one MCP client per server process).

---

## Background & Current State

### Transport

The server uses **stdio JSON-RPC** exclusively (`rmcp` crate, `src/main.rs`). The MCP protocol supports bidirectional communication: the server can send notifications to the client at any time over the same stdio channel, without the client making a request first.

### Existing Notification Infrastructure

`src/notifier.rs` already defines:

```rust
pub struct SessionEvent {
    pub session_id: Uuid,
    pub workflow_type: String,
    pub session_state: String,   // "Running" | "WaitingAtGate" | "Complete" | ...
    pub phase: String,
    pub sub_phase: Option<String>,
    pub message: String,
    pub gate_content: Option<serde_json::Value>,
    pub progress: f64,
    pub total: f64,
}
```

When `notifier.notify(event)` is called it emits two MCP notifications to the peer:

1. `notifications/progress` — carries `progress`, `total`, and `message` for generic progress bars.
2. `notifications/message` — carries the full `SessionEvent` JSON as a log message at `info` level.

**Problem:** `notifications/message` was designed for log output, not structured workflow events. Its payload is embedded as a freeform string inside a log notification, making it difficult for clients to parse reliably. Clients have therefore ignored notifications and relied on `spec_status` polling instead.

### Polling Mechanics

```
Client loop:
  while true:
    result = call spec_status(session_id)
    if result.session_state in ["WaitingAtGate", "Complete", "ErrorGate"]:
      break
    sleep(poll_interval)
```

This introduces poll-interval latency (typically 1–5 s) on every gate arrival and completion event.

---

## Requirements

### Functional Requirements

| ID | Requirement |
|----|-------------|
| F-1 | The server MUST emit a structured MCP notification when a workflow session transitions between states. |
| F-2 | Notifications MUST include: `session_id`, `workflow_type`, `session_state`, `phase`, `sub_phase`, `progress`, and `message`. |
| F-3 | Gate-arrival notifications MUST include the full `gate_content` object (question, artifact path, revision number). |
| F-4 | Error notifications MUST include the error message, failed phase name, and process exit code. |
| F-5 | The server MUST emit a notification at workflow start (after `spec_start` spawns the background task). |
| F-6 | Child agent events (tool calls and intermediate output) SHOULD be emitted as lower-priority log notifications, distinct from state-change notifications. |
| F-7 | The `spec_status` tool MUST remain available as a snapshot query and return identical data to what notifications carry. |
| F-8 | A client that processes notifications MUST be able to fully reconstruct current workflow state without ever calling `spec_status`. |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-1 | Notification delivery latency from state change to client receipt MUST be < 100 ms under normal load. |
| NF-2 | The server MUST NOT drop state-change notifications even if a previous notification is still in-flight on the stdio channel. |
| NF-3 | Notification schema MUST be versioned so future fields can be added without breaking existing clients. |
| NF-4 | The system MUST handle the case where no MCP peer is connected (peer handle is `None`) without panicking. |

---

## Design

### Notification Method Name

Replace use of `notifications/message` for workflow events with a dedicated method:

```
spec/sessionEvent
```

This is a **custom MCP notification** (the protocol allows any `<namespace>/<name>` format for extensions). It is sent server → client with no response expected.

The existing `notifications/progress` emission is retained for clients that render progress bars but carries no structured state data.

The existing `notifications/message` emission for **child agent log lines** is retained at `debug` level so it does not pollute state-change streams.

### Payload Schema

```jsonc
// spec/sessionEvent notification params
{
  "schema_version": "1",          // string, increment on breaking changes
  "session_id": "uuid-v4",
  "workflow_type": "spec" | "brainstorm" | "epic" | "implement",
  "event_type": "phase_transition" | "gate_arrived" | "gate_response_received"
               | "workflow_complete" | "workflow_error" | "workflow_cancelled"
               | "keepalive",
  "session_state": "Running" | "WaitingAtGate" | "ErrorGate" | "Complete" | "Cancelled",
  "phase": "Discovery" | "Synthesis" | "AwaitingApproval" | ...,
  "sub_phase": "Exploring" | "AwaitingAnswer" | null,
  "message": "Human-readable description",
  "progress": 0.0,                // 0.0–1.0
  "total_cost_usd": 0.042,
  "timestamp": "2026-04-09T12:34:56Z",  // ISO 8601 UTC

  // Only present when event_type == "gate_arrived"
  "gate_content": {
    "question": "...",
    "artifact_path": "/path/to/draft.md" | null,
    "revision": 2
  },

  // Only present when event_type == "workflow_error"
  "error": {
    "message": "Claude subprocess exited with code 1",
    "failed_phase": "Synthesis",
    "exit_code": 1
  }
}
```

#### `event_type` Values

| Value | Trigger |
|-------|---------|
| `phase_transition` | Session moves from one phase/sub-phase to another while `Running` |
| `gate_arrived` | Session enters `WaitingAtGate`; client must call `spec_respond` |
| `gate_response_received` | Client called `spec_respond`; phase runner is unblocked |
| `workflow_complete` | Session reaches terminal `Complete` state |
| `workflow_error` | Session reaches terminal `ErrorGate` state |
| `workflow_cancelled` | Session was cancelled via `spec_cancel` |
| `keepalive` | Emitted every 30 s during long-running phases to confirm liveness |

### Notification Emission Points

The following table maps all state transitions in `src/phase_runner.rs` and `src/mcp/mod.rs` to required notification calls:

| Location | Event | Notification |
|----------|-------|--------------|
| `spec_start` handler, after task spawn | Workflow started | `phase_transition` (state=`Running`) |
| `phase_runner: notify_current_state()` | Phase or sub-phase change | `phase_transition` |
| `phase_runner: await_gate_response()` entry | Gate reached | `gate_arrived` |
| `spec_respond` handler, after `tx.send()` | Gate answer sent | `gate_response_received` |
| Phase runner: `Complete` arm | Workflow done | `workflow_complete` |
| Phase runner: `ErrorGate` arm | Error encountered | `workflow_error` |
| `spec_cancel` handler | Cancellation | `workflow_cancelled` |
| `send_keepalive()` | Periodic during gate wait | `keepalive` |

### Changes to `SessionNotifier`

**Add a new method** `notify_event(event: SessionEvent)` that constructs and sends a `spec/sessionEvent` notification:

```rust
// src/notifier.rs
pub async fn notify_event(&self, event: &SessionEvent) {
    let peer_guard = self.peer.read().await;
    if let Some(peer) = peer_guard.as_ref() {
        let params = serde_json::to_value(event).expect("SessionEvent is always serializable");
        let _ = peer.notify("spec/sessionEvent", params).await;
    }
    // Also emit notifications/progress for progress bar clients
    // (existing behavior retained)
}
```

**Extend `SessionEvent`** with the new fields:

```rust
pub struct SessionEvent {
    pub schema_version: &'static str,      // = "1"
    pub session_id: Uuid,
    pub workflow_type: String,
    pub event_type: SessionEventType,       // new enum
    pub session_state: String,
    pub phase: String,
    pub sub_phase: Option<String>,
    pub message: String,
    pub progress: f64,
    pub total_cost_usd: f64,               // rename from total → total_cost_usd
    pub timestamp: DateTime<Utc>,          // new
    pub gate_content: Option<GateContent>, // new structured type (was Value)
    pub error: Option<ErrorContent>,       // new
}

pub enum SessionEventType {
    PhaseTransition,
    GateArrived,
    GateResponseReceived,
    WorkflowComplete,
    WorkflowError,
    WorkflowCancelled,
    Keepalive,
}
```

### Changes to `spec_start`

After spawning the background task, emit an initial `phase_transition` notification so the client knows the workflow has started without needing to call `spec_status`:

```rust
notifier.notify_event(&SessionEvent {
    event_type: SessionEventType::PhaseTransition,
    session_state: "Running".into(),
    phase: initial_phase.to_string(),
    message: format!("Workflow started: {workflow_type}"),
    ..defaults
}).await;
```

### Changes to `spec_respond`

After sending the gate response through the oneshot channel, emit a `gate_response_received` notification so the client sees acknowledgement immediately:

```rust
notifier.notify_event(&SessionEvent {
    event_type: SessionEventType::GateResponseReceived,
    session_state: "Running".into(),  // transitioning back to Running
    message: format!("Gate response accepted: {response_type}"),
    ..snapshot_of_current_state
}).await;
```

### Deprecation of `spec_status` Polling

`spec_status` is **not removed**. It remains useful for:
- Initial state recovery when a client reconnects.
- Debugging and introspection.
- Clients that cannot process notifications (e.g., simple test harnesses).

However, tool documentation is updated to discourage polling:

> ⚠️ **Do not poll this tool.** Subscribe to `spec/sessionEvent` notifications for real-time updates. Use `spec_status` only to retrieve a one-time snapshot of current state, e.g., on reconnect.

---

## Implementation Notes

### `rmcp` Custom Notification API

The `rmcp` crate's `Peer` type supports sending arbitrary notifications:

```rust
peer.notify("spec/sessionEvent", serde_json::Value).await
```

This matches the MCP protocol's allowance for extension notification methods. Clients must explicitly register a handler for `spec/sessionEvent`; unknown notification methods are silently ignored by conforming MCP clients, so this is backward-compatible.

### Client-Side Handler Registration

Clients using the MCP SDK register a notification handler:

```python
# Python MCP client example
@client.notification_handler("spec/sessionEvent")
async def on_spec_event(params: dict):
    event_type = params["event_type"]
    if event_type == "gate_arrived":
        gate_q = params["gate_content"]["question"]
        answer = await ask_user(gate_q)
        await client.call_tool("spec_respond", {
            "session_id": params["session_id"],
            "response_type": "approve",
            "content": answer,
        })
    elif event_type == "workflow_complete":
        print("Done:", params["message"])
```

### Keepalive Interval

The existing `send_keepalive()` in `notifier.rs` runs every 30 s during gate waits. This is retained and mapped to the `keepalive` event type. Clients should treat absence of notifications for > 60 s as a possible connection failure and fall back to `spec_status`.

### Concurrency Safety

`SessionNotifier` holds the peer behind `Arc<RwLock<Option<Peer>>>`. Notification calls acquire a read lock, so multiple concurrent phase runners (different sessions) can send notifications simultaneously without contention. Write lock is only acquired when the peer is first stored during MCP handshake initialization.

### Error Handling for Notification Failures

`peer.notify()` returns a `Result`. Notification failures (e.g., client disconnected) are logged at `warn` level but do not propagate as errors — the workflow continues regardless of whether the client is still connected. The in-memory session state remains authoritative.

### Backward Compatibility

- Existing `notifications/progress` emissions are unchanged.
- Existing `notifications/message` for child agent log lines is unchanged.
- `spec_status` response schema is unchanged.
- New `spec/sessionEvent` notifications are additive; clients that don't register a handler silently ignore them.

---

## Open Questions

| # | Question | Owner | Resolution |
|---|----------|-------|------------|
| OQ-1 | Should `spec/sessionEvent` notifications carry a monotonically increasing `sequence_number` so clients can detect missed events? This would allow a client to call `spec_status` to resync if it detects a gap. | TBD | Consider for v2 if clients report missed events |
| OQ-2 | The `notifications/message` log notifications for child agent events are high-volume. Should they be gated behind a client-declared capability (e.g., `spec/capabilities: {child_events: true}`)? | TBD | Default off, opt-in |
| OQ-3 | When a new MCP client connects to a session already in progress (e.g., IDE restart), should `spec_start` emit a synthetic `phase_transition` notification to bring the new client up to date? Currently the client must call `spec_status` manually. | TBD | Likely yes; implement as part of MCP `initialized` handler |
| OQ-4 | `rmcp` notification delivery is fire-and-forget. If the stdio buffer fills (client too slow), notifications may be dropped. Should we add a backpressure mechanism or bounded notification queue? | TBD | Monitor in practice; add buffered queue if needed |
| OQ-5 | Should `schema_version` be bumped to `"2"` if we later add fields to `SessionEvent`, or only on breaking/removal changes? Define a versioning policy. | TBD | Additive changes: no bump. Removals/renames: bump. |

---

## Migration Path

1. **Phase 1 (this spec):** Add `spec/sessionEvent` notifications with the full payload. Retain all polling infrastructure unchanged.
2. **Phase 2:** Update official client examples (Claude Code agent harness, Python integration tests) to use notification handlers instead of polling loops.
3. **Phase 3:** Add `spec_status` documentation warning. Remove polling-based examples from docs.
4. **Phase 4 (future, opt-in):** If a client declares `spec/capabilities: {notifications_only: true}`, the server MAY suppress `spec_status` tool availability to enforce the push model.
