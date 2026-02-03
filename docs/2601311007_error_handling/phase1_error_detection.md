# Phase 1: Fix Critical Bugs and Add Error Detection

**Estimated Effort**: 1.5 days

## Overview

This phase addresses the critical error handling gaps in the spec-pipeline extension. The primary goals are:

1. Fix the missing `return` statement after implementer failure (critical bug)
2. Add exit code checking for code reviewer and address review agent calls
3. Add exit code checking for plan reviewer agent calls
4. Extend `PipelineState` interface with structured `ErrorDetails`
5. Create error classification helper function
6. Persist the agent task in error state for exact retry capability
7. Write error details to log file for debugging

## Prerequisites

- None (this is the first phase)

## Important Notes

- **Line numbers are approximate**: Always use pattern matching to find the correct location. Search for the specific code patterns shown in each step.
- **In-progress pipelines**: Pipelines currently in the `implementation` stage will benefit from these fixes on their next cycle or `/spec-resume` call.
- **Error log files**: The `.pi/spec-pipeline/{id}.error.log` file is intentionally preserved after cancellation/completion for debugging history.
- **Rollback**: If this phase is partially implemented and needs reversion, use `git stash` or `git checkout` on the single modified file (`extensions/spec-pipeline/index.ts`).

## Steps

### Step 1.1: Add Type Definitions for ErrorDetails

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `interface AgentResult` (around line 61)
- **Pattern Reference**: Based on existing `PipelineState` interface (search for `interface PipelineState`)
- **Action**: Add new type definitions after the existing `AgentResult` interface

```typescript
// Before (find "interface AgentResult"):
interface AgentResult {
	output: string;
	exitCode: number;
	error?: string;
}

// After:
interface AgentResult {
	output: string;
	exitCode: number;
	error?: string;
}

// Error handling types
type ErrorType = "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "VALIDATION" | "UNKNOWN";
type RoleName = 
	| "discoveryAgent"
	| "specDrafter"
	| "specReviewer"
	| "planDrafter"
	| "planReviewer"
	| "implementer"
	| "codeReviewer"
	| "addressReview"
	| "commitMessageWriter";

interface ErrorDetails {
	timestamp: string;           // ISO timestamp of error
	agent: AgentName;            // Which agent failed (reuses existing AgentName type)
	role: RoleName;              // Which role was executing
	phase?: number;              // Phase index (1-indexed, if in implementation stage)
	cycle?: number;              // Review cycle (1-indexed, if in implementation stage)
	exitCode: number;            // Subprocess exit code
	stderr?: string;             // Error output from subprocess (truncated to 2000 chars)
	errorType: ErrorType;        // Classified error type
	agentTask: string;           // The exact task prompt sent to the agent
}
```

- **Verify**: Load extension in pi (`pi --help` or start a session) to verify it compiles

### Step 1.2: Extend PipelineState Interface

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `interface PipelineState` and find the `lastError?: string;` field near the end
- **Pattern Reference**: Existing `PipelineState` interface
- **Action**: Modify `lastError` from `string` to `ErrorDetails` and add new fields for Phase 2 preparation

```typescript
// Before (find "lastError?: string" near end of PipelineState):
	// Error tracking
	lastError?: string;
}

// After:
	// Error tracking (enhanced for Phase 2)
	lastError?: ErrorDetails;          // Structured error details (replaces string)
	
	// Placeholders for Phase 2 git integration
	originalBranch?: string;           // Branch name before pipeline started
	pipelineBranch?: string;           // Generated branch name for this pipeline
	checkpoints?: string[];            // Array of checkpoint commit hashes
	errorStash?: string;               // Stash reference if error occurred
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.3: Create Error Classification Helper Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `async function createCommit` and add after it
- **Pattern Reference**: Follow pattern of existing helper functions like `generateSpecTimestamp()`
- **Action**: Add new helper functions after `createCommit()` function

```typescript
// Add after the createCommit() function (search for "async function createCommit"):

/**
 * Classify error type from stderr output
 */
