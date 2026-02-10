# Phase 2: Create Progress Callback Factory

**Estimated Effort**: 1 day

## Overview

Create a factory function that generates progress callbacks for agent execution. The callbacks will:
- Format tool invocations into user-friendly messages with appropriate emoji
- Send notifications via `ctx.ui.notify()` for terminal visibility
- Update the pipeline widget in real-time with current action context
- Support phase/cycle information for contextual awareness

This phase builds on Phase 1's event parsing infrastructure by adding the display layer that makes tool actions visible to users.

## Prerequisites

- Phase 1 complete (event parsing in `runAgentWithConfig()` is implemented)
- Types `ToolEventData`, `TextEventData`, and `AgentOutputEvent` are defined
- Widget infrastructure (`updateImplWidget`, `updateSpecWidget`) exists in `formatting.ts`

## Implementation Strategy

**Location Decision**: Add the progress callback factory to `agents.ts` (Option A from spec).

**Rationale**:
- Keeps progress logic centralized with callback infrastructure
- The factory is closely tied to agent execution semantics
- Avoids circular dependencies (formatting.ts imports types, agents.ts uses the callback)
- Maintains cohesion: event parsing + callback creation in same file

## Steps

### Step 2.1: Define Tool Emoji Mapping

**Files**: `extensions/spec-pipeline/agents.ts`

**Action**: Add emoji constants at the top of the file, after imports and before function definitions.

**Code to Add** (after line 13, before the comment on line 14):

```typescript
// ============================================
// Progress Display Constants
// ============================================

/**
 * Emoji mapping for tool operations (R6)
 * Used by progress callbacks to format user-friendly notifications
 */
const TOOL_EMOJI: Record<string, string> = {
	read: "📖",
	write: "✍️",
	edit: "✏️",
	bash: "⚙️",
	grep: "🔍",
	find: "🔎",
};

/**
 * Default emoji for unknown tool types
 */
const DEFAULT_TOOL_EMOJI = "🔧";
```

**Verification**:
```bash
# Check that constants are defined
grep -A 10 "TOOL_EMOJI" extensions/spec-pipeline/agents.ts
```

**Pattern Reference**: Similar to existing constants `MODEL_IDENTIFIERS` (line 669 of types.ts), but exported directly in agents.ts for local use.

---

### Step 2.2: Create Progress Callback Factory Function

**Files**: `extensions/spec-pipeline/agents.ts`

**Action**: Add the factory function after the TOOL_EMOJI constants and before `runAgentWithConfig()`.

**Code to Add** (before `runAgentWithConfig` function, around line 30-35):

