# Phase 2: Git Branch Isolation and Checkpoints

**Estimated Effort**: 2 days

## Overview

This phase implements git-based branch isolation and checkpoint management for the spec-pipeline. All pipeline work will be done on a dedicated branch, with checkpoint commits created before potentially destructive operations. On errors, uncommitted changes are stashed. On completion, checkpoint commits are squashed and merged.

## Prerequisites

- **Phase 1 MUST be complete** before implementing Phase 2
- Phase 1 adds the following that Phase 2 depends on:
  - `ErrorDetails` type with `timestamp`, `agent`, `role`, `phase`, `cycle`, `exitCode`, `stderr`, `errorType`, `agentTask` fields
  - `RoleName` type alias for all agent roles
  - `handleAgentError()` function that saves error state, appends to error log, and notifies user
  - Helper functions: `classifyError()`, `appendErrorLog()`, `truncateString()`, `getErrorSuggestion()`
  - Modified `lastError` field in `PipelineState` from `string` to `ErrorDetails`

If Phase 1 is not implemented, Phase 2 steps 2.14-2.15 will not work correctly.

## Important Notes

- **Line numbers are approximate**: Always use pattern matching to find the correct location.
- **Git operations are async**: All git helper functions return Promises and must be awaited.
- **Branch naming**: Uses forward slash (`spec-pipeline/{id}`) for git branch organization.
- **Checkpoint commits**: Use `[CHECKPOINT]` prefix for identification and later squashing.
- **Backward compatibility**: Existing pipelines without branches will continue to work but won't have branch isolation.

## Steps

### Step 2.0: Add Git Fields to PipelineState Interface

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `interface PipelineState` and find the `lastError` field near the end
- **Pattern Reference**: Existing `PipelineState` interface
- **Action**: Add git-related fields to `PipelineState` for branch isolation and checkpoints

```typescript
// Before (find "// Error tracking" comment before lastError in PipelineState):
	// Error tracking
	lastError?: string;
}

// After:
	// Error tracking
	lastError?: string;
	
	// Git branch management
	originalBranch?: string;     // Branch name before pipeline started
	pipelineBranch?: string;     // Generated branch name for this pipeline
	checkpoints?: string[];      // Array of checkpoint commit hashes
	errorStash?: string;         // Stash reference if error occurred
}
```

**Note**: If Phase 1 has already changed `lastError` to `ErrorDetails`, keep that change. The git fields should be added after whatever `lastError` definition exists.

- **Verify**: Load extension in pi to verify it compiles

### Step 2.1: Add Git Helper Functions - Repository Validation

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `async function createCommit` (around line 603) and add the new functions AFTER it
- **Pattern Reference**: Based on existing `createCommit()` function which uses `spawn` for git commands
- **Action**: Add git validation helper functions

```typescript
// Add after the existing createCommit() function:

/**
 * Execute a git command and return the result
 */
async function execGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const proc = spawn("git", args, { cwd });
		proc.stdout?.on("data", (data) => { stdout += data.toString(); });
		proc.stderr?.on("data", (data) => { stderr += data.toString(); });
		proc.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
		proc.on("error", () => resolve({ code: 1, stdout: "", stderr: "Failed to execute git" }));
	});
}

/**
 * Validate that we're in a git repository
 * Returns true if git is available and we're in a repo
 */
async function validateGitRepo(cwd: string): Promise<{ valid: boolean; error?: string }> {
	const result = await execGit(cwd, ["rev-parse", "--git-dir"]);
	if (result.code !== 0) {
		return { 
			valid: false, 
			error: "Not a git repository. Please initialize git with 'git init' before starting the pipeline." 
		};
	}
	return { valid: true };
}

/**
 * Check if the working directory is clean (no uncommitted changes)
 */
async function checkGitClean(cwd: string): Promise<{ clean: boolean; status?: string }> {
	const result = await execGit(cwd, ["status", "--porcelain"]);
	if (result.code !== 0) {
		return { clean: false, status: result.stderr };
	}
	if (result.stdout.length > 0) {
		return { clean: false, status: result.stdout };
	}
	return { clean: true };
}

/**
 * Get the current git branch name
 */
async function getCurrentBranch(cwd: string): Promise<string | null> {
	const result = await execGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (result.code !== 0) {
		return null;
	}
	return result.stdout || null;
}

/**
 * Check if a branch exists
 */
async function branchExists(cwd: string, branchName: string): Promise<boolean> {
	const result = await execGit(cwd, ["rev-parse", "--verify", branchName]);
	return result.code === 0;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.2: Add Git Helper Functions - Branch Management

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `branchExists()` from Step 2.1
- **Action**: Add branch creation and switching functions

```typescript
/**
 * Create a new branch and switch to it
 * If branch exists, appends -N suffix
 * Returns the actual branch name created
 */