function classifyError(stderr: string | undefined): ErrorType {
	if (!stderr) return "UNKNOWN";
	
	const lowerStderr = stderr.toLowerCase();
	
	// Rate limit detection (HTTP 429 or rate limit text)
	if (
		lowerStderr.includes("429") ||
		lowerStderr.includes("rate limit") ||
		lowerStderr.includes("rate_limit") ||
		lowerStderr.includes("ratelimit") ||
		lowerStderr.includes("too many requests")
	) {
		return "RATE_LIMIT";
	}
	
	// Timeout detection
	if (
		lowerStderr.includes("timeout") ||
		lowerStderr.includes("timed out") ||
		lowerStderr.includes("etimedout")
	) {
		return "TIMEOUT";
	}
	
	// Network error detection
	if (
		lowerStderr.includes("econnrefused") ||
		lowerStderr.includes("enotfound") ||
		lowerStderr.includes("network") ||
		lowerStderr.includes("connection") ||
		lowerStderr.includes("socket") ||
		lowerStderr.includes("dns")
	) {
		return "NETWORK";
	}
	
	// Validation error detection
	if (
		lowerStderr.includes("invalid") ||
		lowerStderr.includes("validation") ||
		lowerStderr.includes("malformed") ||
		lowerStderr.includes("parse error")
	) {
		return "VALIDATION";
	}
	
	return "UNKNOWN";
}

/**
 * Truncate string to specified length, adding ellipsis if truncated
 */