```typescript
// ============================================
// Progress Callback Factory
// ============================================

/**
 * Create a progress callback for agent execution (R5-R21)
 * 
 * The callback formats tool invocations into user-friendly messages and
 * updates both notifications and the pipeline widget in real-time.
 * 
 * @param ctx - UI context with notify and setWidget functions
 * @param state - Current implementation or spec state (for widget updates)
 * @param phaseInfo - Human-readable phase context (e.g., "Phase 2/3", "Review Cycle 1")
 * @param isImplPipeline - True for implementation widget, false for spec widget
 * @returns Callback function that handles AgentOutputEvent
 * 
 * @example
 * ```typescript
 * const callback = createProgressCallback(
 *   ctx,
 *   state,
 *   "Phase 2/3",
 *   true
 * );
 * await runAgentWithConfig(
 *   config, task, cwd, systemPrompt,
 *   undefined, callback, "implementer"
 * );
 * ```
 */
export function createProgressCallback(
	ctx: PipelineUIContext,
	state: ImplementationState | SpecState,
	phaseInfo: string,
	isImplPipeline: boolean = true
): (event: AgentOutputEvent) => void {
	return (event: AgentOutputEvent) => {
		// Handle legacy text deltas (ignore for progress display)
		if (typeof event === "string") {
			return;
		}
		
		// Handle structured text events (ignore for progress display)
		if (event.type === "text") {
			return;
		}
		
		// Handle tool invocation events (R2, R3, R4)
		if (event.type === "tool") {
			const emoji = TOOL_EMOJI[event.name] || DEFAULT_TOOL_EMOJI;
			let message = "";
			
			// Format message based on tool type (R7)
			if (event.name === "read" && event.arguments?.path) {
				// Read: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Reading ${path}`;
			} else if (event.name === "write" && event.arguments?.path) {
				// Write: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Creating ${path}`;
			} else if (event.name === "edit" && event.arguments?.path) {
				// Edit: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Editing ${path}`;
			} else if (event.name === "bash" && event.arguments?.command) {
				// Bash: show truncated command (R7, R9)
				const cmd = event.arguments.command;
				const truncated = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
				message = `${emoji} Running: ${truncated}`;
			} else if (event.name === "grep" && event.arguments?.pattern) {
				// Grep: show pattern and optional path (R7)
				const pattern = event.arguments.pattern;
				const pathPart = event.arguments.path ? ` in ${formatPath(event.arguments.path)}` : "";
				message = `${emoji} Searching ${pattern}${pathPart}`;
			} else if (event.name === "find" && event.arguments?.pattern) {
				// Find: show pattern (R7)
				const pattern = event.arguments.pattern;
				message = `${emoji} Finding ${pattern}`;
			}
			
			// If we successfully formatted a message, send notifications (R10, R11)
			if (message) {
				// Add phase context (R21)
				const contextualMessage = `${message} [${phaseInfo}]`;
				
				// Send notification (R10, R11)
				ctx.ui.notify(contextualMessage, "info");
				
				// Update widget with current action (R13, R14, R15)
				if (isImplPipeline) {
					updateImplWidget(ctx as any, state as ImplementationState, contextualMessage);
				} else {
					updateSpecWidget(ctx as any, state as SpecState, contextualMessage);
				}
			}
		}
	};
}

/**
 * Format file path for display (R8)
 * Strips leading ./ and returns relative path
 */
function formatPath(path: string): string {
	if (path.startsWith("./")) {
		return path.slice(2);
	}
	return path;
}
```

**Verification**:
```bash
# Check function exists
grep -A 5 "export function createProgressCallback" extensions/spec-pipeline/agents.ts

# Check it imports the required types
grep "import.*PipelineUIContext" extensions/spec-pipeline/agents.ts
grep "import.*ImplementationState" extensions/spec-pipeline/agents.ts
grep "import.*SpecState" extensions/spec-pipeline/agents.ts
```

**Pattern Reference**:
- Based on callback pattern from `review.ts:126` (`onOutput?: (text: string) => void`)
- Widget update pattern from `formatting.ts:674-696` (`updateImplWidget`)
- Notification pattern from existing code: `ctx.ui.notify(message, "info")`

---

### Step 2.3: Add Required Imports

**Files**: `extensions/spec-pipeline/agents.ts`

**Action**: Add missing type imports at the top of the file.

**Before** (current imports, lines 8-12):
```typescript
import type {
	ModelConfig,
	AgentName,
	AgentResult,
	AgentOutputEvent,
	ToolEventData,
} from "./types.ts";
```

**After**:
```typescript
import type {
	ModelConfig,
	AgentName,
	AgentResult,
	AgentOutputEvent,
	ToolEventData,
	PipelineUIContext,
	ImplementationState,
	SpecState,
} from "./types.ts";
import { updateImplWidget, updateSpecWidget } from "./formatting.ts";
```

**Verification**:
```bash
# Check imports are present
grep "PipelineUIContext" extensions/spec-pipeline/agents.ts
grep "updateImplWidget" extensions/spec-pipeline/agents.ts

# Verify no circular dependency issues
npm test -- agents.test.ts
```

---

### Step 2.4: Update Type Exports

**Files**: `extensions/spec-pipeline/agents.ts`

**Action**: Export the new factory function so it can be used by other modules.

**Note**: The function is already exported with `export function createProgressCallback` in Step 2.2, so no additional changes needed. This step is just verification.

**Verification**:
```bash
# Verify export is accessible
grep "export function createProgressCallback" extensions/spec-pipeline/agents.ts

