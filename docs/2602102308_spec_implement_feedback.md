# Add Progress Visibility to /implement Pipeline

**Status**: Draft  
**Created**: 2026-02-10  
**Spec ID**: 2602102308

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The `/implement` command is the primary autonomous workflow in the spec-pipeline extension, orchestrating plan generation, code implementation, and tiered reviews. However, unlike the conversational features (`/spec`, `/roadmap`, `/epic`) which provide real-time feedback and visibility into AI actions, the implementation pipeline operates opaquely. Users see only high-level banners ("📋 drafting plan...", "🔵 implementing...") without insight into what the AI is actually doing.

This opacity creates anxiety during long-running operations and makes it difficult to understand progress, troubleshoot issues, or gauge when the pipeline might complete. Users have no visibility into which files are being read, what code is being written, or what commands are being executed.

#### Current State

**Existing Visibility Mechanisms:**

1. **Step Banners**: High-level phase notifications using `formatStepBanner()`
   - "📝 Phase X/Y Plan - Creating detailed implementation plan"
   - "🔵 opus implementing phase X..."
   - "📝 Running tiered plan review..."

2. **Widget Updates**: Persistent status display using `updateImplWidget()`
   - Shows pipeline ID, stage, phase progress bar
   - Accepts optional `currentAction` parameter (currently unused)
   - Updated at phase boundaries only

3. **Agent Summary**: Post-completion output using `formatAgentSummary()`
   - Shows truncated agent output after completion
   - No real-time streaming during execution

**Agent Execution Infrastructure:**

- `runAgentWithConfig()` in `agents.ts` spawns pi subprocess with `--mode json`
- Pi emits structured JSON events on stdout:
  - `text_delta`: AI thinking/responses (currently captured)
  - `toolcall_end`: Tool invocations with name and arguments (currently ignored)
- `onOutput` callback parameter exists but is passed as `undefined` in all calls

**Key Integration Points:**

1. **Plan Drafting** (`implement-pipeline.ts:359`):
   ```typescript
   await runAgentWithConfig(
     planDrafterConfig, planTask, cwd, 
     SYSTEM_PROMPTS.planDrafter,
     undefined, // signal
     undefined, // onOutput ← UNUSED
     "planDrafter"
   );
   ```

2. **Implementation** (`implement-pipeline.ts:532`):
   ```typescript
   await runAgentWithConfig(
     implementerConfig, implementTask, cwd,
     SYSTEM_PROMPTS.implementer,
     undefined, // signal
     undefined, // onOutput ← UNUSED
     "implementer"
   );
   ```

3. **Tiered Reviews** (`review.ts:229, 277, 393, 452`):
   - `runTieredReview()` threads `onOutput` to `runAgentWithConfig()`
   - Always passed as `undefined` from callers

**JSON Event Structure** (from pi `--mode json`):

```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "toolcall_end",
    "contentIndex": 0,
    "toolCall": {
      "type": "toolCall",
      "id": "toolu_xxx",
      "name": "read",
      "arguments": {"path": "src/auth/middleware.ts"}
    }
  }
}
```

#### Key Issues

| ID | Issue | Impact |
|----|-------|--------|
| I1 | No visibility into file operations | Users can't see which files are being analyzed or modified |
| I2 | No visibility into command execution | Users can't see what bash commands are running |
| I3 | Widget shows static status only | No real-time action context updates |
| I4 | Long-running phases feel frozen | Users have no confidence that progress is happening |
| I5 | Debugging is difficult | Can't identify where agent is stuck without reading logs |
| I6 | Inconsistent UX with conversational features | `/spec` feels interactive, `/implement` feels opaque |

### 2. Requirements

#### Event Parsing Requirements

**R1**: The `runAgentWithConfig()` function in `agents.ts` MUST parse `toolcall_end` events from the pi subprocess JSON stream.

**R2**: For each `toolcall_end` event, the system MUST extract:
- Tool name (`event.assistantMessageEvent.toolCall.name`)
- Tool arguments (`event.assistantMessageEvent.toolCall.arguments`)

**R3**: The parsing MUST handle malformed events gracefully (ignore JSON parse errors, missing fields).

**R4**: The `onOutput` callback MUST be invoked with structured action information, not just raw text deltas.

#### Action Formatting Requirements

**R5**: The system MUST create a progress callback factory function that formats tool actions into human-readable messages.

**R6**: The formatting MUST use emoji conventions consistent with the existing codebase:
- 📖 for `read` operations
- ✍️ for `write` operations
- ✏️ for `edit` operations
- ⚙️ for `bash` commands
- 🔍 for `grep` operations
- 🔎 for `find` operations

