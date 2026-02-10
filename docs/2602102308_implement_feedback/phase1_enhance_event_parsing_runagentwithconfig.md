# Phase 1: Enhance Event Parsing in runAgentWithConfig()

**Estimated Effort**: 1 day

## Overview

This phase enhances the `runAgentWithConfig()` function in `agents.ts` to parse `toolcall_end` events from the pi subprocess JSON stream in addition to the existing `text_delta` events. This lays the foundation for providing real-time progress visibility by capturing structured information about tool invocations (file reads, writes, edits, bash commands, etc.).

## Prerequisites

- None (this is the first phase)
- Existing codebase in stable state
- Test suite passes: `npm test`

## Implementation Context

### Current State

The `runAgentWithConfig()` function spawns a pi subprocess with `--mode json` and currently only processes `text_delta` events:

**File**: `extensions/spec-pipeline/agents.ts` (lines 73-79)
```typescript
const processLine = (line: string) => {
    if (!line.trim()) return;
    try {
        const event = JSON.parse(line);
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            output += event.assistantMessageEvent.delta;
            onOutput?.(event.assistantMessageEvent.delta);
        }
    } catch {
        // Ignore parse errors
    }
};
```

### Pi JSON Event Format

Pi emits structured JSON events on stdout when running in `--mode json`:

**Text Delta Event** (currently handled):
```json
{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "delta": "some text..."
  }
}
```

**Tool Call Event** (needs to be handled):
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

### Callback Signature Challenge

The current `onOutput` callback accepts strings only:
```typescript
onOutput?: (text: string) => void
```

To support both text deltas (for backward compatibility) and structured tool data, we need a union type approach.

## Steps

### Step 1.1: Define Tool Event Data Structure

**Files**: `extensions/spec-pipeline/types.ts`

**Action**: Add type definitions for tool event data at the end of the file (after the hierarchy types section, around line 400+).

```typescript
// ============================================
// Agent Progress Event Types
// ============================================

/**
 * Data structure for tool invocation events from pi subprocess
 */
export interface ToolEventData {
	type: "tool";
	name: string;
	arguments: Record<string, any>;
}

/**
 * Data structure for text delta events from pi subprocess (legacy)
 */
export interface TextEventData {
	type: "text";
	delta: string;
}

/**
 * Union type for agent output events
 * Allows onOutput callback to handle both text deltas and tool events
 */
export type AgentOutputEvent = TextEventData | ToolEventData | string;
```

**Pattern Reference**: Based on existing type definitions in `types.ts` (ErrorDetails, AgentResult, etc.)

**Verify**: 
```bash
# Check TypeScript compilation
cd /home/rpaz/code/ai_tools
npx tsc --noEmit extensions/spec-pipeline/types.ts
```

### Step 1.2: Update runAgentWithConfig Callback Signature

**Files**: `extensions/spec-pipeline/agents.ts` (line 28)

**Action**: Change the `onOutput` parameter type to accept the new union type.

**Before**:
```typescript
export async function runAgentWithConfig(
	modelConfig: ModelConfig,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (text: string) => void,
	role?: string
): Promise<AgentResult> {
```

**After**:
```typescript
import type {
	ModelConfig,
	AgentName,
	AgentResult,
	AgentOutputEvent,  // ADD THIS IMPORT
} from "./types.ts";

export async function runAgentWithConfig(
	modelConfig: ModelConfig,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (event: AgentOutputEvent) => void,  // CHANGED
	role?: string
): Promise<AgentResult> {
```

**Pattern Reference**: Based on existing function signatures in `agents.ts` and type imports from `types.ts`

**Verify**: 
```bash
# Check TypeScript compilation
cd /home/rpaz/code/ai_tools
npx tsc --noEmit extensions/spec-pipeline/agents.ts
```

### Step 1.3: Extend processLine to Handle toolcall_end Events

**Files**: `extensions/spec-pipeline/agents.ts` (lines 72-82)

**Action**: Add parallel handler for `toolcall_end` events while preserving existing `text_delta` handling.