function truncateString(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return str.slice(0, maxLength - 3) + "...";
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.4: Create Error Log File Writer

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `truncateString()` function from Step 1.3
- **Pattern Reference**: Follow pattern of `saveState()` function (search for `function saveState`)
- **Action**: Add error log writer function

```typescript
/**
 * Append error details to the error log file.
 * This file is intentionally preserved (not cleaned up) for debugging history.
 */
function appendErrorLog(cwd: string, pipelineId: string, error: ErrorDetails): void {
	const stateDir = getStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}
	
	const logPath = path.join(stateDir, `${pipelineId}.error.log`);
	
	const logEntry = `
================================================================================
ERROR LOG ENTRY - ${error.timestamp}
================================================================================
Agent: ${error.agent}
Role: ${error.role}
Error Type: ${error.errorType}
Exit Code: ${error.exitCode}
${error.phase !== undefined ? `Phase: ${error.phase}` : ""}
${error.cycle !== undefined ? `Cycle: ${error.cycle}` : ""}

--- STDERR ---
${error.stderr || "(no stderr output)"}

--- AGENT TASK ---
${error.agentTask}
================================================================================

`;
	
	fs.appendFileSync(logPath, logEntry, "utf-8");
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.5: Create Centralized Error Handler Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `appendErrorLog()` function from Step 1.4
- **Pattern Reference**: Based on existing error handling patterns scattered throughout
- **Action**: Add centralized error handler

```typescript
/**
 * Get actionable suggestion based on error type
 */
function getErrorSuggestion(errorType: ErrorType): string {
	switch (errorType) {
		case "RATE_LIMIT":
			return "Wait a few minutes for rate limits to reset, then run `/spec-resume` to retry";
		case "TIMEOUT":
			return "Check your network connection, then run `/spec-resume` to retry";
		case "NETWORK":
			return "Check your network connection, then run `/spec-resume` to retry";
		case "VALIDATION":
			return "Review the error details above. You may need to manually fix issues before resuming.";
		case "UNKNOWN":
		default:
			return "Check error details in the log file, then run `/spec-resume` to retry";
	}
}

/**
 * Handle agent error - save state, log error, notify user
 * Returns the ErrorDetails object for the caller to use
 */
function handleAgentError(
	cwd: string,
	state: PipelineState,
	result: AgentResult,
	agent: AgentName,
	role: RoleName,
	task: string,
	phase: number | undefined,
	cycle: number | undefined,
	notify: (msg: string, type: "info" | "error" | "success" | "warning") => void
): ErrorDetails {
	const errorDetails: ErrorDetails = {
		timestamp: new Date().toISOString(),
		agent,
		role,
		phase,
		cycle,
		exitCode: result.exitCode,
		stderr: truncateString(result.error || "", 2000),
		errorType: classifyError(result.error),
		agentTask: task,
	};
	
	// Save to state
	state.lastError = errorDetails;
	saveState(cwd, state);
	
	// Append to error log
	appendErrorLog(cwd, state.id, errorDetails);
	
	// Format user notification
	const phaseInfo = phase !== undefined ? ` (Phase ${phase}${cycle !== undefined ? `, Cycle ${cycle}` : ""})` : "";
	const errorMessage = `${role} failed${phaseInfo}: ${errorDetails.errorType}`;
	const stderrPreview = errorDetails.stderr ? `\n${truncateString(errorDetails.stderr, 500)}` : "";
	const suggestion = `\n\n💡 ${getErrorSuggestion(errorDetails.errorType)}`;
	const logInfo = `\n📁 Full error log: .pi/spec-pipeline/${state.id}.error.log`;
	
	notify(errorMessage + stderrPreview + suggestion + logInfo, "error");
	
	return errorDetails;
}
```

- **Note**: `notify` parameter is required (not optional) since `ctx.ui.notify` is always available in the extension API
- **Verify**: Load extension in pi to verify it compiles

### Step 1.6: Migrate State Loading for Backward Compatibility

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function loadState` and then find the comment `// Save the migrated state back to disk`
- **Pattern Reference**: Existing migration logic for `discovery` field and `specPath` field in the same function
- **Action**: Insert migration code immediately before the `// Save the migrated state back to disk` comment

```typescript
// Find: "// Save the migrated state back to disk"
// Insert BEFORE that comment:

		// Migrate old string lastError to ErrorDetails
		if (state.lastError && typeof state.lastError === "string") {
			const legacyError = state.lastError as unknown as string;
			state.lastError = {
				timestamp: state.updatedAt || new Date().toISOString(),
				agent: "opus",  // Default, unknown
				role: "implementer",  // Default, unknown
				exitCode: 1,
				stderr: legacyError,
				errorType: classifyError(legacyError),
				agentTask: "(task not recorded in legacy state)",
			};
			needsSave = true;
		}
		
		// Save the migrated state back to disk  <-- existing comment, keep as-is
```

- **Verify**: Load an existing pipeline state (from previous runs) and verify no errors

### Step 1.7: Fix Critical Bug - Add Missing Return After Implementer Error

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `if (implementResult.exitCode !== 0)` which is followed by `state.lastError = \`Implementation failed`
- **Variable context**: `implementTask` is defined earlier in the same scope (search for `const implementTask =`)
- **Pattern Reference**: Existing error handling with return in discovery agent (search for `Discovery agent failed`)
- **Action**: Replace the error handling block with the new centralized handler and add `return`

```typescript
// Before (find "if (implementResult.exitCode !== 0)" near "Implementation failed"):
			if (implementResult.exitCode !== 0) {
				state.lastError = `Implementation failed: ${implementResult.error}`;
				saveState(cwd, state);
				ctx.ui.notify(state.lastError, "error");
			}

// After:
			if (implementResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					implementResult,
					"opus",
					"implementer",
					implementTask,
					phaseIdx + 1,
					cycle,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;  // CRITICAL: Stop pipeline execution
			}
```

- **Verify**: This is the critical fix. Test that implementation failure stops pipeline (see Testing Strategy below).

### Step 1.8: Add Exit Code Check for Code Reviewer

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `state.previousReview = codeReviewResult.output` - the check goes BEFORE this line
- **Variable context**: `reviewTask` is defined earlier in the same scope (search for `const reviewTask = \`Review the implementation`)
- **Pattern Reference**: Pattern established in Step 1.7
- **Action**: Add exit code check after code reviewer runAgent call, before saving previousReview

```typescript
// Find: "state.previousReview = codeReviewResult.output"
// Insert BEFORE that line:

			if (codeReviewResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					codeReviewResult,
					"opus",
					"codeReviewer",
					reviewTask,
					phaseIdx + 1,
					cycle,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}

			state.previousReview = codeReviewResult.output;  // <-- existing line, keep as-is
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.9: Add Exit Code Check for Address Review

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `await runAgent("opus", addressTask, cwd, SYSTEM_PROMPTS.addressReview`
- **Pattern Reference**: Pattern established in Step 1.7
- **Action**: Capture result and add exit code check

```typescript
// Before (find "await runAgent("opus", addressTask"):
				await runAgent("opus", addressTask, cwd, SYSTEM_PROMPTS.addressReview, undefined, (text) => {
					process.stdout.write(text);
				}, "addressReview");

// After:
				const addressResult = await runAgent("opus", addressTask, cwd, SYSTEM_PROMPTS.addressReview, undefined, (text) => {
					process.stdout.write(text);
				}, "addressReview");
				
				if (addressResult.exitCode !== 0) {
					handleAgentError(
						cwd,
						state,
						addressResult,
						"opus",
						"addressReview",
						addressTask,
						phaseIdx + 1,
						cycle,
						ctx.ui.notify.bind(ctx.ui)
					);
					return;
				}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.10: Add Exit Code Check for Plan Reviewer

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `// If review found issues, revise` - the check goes BEFORE this comment
- **Pattern Reference**: Pattern established in Step 1.7
- **Action**: Add exit code check after plan reviewer runAgent call

```typescript
// Find: "// If review found issues, revise"
// Insert BEFORE that comment:

		if (planReviewResult.exitCode !== 0) {
			handleAgentError(
				cwd,
				state,
				planReviewResult,
				"opus",
				"planReviewer",
				planReviewTask,
				undefined,  // Not in implementation phase yet
				undefined,
				ctx.ui.notify.bind(ctx.ui)
			);
			return;
		}

		// If review found issues, revise  // <-- existing comment, keep as-is
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.11: Add Exit Code Check for Plan Revision

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for the `await runAgent` call inside the "If review found issues, revise" block - it calls `SYSTEM_PROMPTS.planDrafter` with `reviseTask`
- **Pattern Reference**: Pattern established in Step 1.7
- **Action**: Capture result and add exit code check for plan revision

```typescript
// Before (find the runAgent call with reviseTask and SYSTEM_PROMPTS.planDrafter):
			await runAgent(
				"opus",
				reviseTask,
				cwd,
				SYSTEM_PROMPTS.planDrafter,
				undefined,
				(text) => {
					process.stdout.write(text);
				},
				"planDrafter"
			);

// After:
			const reviseResult = await runAgent(
				"opus",
				reviseTask,
				cwd,
				SYSTEM_PROMPTS.planDrafter,
				undefined,
				(text) => {
					process.stdout.write(text);
				},
				"planDrafter"
			);
			
			if (reviseResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					reviseResult,
					"opus",
					"planDrafter",
					reviseTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.12: Update Existing Error Handlers to Use handleAgentError

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Update discovery agent, spec drafter, spec reviewer, and plan drafter error handlers to use the new centralized function

**Discovery agent** (find by searching `Discovery agent failed`):
- **Variable context**: `questionTask` is defined earlier in same scope

```typescript
// Before:
			if (questionResult.exitCode !== 0) {
				state.lastError = `Discovery agent failed: ${questionResult.error}`;
				saveState(cwd, state);
				ctx.ui.notify(state.lastError, "error");
				return;
			}

// After:
			if (questionResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					questionResult,
					"opus",
					"discoveryAgent",
					questionTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

**Spec drafter** (find by searching `Spec drafting failed`):
- **Variable context**: `draftTask` is defined earlier in same scope

```typescript
// Before:
			if (draftResult.exitCode !== 0) {
				state.lastError = `Spec drafting failed: ${draftResult.error}`;
				saveState(cwd, state);
				ctx.ui.notify(state.lastError, "error");
				return;
			}

// After:
			if (draftResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					draftResult,
					"opus",
					"specDrafter",
					draftTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

**Spec reviewer** (find by searching `Spec review failed`):
- **Variable context**: `reviewTask` is defined at the start of this block (search `const reviewTask = \`Review this spec draft`)

```typescript
// Before:
			if (reviewResult.exitCode !== 0) {
				state.lastError = `Spec review failed: ${reviewResult.error}`;
				saveState(cwd, state);
				ctx.ui.notify(state.lastError, "error");
				return;
			}

// After:
			if (reviewResult.exitCode !== 0) {
				handleAgentError(
					cwd,
					state,
					reviewResult,
					"opus",
					"specReviewer",
					reviewTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

**Plan drafter** (find by searching `Plan drafting failed`):
- **Variable context**: `planTask` is defined earlier in same scope

```typescript
// Before:
		if (planDraftResult.exitCode !== 0) {
			state.lastError = `Plan drafting failed: ${planDraftResult.error}`;
			saveState(cwd, state);
			ctx.ui.notify(state.lastError, "error");
			return;
		}

// After:
		if (planDraftResult.exitCode !== 0) {
			handleAgentError(
				cwd,
				state,
				planDraftResult,
				"opus",
				"planDrafter",
				planTask,
				undefined,
				undefined,
				ctx.ui.notify.bind(ctx.ui)
			);
			return;
		}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 1.13: Update formatState() for Structured Error Display

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function formatState` and then find `if (state.lastError)` within it
- **Pattern Reference**: Existing `formatState()` implementation
- **Action**: Update error display section to handle structured `ErrorDetails`

```typescript
// Before (find "if (state.lastError)" in formatState function):
	if (state.lastError) {
		lines.push(`Last Error: ${state.lastError}`);
	}

// After:
	if (state.lastError) {
		const err = state.lastError;
		lines.push("");
		lines.push("─── Last Error ───");
		lines.push(`  Timestamp: ${err.timestamp}`);
		lines.push(`  Agent: ${err.agent} (${err.role})`);
		if (err.phase !== undefined) {
			lines.push(`  Phase: ${err.phase}${err.cycle !== undefined ? `, Cycle ${err.cycle}` : ""}`);
		}
		lines.push(`  Type: ${err.errorType}`);
		if (err.stderr) {
			const preview = truncateString(err.stderr, 200);
			lines.push(`  Message: ${preview}`);
		}
		lines.push(`  Log: .pi/spec-pipeline/${state.id}.error.log`);
		lines.push("──────────────────");
	}
```

- **Verify**: Run `/spec-status` on a pipeline with an error and verify display

### Step 1.14: Verify TypeScript Compilation and Runtime

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Final verification
- **Commands**:
  ```bash
  # Verify by loading in pi (preferred - extension loading handles TypeScript)
  pi --help  # Verify extension loads without errors
  
  # Or start a pi session and verify no extension loading errors appear
  ```

- **Verify**: No TypeScript errors, extension loads correctly

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `.pi/spec-pipeline/{id}.error.log` | Runtime error log file (append-only, preserved for debugging) | Created by `appendErrorLog()` |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Add type definitions, helper functions, fix error handling |

## Implementation Order

The steps must be done in this order due to dependencies:

1. **Steps 1.1-1.2**: Type definitions (no dependencies)
2. **Steps 1.3-1.5**: Helper functions (depends on types)
3. **Step 1.6**: State migration (depends on types and helpers)
4. **Steps 1.7-1.11**: Fix error handling bugs (depends on `handleAgentError`)
5. **Step 1.12**: Update existing handlers (depends on `handleAgentError`)
6. **Step 1.13**: Update display (depends on types)
7. **Step 1.14**: Final verification

## Completion Checklist

- [ ] Step 1.1: Type definitions added (ErrorType, ErrorDetails, RoleName)
- [ ] Step 1.2: PipelineState extended with new fields
- [ ] Step 1.3: `classifyError()` and `truncateString()` functions added
- [ ] Step 1.4: `appendErrorLog()` function added
- [ ] Step 1.5: `handleAgentError()` function added
- [ ] Step 1.6: State migration for backward compatibility
- [ ] Step 1.7: CRITICAL - Missing `return` added after implementer error
- [ ] Step 1.8: Code reviewer exit code check added
- [ ] Step 1.9: Address review exit code check added
- [ ] Step 1.10: Plan reviewer exit code check added
- [ ] Step 1.11: Plan revision exit code check added
- [ ] Step 1.12: Existing error handlers updated to use `handleAgentError()`
- [ ] Step 1.13: `formatState()` updated for structured error display
- [ ] Step 1.14: Extension loads without errors in pi
- [ ] All agent calls now have proper exit code checking with `return`
- [ ] Error classification detects rate limiting (429, "rate limit")
- [ ] Error log file created/appended at `.pi/spec-pipeline/{id}.error.log`
- [ ] State migration handles legacy string `lastError`

## Testing Strategy

Since there are no automated tests for this extension, use these manual testing approaches:

### 1. Test Rate Limit Detection
To test rate limit classification without waiting for actual limits:
```bash
# Temporarily modify classifyError() to always return "RATE_LIMIT" for testing
# Then run /spec with a simple description and cancel mid-way
```

### 2. Test with Invalid API Key
```bash
# Set an invalid API key temporarily to trigger authentication errors
ANTHROPIC_API_KEY=invalid pi
# Then run /spec - the agent call will fail immediately
```

### 3. Test Network Errors
```bash
# Disconnect network or use offline mode during agent call
```

### 4. State File Inspection
After any error, check:
- `.pi/spec-pipeline/{id}.json` - Verify `lastError` has proper `ErrorDetails` structure
- `.pi/spec-pipeline/{id}.error.log` - Verify formatted error log entry

### 5. Resume Verification
After an error:
1. Run `/spec-status` - Should show formatted error details
2. Run `/spec-resume` - Should display previous error context before retrying

### 6. Legacy Migration Test
If you have existing pipelines with string `lastError`:
1. Load the pipeline with `/spec-resume` or `/spec-status`
2. Verify the string was migrated to `ErrorDetails` structure

## Notes

- Phase/cycle numbers in error details are 1-indexed for user-friendly display
- Error log is append-only to preserve history across multiple retry attempts
- The notification includes emoji for visual clarity (💡 for suggestion, 📁 for log path)
- Uses existing `AgentName` type (no separate `AgentNameForError` needed)
