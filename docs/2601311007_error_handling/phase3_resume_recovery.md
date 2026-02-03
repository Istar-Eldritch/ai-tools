# Phase 3: Resume Logic and Exact Retry

**Estimated Effort**: 1 day

## Overview

This phase implements the exact retry mechanism for failed agent operations. When a pipeline fails and the user runs `/spec-resume`, the system will:

1. Display a formatted summary of the previous error
2. Retry the exact same agent operation using the stored `agentTask` from `ErrorDetails`
3. Drop the error stash and clear error state on successful retry
4. Handle re-failures by repeating the error handling process (stash, save state, notify)

## Prerequisites

- **Phase 1 MUST be complete** - Provides `ErrorDetails` type, `handleAgentError()` function, and structured error state
- **Phase 2 MUST be complete** - Provides git validation, branch switching, stash dropping, and checkpoint creation

### Phase 1 Dependencies

| Item | Purpose |
|------|---------|
| `ErrorDetails` type | Contains `agentTask`, `agent`, `role`, `phase`, `cycle` for retry |
| `RoleName` type | Type-safe role parameter |
| `handleAgentError()` | Saves error state, stashes changes, notifies user |
| `classifyError()` | Error classification |
| `appendErrorLog()` | Logging |

### Phase 2 Dependencies

| Item | Purpose |
|------|---------|
| `validateGitRepo()` | Check git is available |
| `checkGitClean()` | Verify clean working directory |
| `switchToBranch()` | Switch to pipeline branch |
| `dropStash()` | Drop error stash before/after retry |
| `stashExists()` | Check if stash still exists |
| `createCheckpointAndSave()` | Create checkpoint before retry |

## Important Notes

- **Line numbers are approximate**: Always use pattern matching to find the correct location
- **Retry uses stored task**: The exact `agentTask` from `ErrorDetails` is used, not regenerated
- **Unlimited retries**: User controls when to retry; no automatic retry limits
- **Re-failure handling**: If retry fails, same error handling process repeats (stash, save, notify)
- **Stash handling**: Phase 2 drops error stash before retry. Phase 3 also drops stash after successful retry as a defensive measure (R12 compliance)

## Steps

### Step 3.1: Create Error Display Helper Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function formatState` and add the new function BEFORE it
- **Pattern Reference**: Follow format of `formatState()` function
- **Action**: Add a helper to format and display previous error details

```typescript
// Add BEFORE the existing formatState() function:

/**
 * Format error details for display before retry
 * Returns formatted string for user notification
 */
function formatErrorForRetry(error: ErrorDetails, state: PipelineState): string {
	const lines: string[] = [];
	lines.push("");
	lines.push("Resuming pipeline from error state:");
	lines.push("────────────────────────────────────");
	lines.push(`  Failed at:   ${error.timestamp}`);
	lines.push(`  Agent:       ${error.agent}`);
	lines.push(`  Role:        ${error.role}`);
	
	if (error.phase !== undefined) {
		const totalPhases = state.phases.length || "?";
		const phaseInfo = `${error.phase} of ${totalPhases}`;
		if (error.cycle !== undefined) {
			lines.push(`  Phase:       ${phaseInfo}`);
			lines.push(`  Cycle:       ${error.cycle} of ${REVIEW_CYCLES}`);
		} else {
			lines.push(`  Phase:       ${phaseInfo}`);
		}
	}
	
	lines.push(`  Error type:  ${error.errorType}`);
	
	if (error.stderr) {
		// Show first 200 chars of error message
		const preview = error.stderr.length > 200 
			? error.stderr.slice(0, 200) + "..." 
			: error.stderr;
		lines.push(`  Message:     ${preview}`);
	}
	
	lines.push("────────────────────────────────────");
	lines.push("");
	
	return lines.join("\n");
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 3.2: Create Retry Agent Helper Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `formatErrorForRetry()` from Step 3.1
- **Pattern Reference**: Based on existing agent call patterns in `runPipeline()`
- **Action**: Add helper function to perform retry based on stored ErrorDetails

```typescript
/**
 * Retry a failed agent operation using stored error details
 * Returns true if retry succeeded, false if it failed (error already handled)
 */