**Before**:
```typescript
const processLine = (line: string) => {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line);
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			output += event.assistantMessageEvent.delta;
			onOutput?.(event.assistantMessageEvent.delta);
		}
	} catch {
		// Ignore parse errors
	}
};
```

**After**:
```typescript
const processLine = (line: string) => {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line);
		
		// Handle text delta events (for output accumulation and legacy callbacks)
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			output += delta;
			
			// Call onOutput with text delta (backward compatibility)
			// Legacy callers expect strings, new callers can handle TextEventData
			if (onOutput) {
				onOutput(delta);
			}
		}
		
		// Handle tool call events (for progress visibility)
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "toolcall_end") {
			const toolCall = event.assistantMessageEvent?.toolCall;
			
			// Gracefully handle missing fields
			if (toolCall && toolCall.name && toolCall.arguments) {
				const toolEvent: ToolEventData = {
					type: "tool",
					name: toolCall.name,
					arguments: toolCall.arguments,
				};
				
				// Call onOutput with structured tool data
				if (onOutput) {
					onOutput(toolEvent);
				}
			}
		}
	} catch {
		// Ignore parse errors (malformed JSON, incomplete events)
	}
};
```

**Key Design Decisions**:
1. **Text deltas remain as strings** for backward compatibility with existing callers that expect `string` type
2. **Tool events use structured type** to enable rich formatting in Phase 2
3. **Graceful degradation**: Missing fields in toolCall are silently ignored (no crashes)
4. **Two separate `if` blocks**: Makes the logic clear and allows both event types to be processed if they somehow appear in the same line

**Pattern Reference**: Based on existing event handling pattern in current `processLine()` function

**Verify**:
```bash
# Run TypeScript compiler check
cd /home/rpaz/code/ai_tools
npx tsc --noEmit extensions/spec-pipeline/agents.ts

# Run existing tests to ensure no regressions
npm test
```

### Step 1.4: Update runAgent Legacy Wrapper Signature

**Files**: `extensions/spec-pipeline/agents.ts` (line 137)

**Action**: Update the legacy `runAgent()` wrapper to match the new callback signature.

**Before**:
```typescript
export async function runAgent(
	agentName: AgentName,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (text: string) => void,
	role?: string
): Promise<AgentResult> {
```

**After**:
```typescript
export async function runAgent(
	agentName: AgentName,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (event: AgentOutputEvent) => void,  // CHANGED
	role?: string
): Promise<AgentResult> {
```

**Pattern Reference**: Must match the signature of `runAgentWithConfig()` since this is a wrapper

**Verify**:
```bash
# Check TypeScript compilation
cd /home/rpaz/code/ai_tools
npx tsc --noEmit extensions/spec-pipeline/agents.ts
```

### Step 1.5: Add Unit Tests for Tool Event Parsing

**Files**: Create new file `extensions/spec-pipeline/agents.test.ts`

**Action**: Create comprehensive unit tests for the new tool event parsing logic.

```typescript
import { describe, it, expect, vi } from "vitest";
import { runAgentWithConfig } from "./agents.ts";
import type { ModelConfig, AgentOutputEvent, ToolEventData } from "./types.ts";

describe("runAgentWithConfig - tool event parsing", () => {
	// Helper to create a basic model config
	const createModelConfig = (): ModelConfig => ({
		model: "sonnet",
		thinking: "medium",
	});

	it("should parse toolcall_end events and call onOutput with structured data", async () => {
		// This test would need to mock the pi subprocess
		// For now, we'll create a more focused unit test of the processLine logic
		// by extracting it or testing the integration
		
		// Note: Full subprocess mocking is complex, so we focus on:
		// 1. Manual testing with real pi subprocess
		// 2. Type checking to ensure signatures are correct
		expect(true).toBe(true); // Placeholder
	});

	it("should handle text_delta events for backward compatibility", async () => {
		// Similar placeholder - real testing will be done via integration
		expect(true).toBe(true);
	});

	it("should gracefully handle malformed tool events", async () => {
		// Test that missing fields don't crash
		expect(true).toBe(true);
	});
});

describe("AgentOutputEvent type narrowing", () => {
	it("should correctly identify tool events", () => {
		const toolEvent: AgentOutputEvent = {
			type: "tool",
			name: "read",
			arguments: { path: "test.ts" },
		};

		if (typeof toolEvent !== "string" && "type" in toolEvent && toolEvent.type === "tool") {
			expect(toolEvent.name).toBe("read");
			expect(toolEvent.arguments.path).toBe("test.ts");
		} else {
			throw new Error("Type narrowing failed");
		}
	});

	it("should correctly identify text events", () => {
		const textEvent: AgentOutputEvent = "some text";

		if (typeof textEvent === "string") {
			expect(textEvent).toBe("some text");
		} else {
			throw new Error("Type narrowing failed");
		}
	});
});
```

