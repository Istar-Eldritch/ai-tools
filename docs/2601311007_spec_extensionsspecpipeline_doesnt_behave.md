# Technical Specification: Robust Error Handling and Recovery for Spec-Pipeline

**Status**: Draft  
**Created**: 2026-01-31  
**Spec ID**: 2601311007

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The spec-pipeline extension automates the specification → implementation workflow using multiple AI agents. In production use, agent API calls can fail due to rate limiting (HTTP 429), network issues, timeout errors, or other transient failures. When these errors occur, the pipeline's current behavior is **unreliable and unpredictable**:

- Some failures cause the pipeline to silently continue executing subsequent steps
- Partial work from failed operations may be left in the working directory
- Users cannot easily retry the exact failed operation
- Error context is insufficient for debugging
- No mechanism to safely revert failed changes

This undermines the pipeline's reliability and forces manual intervention to recover from errors.

#### Current State

The spec-pipeline extension runs a multi-stage workflow:

1. **Discovery phase** - Q&A gathering (optional)
2. **Spec drafting** - Opus drafts specification
3. **Spec review** - Opus reviews draft
4. **Plan generation** - Opus creates phase plans
5. **Implementation** - Opus implements, Opus reviews, addresses feedback (3 cycles per phase)
6. **Commits** - Haiku writes commit messages

Each stage involves calling `runAgent()` which executes a subprocess that returns:
```typescript
interface AgentResult {
  output: string;
  exitCode: number;
  error?: string;
}
```

**Current error handling analysis** (from `extensions/spec-pipeline/index.ts`):

| Agent Call Site | Location | Error Handling Status |
|-----------------|----------|----------------------|
| Discovery agent | ~line 920 | ✅ Properly checked |
| Spec drafter | ~line 1095 | ✅ Properly checked |
| Spec reviewer | ~line 1115 | ✅ Properly checked |
| Plan drafter | ~line 1265 | ✅ Properly checked |
| Plan reviewer | ~line 1290 | ⚠️ Checked but no early return on issues |
| **Implementer** | ~line 1420 | ❌ **Missing `return` after error** |
| **Code reviewer** | ~line 1445 | ❌ **No exit code checking** |
| **Address review** | ~line 1460 | ❌ **No exit code checking, result not captured** |
| Commit writer | ~line 1485 | ⚠️ Warns only (non-critical) |

**Critical Bug - Implementer (line ~1420)**:
```typescript
if (implementResult.exitCode !== 0) {
  state.lastError = `Implementation failed: ${implementResult.error}`;
  saveState(cwd, state);
  ctx.ui.notify(state.lastError, "error");
  // BUG: No return statement! Pipeline continues to code review
}
```

#### Key Issues

| ID | Issue | Severity |
|----|-------|----------|
| I1 | Implementation failures don't stop the pipeline (missing `return` statement) | Critical |
| I2 | Code review and address review failures are never checked | High |
| I3 | No git-based checkpoint/revert mechanism for partial work | Medium |
| I4 | No separate branch isolation for pipeline work | Medium |
| I5 | Insufficient error metadata captured (no agent/role/phase context) | Medium |
| I6 | Cannot retry the exact same agent operation (task not persisted) | Medium |
| I7 | No detection/handling of dirty working directory before pipeline start | Low |
| I8 | Rate limiting errors (429) not specifically detected or communicated | Low |

### 2. Requirements

#### Error Detection Requirements

**R1**: ALL agent operation failures SHALL halt pipeline execution immediately after saving state and notifying the user.

**R2**: The pipeline SHALL check `exitCode !== 0` from EVERY `runAgent()` call, including:
- discoveryAgent
- specDrafter
- specReviewer
- planDrafter
- planReviewer
- implementer
- codeReviewer
- addressReview
- commitMessageWriter (non-critical - warn only, do not halt)

**R3**: When an agent fails, the pipeline SHALL:
1. Save the current state with structured error details
2. Stash any uncommitted changes in the working directory
3. Notify the user with full error context and recovery suggestions
4. Stop execution (return from `runPipeline()`)

**R4**: The pipeline SHALL detect rate limiting errors specifically by:
- Checking for HTTP 429 status in error messages
- Checking for "rate limit" or "rate_limit" text in error output (case-insensitive)
- Labeling these errors as `RATE_LIMIT` type in error metadata

#### Error State Persistence Requirements