async function createPipelineBranch(cwd: string, pipelineId: string): Promise<{ success: boolean; branchName?: string; error?: string }> {
	const baseName = `spec-pipeline/${pipelineId}`;
	let branchName = baseName;
	let suffix = 1;
	
	// Find unique branch name if base already exists
	while (await branchExists(cwd, branchName)) {
		branchName = `${baseName}-${suffix}`;
		suffix++;
		if (suffix > 100) {
			return { success: false, error: "Too many branch name collisions" };
		}
	}
	
	// Create and switch to the new branch
	const result = await execGit(cwd, ["checkout", "-b", branchName]);
	if (result.code !== 0) {
		return { success: false, error: result.stderr || "Failed to create branch" };
	}
	
	return { success: true, branchName };
}

/**
 * Switch to an existing branch
 */
async function switchToBranch(cwd: string, branchName: string): Promise<{ success: boolean; error?: string }> {
	const result = await execGit(cwd, ["checkout", branchName]);
	if (result.code !== 0) {
		return { success: false, error: result.stderr || "Failed to switch branch" };
	}
	return { success: true };
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.3: Add Git Helper Functions - Checkpoints

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `switchToBranch()` from Step 2.2
- **Action**: Add checkpoint commit functions

```typescript
/**
 * Create a checkpoint commit with all current changes
 * Returns the commit hash or null if nothing to commit
 */
async function createCheckpoint(
	cwd: string, 
	role: string, 
	phase?: number, 
	cycle?: number
): Promise<string | null> {
	// Stage all changes
	const addResult = await execGit(cwd, ["add", "-A"]);
	if (addResult.code !== 0) {
		return null;
	}
	
	// Check if there are changes to commit
	const statusResult = await execGit(cwd, ["diff", "--staged", "--quiet"]);
	if (statusResult.code === 0) {
		// No staged changes, nothing to commit
		return null;
	}
	
	// Build commit message
	let message = `[CHECKPOINT] Before ${role}`;
	if (phase !== undefined) {
		message += ` - Phase ${phase}`;
		if (cycle !== undefined) {
			message += `, Cycle ${cycle}`;
		}
	}
	
	// Create commit
	const commitResult = await execGit(cwd, ["commit", "-m", message]);
	if (commitResult.code !== 0) {
		return null;
	}
	
	// Get commit hash
	const hashResult = await execGit(cwd, ["rev-parse", "HEAD"]);
	if (hashResult.code !== 0) {
		return null;
	}
	
	return hashResult.stdout;
}

/**
 * Get the current HEAD commit hash
 */
async function getHeadCommit(cwd: string): Promise<string | null> {
	const result = await execGit(cwd, ["rev-parse", "HEAD"]);
	if (result.code !== 0) {
		return null;
	}
	return result.stdout;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.4: Add Git Helper Functions - Stashing

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `getHeadCommit()` from Step 2.3
- **Action**: Add stash management functions

```typescript
/**
 * Stash any uncommitted changes with an identifiable message
 * Returns the stash reference or null if nothing to stash
 */
async function stashChanges(cwd: string, timestamp: string): Promise<string | null> {
	// Check if there are changes to stash
	const statusResult = await execGit(cwd, ["status", "--porcelain"]);
	if (statusResult.code !== 0 || statusResult.stdout.length === 0) {
		return null;
	}
	
	// Create stash with message
	const message = `spec-pipeline-error-${timestamp}`;
	const result = await execGit(cwd, ["stash", "push", "-m", message, "--include-untracked"]);
	if (result.code !== 0) {
		return null;
	}
	
	// Get stash reference (stash@{0} after push)
	return `stash@{0}`;
}

/**
 * Drop a specific stash by reference
 */
async function dropStash(cwd: string, stashRef: string): Promise<boolean> {
	const result = await execGit(cwd, ["stash", "drop", stashRef]);
	return result.code === 0;
}

/**
 * Check if a stash reference still exists
 */
async function stashExists(cwd: string, stashRef: string): Promise<boolean> {
	// List stashes and check if the reference is valid
	const result = await execGit(cwd, ["stash", "list"]);
	if (result.code !== 0) {
		return false;
	}
	// Try to show the stash - if it fails, stash doesn't exist
	const showResult = await execGit(cwd, ["stash", "show", stashRef]);
	return showResult.code === 0;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.5: Add Git Helper Functions - Completion/Squashing

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `stashExists()` from Step 2.4
- **Action**: Add squash and merge functions

```typescript
/**
 * Count checkpoint commits from a starting point
 */
async function countCheckpointCommits(cwd: string, fromCommit: string | null): Promise<number> {
	const range = fromCommit ? `${fromCommit}..HEAD` : "HEAD";
	const result = await execGit(cwd, ["log", "--oneline", "--grep=\\[CHECKPOINT\\]", range]);
	if (result.code !== 0 || result.stdout.length === 0) {
		return 0;
	}
	return result.stdout.split("\n").filter(line => line.trim().length > 0).length;
}

/**
 * Squash all commits on the pipeline branch into meaningful phase commits
 * This creates a clean history with one commit per phase
 */
async function squashCheckpointCommits(
	cwd: string, 
	originalBranch: string,
	phaseCount: number
): Promise<{ success: boolean; error?: string }> {
	// Get the merge-base with the original branch
	const baseResult = await execGit(cwd, ["merge-base", originalBranch, "HEAD"]);
	if (baseResult.code !== 0) {
		return { success: false, error: "Failed to find merge-base" };
	}
	const mergeBase = baseResult.stdout;
	
	// Soft reset to merge-base, keeping all changes staged
	const resetResult = await execGit(cwd, ["reset", "--soft", mergeBase]);
	if (resetResult.code !== 0) {
		return { success: false, error: "Failed to reset for squash" };
	}
	
	// Create a single squashed commit
	const commitResult = await execGit(cwd, [
		"commit", 
		"-m", 
		`feat: complete spec pipeline implementation (${phaseCount} phases)`
	]);
	if (commitResult.code !== 0) {
		// If nothing to commit, that's OK (no changes were made)
		const statusResult = await execGit(cwd, ["status", "--porcelain"]);
		if (statusResult.stdout.length === 0) {
			return { success: true };
		}
		return { success: false, error: "Failed to create squashed commit" };
	}
	
	return { success: true };
}

/**
 * Merge pipeline branch to original branch
 * Uses fast-forward if possible, otherwise creates merge commit
 */
async function mergePipelineBranch(
	cwd: string, 
	originalBranch: string,
	pipelineBranch: string
): Promise<{ success: boolean; error?: string; conflicted?: boolean }> {
	// Switch to original branch
	const switchResult = await switchToBranch(cwd, originalBranch);
	if (!switchResult.success) {
		return { success: false, error: `Failed to switch to ${originalBranch}: ${switchResult.error}` };
	}
	
	// Try to merge with fast-forward
	const mergeResult = await execGit(cwd, ["merge", "--ff-only", pipelineBranch]);
	if (mergeResult.code === 0) {
		return { success: true };
	}
	
	// Try regular merge if fast-forward fails
	const regularMergeResult = await execGit(cwd, ["merge", pipelineBranch, "-m", `Merge ${pipelineBranch}`]);
	if (regularMergeResult.code !== 0) {
		// Check if it's a conflict
		if (regularMergeResult.stderr.includes("CONFLICT") || regularMergeResult.stdout.includes("CONFLICT")) {
			// Abort the merge
			await execGit(cwd, ["merge", "--abort"]);
			return { success: false, conflicted: true, error: "Merge conflict detected. Please resolve manually." };
		}
		return { success: false, error: regularMergeResult.stderr || "Merge failed" };
	}
	
	return { success: true };
}

/**
 * Delete a branch
 */
async function deleteBranch(cwd: string, branchName: string): Promise<boolean> {
	const result = await execGit(cwd, ["branch", "-D", branchName]);
	return result.code === 0;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.6: Add Pre-Pipeline Git Validation to /spec Command

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `pi.registerCommand("spec"` and then find the line `// Detect project configuration` followed by `const projectConfig = detectProjectConfig(cwd);`
- **Action**: Insert git validation and branch creation BEFORE project config detection

```typescript
// Find this pattern:
			// Detect project configuration
			const projectConfig = detectProjectConfig(cwd);

// Insert BEFORE it:
			// Git repository validation
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			// Check for clean working directory
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash your changes before starting the pipeline.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			// Store original branch name
			const originalBranch = await getCurrentBranch(cwd);
			if (!originalBranch) {
				ctx.ui.notify("Failed to determine current branch", "error");
				return;
			}

			// Detect project configuration  // <-- existing line, keep as-is
```

- **Verify**: Start pi and run `/spec test` in a dirty working directory - should be rejected

### Step 2.7: Create Pipeline Branch After State Creation

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for pattern `saveState(cwd, state);` followed immediately by `ctx.ui.notify(\`Pipeline ID: ${state.id}\`, "info");` in the spec command handler (around line 1585-1586)
- **Action**: Insert branch creation after initial state save

```typescript
// Find these consecutive lines in the spec command handler:
			saveState(cwd, state);
			ctx.ui.notify(`Pipeline ID: ${state.id}`, "info");

// Replace with:
			// Save original branch to state
			state.originalBranch = originalBranch;
			state.checkpoints = [];
			saveState(cwd, state);
			
			// Create and switch to pipeline branch
			const branchResult = await createPipelineBranch(cwd, state.id);
			if (!branchResult.success) {
				ctx.ui.notify(`Failed to create pipeline branch: ${branchResult.error}`, "error");
				state.stage = "cancelled";
				saveState(cwd, state);
				return;
			}
			state.pipelineBranch = branchResult.branchName;
			saveState(cwd, state);
			
			ctx.ui.notify(`Pipeline ID: ${state.id}`, "info");
			ctx.ui.notify(`Branch: ${branchResult.branchName}`, "info");
```

- **Verify**: Start pi and run `/spec test description` - should create and switch to `spec-pipeline/{id}` branch

### Step 2.8: Add Git Validation to /spec-resume Command

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `pi.registerCommand("spec-resume"` and then find `ctx.ui.notify(\`Resuming pipeline: ${state.id}\`, "info");`
- **Action**: Insert git validation BEFORE the "Resuming pipeline" notification

```typescript
// Find this line:
			ctx.ui.notify(`Resuming pipeline: ${state.id}`, "info");

// Insert BEFORE it:
			// Validate git repo (required for all pipelines now)
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			// Check for clean working directory
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash them before resuming.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			// Handle pipeline branch switching (if pipeline has a branch)
			if (state.pipelineBranch) {
				const currentBranch = await getCurrentBranch(cwd);
				
				// Check if pipeline branch still exists
				const pipelineBranchExists = await branchExists(cwd, state.pipelineBranch);
				if (!pipelineBranchExists) {
					ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' no longer exists.`, "error");
					ctx.ui.notify("You can recreate it manually from an existing commit or start a new pipeline.", "info");
					return;
				}
				
				// Switch to pipeline branch if not already on it
				if (currentBranch !== state.pipelineBranch) {
					ctx.ui.notify(`Switching to pipeline branch: ${state.pipelineBranch}`, "info");
					const switchResult = await switchToBranch(cwd, state.pipelineBranch);
					if (!switchResult.success) {
						ctx.ui.notify(`Failed to switch to pipeline branch: ${switchResult.error}`, "error");
						return;
					}
				}
				
				// Drop error stash if it exists (discard failed partial work)
				if (state.errorStash) {
					const stashStillExists = await stashExists(cwd, state.errorStash);
					if (stashStillExists) {
						ctx.ui.notify("Dropping stashed changes from previous error...", "info");
						await dropStash(cwd, state.errorStash);
					}
					state.errorStash = undefined;
					saveState(cwd, state);
				}
			}

			ctx.ui.notify(`Resuming pipeline: ${state.id}`, "info");  // <-- existing line, keep as-is