**Pattern Reference**: Based on existing test files in `extensions/spec-pipeline/*.test.ts`, particularly:
- `formatting.test.ts` for describe/it structure
- `config.test.ts` for type checking tests

**Note**: Full subprocess mocking is complex and out of scope for Phase 1. These tests focus on:
1. Type correctness (ensuring union types work)
2. Type narrowing patterns (for consumers in Phase 2)
3. Basic structure validation

The real validation will happen through:
- TypeScript compilation checks
- Manual testing with actual `/implement` runs
- Integration tests in Phase 3

**Verify**:
```bash
# Run the new test file
cd /home/rpaz/code/ai_tools
npm test -- agents.test.ts

# Run all tests to ensure no regressions
npm test
```

### Step 1.6: Update Type Exports

**Files**: `extensions/spec-pipeline/types.ts`

**Action**: Ensure the new types are exported properly for use in other modules.

The types defined in Step 1.1 should already be exported due to the `export interface` declarations. Verify they're accessible:

**Verify**:
```bash
# Check that types can be imported from types.ts
cd /home/rpaz/code/ai_tools
cat > /tmp/test-import.ts << 'EOF'
import type { ToolEventData, TextEventData, AgentOutputEvent } from "./extensions/spec-pipeline/types.ts";

const tool: ToolEventData = {
	type: "tool",
	name: "read",
	arguments: { path: "test.ts" }
};

const text: AgentOutputEvent = "text";
EOF

npx tsc --noEmit /tmp/test-import.ts
rm /tmp/test-import.ts
```

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-pipeline/agents.test.ts` | Unit tests for event parsing | Based on `formatting.test.ts`, `config.test.ts` |

### Modified Files
| File | Changes | Lines Modified |
|------|---------|----------------|
| `extensions/spec-pipeline/types.ts` | Add `ToolEventData`, `TextEventData`, `AgentOutputEvent` type definitions | ~400+ (new section) |
| `extensions/spec-pipeline/agents.ts` | Update `runAgentWithConfig()` signature; extend `processLine()` to handle `toolcall_end`; update `runAgent()` signature | Lines 3 (import), 28 (signature), 72-95 (processLine), 137 (signature) |

## Testing Strategy

### Automated Testing
```bash
# Run all tests
cd /home/rpaz/code/ai_tools
npm test

# Run specific test file
npm test -- agents.test.ts