**R7**: Each formatted message MUST include the relevant context:
- `read`: `"📖 Reading {path}..."`
- `write`: `"✍️ Creating {path}..."`
- `edit`: `"✏️ Editing {path}..."`
- `bash`: `"⚙️ Running: {command}"`
- `grep`: `"🔍 Searching {pattern} in {path}..."`
- `find`: `"🔎 Finding {pattern}..."`

**R8**: Path formatting MUST be relative to the project root for brevity (strip leading `./` if present).

**R9**: Bash commands MUST be truncated if longer than 60 characters: `"⚙️ Running: npm test --watch --coverage..."`

#### Notification Requirements

**R10**: The progress callback MUST call `ctx.ui.notify()` with formatted messages at "info" severity level.

**R11**: All tool actions MUST generate notifications (no throttling in initial implementation).

**R12**: Notification frequency MAY be high (10+ per second) - throttling is deferred to future work if needed.

#### Widget Update Requirements

**R13**: The progress callback MUST update the pipeline widget using `updateImplWidget()` or widget-specific setters.

**R14**: The widget's `currentAction` field MUST show the most recent tool action in real-time.

**R15**: Widget updates MUST replace the previous action (single-line updates, not cumulative).

**R16**: The widget format MUST be:
```
🚀 Implement: {pipelineId}...
────────────────────────────────────────
Stage: 🚀 Implementation
Phases: [█████░░░] 6/8
────────────────────────────────────────
⏳ {currentAction}
```

#### Integration Requirements

**R17**: The progress callback MUST be wired into plan drafting phase (`implement-pipeline.ts:359`).

**R18**: The progress callback MUST be wired into implementation phase (`implement-pipeline.ts:532`).

**R19**: The progress callback MUST be wired into tiered review cycles (`review.ts` via context).

**R20**: The `runTieredReview()` function MUST accept and thread the callback to all internal `runAgentWithConfig()` calls.

**R21**: The callback MUST be phase-aware: notifications should indicate which phase is active (e.g., "📖 Reading auth.ts [Phase 2]...").

#### Backward Compatibility Requirements

**R22**: The `onOutput` callback parameter MUST remain optional in `runAgentWithConfig()` signature.

**R23**: Existing code that passes `undefined` for `onOutput` MUST continue working without modification.

**R24**: The change MUST NOT affect code outside of `agents.ts`, `implement-pipeline.ts`, `review.ts`, and optionally `formatting.ts`.

### 3. Success Criteria

- [ ] During plan drafting, notifications show which files are being read (e.g., "📖 Reading src/auth/service.ts...")
- [ ] During implementation, notifications show file write/edit operations (e.g., "✍️ Creating src/middleware/auth.ts...")
- [ ] During reviews, notifications show file read operations (e.g., "📖 Reading test/auth.spec.ts [Review Cycle 1]...")
- [ ] Bash command executions are visible (e.g., "⚙️ Running: npm test")
- [ ] The pipeline widget updates in real-time to show current action
- [ ] Widget shows phase context: "⏳ 📖 Reading auth.ts [Phase 2/3]..."
- [ ] Notification history in terminal shows complete trail of actions
- [ ] No errors or crashes when parsing malformed JSON events
- [ ] Existing tests pass without modification
- [ ] Users report improved visibility and confidence in pipeline progress

### 4. Out of Scope

- **Throttling/debouncing notifications** - Deferred to future work if spam becomes an issue
- **Filtering tool actions by type** - Show all actions initially, add filtering later if needed
- **Progress percentage or time estimates** - Only show current action, not predictions
- **Detailed argument display** - Only show primary context (path, command), not full JSON
- **Commit generation progress** - Commit message writing is fast, doesn't need visibility
- **Test execution progress** - Test command output already visible via bash tool
- **Notification persistence** - Use terminal history, don't create log files
- **Configuration options** - No user-facing config for progress display behavior
- **Conversational checkpoints** - Keep autonomous execution, no user approval gates

### 5. Open Questions

None - all decisions were made during discovery.

---

## PART II: High-Level Implementation Plan

### Implementation Approach

This is a targeted enhancement to the agent execution infrastructure, adding structured progress feedback without changing the autonomous execution model. The work focuses on:

1. **Event parsing** - Extend `agents.ts` to capture `toolcall_end` events in addition to `text_delta`
2. **Action formatting** - Create a callback factory that formats tool actions into user-friendly messages
3. **Notification wiring** - Thread the callback through the three key phases (plan, implement, review)
4. **Widget integration** - Update the widget in real-time to show current action context

The implementation follows the existing architecture: `runAgentWithConfig()` remains the central orchestrator, the `onOutput` callback is the extension point, and `ctx.ui.notify()` + `updateImplWidget()` handle display.

### Architectural Guidance

**Parsing Layer** (`agents.ts`):
- Enhance the `processLine()` function inside `runAgentWithConfig()` to detect `toolcall_end` events
- Extract tool name and arguments from the event structure
- Call `onOutput()` with structured data (not just text deltas)
- Keep text delta handling for backward compatibility

