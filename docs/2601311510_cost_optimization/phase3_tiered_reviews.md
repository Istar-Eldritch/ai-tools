# Phase 3: Tiered Review Implementation

**Estimated Effort**: 2 days

## Overview

This phase implements the core tiered review system that runs cheaper model reviews first (Sonnet), followed by expensive model reviews (Opus) as a final quality gate. It replaces the current fixed `REVIEW_CYCLES = 3` approach with a configurable cheap/expensive tier system.

The tiered review pattern applies to all three review types:
- Spec reviews (specReviewer)
- Plan reviews (planReviewer)
- Code reviews (codeReviewer)

**Behavioral Change**: This implementation changes commit granularity from per-review-cycle (3 commits per phase) to per-phase (1 commit per phase). This simplifies the commit history while maintaining audit trail via checkpoints.

## Prerequisites

- Phase 1 complete (configuration schema with `ModelConfig`, `TieredModelConfig`, `ProjectConfig.models`, `ProjectConfig.reviewCycles`)
- Phase 2 complete (verdict parsing with `parseVerdict()` and `hasSignificantIssues()` functions)

## Flow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TIERED REVIEW FLOW                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CHEAP TIER (e.g., Sonnet) - N cycles (configurable, default=2)    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  For each cycle:                                              │  │
│  │    1. Run review with cheap model                             │  │
│  │    2. Parse verdict                                           │  │
│  │    3. If APPROVED → break to expensive tier                   │  │
│  │    4. If NEEDS_CHANGES and more cycles → apply fix, continue  │  │
│  │    5. If NEEDS_CHANGES and no more cycles → proceed to expensive│ │
│  └──────────────────────────────────────────────────────────────┘  │
│                            ↓                                        │
│  EXPENSIVE TIER (e.g., Opus) - M cycles (configurable, default=2)  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  For each cycle:                                              │  │
│  │    1. Run review with expensive model (independent review)    │  │
│  │    2. Parse verdict                                           │  │
│  │    3. If APPROVED → done, proceed to next phase               │  │
│  │    4. If NEEDS_CHANGES → apply fix (expensive tier fixes!)    │  │
│  │       - Re-review with expensive model                        │  │
│  │       - Stay at expensive tier until approved or max cycles   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            ↓                                        │
│  PROCEED (approved or max cycles reached)                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Steps

### Step 3.1: Add MODEL_IDENTIFIERS Constant

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: After the `AGENTS` constant (around line 50)
- **Pattern Reference**: Uses `MODELS` from `agents-config.mts` (lines 7-11)
- **Action**: Add a mapping from model shorthand to full identifier

```typescript
// Insert after AGENTS constant (around line 58)

/**
 * Model identifier mapping for ModelConfig.model values
 * Maps short names ("opus", "sonnet", "haiku") to full model identifiers
 */
const MODEL_IDENTIFIERS: Record<"opus" | "sonnet" | "haiku", string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
};
```

- **Verify**: Constant compiles and values match existing `AGENTS` model values

### Step 3.2: Create runAgentWithConfig Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: After the existing `runAgent` function (around line 580)
- **Pattern Reference**: Based on existing `runAgent` function (lines 481-578)
- **Action**: Create a new function that accepts `ModelConfig` directly instead of `AgentName`

```typescript
// Insert after the runAgent function (around line 580)

/**
 * Run a pi subprocess with explicit model configuration
 * Unlike runAgent which looks up config from AGENTS constant,
 * this accepts ModelConfig directly for tiered review flexibility.
 */
async function runAgentWithConfig(
	modelConfig: ModelConfig,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (text: string) => void,
	role?: string
): Promise<AgentResult> {
	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		MODEL_IDENTIFIERS[modelConfig.model],
		"--thinking",
		modelConfig.thinking,
	];

	// Restrict tools based on role
	if (role && READ_ONLY_ROLES.has(role)) {
		args.push("--tools", "read,bash,grep,find,ls");
	} else if (role && WRITE_ROLES.has(role)) {
		args.push("--tools", "read,bash,edit,write,grep,find,ls");
	}

	// Write system prompt to temp file
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-pipeline-"));
	const promptPath = path.join(tmpDir, "system.md");
	fs.writeFileSync(promptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	args.push("--append-system-prompt", promptPath);

	args.push(task);

	let output = "";
	let error = "";
	let proc: ChildProcess | null = null;

	try {
		const exitCode = await new Promise<number>((resolve) => {
			proc = spawn("pi", args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

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

			proc.stdout?.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr?.on("data", (data) => {
				error += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => resolve(1));

			if (signal) {
				const killProc = () => {
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		return { output: output.trim(), exitCode, error: error || undefined };
	} finally {
		try {
			fs.unlinkSync(promptPath);
			fs.rmdirSync(tmpDir);
		} catch {
			/* ignore */
		}
	}
}
```

- **Verify**: Function compiles and can be called with a `ModelConfig` object

### Step 3.3: Define Tiered Review Result Type

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: After the `ReviewVerdict` type definition (from Phase 2)
- **Action**: Add types to track tiered review state and results