async function retryFailedOperation(
	state: PipelineState,
	cwd: string,
	projectConfig: ProjectConfig,
	ctx: {
		ui: {
			notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
			confirm: (title: string, message: string) => Promise<boolean>;
		};
	}
): Promise<boolean> {
	const error = state.lastError;
	if (!error || typeof error === "string") {
		// No structured error or legacy string error - cannot retry
		return false;
	}
	
	// Get system prompts for the project
	const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);
	
	// Determine the system prompt for this role
	const systemPrompt = SYSTEM_PROMPTS[error.role as keyof typeof SYSTEM_PROMPTS];
	if (!systemPrompt) {
		ctx.ui.notify(`Unknown role: ${error.role}. Cannot retry.`, "error");
		return false;
	}
	
	// Create checkpoint before retry (if on pipeline branch)
	if (state.pipelineBranch) {
		await createCheckpointAndSave(
			cwd,
			state,
			`retry_${error.role}`,
			error.phase,
			error.cycle,
			ctx.ui.notify.bind(ctx.ui)
		);
	}
	
	// Display retry notification
	ctx.ui.notify(`🔄 Retrying ${error.role}...`, "info");
	
	// Retry the exact same operation
	const result = await runAgent(
		error.agent,
		error.agentTask,
		cwd,
		systemPrompt,
		undefined,
		(text) => {
			process.stdout.write(text);
		},
		error.role
	);
	
	if (result.exitCode !== 0) {
		// Retry failed - handle error (this will stash changes, save state, notify)
		await handleAgentError(
			cwd,
			state,
			result,
			error.agent,
			error.role,
			error.agentTask,
			error.phase,
			error.cycle,
			ctx.ui.notify.bind(ctx.ui)
		);
		return false;
	}
	
	// Retry succeeded - handle role-specific output capture
	if (error.role === "codeReviewer") {
		// Store review output for potential addressReview step
		state.previousReview = result.output;
	}
	
	// Drop the error stash if it exists (R12 compliance - defensive)
	// Note: Phase 2 also drops stash before retry, but we ensure cleanup on success
	if (state.errorStash) {
		if (await stashExists(cwd, state.errorStash)) {
			await dropStash(cwd, state.errorStash);
			ctx.ui.notify("Dropped error stash from previous failure", "info");
		}
		state.errorStash = undefined;
	}
	
	// Clear the error state
	state.lastError = undefined;
	saveState(cwd, state);
	ctx.ui.notify(`✅ ${error.role} succeeded on retry`, "success");
	
	return true;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 3.3: Add Retry Logic to /spec-resume Command

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify(\`Resuming pipeline: ${state.id}\`, "info");` in the spec-resume command handler
- **Pattern Reference**: Based on existing resume flow in the same handler
- **Action**: Insert retry logic AFTER the "Resuming pipeline" notification and BEFORE the runPipeline call

First, find the `ctx.ui.notify(\`Resuming pipeline: ${state.id}\`, "info");` line, then locate where `await runPipeline(state, cwd, projectConfig, ctx);` is called (near the end of the handler). Insert the retry logic between them.

```typescript
// Find these lines at the end of spec-resume handler:
			ctx.ui.notify(`Resuming pipeline: ${state.id}`, "info");
			ctx.ui.notify(`Current stage: ${formatStage(state.stage)}`, "info");

			// Detect project configuration
			const projectConfig = detectProjectConfig(cwd);

			// Run the pipeline
			await runPipeline(state, cwd, projectConfig, ctx);

// Replace with:
			ctx.ui.notify(`Resuming pipeline: ${state.id}`, "info");
			ctx.ui.notify(`Current stage: ${formatStage(state.stage)}`, "info");

			// Detect project configuration
			const projectConfig = detectProjectConfig(cwd);

			// Check if we're resuming from an error state
			if (state.lastError) {
				// Handle legacy string errors (cannot retry, just display and continue)
				if (typeof state.lastError === "string") {
					ctx.ui.notify(`Previous error (legacy): ${state.lastError.slice(0, 200)}`, "warning");
					ctx.ui.notify("Cannot retry legacy error format. Pipeline will attempt to continue.", "info");
					// Clear the legacy error and continue
					state.lastError = undefined;
					saveState(cwd, state);
				} else if (state.lastError.agentTask) {
					// Structured error with agentTask - can retry
					
					// Display the previous error
					const errorDisplay = formatErrorForRetry(state.lastError, state);
					ctx.ui.notify(errorDisplay, "info");
					
					// Ask user if they want to retry the failed operation
					const shouldRetry = await ctx.ui.confirm(
						"Retry Failed Operation?",
						`The pipeline failed at ${state.lastError.role}.\n\nRetry the same operation?`
					);
					
					if (!shouldRetry) {
						ctx.ui.notify("Resume cancelled. Use /spec-resume to try again later.", "info");
						return;
					}
					
					ctx.ui.notify("Retrying the same operation...", "info");
					
					// Attempt retry
					const retrySuccess = await retryFailedOperation(state, cwd, projectConfig, ctx);
					
					if (!retrySuccess) {
						// Retry failed - error already handled, just return
						ctx.ui.notify("Retry failed. Run /spec-resume to try again.", "info");
						return;
					}
					
					// Retry succeeded - continue with normal pipeline flow
					ctx.ui.notify("Retry successful! Continuing pipeline...", "success");
				} else {
					// Structured error but no agentTask (shouldn't happen, but handle gracefully)
					ctx.ui.notify("Previous error detected but cannot retry (no task stored).", "warning");
					state.lastError = undefined;
					saveState(cwd, state);
				}
			}

			// Run the pipeline (continues from current stage)
			await runPipeline(state, cwd, projectConfig, ctx);
```

- **Note**: `ctx.ui.confirm` is available because we already checked `ctx.hasUI` at the start of the handler
- **Verify**: Load extension in pi to verify it compiles

### Step 3.4: Add Type Import for RoleName from agents-config (if needed)

The `retryFailedOperation` function uses `error.role` to access `SYSTEM_PROMPTS`. We should ensure the type is properly handled.

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `import { createSystemPrompts } from "./agents-config.mjs";`
- **Action**: Update import to include RoleName type (only if Phase 1 defines it in agents-config)

```typescript
// Before:
import { createSystemPrompts } from "./agents-config.mjs";

// After:
import { createSystemPrompts, type RoleName } from "./agents-config.mjs";
```

- **Note**: If Phase 1 defines `RoleName` locally in index.ts (which is the default), skip this step. The local definition takes precedence.
- **Verify**: Load extension in pi to verify it compiles

### Step 3.5: Update formatState() to Show Retry Information

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `if (state.lastError)` within the `formatState()` function
- **Action**: Enhance the error display to indicate that retry is available

**If Phase 1 already updated this section**, verify it shows the error properly and add the retry hint:

```typescript
// Find the lastError display section in formatState():
// (This may already be enhanced by Phase 1)

// Ensure this block includes retry hint:
	if (state.lastError) {
		const err = typeof state.lastError === "string" 
			? { errorType: "UNKNOWN", stderr: state.lastError } as ErrorDetails
			: state.lastError;
		lines.push("");
		lines.push("─── Last Error ───");
		lines.push(`  Timestamp: ${err.timestamp || "unknown"}`);
		lines.push(`  Agent: ${err.agent || "unknown"} (${err.role || "unknown"})`);
		if (err.phase !== undefined) {
			lines.push(`  Phase: ${err.phase}${err.cycle !== undefined ? `, Cycle ${err.cycle}` : ""}`);
		}
		lines.push(`  Type: ${err.errorType}`);
		if (err.stderr) {
			const preview = err.stderr.length > 200 ? err.stderr.slice(0, 200) + "..." : err.stderr;
			lines.push(`  Message: ${preview}`);
		}
		lines.push(`  Log: .pi/spec-pipeline/${state.id}.error.log`);
		if (err.agentTask) {
			lines.push(`  Retry: /spec-resume (will retry the same operation)`);
		}
		lines.push("──────────────────");
	}
```

- **Note**: If Phase 1 already implements this, verify the `Retry:` hint line is present or add it.
- **Verify**: Run `/spec-status` on a pipeline with an error and verify display

### Step 3.6: Final Verification

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Final compilation and runtime verification
- **Commands**:
  ```bash
  # Verify extension loads without errors
  pi --help
  
  # Start a pi session and verify commands work
  pi
  /spec-status  # Should work
  ```

- **Verify**: All retry functionality compiles and basic commands work

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| (none) | All changes in existing file | |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Add `formatErrorForRetry()`, `retryFailedOperation()`, update `/spec-resume` handler, update `formatState()` |

## Implementation Order

The steps must be done in this order due to dependencies:

1. **Step 3.1**: `formatErrorForRetry()` helper (standalone)
2. **Step 3.2**: `retryFailedOperation()` helper (depends on 3.1, uses Phase 2 stash functions)
3. **Step 3.3**: Update `/spec-resume` with retry logic (depends on 3.1, 3.2)
4. **Step 3.4**: Type import (optional, depends on Phase 1 location of RoleName)
5. **Step 3.5**: formatState() enhancement
6. **Step 3.6**: Final verification

## Completion Checklist

- [ ] Step 3.1: `formatErrorForRetry()` function added
- [ ] Step 3.2: `retryFailedOperation()` function added with stash drop on success
- [ ] Step 3.3: `/spec-resume` updated with retry logic (handles legacy and structured errors)
- [ ] Step 3.4: RoleName type import (if needed)
- [ ] Step 3.5: formatState() shows retry hint
- [ ] Step 3.6: Final verification passed
- [ ] `/spec-resume` displays previous error before retrying
- [ ] Retry uses exact stored `agentTask` from `ErrorDetails`
- [ ] Error stash dropped after successful retry (R12 compliance)
- [ ] `state.errorStash` cleared from state after drop
- [ ] Retry failure triggers same error handling (stash, save, notify)
- [ ] User can decline retry and resume later
- [ ] Legacy string `lastError` handled gracefully
- [ ] codeReviewer retry captures review output for addressReview
- [ ] Extension loads without TypeScript errors

## Testing Strategy

### 1. Test Retry Display
```bash
# After an error occurs:
pi
/spec-resume

# Expected output:
# Resuming pipeline from error state:
# ────────────────────────────────────
#   Failed at:   2026-01-31 14:23:45
#   Agent:       opus
#   Role:        implementer
#   Phase:       2 of 4
#   Cycle:       1 of 3
#   Error type:  RATE_LIMIT
#   Message:     Rate limit exceeded...
# ────────────────────────────────────
#
# Retry the same operation? [Y/n]
```

### 2. Test Successful Retry
```bash
# 1. Cause an error (e.g., network issues, rate limit)
# 2. Fix the issue (wait for rate limit, fix network)
# 3. Run /spec-resume
# 4. Confirm retry
# 5. Expected: Operation succeeds, pipeline continues
```

### 3. Test Retry Failure
```bash
# 1. Cause an error
# 2. Don't fix the issue
# 3. Run /spec-resume
# 4. Confirm retry
# 5. Expected: New error saved, can retry again
```

### 4. Test Cancel Retry
```bash
# 1. After an error, run /spec-resume
# 2. Decline retry when prompted
# 3. Expected: "Resume cancelled" message
# 4. State unchanged, can retry later
```

### 5. Test Legacy Error
```bash
# 1. Edit .pi/spec-pipeline/{id}.json
# 2. Change lastError from object to string: "lastError": "Old error"
# 3. Run /spec-resume
# 4. Expected: Legacy warning, pipeline continues without retry
```

### 6. Test Code Reviewer Retry
```bash
# 1. Cause an error during codeReviewer step
# 2. Run /spec-resume and confirm retry
# 3. Expected: Review output captured in state.previousReview
# 4. addressReview step uses the captured review
```

### 7. Test Error Stash Cleanup After Successful Retry
```bash
# 1. Cause an error that creates an errorStash
# 2. Verify state.errorStash has a value (check state JSON)
# 3. Run /spec-resume and confirm retry
# 4. After successful retry, verify:
#    - The stash has been dropped (run: git stash list)
#    - state.errorStash is undefined in state JSON
#    - Message "Dropped error stash from previous failure" was displayed
```

## Notes

- The retry mechanism preserves user control - no automatic retries
- Each retry creates a new checkpoint (if on pipeline branch)
- Re-failures go through the same error handling (stash, log, notify)
- Legacy string `lastError` values cannot be retried (no stored task)
- The stored `agentTask` is used verbatim - no regeneration
- User can cancel retry and try later without losing state
- Works in conjunction with Phase 2's git validation and stash dropping
- Error stash is dropped both before retry (Phase 2) and after successful retry (Phase 3) for robustness