**Formatting Layer** (new file `agents.ts` or add to `formatting.ts`):
- Create `createProgressCallback()` factory function
- Factory accepts `ctx`, `state`, `phaseInfo` and returns a callback
- Callback formats tool actions with appropriate emoji and context
- Callback invokes `ctx.ui.notify()` and updates widget

**Integration Layer** (`implement-pipeline.ts`, `review.ts`):
- Replace `undefined` with `createProgressCallback(ctx, state, phaseInfo)` at three key points
- For tiered reviews, create callback once and thread through `runTieredReview()` context
- Ensure phase/cycle information is included in notifications

**Widget Layer** (`formatting.ts`):
- The `updateImplWidget()` function already accepts `currentAction` parameter
- No changes needed to widget logic, just call it more frequently

### Phase Overview

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Enhance event parsing in runAgentWithConfig() | 1 day |
| Phase 2 | Create progress callback factory and formatting | 1 day |
| Phase 3 | Wire callback into pipeline phases | 0.5 days |

### Detailed Guidance

#### Phase 1: Event Parsing Enhancement

**Context**: The `runAgentWithConfig()` function in `agents.ts` currently only processes `text_delta` events. We need to extend it to also capture `toolcall_end` events and extract structured information about tool invocations.

**Key Considerations**:
- The `processLine()` inner function already parses JSON events and handles `text_delta`
- Add a parallel handler for `toolcall_end` events
- The `onOutput` callback signature may need to change to accept structured data (consider backward compatibility)
- Tool arguments are nested in `event.assistantMessageEvent.toolCall.arguments`
- Handle missing fields gracefully (not all events have the expected structure)

**Files to Modify**:
- `extensions/spec-pipeline/agents.ts`: Enhance `processLine()` to detect and parse `toolcall_end` events

**Testing Approach**:
- Manually run `/implement` on a test spec and verify JSON events are parsed correctly
- Check that malformed events don't crash the subprocess
- Verify existing text output still works for backward compatibility

#### Phase 2: Progress Callback Factory

**Context**: Create a factory function that generates progress callbacks customized for specific phases. The callback will format tool actions into notifications and update the widget.