```typescript
// Insert after ReviewVerdict type (from Phase 2)

/**
 * Result from a tiered review process
 */
interface TieredReviewResult {
	/** Final verdict from the review process */
	verdict: ReviewVerdict;
	/** Output from the last review */
	lastReviewOutput: string;
	/** Which tier produced the final verdict */
	finalTier: "cheap" | "expensive";
	/** Number of cheap tier cycles completed */
	cheapCyclesCompleted: number;
	/** Number of expensive tier cycles completed */
	expensiveCyclesCompleted: number;
	/** Whether the process was interrupted by an error */
	hadError: boolean;
}

/** Reviewer role names that support tiered configuration */
type TieredReviewerRole = "specReviewer" | "planReviewer" | "codeReviewer";

/**
 * Context for running a tiered review
 */
interface TieredReviewContext {
	/** Current working directory */
	cwd: string;
	/** Project configuration with model settings */
	projectConfig: ProjectConfig;
	/** System prompts - must be compatible with SYSTEM_PROMPTS structure */
	systemPrompts: {
		[K in TieredReviewerRole]: string;
	} & {
		addressReview: string;
	};
	/** Pipeline state for checkpoints and error handling */
	state: PipelineState;
	/** Phase index (1-indexed, for logging/checkpoints) */
	phaseIndex?: number;
	/** UI notification callback */
	notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
	/** Output stream callback */
	onOutput: (text: string) => void;
	/** Optional abort signal for cancellation support */
	signal?: AbortSignal;
}

/**
 * Configuration for a specific review operation
 */
interface ReviewOperation {
	/** The reviewer role */
	role: TieredReviewerRole;
	/** Task prompt to send to the reviewer */
	reviewTask: string;
	/** Task prompt generator for applying fixes - receives review output */
	fixTask: (reviewOutput: string) => string;
	/** Optional: whether to run addressReview for significant issues */
	runAddressReviewOnSignificantIssues?: boolean;
}
```

- **Verify**: Types compile without errors

### Step 3.4: Create runTieredReview Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: After `runAgentWithConfig` function
- **Action**: Create the core tiered review function that implements the flow from the spec