# Check that it can be imported in tests
echo "import { createProgressCallback } from './agents.ts';" | node --input-type=module --eval "console.log('Import successful')" 2>&1
```

---

### Step 2.5: Add Unit Tests

**Files**: `extensions/spec-pipeline/agents.test.ts`

**Action**: Add comprehensive tests for the progress callback factory.

**Code to Add** (at the end of the file):

```typescript
describe("createProgressCallback", () => {
	it("formats read tool events correctly", () => {
		const notifications: string[] = [];
		const widgets: Array<{ id: string; content: string[] | undefined }> = [];
		
		const ctx: any = {
			ui: {
				notify: (msg: string, type: string) => notifications.push(msg),
				setWidget: (id: string, content: string[] | undefined) => 
					widgets.push({ id, content }),
			},
		};
		
		const state: any = {
			id: "test_impl",
			phases: ["Phase 1", "Phase 2"],
			currentPhaseIndex: 0,
			stage: "implementation",
		};
		
		const callback = createProgressCallback(ctx, state, "Phase 1/2", true);
		
		// Invoke with read tool event
		callback({
			type: "tool",
			name: "read",
			arguments: { path: "./src/auth.ts" },
		});
		
		// Verify notification was sent
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toBe("📖 Reading src/auth.ts [Phase 1/2]");
		
		// Verify widget was updated
		expect(widgets).toHaveLength(1);
		expect(widgets[0].content).toBeDefined();
		expect(widgets[0].content?.join("\n")).toContain("📖 Reading src/auth.ts");
	});
	
	it("formats write tool events correctly", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 2", true);
		callback({
			type: "tool",
			name: "write",
			arguments: { path: "src/new-file.ts" },
		});
		
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("✍️ Creating src/new-file.ts");
		expect(notifications[0]).toContain("[Phase 2]");
	});
	
	it("formats edit tool events correctly", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Review Cycle 1", true);
		callback({
			type: "tool",
			name: "edit",
			arguments: { path: "./lib/utils.ts" },
		});
		
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toBe("✏️ Editing lib/utils.ts [Review Cycle 1]");
	});
	
	it("truncates long bash commands", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 3", true);
		const longCommand = "npm test -- --watch --coverage --reporters=verbose --maxWorkers=4 --bail";
		
		callback({
			type: "tool",
			name: "bash",
			arguments: { command: longCommand },
		});
		
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("⚙️ Running:");
		expect(notifications[0]).toContain("...");
		expect(notifications[0].length).toBeLessThan(120); // Truncated message
	});
	
	it("handles grep tool events", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 1", true);
		callback({
			type: "tool",
			name: "grep",
			arguments: { pattern: "interface.*User", path: "src/" },
		});
		
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("🔍 Searching interface.*User in src/");
	});
	
	it("handles find tool events", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 2", true);
		callback({
			type: "tool",
			name: "find",
			arguments: { pattern: "*.test.ts" },
		});
		
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toBe("🔎 Finding *.test.ts [Phase 2]");
	});
	
	it("ignores text delta events (backward compatibility)", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 1", true);
		
		// Legacy string event
		callback("some text output");
		expect(notifications).toHaveLength(0);
		
		// Structured text event
		callback({ type: "text", delta: "more output" });
		expect(notifications).toHaveLength(0);
	});
	
	it("handles unknown tool types with default emoji", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 1", true);
		callback({
			type: "tool",
			name: "unknown_tool",
			arguments: { some: "arg" },
		});
		
		// Unknown tools without specific formatting should not generate notifications
		expect(notifications).toHaveLength(0);
	});
	
	it("uses spec widget for non-implementation pipelines", () => {
		const widgets: Array<{ id: string; content: string[] | undefined }> = [];
		const ctx: any = {
			ui: {
				notify: () => {},
				setWidget: (id: string, content: string[] | undefined) => 
					widgets.push({ id, content }),
			},
		};
		
		const state: any = {
			id: "spec_123",
			stage: "spec_drafting",
			specFilename: "test.md",
		};
		
		const callback = createProgressCallback(ctx, state, "Drafting", false);
		callback({
			type: "tool",
			name: "read",
			arguments: { path: "README.md" },
		});
		
		// Should call updateSpecWidget instead of updateImplWidget
		expect(widgets).toHaveLength(1);
		// Spec widget has different format (no phases progress bar)
		const widgetContent = widgets[0].content?.join("\n") || "";
		expect(widgetContent).toContain("📋 Spec:");
	});
	
	it("strips leading ./ from paths", () => {
		const notifications: string[] = [];
		const ctx: any = {
			ui: { notify: (msg: string) => notifications.push(msg), setWidget: () => {} },
		};
		const state: any = { id: "test", phases: [], currentPhaseIndex: 0, stage: "implementation" };
		
		const callback = createProgressCallback(ctx, state, "Phase 1", true);
		callback({
			type: "tool",
			name: "read",
			arguments: { path: "./src/nested/file.ts" },
		});
		
		expect(notifications[0]).toBe("📖 Reading src/nested/file.ts [Phase 1]");
		expect(notifications[0]).not.toContain("./src");
	});
});
```

**Verification**:
```bash
# Run the new tests
npm test -- agents.test.ts