**R5**: The `PipelineState` interface SHALL be extended with a structured error field:
```typescript
type ErrorType = "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "VALIDATION" | "UNKNOWN";
type AgentName = "opus" | "sonnet" | "haiku";
type RoleName = "discoveryAgent" | "specDrafter" | "specReviewer" | "planDrafter" 
              | "planReviewer" | "implementer" | "codeReviewer" | "addressReview" 
              | "commitMessageWriter";

interface ErrorDetails {
  timestamp: string;           // ISO timestamp of error
  agent: AgentName;            // Which agent failed
  role: RoleName;              // Which role was executing
  phase?: number;              // Phase index (if in implementation stage)
  cycle?: number;              // Review cycle (if in implementation stage)
  exitCode: number;            // Subprocess exit code
  stderr?: string;             // Error output from subprocess (truncated to 2000 chars)
  errorType: ErrorType;        // Classified error type
  checkpointCommit?: string;   // Git commit hash to revert to
  agentTask: string;           // The exact task prompt sent to the agent
}

interface PipelineState {
  // ... existing fields ...
  
  // Git branch management (new)
  originalBranch?: string;     // Branch name before pipeline started
  pipelineBranch?: string;     // Generated branch name for this pipeline
  checkpoints?: string[];      // Array of checkpoint commit hashes
  errorStash?: string;         // Stash reference if error occurred
  
  // Error tracking (enhanced)
  lastError?: ErrorDetails;    // Replace string with structured error
}
```

**R6**: The `agentTask` parameter from every `runAgent()` call SHALL be stored in `ErrorDetails` to enable exact retry on resume.

**R7**: Error details SHALL be displayed to the user in a formatted, readable manner including:
- Timestamp of failure
- Which agent and role failed
- Current phase and cycle (if applicable)
- Error type (RATE_LIMIT, TIMEOUT, etc.)
- Excerpt from stderr (first 500 chars for display, full in log file)
- Actionable suggestion for next steps

#### Git Branch and Checkpoint Requirements

**R8**: When a pipeline starts via `/spec`, it SHALL:
- Check that the working directory is clean (`git status --porcelain` returns empty)
- If dirty, notify user and exit with error: "Working directory has uncommitted changes. Please commit or stash your changes before starting the pipeline."

**R9**: After validating clean working directory, the pipeline SHALL:
- Create a new git branch named `spec-pipeline/{pipelineId}`
- Check if branch already exists; if so, append `-N` suffix (where N is incremented)
- Switch to the new branch
- Save the original branch name in `PipelineState.originalBranch`

**R10**: Before EACH agent operation that modifies files (roles: specDrafter, planDrafter, implementer, addressReview), the pipeline SHALL:
- Create a git checkpoint commit with all current staged/unstaged changes
- Store the commit hash in `PipelineState.checkpoints` array
- Use commit message format: `[CHECKPOINT] Before {role} - Phase {N}, Cycle {M}` (or omit phase/cycle if N/A)

**R11**: When an agent operation fails, the pipeline SHALL:
1. Stash any uncommitted changes created by the failed agent with message `spec-pipeline-error-{timestamp}`
2. Store the stash reference in `PipelineState.errorStash`
3. Leave the checkpoint commits in place for user inspection
4. Do NOT automatically revert - let user decide

**R12**: When the user runs `/spec-resume` after an error:
1. Check that working directory is clean (user must stash/commit manual changes)
2. Switch back to the pipeline branch if user moved away
3. Drop the error stash (if it exists) to discard failed partial work
4. Retry the exact same agent operation using the stored `agentTask` from `ErrorDetails`
5. Create a new checkpoint before retrying

**R13**: When the pipeline completes successfully, it SHALL:
1. Squash all checkpoint commits on the pipeline branch into meaningful commits (one per phase)
2. Offer user choice: merge to original branch, keep pipeline branch, or manual merge
3. If user chooses merge: fast-forward or merge to original branch, delete pipeline branch

**R14**: When the user cancels a pipeline via `/spec-cancel`, it SHALL:
- Leave the pipeline branch intact for user inspection
- Notify user: "Pipeline branch 'spec-pipeline/{id}' preserved. You can delete it manually or run /spec-resume to continue later."

**R15**: The pipeline branch name SHALL be included in the `/spec-status` output.

#### Resume and Retry Requirements

**R16**: When `/spec-resume` is called after an error, the pipeline SHALL:
- Load the stored `ErrorDetails.agentTask`
- Call `runAgent()` with the EXACT same parameters (agent, role, task, cwd)
- If this retry also fails, repeat the error handling process (save state, stash, notify)
- Allow unlimited retry attempts (user controls when to retry)