```typescript
// Insert after runAgentWithConfig function

/**
 * Run a tiered review process (R6, R7, R8, R9, R10)
 * 
 * Flow:
 * 1. Cheap tier reviews for N cycles (until APPROVED or max cycles)
 * 2. Expensive tier reviews for M cycles (until APPROVED or max cycles)
 * 3. Expensive tier fixes stay at expensive tier (R8)
 * 
 * @returns TieredReviewResult with final verdict and cycle counts
 */
async function runTieredReview(
	ctx: TieredReviewContext,
	operation: ReviewOperation
): Promise<TieredReviewResult> {
	const { cwd, projectConfig, systemPrompts, state, phaseIndex, notify, onOutput, signal } = ctx;
	const { role, reviewTask, fixTask, runAddressReviewOnSignificantIssues = false } = operation;
	
	const tieredConfig = projectConfig.models[role];
	const cheapCycles = projectConfig.reviewCycles.cheap;
	const expensiveCycles = projectConfig.reviewCycles.expensive;
	
	let lastReviewOutput = "";
	let cheapCyclesCompleted = 0;
	let expensiveCyclesCompleted = 0;
	
	const roleEmoji = role === "specReviewer" ? "📋" : role === "planReviewer" ? "📝" : "💻";
	
	// Update state to track tiered review progress (for resume)
	state.currentReviewTier = "cheap";
	state.cheapCyclesCompleted = 0;
	state.expensiveCyclesCompleted = 0;
	saveState(cwd, state);
	
	// ========================================
	// CHEAP TIER
	// ========================================
	notify(`${roleEmoji} Starting ${role} (cheap tier: ${tieredConfig.cheap.model}/${tieredConfig.cheap.thinking})`, "info");
	
	for (let cycle = 1; cycle <= cheapCycles; cycle++) {
		cheapCyclesCompleted = cycle;
		state.cheapCyclesCompleted = cycle;
		saveState(cwd, state);
		
		notify(`  Cheap cycle ${cycle}/${cheapCycles}`, "info");
		
		// Create checkpoint before review
		await createCheckpointAndSave(cwd, state, role, phaseIndex, cycle, notify);
		
		// Run cheap review
		const reviewResult = await runAgentWithConfig(
			tieredConfig.cheap,
			cycle === 1 ? reviewTask : `Continue review after fixes were applied:\n\n${reviewTask}`,
			cwd,
			systemPrompts[role],
			signal,
			onOutput,
			role
		);
		
		if (reviewResult.exitCode !== 0) {
			// Error handling - save state and return
			// Note: handleAgentError handles stashing changes internally
			await handleAgentError(
				cwd, state, reviewResult,
				tieredConfig.cheap.model,  // model is "opus" | "sonnet" | "haiku" which matches AgentName
				role,
				reviewTask,
				phaseIndex,
				cycle,
				notify
			);
			return {
				verdict: "NEEDS_CHANGES",
				lastReviewOutput,
				finalTier: "cheap",
				cheapCyclesCompleted,
				expensiveCyclesCompleted,
				hadError: true,
			};
		}
		
		lastReviewOutput = reviewResult.output;
		const verdict = parseVerdict(lastReviewOutput);
		notify(`  Cheap cycle ${cycle} verdict: ${verdict}`, "info");
		
		// If approved by cheap model, proceed to expensive tier for final QA
		if (verdict === "APPROVED") {
			notify("  Cheap tier approved - proceeding to expensive tier for final QA", "info");
			break;
		}
		
		// NEEDS_CHANGES - apply fix if more cycles remain
		if (cycle < cheapCycles) {
			notify("  Applying fixes for cheap tier...", "info");
			
			// Create checkpoint before fix
			await createCheckpointAndSave(cwd, state, "addressReview", phaseIndex, cycle, notify);
			
			// Apply fix using addressReview role but cheap model
			const fixResult = await runAgentWithConfig(
				tieredConfig.cheap,  // Use cheap model for cheap tier fixes
				fixTask(lastReviewOutput),
				cwd,
				systemPrompts.addressReview,
				signal,
				onOutput,
				"addressReview"
			);
			
			if (fixResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, fixResult,
					tieredConfig.cheap.model,
					"addressReview",
					fixTask(lastReviewOutput),
					phaseIndex,
					cycle,
					notify
				);
				return {
					verdict: "NEEDS_CHANGES",
					lastReviewOutput,
					finalTier: "cheap",
					cheapCyclesCompleted,
					expensiveCyclesCompleted,
					hadError: true,
				};
			}
		}
	}
	
	// ========================================
	// EXPENSIVE TIER (Final Quality Gate)
	// ========================================
	state.currentReviewTier = "expensive";
	saveState(cwd, state);
	
	notify(`${roleEmoji} Starting ${role} (expensive tier: ${tieredConfig.expensive.model}/${tieredConfig.expensive.thinking})`, "info");
	
	for (let cycle = 1; cycle <= expensiveCycles; cycle++) {
		expensiveCyclesCompleted = cycle;
		state.expensiveCyclesCompleted = cycle;
		saveState(cwd, state);
		
		notify(`  Expensive cycle ${cycle}/${expensiveCycles}`, "info");
		
		// Create checkpoint before expensive review
		// Use offset cycle number to distinguish from cheap tier checkpoints
		await createCheckpointAndSave(cwd, state, role, phaseIndex, cheapCycles + cycle, notify);
		
		// Run expensive review - independent targeted review (R7)
		// The expensive model does its own analysis, not just validating cheap model
		const expensiveReviewTask = cycle === 1
			? `Perform a thorough quality gate review. Focus on areas that may have been missed in initial reviews:\n\n${reviewTask}`
			: `Review after fixes were applied:\n\n${reviewTask}`;
		
		const reviewResult = await runAgentWithConfig(
			tieredConfig.expensive,
			expensiveReviewTask,
			cwd,
			systemPrompts[role],
			signal,
			onOutput,
			role
		);
		
		if (reviewResult.exitCode !== 0) {
			await handleAgentError(
				cwd, state, reviewResult,
				tieredConfig.expensive.model,
				role,
				expensiveReviewTask,
				phaseIndex,
				cheapCycles + cycle,
				notify
			);
			return {
				verdict: "NEEDS_CHANGES",
				lastReviewOutput,
				finalTier: "expensive",
				cheapCyclesCompleted,
				expensiveCyclesCompleted,
				hadError: true,
			};
		}
		
		lastReviewOutput = reviewResult.output;
		const verdict = parseVerdict(lastReviewOutput);
		notify(`  Expensive cycle ${cycle} verdict: ${verdict}`, "info");
		
		// If approved by expensive model, we're done
		if (verdict === "APPROVED") {
			return {
				verdict: "APPROVED",
				lastReviewOutput,
				finalTier: "expensive",
				cheapCyclesCompleted,
				expensiveCyclesCompleted,
				hadError: false,
			};
		}
		
		// NEEDS_CHANGES from expensive tier - fixes stay at expensive tier (R8)
		if (cycle < expensiveCycles) {
			notify("  Applying fixes (staying at expensive tier - R8)...", "info");
			
			// Check for significant issues that need immediate attention
			// (Currently informational; all fixes are applied regardless)
			if (runAddressReviewOnSignificantIssues && hasSignificantIssues(lastReviewOutput)) {
				notify("  Found significant issues - applying fix with expensive model", "info");
			}
			
			// Create checkpoint before fix
			await createCheckpointAndSave(cwd, state, "addressReview", phaseIndex, cheapCycles + cycle, notify);
			
			// Apply fix using expensive model (R8 - stay at expensive tier)
			const fixResult = await runAgentWithConfig(
				tieredConfig.expensive,  // Use expensive model for expensive tier fixes (R8)
				fixTask(lastReviewOutput),
				cwd,
				systemPrompts.addressReview,
				signal,
				onOutput,
				"addressReview"
			);
			
			if (fixResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, fixResult,
					tieredConfig.expensive.model,
					"addressReview",
					fixTask(lastReviewOutput),
					phaseIndex,
					cheapCycles + cycle,
					notify
				);
				return {
					verdict: "NEEDS_CHANGES",
					lastReviewOutput,
					finalTier: "expensive",
					cheapCyclesCompleted,
					expensiveCyclesCompleted,
					hadError: true,
				};
			}
		}
	}
	
	// Max cycles reached without approval - proceed anyway (avoid infinite loops)
	notify(`  Max review cycles reached - proceeding (cycles: cheap=${cheapCyclesCompleted}, expensive=${expensiveCyclesCompleted})`, "warning");
	return {
		verdict: "NEEDS_CHANGES",  // Technically not approved, but we proceed
		lastReviewOutput,
		finalTier: "expensive",
		cheapCyclesCompleted,
		expensiveCyclesCompleted,
		hadError: false,
	};
}
```

- **Verify**: Function compiles and implements the flow from the spec diagram

### Step 3.5: Update PipelineState for Tiered Review Tracking

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Existing `PipelineState` interface (lines 117-170)
- **Action**: Update state to track tiered review progress for resume functionality

```typescript
// In PipelineState interface (around line 140), update/add these fields:

// Before:
	// Implementation state (per phase)
	currentReviewCycle: number;
	previousReview: string;

// After:
	// Implementation state (per phase)
	currentReviewCycle: number;
	previousReview: string;
	
	// Tiered review state (added in Phase 3)
	currentReviewTier?: "cheap" | "expensive";  // Which tier we're currently in
	cheapCyclesCompleted?: number;               // Cycles done in cheap tier
	expensiveCyclesCompleted?: number;           // Cycles done in expensive tier
```

- **Verify**: State can track tiered review progress for resume functionality

### Step 3.6: Remove REVIEW_CYCLES Constant

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current constant at line 188
- **Action**: Remove the fixed constant (now configurable via `projectConfig.reviewCycles`)

```typescript
// Before (line 188):
const REVIEW_CYCLES = 3;

// After:
// REMOVED: REVIEW_CYCLES = 3
// Review cycles are now configurable via projectConfig.reviewCycles.cheap and projectConfig.reviewCycles.expensive
```