# Verify all tests pass
npm test
```

**Pattern Reference**: Based on existing test patterns in `agents.test.ts` and `formatting.test.ts` - using mock objects for UI context and state.

---

## Files Summary

### New Files

None - all changes are additions to existing files.

### Modified Files

| File | Changes |
|------|---------|
| `agents.ts` | Add TOOL_EMOJI constants, createProgressCallback factory, formatPath helper, and imports |
| `agents.test.ts` | Add comprehensive test suite for createProgressCallback function |

## Completion Checklist

- [ ] Step 2.1: TOOL_EMOJI constants added to agents.ts
- [ ] Step 2.2: createProgressCallback factory function implemented
- [ ] Step 2.3: Required imports added (PipelineUIContext, ImplementationState, SpecState, updateImplWidget, updateSpecWidget)
- [ ] Step 2.4: Factory function is exported (verified)
- [ ] Step 2.5: Unit tests added and passing
- [ ] All existing tests still pass (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] Code follows project style (matches existing patterns in agents.ts)

## Testing Verification

After implementation, verify:

1. **Factory Function Works**:
   ```bash
   npm test -- agents.test.ts
   ```

2. **All Tests Pass**:
   ```bash
   npm test
   ```

3. **TypeScript Compilation**:
   ```bash
   npx tsc --noEmit
   ```

4. **Manual Verification** (optional, for Phase 3 integration):
   ```typescript
   // Create a callback
   const callback = createProgressCallback(ctx, state, "Phase 1/2", true);
   
   // Simulate tool event
   callback({
     type: "tool",
     name: "read",
     arguments: { path: "./src/auth.ts" }
   });
   
   // Should see notification and widget update
   ```

## Integration Notes for Phase 3

The callback factory is now ready to be wired into the pipeline:

1. **Plan Drafting** (`implement-pipeline.ts:359`):
   ```typescript
   const progressCallback = createProgressCallback(ctx, state, `Phase ${phaseIdx + 1}`, true);
   await runAgentWithConfig(
     planDrafterConfig, planTask, cwd, 
     SYSTEM_PROMPTS.planDrafter,
     undefined,
     progressCallback,  // ← Replace undefined with callback
     "planDrafter"
   );
   ```

2. **Implementation** (`implement-pipeline.ts:532`):
   ```typescript
   const progressCallback = createProgressCallback(ctx, state, `Phase ${phaseIdx + 1}`, true);
   await runAgentWithConfig(
     implementerConfig, implementTask, cwd,
     SYSTEM_PROMPTS.implementer,
     undefined,
     progressCallback,  // ← Replace undefined with callback
     "implementer"
   );
   ```

3. **Tiered Reviews** (via `review.ts` context):
   - The callback will be passed through `ReviewContext.onOutput`
   - Phase 3 will modify `runTieredReview()` signature to accept phase info
   - Then create and thread the callback through all review calls

## Known Limitations

1. **No Throttling**: All tool events generate notifications (R11, R12). If this becomes noisy, throttling can be added in a future enhancement.

2. **No Filtering**: All tool types shown. Could add config to filter specific tool types (e.g., hide `read` operations).

3. **Simple Path Formatting**: Only strips `./` prefix. Could add more sophisticated path shortening (e.g., show `.../.../file.ts` for deeply nested paths).

4. **Widget Updates Per Tool**: Widget updates on every tool invocation. Performance impact should be minimal since `setWidget` is designed for frequent updates.

These limitations are intentional for the initial implementation and align with the spec's "Out of Scope" section.