**Key Considerations**:
- Factory should accept context about which phase/cycle is active
- Callback should format messages with appropriate emoji based on tool name
- Use existing `ctx.ui.notify()` for notifications (don't create new display mechanisms)
- Update widget using `updateImplWidget()` with the new action text
- Keep formatting logic separate from parsing logic for testability

**Implementation Strategy**:
- Option A: Add factory function to `agents.ts` (keeps progress logic centralized)
- Option B: Add factory function to `formatting.ts` (keeps UI formatting centralized)
- Recommended: Option A for cohesion with the callback infrastructure

**Files to Modify**:
- `extensions/spec-pipeline/agents.ts` OR `extensions/spec-pipeline/formatting.ts`: Add `createProgressCallback()` factory
- Factory signature: `(ctx: PipelineUIContext, state: ImplementationState, phaseInfo: string) => (toolName: string, args: any) => void`

**Testing Approach**:
- Unit test the factory with mock context to verify message formatting
- Test each tool type (read, write, edit, bash, grep, find) produces correct emoji
- Verify path truncation and command truncation work correctly

#### Phase 3: Integration

**Context**: Wire the progress callback into the three main agent invocation points: plan drafting, implementation, and tiered reviews.

**Key Considerations**:
- Plan drafting and implementation are straightforward: create callback and pass to `runAgentWithConfig()`
- Tiered reviews require threading the callback through the `runTieredReview()` context
- Phase information should be included in callback context for accurate notifications
- Review cycle numbers should be included (e.g., "📖 Reading auth.ts [Review Cycle 2]...")

**Files to Modify**:
- `extensions/spec-pipeline/implement-pipeline.ts`: Replace `undefined` with callback at lines ~359 (plan) and ~532 (implement)
- `extensions/spec-pipeline/review.ts`: Accept `onOutput` in context, thread to all `runAgentWithConfig()` calls

**Testing Approach**:
- Run `/implement` on a multi-phase spec and verify notifications appear during each phase
- Check that review cycles show appropriate phase/cycle information
- Verify widget updates in real-time as actions occur
- Confirm no regressions in error handling or pipeline flow

---

## Implementation Notes

### Emoji Mapping Reference

```typescript
const TOOL_EMOJI: Record<string, string> = {
  read: "📖",
  write: "✍️",
  edit: "✏️",
  bash: "⚙️",
  grep: "🔍",
  find: "🔎",
};
```

### Example Event Processing

```typescript
// In processLine() function:
if (event.type === "message_update") {
  const evt = event.assistantMessageEvent;
  
  // Existing text delta handling
  if (evt?.type === "text_delta") {
    output += evt.delta;
    onOutput?.(evt.delta);
  }
  
  // New toolcall handling
  if (evt?.type === "toolcall_end") {
    const toolName = evt.toolCall?.name;
    const toolArgs = evt.toolCall?.arguments;
    if (toolName && toolArgs) {
      onOutput?.({ type: "tool", name: toolName, arguments: toolArgs });
    }
  }
}
```

### Example Progress Callback

```typescript
function createProgressCallback(
  ctx: PipelineUIContext,
  state: ImplementationState,
  phaseLabel: string
) {
  return (data: any) => {
    // Handle legacy text deltas (ignore for now)
    if (typeof data === "string") return;
    
    // Handle tool events
    if (data.type === "tool") {
      const emoji = TOOL_EMOJI[data.name] || "🔧";
      let message = "";
      
      if (data.name === "read") {
        message = `${emoji} Reading ${data.arguments.path}`;
      } else if (data.name === "write") {
        message = `${emoji} Creating ${data.arguments.path}`;
      } else if (data.name === "edit") {
        message = `${emoji} Editing ${data.arguments.path}`;
      } else if (data.name === "bash") {
        const cmd = data.arguments.command || "";
        const truncated = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
        message = `${emoji} Running: ${truncated}`;
      }
      
      if (message) {
        ctx.ui.notify(`${message} [${phaseLabel}]`, "info");
        updateImplWidget(ctx, state, `${message} [${phaseLabel}]`);
      }
    }
  };
}
```

### Widget Context Updates

The widget already has infrastructure for `currentAction`:
```typescript
updateImplWidget(ctx, state, "📖 Reading src/auth.ts [Phase 2/3]");
```

This will display as:
```
🚀 Implement: 2602102308_impl...
────────────────────────────────────────
Stage: 🚀 Implementation
Phases: [██████░░] 6/8
────────────────────────────────────────
⏳ 📖 Reading src/auth.ts [Phase 2/3]
```

---

## Testing Strategy

### Manual Testing Scenarios

1. **Plan Drafting Visibility**:
   - Run `/implement` on a new spec
   - Verify notifications show files being read during plan exploration
   - Verify plan file write is notified

2. **Implementation Visibility**:
   - Verify file read operations during code exploration
   - Verify file write operations when creating new files
   - Verify file edit operations when modifying existing files
   - Verify bash commands (test execution) are shown

3. **Review Visibility**:
   - Verify review cycles show file reads
   - Verify fix applications show file edits
   - Verify cycle information appears in notifications

4. **Widget Updates**:
   - Verify widget shows current action in real-time
   - Verify phase information is included
   - Verify widget updates don't cause flicker or performance issues

5. **Error Handling**:
   - Run implementation that triggers an error
   - Verify progress notifications stop cleanly
   - Verify error messages are still displayed correctly

### Regression Testing

- Run existing test suite: `npm test`
- Verify all existing specs still implement successfully
- Check that `/implement-resume` works correctly
- Confirm error recovery and stashing still function

---

## Future Enhancements (Out of Scope)

### Throttling/Debouncing

If notification spam becomes an issue, implement smart throttling:
- Time-based: Max 1 notification per second for `read` operations
- Type-based: Always show `write`/`edit`, throttle `read`
- First/last: Always show first and last action in a burst

### Progress Statistics

Add aggregate statistics to widget:
- Files read: 23
- Files modified: 8
- Commands run: 3
- Time elapsed: 2m 34s

### Action Filtering

Allow users to configure which actions generate notifications:
```json
{
  "progressVisibility": {
    "showReads": false,
    "showWrites": true,
    "showEdits": true,
    "showBash": true
  }
}
```

### Detailed Logging

Create a detailed action log file for post-mortem analysis:
```
.pi/spec-pipeline/implementations/{id}/actions.log
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Notification spam overwhelming terminal | High | Accept in v1, add throttling if users complain |
| Performance impact from frequent widget updates | Medium | Widget updates are cheap (single setWidget call), monitor in testing |
| JSON parsing errors crashing subprocess | High | Wrap all JSON.parse in try-catch, ignore malformed events |
| Callback signature change breaking backward compatibility | Medium | Make onOutput accept union type (string \| object), handle both |
| Phase information not available in review context | Low | Thread phase info through runTieredReview context parameter |

---

## Success Metrics

**Visibility Improvements**:
- Users can identify which file the agent is analyzing at any moment
- Users can see code modifications as they happen
- Users understand what bash commands are being executed

**User Experience**:
- Users report reduced anxiety during long-running implementations
- Users can troubleshoot stuck agents by seeing last action
- Users perceive `/implement` as more transparent and trustworthy

**Technical Quality**:
- No increase in error rate or pipeline failures
- No performance degradation (< 5% slowdown)
- Zero crashes from event parsing errors