```

- **Verify**: Run `/spec-resume` with dirty working directory - should be rejected

### Step 2.9: Create Helper Function to Wrap Checkpoint Creation

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add after `deleteBranch()` function from Step 2.5
- **Action**: Add helper to create checkpoint and update state

```typescript
/**
 * Create a checkpoint before a write operation and update state
 * Returns true if checkpoint was created (or not needed), false on error
 */
async function createCheckpointAndSave(
	cwd: string,
	state: PipelineState,
	role: string,
	phase?: number,
	cycle?: number,
	notify?: (msg: string, type: "info" | "error" | "success" | "warning") => void
): Promise<boolean> {
	// Only create checkpoints if on a pipeline branch
	if (!state.pipelineBranch) {
		return true;  // No branch isolation, skip checkpoint
	}
	
	const commitHash = await createCheckpoint(cwd, role, phase, cycle);
	if (commitHash) {
		if (!state.checkpoints) {
			state.checkpoints = [];
		}
		state.checkpoints.push(commitHash);
		saveState(cwd, state);
		notify?.(`📍 Checkpoint created: ${commitHash.slice(0, 8)}`, "info");
	}
	// null means nothing to commit, which is fine
	return true;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.10: Add Checkpoint Creation Before specDrafter

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify("🔵 Opus drafting spec...", "info");` in the spec drafting loop
- **Action**: Add checkpoint creation before the agent call

```typescript
// Find this line:
			ctx.ui.notify("🔵 Opus drafting spec...", "info");

// Insert BEFORE it:
			// Create checkpoint before spec drafting
			await createCheckpointAndSave(cwd, state, "specDrafter", undefined, undefined, ctx.ui.notify.bind(ctx.ui));

			ctx.ui.notify("🔵 Opus drafting spec...", "info");  // <-- existing line, keep as-is
```

- **Verify**: Run `/spec` and observe checkpoint creation message before spec drafting

### Step 2.11: Add Checkpoint Creation Before planDrafter

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify("🔵 Opus drafting implementation plan...", "info");`
- **Action**: Add checkpoint creation before the agent call

```typescript
// Find this line:
		ctx.ui.notify("🔵 Opus drafting implementation plan...", "info");

// Insert BEFORE it:
		// Create checkpoint before plan drafting
		await createCheckpointAndSave(cwd, state, "planDrafter", i + 1, undefined, ctx.ui.notify.bind(ctx.ui));

		ctx.ui.notify("🔵 Opus drafting implementation plan...", "info");  // <-- existing line, keep as-is
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.12: Add Checkpoint Creation Before implementer

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify("🔵 Opus implementing...", "info");`
- **Action**: Add checkpoint creation before the agent call

```typescript
// Find this line:
			ctx.ui.notify("🔵 Opus implementing...", "info");

// Insert BEFORE it:
			// Create checkpoint before implementation
			await createCheckpointAndSave(cwd, state, "implementer", phaseIdx + 1, cycle, ctx.ui.notify.bind(ctx.ui));

			ctx.ui.notify("🔵 Opus implementing...", "info");  // <-- existing line, keep as-is
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.13: Add Checkpoint Creation Before addressReview

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify("🔵 Opus addressing review feedback...", "info");`
- **Action**: Add checkpoint creation before the agent call

```typescript
// Find this line:
			ctx.ui.notify("🔵 Opus addressing review feedback...", "info");

// Insert BEFORE it:
			// Create checkpoint before addressing review
			await createCheckpointAndSave(cwd, state, "addressReview", phaseIdx + 1, cycle, ctx.ui.notify.bind(ctx.ui));

			ctx.ui.notify("🔵 Opus addressing review feedback...", "info");  // <-- existing line, keep as-is
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.14: Update handleAgentError to Stash Changes (Phase 1 Dependency)

**IMPORTANT**: This step REQUIRES Phase 1 to be complete. The `handleAgentError()` function must already exist from Phase 1.

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function handleAgentError` (added in Phase 1)
- **Action**: Modify the existing sync function to be async and add stashing logic. This change requires updating ALL callers to use `await` (see Step 2.15).

```typescript
// Before (Phase 1 version - SYNC function):
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
		// ... error details construction from Phase 1
	};
	
	// Save to state
	state.lastError = errorDetails;
	saveState(cwd, state);
	
	// Append to error log
	appendErrorLog(cwd, state.id, errorDetails);
	
	// Format user notification
	// ... notification code from Phase 1
	
	return errorDetails;
}

// After (ASYNC function with stashing):
async function handleAgentError(
	cwd: string,
	state: PipelineState,
	result: AgentResult,
	agent: AgentName,
	role: RoleName,
	task: string,
	phase: number | undefined,
	cycle: number | undefined,
	notify: (msg: string, type: "info" | "error" | "success" | "warning") => void
): Promise<ErrorDetails> {
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
	
	// Stash any uncommitted changes from the failed operation
	if (state.pipelineBranch) {
		const stashRef = await stashChanges(cwd, errorDetails.timestamp.replace(/[:.]/g, "-"));
		if (stashRef) {
			state.errorStash = stashRef;
			notify("💾 Uncommitted changes stashed for recovery", "info");
		}
	}
	
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

- **Verify**: Load extension in pi to verify it compiles (will fail until Step 2.15 is complete)

### Step 2.15: Update All handleAgentError Call Sites to Use await

**IMPORTANT**: Steps 2.14 and 2.15 MUST be done together atomically. Doing only 2.14 will break the code since all callers expect a sync function.

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Find ALL occurrences of `handleAgentError(` and add `await` prefix

**All call sites to update** (search for each pattern):

1. **Discovery agent** (search for `"discoveryAgent",`):
```typescript
// Before:
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

// After:
				await handleAgentError(
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
```

2. **Spec drafter** (search for `"specDrafter",`):
   Add `await` prefix to `handleAgentError(` call

3. **Spec reviewer** (search for `"specReviewer",`):
   Add `await` prefix to `handleAgentError(` call

4. **Plan drafter** (search for `"planDrafter",` with `planTask`):
   Add `await` prefix to `handleAgentError(` call

5. **Plan reviewer** (search for `"planReviewer",`):
   Add `await` prefix to `handleAgentError(` call

6. **Plan revision** (search for `"planDrafter",` with `reviseTask`):
   Add `await` prefix to `handleAgentError(` call

7. **Implementer** (search for `"implementer",`):
   Add `await` prefix to `handleAgentError(` call

8. **Code reviewer** (search for `"codeReviewer",`):
   Add `await` prefix to `handleAgentError(` call

9. **Address review** (search for `"addressReview",`):
   Add `await` prefix to `handleAgentError(` call

- **Verify**: Load extension in pi to verify it compiles (all async/await chains correct)

### Step 2.16: Add Pipeline Completion with Squash and Merge Options

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `state.stage = "completed";` followed by `saveState(cwd, state);` and `ctx.ui.notify("\n🎉 Spec pipeline complete!", "success");` at the end of the runPipeline function
- **Action**: Replace completion block with squash and merge options

**Note**: `ctx.ui.select` is already used at line 1153 WITHOUT optional chaining. Follow that same pattern here.

```typescript
// Before (find the completion block at the end of runPipeline):
	state.stage = "completed";
	saveState(cwd, state);
	ctx.ui.notify("\n🎉 Spec pipeline complete!", "success");
}

// After:
	// Handle pipeline completion with squash and merge
	if (state.pipelineBranch && state.originalBranch) {
		ctx.ui.notify("\n✅ Implementation complete! Preparing to finalize...", "success");
		
		// Count checkpoint commits for information
		const checkpointCount = state.checkpoints?.length || 0;
		ctx.ui.notify(`Created ${checkpointCount} checkpoints during implementation`, "info");
		
		// Ask user what to do with the branch (matches existing select usage at line 1153)
		const mergeChoice = await ctx.ui.select(
			"How would you like to handle the pipeline branch?",
			[
				{ label: "Squash commits and merge to original branch", value: "squash_merge" },
				{ label: "Merge as-is (keep all commits)", value: "merge" },
				{ label: "Keep pipeline branch (manual merge later)", value: "keep" },
			]
		);
		
		if (mergeChoice === "squash_merge") {
			ctx.ui.notify("Squashing checkpoint commits...", "info");
			const squashResult = await squashCheckpointCommits(cwd, state.originalBranch, state.phases.length);
			if (!squashResult.success) {
				ctx.ui.notify(`Squash failed: ${squashResult.error}`, "error");
				ctx.ui.notify("Pipeline branch preserved for manual handling", "info");
			} else {
				ctx.ui.notify("Merging to original branch...", "info");
				const mergeResult = await mergePipelineBranch(cwd, state.originalBranch, state.pipelineBranch);
				if (!mergeResult.success) {
					if (mergeResult.conflicted) {
						ctx.ui.notify("Merge conflicts detected. Please resolve manually.", "warning");
						ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' preserved`, "info");
					} else {
						ctx.ui.notify(`Merge failed: ${mergeResult.error}`, "error");
					}
				} else {
					// Successfully merged - delete pipeline branch
					await deleteBranch(cwd, state.pipelineBranch);
					ctx.ui.notify(`Merged and cleaned up branch '${state.pipelineBranch}'`, "success");
				}
			}
		} else if (mergeChoice === "merge") {
			ctx.ui.notify("Merging to original branch...", "info");
			const mergeResult = await mergePipelineBranch(cwd, state.originalBranch, state.pipelineBranch);
			if (!mergeResult.success) {
				if (mergeResult.conflicted) {
					ctx.ui.notify("Merge conflicts detected. Please resolve manually.", "warning");
				} else {
					ctx.ui.notify(`Merge failed: ${mergeResult.error}`, "error");
				}
				ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' preserved`, "info");
			} else {
				await deleteBranch(cwd, state.pipelineBranch);
				ctx.ui.notify(`Merged and cleaned up branch '${state.pipelineBranch}'`, "success");
			}
		} else {
			// Keep branch - just switch back to original
			await switchToBranch(cwd, state.originalBranch);
			ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' preserved for manual merge`, "info");
		}
	}
	
	state.stage = "completed";
	saveState(cwd, state);
	ctx.ui.notify("\n🎉 Spec pipeline complete!", "success");
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.17: Update /spec-cancel to Preserve Branch and Notify

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `if (confirm) {` in the spec-cancel command handler, followed by `state.stage = "cancelled";`
- **Action**: Update the cancel confirmation block to include branch preservation message

```typescript
// Before:
		if (confirm) {
			state.stage = "cancelled";
			saveState(cwd, state);
			ctx.ui.notify("Pipeline cancelled. Resume with /spec-resume", "info");
		}

// After:
		if (confirm) {
			state.stage = "cancelled";
			saveState(cwd, state);
			
			if (state.pipelineBranch) {
				ctx.ui.notify(`Pipeline cancelled. Branch '${state.pipelineBranch}' preserved.`, "info");
				ctx.ui.notify("You can delete it manually with: git branch -D " + state.pipelineBranch, "info");
				ctx.ui.notify("Or resume later with: /spec-resume", "info");
				
				// Try to switch back to original branch
				if (state.originalBranch) {
					const switchResult = await switchToBranch(cwd, state.originalBranch);
					if (switchResult.success) {
						ctx.ui.notify(`Switched back to '${state.originalBranch}'`, "info");
					}
				}
			} else {
				ctx.ui.notify("Pipeline cancelled. Resume with /spec-resume", "info");
			}
		}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 2.18: Update formatState() to Include Branch Information

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function formatState` and find `lines.push(\`Spec: ${state.specFilename}\`);`
- **Action**: Add branch information after the spec filename line

```typescript
// Find this line in formatState():
	lines.push(`Spec: ${state.specFilename}`);

// Insert AFTER it:
	if (state.pipelineBranch) {
		lines.push(`Branch: ${state.pipelineBranch}`);
	}
	if (state.originalBranch && state.pipelineBranch) {
		lines.push(`Original Branch: ${state.originalBranch}`);
	}
	if (state.checkpoints && state.checkpoints.length > 0) {
		lines.push(`Checkpoints: ${state.checkpoints.length}`);
	}
	if (state.errorStash) {
		lines.push(`Error Stash: ${state.errorStash} (will be dropped on resume)`);
	}
```

- **Verify**: Run `/spec-status` and verify branch information is displayed

### Step 2.19: Add State Migration for Existing Pipelines Without Branches

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function loadState` and find `// Save the migrated state back to disk` (around line 232)
- **Action**: Add migration for missing git-related fields BEFORE the save line (after the existing phase paths migration)

```typescript
// Find the line: "// Save the migrated state back to disk"
// Insert BEFORE it (after the existing "if (needsSave) { state.phases = migratedPhases; }" block):

		// Initialize missing git-related fields for backward compatibility
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
			// Don't set needsSave - old pipelines without branches are OK
		}
		
		// Save the migrated state back to disk  // <-- existing line, keep as-is
```

- **Note**: We don't force-add `originalBranch` or `pipelineBranch` - old pipelines just continue without branch isolation
- **Verify**: Load an existing pipeline state and verify it doesn't error

### Step 2.20: Final Verification

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Final compilation and runtime verification
- **Commands**:
  ```bash
  # Verify extension loads without errors
  pi --help
  
  # Start a pi session and test commands
  # 1. Test /spec in dirty directory - should be rejected
  # 2. Test /spec in clean directory - should create branch
  # 3. Test /spec-status - should show branch info
  # 4. Test /spec-cancel - should preserve branch and switch back
  ```

- **Verify**: All git operations work correctly

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| (none) | All changes in existing file | |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Add git fields to PipelineState, git helper functions, branch isolation, checkpoints, stashing, squash/merge |

## Implementation Order

The steps must be done in this order due to dependencies:

1. **Step 2.0**: Add git fields to PipelineState (required for all subsequent steps)
2. **Steps 2.1-2.5**: Git helper functions (independent, can be done together)
3. **Steps 2.6-2.7**: Pre-pipeline validation and branch creation in `/spec`
4. **Step 2.8**: Git validation in `/spec-resume`
5. **Steps 2.9-2.13**: Checkpoint creation infrastructure and integration points
6. **Steps 2.14-2.15**: Update error handler for stashing (MUST be done together, REQUIRES Phase 1)
7. **Step 2.16**: Pipeline completion with merge options
8. **Step 2.17**: Cancel command branch preservation
9. **Step 2.18**: Status display update
10. **Step 2.19**: State migration for backward compatibility
11. **Step 2.20**: Final verification

## Phase 1 Dependencies

Steps 2.14 and 2.15 depend on the following from Phase 1:

| Phase 1 Item | Used By | What It Provides |
|--------------|---------|------------------|
| `ErrorDetails` type | Step 2.14 | Structure for error state |
| `RoleName` type | Step 2.14 | Type-safe role parameter |
| `handleAgentError()` | Step 2.14, 2.15 | Base function to modify |
| `classifyError()` | Step 2.14 | Error type classification |
| `appendErrorLog()` | Step 2.14 | Error logging |
| `truncateString()` | Step 2.14 | String truncation helper |
| `getErrorSuggestion()` | Step 2.14 | User-friendly error suggestions |

If Phase 1 is not complete, skip Steps 2.14-2.15 and implement them after Phase 1.

## Completion Checklist

- [ ] Step 2.0: Git fields (`originalBranch`, `pipelineBranch`, `checkpoints`, `errorStash`) added to PipelineState
- [ ] Step 2.1: `execGit()`, `validateGitRepo()`, `checkGitClean()`, `getCurrentBranch()`, `branchExists()` added
- [ ] Step 2.2: `createPipelineBranch()`, `switchToBranch()` added
- [ ] Step 2.3: `createCheckpoint()`, `getHeadCommit()` added
- [ ] Step 2.4: `stashChanges()`, `dropStash()`, `stashExists()` added
- [ ] Step 2.5: `countCheckpointCommits()`, `squashCheckpointCommits()`, `mergePipelineBranch()`, `deleteBranch()` added
- [ ] Step 2.6: Git validation added to `/spec` command (repo check, clean check)
- [ ] Step 2.7: Pipeline branch creation in `/spec` command
- [ ] Step 2.8: Git validation and branch switching in `/spec-resume` command
- [ ] Step 2.9: `createCheckpointAndSave()` helper added
- [ ] Step 2.10: Checkpoint before specDrafter
- [ ] Step 2.11: Checkpoint before planDrafter
- [ ] Step 2.12: Checkpoint before implementer
- [ ] Step 2.13: Checkpoint before addressReview
- [ ] Step 2.14: `handleAgentError()` updated to async with stashing (REQUIRES Phase 1)
- [ ] Step 2.15: All `handleAgentError()` call sites updated to use `await` (REQUIRES Phase 1)
- [ ] Step 2.16: Pipeline completion with squash/merge options
- [ ] Step 2.17: `/spec-cancel` updated with branch preservation
- [ ] Step 2.18: `formatState()` shows branch information
- [ ] Step 2.19: State migration for backward compatibility
- [ ] Step 2.20: Final verification passed
- [ ] Working directory must be clean before `/spec` starts
- [ ] Working directory must be clean before `/spec-resume`
- [ ] Pipeline creates `spec-pipeline/{id}` branch
- [ ] Checkpoints created before specDrafter, planDrafter, implementer, addressReview
- [ ] Failed changes are stashed on error
- [ ] Stash is dropped on resume
- [ ] Squash and merge options offered on completion
- [ ] `/spec-cancel` preserves branch and notifies user
- [ ] `/spec-status` shows branch name
- [ ] Existing pipelines without branches continue to work

## Testing Strategy

### 1. Test Dirty Working Directory Detection
```bash
# Create a test file
echo "test" > test.txt

# Try to start pipeline - should be rejected
pi
/spec test feature
# Expected: "Working directory has uncommitted changes..."

# Clean up
rm test.txt
```

### 2. Test Branch Creation
```bash
# Ensure clean state
git status  # Should be clean

# Start pipeline
pi
/spec test branch creation
# Expected: Branch spec-pipeline/{id} created

# Verify branch exists
git branch  # Should show spec-pipeline/{id}

# Cancel for cleanup
/spec-cancel
```

### 3. Test Checkpoint Creation
```bash
# Start a real pipeline (or mock one)
# Observe checkpoint messages during spec drafting
# Check git log for [CHECKPOINT] commits
git log --oneline | head -10
```

### 4. Test Error Stashing
```bash
# This requires simulating an agent failure
# Set invalid API key temporarily
ANTHROPIC_API_KEY=invalid pi
/spec test error stashing
# Expected: Changes stashed after failure

# Check stash
git stash list
# Expected: "spec-pipeline-error-{timestamp}"
```

### 5. Test Resume with Stash Drop
```bash
# After an error that created a stash
# Fix API key
pi
/spec-resume
# Expected: "Dropping stashed changes from previous error..."
```

### 6. Test Cancel Branch Preservation
```bash
pi
/spec test cancel
# ... let it create branch ...
/spec-cancel
# Expected: Branch preserved, switched back to original
git branch
# Expected: spec-pipeline/{id} still exists
```

## Notes

- All git operations use the `execGit()` helper for consistency
- Branch names use forward slash for organization: `spec-pipeline/{id}`
- Checkpoints use `[CHECKPOINT]` prefix for easy identification and grepping
- Stashes use `spec-pipeline-error-{timestamp}` message for identification
- Error stashes are automatically dropped on resume to discard failed work
- Users can recover failed changes from stash manually if needed
- `ctx.ui.select` is used WITHOUT optional chaining to match existing usage at line 1153
- Existing pipelines without `pipelineBranch` continue to work but don't get branch isolation
- Steps 2.14-2.15 depend on Phase 1 - if Phase 1 is incomplete, defer these steps