- **Verify**: All references to REVIEW_CYCLES are updated to use `projectConfig.reviewCycles`

### Step 3.7: Update REVIEW_CYCLES References

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Update all places that reference `REVIEW_CYCLES`

**Reference 1 - Error display (around line 1187):**
```typescript
// Before:
content.push(formatKeyValue("Cycle", `${error.cycle} of ${REVIEW_CYCLES}`));

// After:
// Note: We can't access projectConfig here, so show cycle count without total
content.push(formatKeyValue("Cycle", String(error.cycle)));
```

**Reference 2 - Status display (around line 1537):**
```typescript
// Before:
lines.push(formatKeyValue("  Review Cycle", `${state.currentReviewCycle}/${REVIEW_CYCLES}`));

// After:
// Show tiered review state if available
if (state.currentReviewTier) {
	lines.push(formatKeyValue("  Review Tier", state.currentReviewTier));
	lines.push(formatKeyValue("  Cheap Cycles", String(state.cheapCyclesCompleted || 0)));
	lines.push(formatKeyValue("  Expensive Cycles", String(state.expensiveCyclesCompleted || 0)));
} else {
	lines.push(formatKeyValue("  Review Cycle", String(state.currentReviewCycle)));
}
```

**Reference 3 - Phase commits initialization (around line 2126):**
```typescript
// Before:
state.phaseCommits = state.phases.map(() => new Array(REVIEW_CYCLES).fill(false));

// After:
// Initialize with empty arrays - commits are tracked per-phase now, not per-cycle
// This reflects the behavioral change: 1 commit per phase instead of per review cycle
state.phaseCommits = state.phases.map(() => []);
```

**Reference 4 & 5 - Implementation loop (around lines 2333, 2337):**
These will be replaced entirely in Step 3.10.

- **Verify**: No remaining references to `REVIEW_CYCLES` constant

### Step 3.8: Update Spec Review to Use Tiered Approach

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current spec review at lines 2001-2066
- **Action**: Replace single Opus review with tiered review, preserving the user approval flow

The spec review flow is special because it involves user approval. The tiered review runs before the user sees it, and the user approval loop must be fully preserved:

```typescript
// Find the spec review section (around line 2000-2070):

// Before (entire block including user approval):
			// Review spec with Opus
			state.stage = "spec_review";
			saveState(cwd, state);

			ctx.ui.notify("🔵 Opus reviewing spec...", "info");
			const reviewTask = `Review this spec draft:\n\n${state.specDraft}`;
			const reviewResult = await runAgent(
				"opus",
				reviewTask,
				cwd,
				SYSTEM_PROMPTS.specReviewer,
				undefined,
				(text) => {
					process.stdout.write(text);
				},
				"specReviewer"
			);

			if (reviewResult.exitCode !== 0) {
				await handleAgentError(
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

			// User review
			state.stage = "user_approval";
			saveState(cwd, state);

			const userDecision = await ctx.ui.confirm(
				"Approve Spec?",
				`${reviewResult.output}\n\n---\n\nDo you approve this spec? (No = provide feedback)`
			);

// After (replace just the review portion, keep user approval intact):
			// Review spec with tiered approach (R6, R10)
			state.stage = "spec_review";
			saveState(cwd, state);

			ctx.ui.notify("📋 Running tiered spec review...", "info");
			
			const specReviewResult = await runTieredReview(
				{
					cwd,
					projectConfig,
					systemPrompts: SYSTEM_PROMPTS,
					state,
					phaseIndex: undefined,  // Spec review is pre-implementation
					notify: ctx.ui.notify.bind(ctx.ui),
					onOutput: (text) => { process.stdout.write(text); },
				},
				{
					role: "specReviewer",
					reviewTask: `Review this spec draft:\n\n${state.specDraft}`,
					fixTask: (reviewOutput) => `Revise the spec to address review feedback.

Current spec at: ${path.join(cwd, state.specPath)}

Review feedback:
${reviewOutput}