**R17**: The `/spec-resume` command SHALL display the previous error before retrying:
```
Resuming pipeline from error state:
────────────────────────────────────
  Failed at:   2026-01-31 14:23:45 UTC
  Agent:       opus
  Role:        implementer
  Phase:       2 of 4
  Cycle:       1 of 3
  Error type:  RATE_LIMIT
  Message:     Rate limit exceeded. Please try again in a few minutes.
────────────────────────────────────

Retrying the same operation...
```

**R18**: If the user manually modified files while the pipeline was paused, `/spec-resume` SHALL:
- Detect dirty working directory via `git status --porcelain`
- Notify user: "Working directory has uncommitted changes. Please commit or stash them before resuming."
- Exit without resuming (do not lose user's work)

#### Display and User Experience Requirements

**R19**: When an error stops the pipeline, the notification SHALL include actionable suggestions based on error type:

| Error Type | Suggestion |
|------------|------------|
| RATE_LIMIT | "Wait a few minutes for rate limits to reset, then run `/spec-resume` to retry" |
| TIMEOUT | "Check your network connection, then run `/spec-resume` to retry" |
| NETWORK | "Check your network connection, then run `/spec-resume` to retry" |
| VALIDATION | "Review the error details above. You may need to manually fix issues before resuming." |
| UNKNOWN | "Check error details in the log file, then run `/spec-resume` to retry" |

**R20**: The `/spec-status` command SHALL display enhanced error information if the pipeline is in error state:
```
Pipeline: 20260131_142345_abcd
Stage: ⚠️ Stopped (Error)
Branch: spec-pipeline/20260131_142345_abcd

Last Error:
  Timestamp:  2026-01-31 14:23:45 UTC
  Agent:      opus (implementer)
  Phase:      2 of 4, Cycle 1 of 3
  Type:       RATE_LIMIT
  Message:    Rate limit exceeded...

Error log: .pi/spec-pipeline/20260131_142345_abcd.error.log
  
To retry: /spec-resume
```

**R21**: Full error details (complete stderr, agent task) SHALL be saved to a file at `.pi/spec-pipeline/{pipelineId}.error.log` for debugging. The log SHALL be appended on each error (not overwritten) to preserve retry history.

### 3. Success Criteria

- [ ] All `runAgent()` calls have exit code checking with proper early return on failure
- [ ] Missing error check on implementer role is fixed (add `return` statement)
- [ ] Missing error checks on codeReviewer and addressReview are added
- [ ] Pipeline creates a separate git branch `spec-pipeline/{id}` for all work
- [ ] Checkpoint commits are created before each file-modifying agent operation
- [ ] Failed agent changes are stashed on error with identifiable message
- [ ] `/spec-resume` retries the exact same agent operation with same task parameter
- [ ] Rate limiting errors (429, "rate limit") are specifically detected and labeled
- [ ] ErrorDetails includes: agent, role, phase, cycle, timestamp, errorType, and agentTask
- [ ] `/spec-status` shows comprehensive error information including branch name
- [ ] Working directory must be clean before starting or resuming pipeline
- [ ] Pipeline branch is squashed and merged on successful completion (with user choice)
- [ ] Error log file is created/appended at `.pi/spec-pipeline/{id}.error.log`
- [ ] User receives actionable suggestions based on error type
- [ ] All existing pipeline functionality continues to work (backward compatible state migration)

### 4. Out of Scope

- **Automatic retry with backoff**: User must manually invoke `/spec-resume` (gives user control)
- **Error analytics or metrics**: No tracking of error rates or patterns across pipelines
- **Partial skip/continue**: Cannot skip a failed step and continue to next phase
- **Custom error handlers**: No user-defined error recovery strategies
- **Notification integrations**: No email/Slack/webhook alerts on errors
- **Git conflict resolution**: User must manually resolve if merge conflicts occur
- **AI-powered error suggestions**: Suggestions are static based on error type classification
- **State file corruption recovery**: Assumes state JSON is always valid
- **Multi-pipeline error handling**: Only handles single active pipeline per project
- **Transaction-style rollback**: Only stashes uncommitted changes, does not revert previous commits
- **Webhook/API for external monitoring**: No programmatic error reporting

### 5. Open Questions

1. ~~Should the pipeline automatically retry after rate limit errors with exponential backoff?~~  
   → **Resolved**: No automatic retry. User must manually `/spec-resume`. This gives user control and avoids burning additional rate limits.

2. ~~What happens to the pipeline branch if the user manually merges or deletes it?~~  
   → **Resolved**: Pipeline will detect missing branch on resume and notify user with recovery instructions. User can recreate branch from state or start fresh.

3. ~~Should there be a `/spec-revert` command to manually revert to the last checkpoint?~~  
   → **Resolved**: Not for MVP. User can manually `git reset --hard <checkpoint-commit>`. Consider for future enhancement.

4. ~~Should the error log file be appended to or overwritten on each error?~~  
   → **Resolved**: Append mode with timestamps. Preserves history of retries for debugging.

5. ~~What if the original branch is deleted while pipeline is running?~~  
   → **Resolved**: Store original branch name. If deleted when merging, warn user and leave pipeline branch as-is.

6. ~~Should we validate that git is available and repository is initialized before starting?~~  
   → **Resolved**: Yes, check `git rev-parse --git-dir` succeeds before starting. Display helpful error if not in a git repository.

7. ~~Should checkpoint commits be tagged for easier identification?~~  
   → **Resolved**: Not needed. Commit message prefix `[CHECKPOINT]` is sufficient and avoids tag pollution.

---

## PART II: High-Level Implementation Plan

### Architectural Guidance

**State Machine Modifications**: The existing `runPipeline()` function will be enhanced with:
- Pre-flight git validation and clean working directory check
- Branch creation and management logic
- Checkpoint commit creation before write operations
- Centralized error handling with stashing
- Cleanup and squash on successful completion

**Error Handling Pattern**: Create a centralized helper to wrap all agent calls:
```typescript
// Pseudocode pattern - actual implementation in phase files
async function runAgentWithErrorHandling(
  state: PipelineState,
  agent: AgentName,
  role: RoleName,
  task: string,
  ...
): Promise<AgentResult | null> {
  await createCheckpoint(state, role);  // Before write roles only
  
  const result = await runAgent(agent, task, cwd, systemPrompt, ...);
  
  if (result.exitCode !== 0) {
    await handleAgentError(state, result, agent, role, task);
    return null;  // Signals caller to stop pipeline
  }
  
  return result;
}
```

**New Helper Functions** to implement:
- `validateGitRepo(cwd): Promise<boolean>` - Check git is available and initialized
- `checkGitClean(cwd): Promise<boolean>` - Verify working directory is clean
- `createPipelineBranch(cwd, id): Promise<string>` - Create and switch to branch
- `createCheckpoint(cwd, state, message): Promise<string>` - Create commit, return hash
- `stashFailedChanges(cwd, timestamp): Promise<string | null>` - Stash and return ref
- `handleAgentError(...)` - Comprehensive error handling, classification, and state save
- `classifyError(stderr): ErrorType` - Detect rate limit, timeout, network errors
- `squashCheckpoints(cwd, state): Promise<void>` - Squash checkpoint commits
- `completePipeline(cwd, state): Promise<void>` - Final cleanup and merge

**Backward Compatibility**: Existing state files will be migrated on load:
- Old `lastError: string` → convert to `ErrorDetails` with minimal info (`errorType: "UNKNOWN"`)
- Missing new fields (`originalBranch`, `checkpoints`, etc.) → initialize with safe defaults
- Existing pipelines without branches continue to work but won't have branch isolation

### Implementation Phases

| Phase | Focus | Effort | Details |
|-------|-------|--------|---------|
| Phase 1 | Fix critical bugs and add error detection | 1.5 days | [phase1_error_detection.md](./2601311007_error_handling/phase1_error_detection.md) |
| Phase 2 | Git branch isolation and checkpoints | 2 days | [phase2_git_checkpoints.md](./2601311007_error_handling/phase2_git_checkpoints.md) |
| Phase 3 | Resume logic and exact retry | 1 day | [phase3_resume_recovery.md](./2601311007_error_handling/phase3_resume_recovery.md) |
| Phase 4 | User experience and error display | 1 day | [phase4_ux_display.md](./2601311007_error_handling/phase4_ux_display.md) |

**Total Estimated Effort**: 5.5 days

### Technical Constraints

1. **Backward compatibility**: Existing active pipelines must be able to resume (state migration on load)
2. **Git repository requirement**: Pipeline can only run in a git-initialized directory
3. **Clean working directory**: User must commit/stash changes before starting or resuming
4. **Branch naming**: Use forward slash (`spec-pipeline/{id}`) for git branch organization
5. **Subprocess exit codes**: Relies on pi subprocess returning non-zero on API errors
6. **State file format**: JSON with atomic write (write to temp file, then rename)
7. **Single active pipeline**: Only one active pipeline per project (existing limitation preserved)
8. **Manual intervention**: Some scenarios (deleted branch, corrupt state) require manual recovery
9. **No Windows-specific paths**: Use `path.join()` for cross-platform compatibility