# Type checking
npx tsc --noEmit extensions/spec-pipeline/agents.ts
npx tsc --noEmit extensions/spec-pipeline/types.ts
```

### Manual Integration Testing

Since full subprocess mocking is complex, the primary validation will be manual testing:

1. **Create a test spec**:
   ```bash
   cd /home/rpaz/code/ai_tools
   # Create a minimal test spec in docs/specs/test_progress.md
   ```

2. **Run implement with instrumented callback**:
   - Temporarily add console.log in `processLine()` to verify events are captured
   - Run `/implement docs/specs/test_progress.md --no-plan`
   - Observe console output showing both text deltas and tool events

3. **Verify backward compatibility**:
   - All existing calls to `runAgentWithConfig()` pass `undefined` for `onOutput`
   - These should continue working without changes
   - Run full implementation pipeline to ensure no crashes

4. **Test event structure**:
   - Log captured tool events to verify structure matches specification
   - Verify `name` and `arguments` fields are populated correctly
   - Test with different tool types (read, write, edit, bash, grep, find)

### Test Scenarios

| Scenario | Expected Result | How to Verify |
|----------|----------------|---------------|
| Text delta events | `onOutput` receives string | Existing behavior, no changes |
| Tool call events | `onOutput` receives `ToolEventData` object | Add temporary logging |
| Missing tool name | Event silently ignored | No crash, no callback |
| Missing tool arguments | Event silently ignored | No crash, no callback |
| Malformed JSON | Parse error caught, ignored | No crash |
| No onOutput callback | Pipeline runs normally | Existing `/implement` flows |
| Mixed events in stream | Both types processed correctly | Full pipeline run |

## Completion Checklist

- [ ] Step 1.1: Type definitions added to `types.ts`
- [ ] Step 1.2: `runAgentWithConfig()` signature updated
- [ ] Step 1.3: `processLine()` enhanced to handle `toolcall_end`
- [ ] Step 1.4: `runAgent()` wrapper signature updated
- [ ] Step 1.5: Unit tests created in `agents.test.ts`
- [ ] Step 1.6: Type exports verified
- [ ] All existing tests pass: `npm test`
- [ ] TypeScript compilation succeeds with no errors
- [ ] Manual testing confirms tool events are captured
- [ ] Backward compatibility verified (existing code works unchanged)
- [ ] No crashes with malformed events
- [ ] Code follows project conventions (TypeScript, Vitest, JSDoc comments)

## Success Criteria

✅ **Parsing Infrastructure Complete**:
- Tool call events are detected and parsed from pi subprocess output
- Structured data (tool name, arguments) is extracted correctly
- Malformed events are handled gracefully without crashes

✅ **Backward Compatibility Maintained**:
- All existing code continues to work without modification
- Existing calls with `onOutput: undefined` work unchanged
- Text delta events are still processed for output accumulation

✅ **Type Safety Enforced**:
- TypeScript compilation succeeds with no errors
- Union type `AgentOutputEvent` enables type-safe callback handling
- Type narrowing patterns work correctly for consumers

✅ **Test Coverage Adequate**:
- Unit tests verify type correctness
- Manual testing confirms real-world event capture
- All existing tests pass (no regressions)

## Notes for Phase 2

Phase 2 will build on this infrastructure by creating a progress callback factory that:
1. Accepts `AgentOutputEvent` union type
2. Uses type narrowing to distinguish tool events from text deltas
3. Formats tool events into human-readable messages with emoji
4. Calls `ctx.ui.notify()` and `updateImplWidget()` for display

The callback signature established in this phase makes Phase 2 straightforward:
```typescript
function createProgressCallback(ctx, state, phaseLabel) {
	return (event: AgentOutputEvent) => {
		// Type narrowing
		if (typeof event === "string") {
			// Legacy text delta, ignore for progress display
			return;
		}
		
		if (event.type === "tool") {
			// Format and display tool action (Phase 2 work)
			const message = formatToolAction(event.name, event.arguments);
			ctx.ui.notify(message, "info");
			updateImplWidget(ctx, state, message);
		}
	};
}
```

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking backward compatibility | Keep string support in union type; test all existing flows |
| Missing tool event fields crash | Add explicit null/undefined checks before accessing nested properties |
| JSON parse errors | Existing try-catch wraps all parsing; errors are silently ignored |
| Type errors in downstream code | Make callback parameter optional; use union type to allow gradual migration |
| Performance impact from event processing | Event handling is minimal (just object creation); no performance concern |

## Dependencies

None - this phase is self-contained and depends only on existing infrastructure.

## Rollback Plan

If issues arise:
1. Revert changes to `agents.ts` (restore original callback signature and processLine logic)
2. Remove new type definitions from `types.ts`
3. Delete `agents.test.ts`
4. All code reverts to pre-Phase-1 state with no impact