Read the current spec, apply fixes, and write the updated version back to the same path.`,
				}
			);
			
			if (specReviewResult.hadError) {
				// Error already handled by runTieredReview
				return;
			}
			
			// Re-read spec after potential fixes from tiered review
			const fullSpecPath = path.join(cwd, state.specPath);
			if (fs.existsSync(fullSpecPath)) {
				state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
			}
			
			// Create a result object compatible with existing user approval flow
			const reviewResult = { output: specReviewResult.lastReviewOutput, exitCode: 0 };

			// === EXISTING USER APPROVAL FLOW (PRESERVED) ===
			// User review
			state.stage = "user_approval";
			saveState(cwd, state);

			const userDecision = await ctx.ui.confirm(
				"Approve Spec?",
				`${reviewResult.output}\n\n---\n\nDo you approve this spec? (No = provide feedback)`
			);

			if (userDecision) {
				state.specApproved = true;
				saveState(cwd, state);
			} else {
				const feedback = await ctx.ui.editor("Provide feedback for spec revision (leave empty to use reviewer feedback as-is):", "");
				if (feedback === undefined) {
					state.stage = "cancelled";
					saveState(cwd, state);
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				if (feedback.trim()) {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nUser feedback (PRIORITY):\n${feedback}\n\nReviewer feedback (reference):\n${reviewResult.output}`;
				} else {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nReviewer feedback (MUST ADDRESS):\n${reviewResult.output}`;
				}
				saveState(cwd, state);
			}
			// === END PRESERVED USER APPROVAL FLOW ===
```

- **Verify**: Spec review runs through tiered process and user approval flow is fully preserved

### Step 3.9: Update Plan Review to Use Tiered Approach

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current plan review at lines 2203-2270
- **Action**: Replace single review + conditional revision with tiered review

The tiered review's `fixTask` callback fully replaces the existing conditional revision block. The flow changes from:
1. Review → if NEEDS_WORK, revise once → done

To:
1. Cheap review cycles (fix between each if needed)
2. Expensive review cycles (fix between each if needed)

```typescript
// Find the plan review section (around line 2203-2270):

// Before (entire plan review and revision block):
		// Review plan with Opus
		ctx.ui.notify("🔵 Opus reviewing implementation plan...", "info");
		const planReviewTask = `Review this implementation plan:\n\n${planContent}`;
		const planReviewResult = await runAgent(
			"opus",
			planReviewTask,
			cwd,
			SYSTEM_PROMPTS.planReviewer,
			undefined,
			(text) => {
				process.stdout.write(text);
			},
			"planReviewer"
		);

		if (planReviewResult.exitCode !== 0) {
			await handleAgentError(
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

		// If review found issues, revise
		if (planReviewResult.output.includes("NEEDS") || planReviewResult.output.includes("Missing")) {
			ctx.ui.notify("🔵 Opus revising plan based on review...", "info");
			const reviseTask = `Revise the implementation plan based on review feedback.

Original spec: ${state.specPath}
Current plan: ${fullPhasePath}

Review feedback:
${planReviewResult.output}

Read the spec and current plan, revise to address the feedback, and write back to: ${fullPhasePath}`;

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
				await handleAgentError(
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
		}

// After (replace entire plan review and revision block):
		// Review plan with tiered approach (R6, R10)
		// The fixTask callback fully replaces the previous conditional revision logic
		ctx.ui.notify("📝 Running tiered plan review...", "info");
		
		const planReviewResult = await runTieredReview(
			{
				cwd,
				projectConfig,
				systemPrompts: SYSTEM_PROMPTS,
				state,
				phaseIndex: i + 1,
				notify: ctx.ui.notify.bind(ctx.ui),
				onOutput: (text) => { process.stdout.write(text); },
			},
			{
				role: "planReviewer",
				reviewTask: `Review this implementation plan:\n\n${planContent}`,
				fixTask: (reviewOutput) => `Revise the implementation plan based on review feedback.

Original spec: ${state.specPath}
Current plan: ${fullPhasePath}

Review feedback:
${reviewOutput}

Read the spec and current plan, revise to address the feedback, and write back to: ${fullPhasePath}`,
			}
		);
		
		if (planReviewResult.hadError) {
			// Error already handled by runTieredReview
			return;
		}
		
		ctx.ui.notify(`Plan review complete (cheap: ${planReviewResult.cheapCyclesCompleted}, expensive: ${planReviewResult.expensiveCyclesCompleted})`, "info");
```

- **Verify**: Plan review uses tiered approach with configurable cycles, fully replacing the old revision logic

### Step 3.10: Replace Code Review Loop with Tiered Approach

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current implementation loop at lines 2320-2500
- **Action**: Replace the fixed cycle loop with tiered review integration

**IMPORTANT BEHAVIORAL CHANGE**: This implementation changes commit granularity from per-review-cycle (3 commits per phase with the old approach) to per-phase (1 commit per phase). This is a deliberate simplification; checkpoints still provide fine-grained recovery points.

```typescript
// Find the implementation phase loop (around line 2320-2500):

// Before (the entire for loop over phases - note: creates 3 commits per phase):
	for (let phaseIdx = state.currentPhaseIndex; phaseIdx < state.phases.length; phaseIdx++) {
		state.currentPhaseIndex = phaseIdx;
		saveState(cwd, state);

		const phasePath = state.phases[phaseIdx];
		const fullPhasePath = path.join(specsDir, phasePath);
		const phasePlan = fs.readFileSync(fullPhasePath, "utf-8");

		ctx.ui.notify(`\n🚀 Starting implementation of Phase ${phaseIdx + 1}/${state.phases.length}`, "info");

		// Determine starting cycle (for resume)
		const startCycle = phaseIdx === state.currentPhaseIndex ? state.currentReviewCycle : 1;

		for (let cycle = startCycle; cycle <= REVIEW_CYCLES; cycle++) {
			// ... existing cycle logic with commit per cycle
		}
		// ... rest of phase loop
	}

// After (replace entire phase implementation loop - creates 1 commit per phase):
	for (let phaseIdx = state.currentPhaseIndex; phaseIdx < state.phases.length; phaseIdx++) {
		state.currentPhaseIndex = phaseIdx;
		state.currentReviewTier = undefined;  // Reset tier tracking for new phase
		state.cheapCyclesCompleted = 0;
		state.expensiveCyclesCompleted = 0;
		saveState(cwd, state);

		const phasePath = state.phases[phaseIdx];
		const fullPhasePath = path.join(specsDir, phasePath);
		const phasePlan = fs.readFileSync(fullPhasePath, "utf-8");

		ctx.ui.notify(`\n🚀 Starting implementation of Phase ${phaseIdx + 1}/${state.phases.length}`, "info");

		// ========================================
		// STEP 1: Initial Implementation
		// ========================================
		
		// Create checkpoint before implementation
		await createCheckpointAndSave(cwd, state, "implementer", phaseIdx + 1, 1, ctx.ui.notify.bind(ctx.ui));

		// Get implementer model config
		const implementerConfig = projectConfig.models.implementer;
		ctx.ui.notify(`🔵 ${implementerConfig.model} implementing...`, "info");
		
		const implementTask = state.previousReview === ""
			? `Implement this phase according to the plan:

${phasePlan}

${projectConfig.testCommand ? `Run tests with: ${projectConfig.testCommand}` : ""}

Make the code changes as specified. Use read, write, edit, and bash tools.`
			: `Continue implementation, addressing the review feedback.

Original plan:
${phasePlan}

Previous review feedback:
${state.previousReview}

${projectConfig.testCommand ? `Run tests with: ${projectConfig.testCommand}` : ""}

Address all issues raised in the review.`;

		const implementResult = await runAgentWithConfig(
			implementerConfig,
			implementTask,
			cwd,
			SYSTEM_PROMPTS.implementer,
			undefined,
			(text) => { process.stdout.write(text); },
			"implementer"
		);

		if (implementResult.exitCode !== 0) {
			await handleAgentError(
				cwd, state, implementResult,
				implementerConfig.model,
				"implementer",
				implementTask,
				phaseIdx + 1,
				1,
				ctx.ui.notify.bind(ctx.ui)
			);
			return;
		}

		// ========================================
		// STEP 2: Tiered Code Review
		// ========================================
		
		ctx.ui.notify("💻 Running tiered code review...", "info");
		
		const codeReviewResult = await runTieredReview(
			{
				cwd,
				projectConfig,
				systemPrompts: SYSTEM_PROMPTS,
				state,
				phaseIndex: phaseIdx + 1,
				notify: ctx.ui.notify.bind(ctx.ui),
				onOutput: (text) => { process.stdout.write(text); },
			},
			{
				role: "codeReviewer",
				reviewTask: `Review the implementation for Phase ${phaseIdx + 1}.

Implementation plan:
${phasePlan}

Check if the implementation matches the plan and follows project conventions.
${projectConfig.testCommand ? `Verify tests pass with: ${projectConfig.testCommand}` : ""}`,
				fixTask: (reviewOutput) => `Address these code review findings:

${reviewOutput}

${projectConfig.testCommand ? `Run tests with: ${projectConfig.testCommand}` : ""}

Make the necessary fixes.`,
				runAddressReviewOnSignificantIssues: true,
			}
		);
		
		if (codeReviewResult.hadError) {
			// Error already handled by runTieredReview
			return;
		}
		
		// Update state with tiered review results
		state.previousReview = codeReviewResult.lastReviewOutput;
		state.currentReviewTier = codeReviewResult.finalTier;
		state.cheapCyclesCompleted = codeReviewResult.cheapCyclesCompleted;
		state.expensiveCyclesCompleted = codeReviewResult.expensiveCyclesCompleted;
		saveState(cwd, state);
		
		ctx.ui.notify(`Code review complete (verdict: ${codeReviewResult.verdict}, cheap: ${codeReviewResult.cheapCyclesCompleted}, expensive: ${codeReviewResult.expensiveCyclesCompleted})`, "info");

		// ========================================
		// STEP 3: Create Commit for Phase
		// Note: Changed from per-cycle commits to per-phase commits
		// ========================================
		
		ctx.ui.notify("🟡 Haiku writing commit message...", "info");
		const phaseCommitTask = `Write a commit message for Phase ${phaseIdx + 1} implementation.

What was implemented:
${implementResult.output.slice(0, 1500)}

Review summary:
${codeReviewResult.lastReviewOutput.slice(0, 500)}

Final review verdict: ${codeReviewResult.verdict}
Cheap review cycles: ${codeReviewResult.cheapCyclesCompleted}
Expensive review cycles: ${codeReviewResult.expensiveCyclesCompleted}`;

		const commitMsgResult = await runAgent(
			"haiku",
			phaseCommitTask,
			cwd,
			SYSTEM_PROMPTS.commitMessageWriter,
			undefined,
			undefined,
			"commitMessageWriter"
		);

		if (commitMsgResult.exitCode === 0) {
			const committed = await createCommit(cwd, extractCommitMessage(commitMsgResult.output));
			if (committed) {
				// Track commit for this phase (now single commit per phase)
				if (!state.phaseCommits[phaseIdx]) {
					state.phaseCommits[phaseIdx] = [];
				}
				state.phaseCommits[phaseIdx].push(true);
				saveState(cwd, state);
				ctx.ui.notify(`Phase ${phaseIdx + 1} committed`, "success");
			}
		}

		// Reset for next phase
		state.currentReviewCycle = 1;
		state.previousReview = "";
		state.currentReviewTier = undefined;
		state.cheapCyclesCompleted = 0;
		state.expensiveCyclesCompleted = 0;
		saveState(cwd, state);

		ctx.ui.notify(`✅ Phase ${phaseIdx + 1} complete`, "success");
	}
```

- **Verify**: Implementation loop uses tiered review with configurable models

### Step 3.11: Update Discovery Agent to Use Configurable Model

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Discovery agent call (around line 1763)
- **Action**: Update to use `runAgentWithConfig` with configured model

```typescript
// Find discovery agent call (around line 1763):

// Before:
			const questionResult = await runAgent(
				"opus",
				questionTask,
				cwd,
				SYSTEM_PROMPTS.discoveryAgent,
				undefined,
				(text) => {
					process.stdout.write(text);
				},
				"discoveryAgent"
			);

			if (questionResult.exitCode !== 0) {
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
				return;
			}

// After:
			const discoveryConfig = projectConfig.models.discoveryAgent;
			ctx.ui.notify(`🔍 ${discoveryConfig.model} generating questions...`, "info");
			
			const questionResult = await runAgentWithConfig(
				discoveryConfig,
				questionTask,
				cwd,
				SYSTEM_PROMPTS.discoveryAgent,
				undefined,
				(text) => {
					process.stdout.write(text);
				},
				"discoveryAgent"
			);

			if (questionResult.exitCode !== 0) {
				await handleAgentError(
					cwd,
					state,
					questionResult,
					discoveryConfig.model,  // Use configured model
					"discoveryAgent",
					questionTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

- **Verify**: Discovery agent uses configured model (default: Sonnet per R14)

### Step 3.12: Update Spec Drafter to Use Configurable Model

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Spec drafter call (around line 1969)
- **Action**: Update to use `runAgentWithConfig` with configured model

```typescript
// Find spec drafter call (around line 1969):

// Before:
			const draftResult = await runAgent("opus", draftTask, cwd, SYSTEM_PROMPTS.specDrafter, undefined, (text) => {
				process.stdout.write(text);
			}, "specDrafter");

			if (draftResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, draftResult,
					"opus",
					"specDrafter",
					draftTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}

// After:
			const specDrafterConfig = projectConfig.models.specDrafter;
			ctx.ui.notify(`📝 ${specDrafterConfig.model} drafting spec...`, "info");
			
			const draftResult = await runAgentWithConfig(
				specDrafterConfig,
				draftTask,
				cwd,
				SYSTEM_PROMPTS.specDrafter,
				undefined,
				(text) => { process.stdout.write(text); },
				"specDrafter"
			);

			if (draftResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, draftResult,
					specDrafterConfig.model,  // Use configured model
					"specDrafter",
					draftTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				return;
			}
```

- **Verify**: Spec drafter uses configured model

### Step 3.13: Update Plan Drafter to Use Configurable Model

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Plan drafter call (around line 2160)
- **Action**: Update plan drafting to use configured model

```typescript
// Find plan draft call (around line 2160):

// Before:
		const planDraftResult = await runAgent(
			"opus",
			planTask,
			cwd,
			SYSTEM_PROMPTS.planDrafter,
			undefined,
			(text) => {
				process.stdout.write(text);
			},
			"planDrafter"
		);

		if (planDraftResult.exitCode !== 0) {
			await handleAgentError(
				cwd, state, planDraftResult,
				"opus",
				"planDrafter",
				planTask,
				undefined,
				undefined,
				ctx.ui.notify.bind(ctx.ui)
			);
			return;
		}

// After:
		const planDrafterConfig = projectConfig.models.planDrafter;
		ctx.ui.notify(`📋 ${planDrafterConfig.model} drafting implementation plan...`, "info");
		
		const planDraftResult = await runAgentWithConfig(
			planDrafterConfig,
			planTask,
			cwd,
			SYSTEM_PROMPTS.planDrafter,
			undefined,
			(text) => { process.stdout.write(text); },
			"planDrafter"
		);

		if (planDraftResult.exitCode !== 0) {
			await handleAgentError(
				cwd, state, planDraftResult,
				planDrafterConfig.model,  // Use configured model
				"planDrafter",
				planTask,
				undefined,
				undefined,
				ctx.ui.notify.bind(ctx.ui)
			);
			return;
		}
```

Note: The plan revision calls inside the old plan review block are now handled by `runTieredReview`'s `fixTask` callback (Step 3.9).

- **Verify**: Plan drafter uses configured model

### Step 3.14: Update retryFailedOperation Function Signature and Implementation

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `retryFailedOperation` function (around line 1215)
- **Action**: Update to use configured models instead of hardcoded `runAgent` call

**A. Update function implementation (around line 1215-1285):**

```typescript
// Find retryFailedOperation function (around line 1215):

// Before (the runAgent call inside the function):
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

// After (replace with configured model selection):
	// Determine model config based on role
	// For reviewer roles during retry, use expensive tier (conservative - ensures quality)
	const tieredReviewerRoles: TieredReviewerRole[] = ["specReviewer", "planReviewer", "codeReviewer"];
	let modelConfig: ModelConfig;
	
	if (tieredReviewerRoles.includes(error.role as TieredReviewerRole)) {
		// For reviewer roles, use expensive tier for retry (conservative)
		const tieredConfig = projectConfig.models[error.role as TieredReviewerRole];
		modelConfig = tieredConfig.expensive;
		ctx.ui.notify(`Retrying ${error.role} with expensive tier (${modelConfig.model})`, "info");
	} else if (error.role === "commitMessageWriter") {
		// Fixed model for commit messages - always Haiku
		modelConfig = { model: "haiku", thinking: "off" };
	} else {
		// Non-tiered roles: use their direct config
		const nonTieredRole = error.role as keyof Pick<typeof projectConfig.models, "discoveryAgent" | "specDrafter" | "planDrafter" | "implementer" | "addressReview">;
		modelConfig = projectConfig.models[nonTieredRole];
	}
	
	// Retry with configured model
	const result = await runAgentWithConfig(
		modelConfig,
		error.agentTask,
		cwd,
		systemPrompt,
		undefined,
		(text) => {
			process.stdout.write(text);
		},
		error.role
	);
```

**B. Verify call sites pass projectConfig (should already be passed - verify around line 1600 in resume logic):**

The `retryFailedOperation` function already receives `projectConfig` as a parameter (line 1222). Verify the call site in the resume command (around line 1600) passes it correctly:

```typescript
// Should already exist (verify):
const retrySucceeded = await retryFailedOperation(state, cwd, projectConfig, ctx);
```

- **Verify**: Retry uses configured models appropriately based on role type

### Step 3.15: Update State Migration for Tiered Review Fields

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `loadState` function (around line 215-295)
- **Action**: Add migration for new tiered review state fields

```typescript
// In loadState function, add migration after the git-related fields migration 
// (around line 288, before the `if (needsSave)` check):

// Before (existing migration for git fields):
		// Initialize missing git-related fields for backward compatibility
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
			// Don't set needsSave - old pipelines without branches are OK
		}
		
		// Save the migrated state back to disk
		if (needsSave) {

// After (add tiered review field migration):
		// Initialize missing git-related fields for backward compatibility
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
			// Don't set needsSave - old pipelines without branches are OK
		}
		
		// Initialize tiered review fields for backward compatibility (Phase 3)
		// Old pipelines don't have tier tracking - they'll be initialized when
		// implementation resumes with the new tiered review system
		if (state.cheapCyclesCompleted === undefined) {
			state.cheapCyclesCompleted = 0;
		}
		if (state.expensiveCyclesCompleted === undefined) {
			state.expensiveCyclesCompleted = 0;
		}
		// currentReviewTier remains undefined for old pipelines - this is OK
		// The tiered review will initialize it when it starts
		
		// Save the migrated state back to disk
		if (needsSave) {
```

- **Verify**: Old pipeline states load without errors

### Step 3.16: Update Configuration Display for Review Cycles

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `formatEffectiveConfig` function (from Phase 1)
- **Action**: Verify review cycles are displayed correctly (should already be handled by Phase 1)

This should already be implemented in Phase 1. Verify the display includes:

```typescript
// In formatEffectiveConfig function (from Phase 1), verify this section exists:
	// Review cycles
	lines.push("  Review Cycles:");
	lines.push(`    Cheap model cycles    : ${config.reviewCycles.cheap}`);
	lines.push(`    Expensive model cycles: ${config.reviewCycles.expensive}`);
```

If not present, add it in Phase 1 implementation.

- **Verify**: Configuration display shows review cycle counts

## Files Summary

### New Files

None - all changes are in existing file.

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Add `MODEL_IDENTIFIERS` constant, add `runAgentWithConfig` function, add tiered review types (`TieredReviewResult`, `TieredReviewContext`, `ReviewOperation`), add `runTieredReview` function, update `PipelineState` interface with tiered review fields, remove `REVIEW_CYCLES` constant, update all `REVIEW_CYCLES` references, update spec/plan/code review operations to use tiered approach, update all agent calls to use configured models, update `retryFailedOperation` to use configured models, update state migration |

## Completion Checklist

- [ ] Step 3.1: `MODEL_IDENTIFIERS` constant created
- [ ] Step 3.2: `runAgentWithConfig` function created
- [ ] Step 3.3: `TieredReviewResult` and related types defined
- [ ] Step 3.4: `runTieredReview` function implements full tiered flow with abort signal support
- [ ] Step 3.5: `PipelineState` updated with tiered review tracking fields
- [ ] Step 3.6: `REVIEW_CYCLES` constant removed
- [ ] Step 3.7: All `REVIEW_CYCLES` references updated
- [ ] Step 3.8: Spec review uses tiered approach with user approval flow preserved
- [ ] Step 3.9: Plan review uses tiered approach (fixTask replaces old revision logic)
- [ ] Step 3.10: Code review uses tiered approach (1 commit per phase vs 3)
- [ ] Step 3.11: Discovery agent uses configurable model (default: Sonnet)
- [ ] Step 3.12: Spec drafter uses configurable model
- [ ] Step 3.13: Plan drafter uses configurable model
- [ ] Step 3.14: `retryFailedOperation` uses configured models with proper type handling
- [ ] Step 3.15: State migration handles new tiered review fields
- [ ] Step 3.16: Configuration display shows review cycles (verify Phase 1)
- [ ] Extension compiles and loads in pi
- [ ] All review flows work correctly (spec, plan, code)
- [ ] Cheap model runs first, expensive model runs as final quality gate
- [ ] Fixes in expensive tier stay at expensive tier (R8)
- [ ] Resume functionality works with new state fields
- [ ] Abort signal properly passed through tiered reviews
- [ ] Error stashing works correctly within tiered review loop

## Testing Verification

After implementation, test these scenarios:

### 1. Basic Tiered Review Flow
- Start a new pipeline
- Verify cheap model (Sonnet) runs first for reviews
- Verify expensive model (Opus) runs as final quality gate
- Check that both tiers run even if cheap tier approves

### 2. Configuration Customization
Create `.pi/spec-pipeline.json`:
```json
{
  "models": {
    "discoveryAgent": { "model": "opus", "thinking": "high" }
  },
  "reviewCycles": {
    "cheap": 1,
    "expensive": 3
  }
}
```
- Verify discovery uses Opus instead of default Sonnet
- Verify review cycles match configuration

### 3. Expensive Tier Fix Behavior (R8)
- Force expensive tier to find issues (modify code during review)
- Verify fixes are applied with expensive model (not cheap)
- Verify re-review uses expensive model

### 4. Resume from Tiered Review
- Interrupt pipeline during tiered review (Ctrl+C or error injection)
- Run `/spec-resume`
- Verify it continues with state correctly tracking tier and cycles
- Verify `currentReviewTier`, `cheapCyclesCompleted`, `expensiveCyclesCompleted` are preserved

### 5. Error Handling and Stashing
- Force an agent error during tiered review
- Verify error is captured with correct model info
- Verify changes are stashed correctly (via `handleAgentError` internal stash logic)
- Verify `/spec-resume` retries with appropriate model (expensive tier for reviewers)

### 6. Backward Compatibility
- Load an existing pipeline state (pre-tiered)
- Verify state migration works (fields initialized to defaults)
- Verify pipeline can continue without errors

### 7. All Review Types
Test each review type uses tiered approach:
- Spec review (user approval flow preserved)
- Plan review (per-phase generation)
- Code review (implementation phase)

### 8. Commit Granularity Change
- Run a full pipeline with multiple phases
- Verify each phase creates exactly 1 commit (not 3 as before)
- Verify checkpoints still provide fine-grained recovery points

### 9. Abort Signal Handling
- Start a pipeline and issue `/spec-cancel` during a tiered review
- Verify the running agent subprocess is terminated
- Verify state is saved correctly for potential resume

## Notes for Phase 4

Phase 4 (Discovery Agent Optimization and Defaults) will:
1. Verify discovery agent defaults to Sonnet (already handled by config defaults)
2. Ensure all default configurations from R14 are properly applied
3. Add any final polish and documentation

The tiered review system from Phase 3 is the core implementation. Phase 4 focuses on validation and cleanup.
