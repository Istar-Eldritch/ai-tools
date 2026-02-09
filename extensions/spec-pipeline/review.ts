/**
 * Review system for the spec pipeline - verdict parsing and tiered review
 */

import type {
	ReviewVerdict,
	TieredReviewResult,
	TieredReviewerRole,
	ProjectConfig,
	SpecState,
	ImplementationState,
	HierarchyState,
	ModelConfig,
} from "./types.ts";
import { runAgentWithConfig } from "./agents.ts";
import { createCheckpointAndSave, createAgentCommit } from "./git.ts";
import { handleAgentError } from "./errors.ts";

// Union type for states that have review-related fields
type ReviewableState = SpecState | ImplementationState | HierarchyState;

// ============================================
// Verdict Parsing
// ============================================

/**
 * Parse verdict from review output (R12, R13)
 * 
 * Looks for explicit verdict markers in the output.
 * Returns NEEDS_CHANGES if no clear verdict is found (conservative behavior per R13).
 * 
 * Test cases:
 *   - "**Verdict**: APPROVED" → APPROVED
 *   - "**Verdict**: NEEDS_CHANGES" → NEEDS_CHANGES  
 *   - "**Status**: APPROVED" → APPROVED
 *   - "**Status**: NEEDS_CHANGES" → NEEDS_CHANGES
 *   - "Blah blah... APPROVED ... more text" → APPROVED
 *   - "The code is APPROVED for merge" → APPROVED
 *   - "NEEDS_CHANGES - see issues below" → NEEDS_CHANGES
 *   - "**Status**: CHANGES_REQUESTED" (legacy) → NEEDS_CHANGES
 *   - "**Status**: READY" (legacy) → APPROVED
 *   - "**Status**: NEEDS_WORK" (legacy) → NEEDS_CHANGES
 *   - "No verdict in output at all" → NEEDS_CHANGES (conservative)
 *   - "APPROVED then later NEEDS_CHANGES" → NEEDS_CHANGES (last wins)
 *   - "NEEDS_CHANGES then later APPROVED" → APPROVED (last wins)
 */
export function parseVerdict(output: string): ReviewVerdict {
	// Normalize output for reliable matching
	const normalized = output.toUpperCase();
	
	// Look for explicit verdict markers using word boundaries
	// Word boundary \b prevents matching partial words (e.g., "UNAPPROVED")
	const approvedMatch = normalized.match(/\bAPPROVED\b/);
	const needsChangesMatch = normalized.match(/\bNEEDS_CHANGES\b/);
	
	// If both appear, use the last one (final verdict takes precedence)
	if (approvedMatch && needsChangesMatch) {
		const approvedIndex = normalized.lastIndexOf("APPROVED");
		const needsChangesIndex = normalized.lastIndexOf("NEEDS_CHANGES");
		return needsChangesIndex > approvedIndex ? "NEEDS_CHANGES" : "APPROVED";
	}
	
	if (approvedMatch) {
		return "APPROVED";
	}
	
	if (needsChangesMatch) {
		return "NEEDS_CHANGES";
	}
	
	// Legacy support: check for old verdict formats that may still appear
	// This helps during transition period and with historical outputs
	if (normalized.includes("CHANGES_REQUESTED") || 
	    normalized.includes("NEEDS_WORK") ||
	    normalized.includes("NEEDS WORK")) {
		return "NEEDS_CHANGES";
	}
	
	if (normalized.includes("READY") && !normalized.includes("NEEDS")) {
		// READY without NEEDS suggests approval (planReviewer legacy)
		return "APPROVED";
	}
	
	// Default to NEEDS_CHANGES if no clear verdict (R13 - conservative behavior)
	return "NEEDS_CHANGES";
}

/**
 * Check if review output mentions critical or major issues
 * Used to determine if addressReview should run
 */
export function hasSignificantIssues(output: string): boolean {
	const normalized = output.toUpperCase();
	return normalized.includes("CRITICAL") || normalized.includes("MAJOR");
}

// ============================================
// Context Types
// ============================================

/**
 * Context for running a tiered review
 */
export interface TieredReviewContext {
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
	state: ReviewableState;
	/** Function to save state after modifications */
	saveFn: () => void;
	/** Phase index (1-indexed, for logging/checkpoints) */
	phaseIndex?: number;
	/** Phase name/description (for commit messages) */
	phaseName?: string;
	/** UI notification callback */
	notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
	/** Output stream callback (optional - if not provided, output is not streamed) */
	onOutput?: (text: string) => void;
	/** Optional abort signal for cancellation support */
	signal?: AbortSignal;
}

/**
 * Configuration for a specific review operation
 */
export interface ReviewOperation {
	/** The reviewer role */
	role: TieredReviewerRole;
	/** Task prompt to send to the reviewer */
	reviewTask: string;
	/** Task prompt generator for applying fixes - receives review output */
	fixTask: (reviewOutput: string) => string;
	/** Optional: whether to run addressReview for significant issues */
	runAddressReviewOnSignificantIssues?: boolean;
}

// ============================================
// Tiered Review Execution
// ============================================

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
export async function runTieredReview(
	ctx: TieredReviewContext,
	operation: ReviewOperation
): Promise<TieredReviewResult> {
	const { cwd, projectConfig, systemPrompts, state, saveFn, phaseIndex, notify, onOutput, signal } = ctx;
	const { role, reviewTask, fixTask, runAddressReviewOnSignificantIssues = false } = operation;
	
	const tieredConfig = projectConfig.models[role];
	// Use the dedicated addressReview model for fix application in both tiers
	const addressReviewConfig = projectConfig.models.addressReview;
	// Get per-reviewer cycle counts
	const reviewerCycles = projectConfig.reviewCycles[role];
	const cheapCycles = reviewerCycles.cheap;
	const expensiveCycles = reviewerCycles.expensive;
	
	// Handle skip case: both cycles are 0 → skip review entirely
	if (cheapCycles === 0 && expensiveCycles === 0) {
		const roleEmoji = role === "specReviewer" ? "📋" : role === "planReviewer" ? "📝" : "💻";
		notify(`${roleEmoji} Skipping ${role} (cycles: 0/0)`, "info");
		return {
			verdict: "APPROVED",  // Treat as approved when skipped
			lastReviewOutput: "",
			finalTier: "cheap",  // Doesn't matter, but need a value
			cheapCyclesCompleted: 0,
			expensiveCyclesCompleted: 0,
			hadError: false,
		};
	}
	
	let lastReviewOutput = "";
	let cheapCyclesCompleted = 0;
	let expensiveCyclesCompleted = 0;
	
	const roleEmoji = role === "specReviewer" ? "📋" : role === "planReviewer" ? "📝" : "💻";
	
	// Update state to track tiered review progress (for resume)
	state.currentReviewTier = cheapCycles > 0 ? "cheap" : "expensive";
	state.cheapCyclesCompleted = 0;
	state.expensiveCyclesCompleted = 0;
	saveFn();
	
	// Build phase context string for notifications
	const phaseCtx = phaseIndex !== undefined ? ` [Phase ${phaseIndex}]` : "";
	
	// ========================================
	// CHEAP TIER (skip if cheapCycles === 0)
	// ========================================
	if (cheapCycles > 0) {
		notify(`${roleEmoji}${phaseCtx} Starting ${role} (cheap tier: ${tieredConfig.cheap.model}/${tieredConfig.cheap.thinking})`, "info");
	} else {
		notify(`${roleEmoji}${phaseCtx} Skipping ${role} cheap tier (cycles: 0)`, "info");
	}
	
	for (let cycle = 1; cycle <= cheapCycles; cycle++) {
		cheapCyclesCompleted = cycle;
		state.cheapCyclesCompleted = cycle;
		saveFn();
		
		notify(`${phaseCtx} Cheap cycle ${cycle}/${cheapCycles}`, "info");
		
		// Create checkpoint before review
		await createCheckpointAndSave(cwd, state, role, saveFn, phaseIndex, cycle, notify);
		
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
				notify,
				saveFn
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
		notify(`${phaseCtx} Cheap cycle ${cycle}/${cheapCycles} verdict: ${verdict}`, "info");
		
		// If approved by cheap model, proceed to expensive tier for final QA
		if (verdict === "APPROVED") {
			notify(`${phaseCtx} Cheap tier approved - proceeding to expensive tier for final QA`, "info");
			break;
		}
		
		// NEEDS_CHANGES - apply fix if more cycles remain
		if (cycle < cheapCycles) {
			notify(`${phaseCtx} Applying fixes (${addressReviewConfig.model})...`, "info");
			
			// Apply fix using dedicated addressReview model config
			const fixResult = await runAgentWithConfig(
				addressReviewConfig,
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
					addressReviewConfig.model,
					"addressReview",
					fixTask(lastReviewOutput),
					phaseIndex,
					cycle,
					notify,
					saveFn
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
			
			// Create commit after addressReview
			const commitResult = await createAgentCommit(
				cwd,
				state,
				{
					role: "addressReview",
					modelConfig: addressReviewConfig,
					phase: phaseIndex,
					phaseName: ctx.phaseName,
					cycle: cycle,
					reviewFeedback: lastReviewOutput,
				},
				projectConfig.models.agentCommitMessageWriter,
				saveFn,
				notify
			);
			
			if (!commitResult.success) {
				if (commitResult.usedFallback) {
					// Fallback was used - abort pipeline (R7)
					notify("Commit message generation failed - fallback used. Pipeline aborted.", "error");
					return {
						verdict: "NEEDS_CHANGES",
						lastReviewOutput,
						finalTier: "cheap",
						cheapCyclesCompleted,
						expensiveCyclesCompleted,
						hadError: true,
					};
				} else {
					// Other commit failure
					notify("Failed to create agent commit", "error");
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
	}
	
	// ========================================
	// EXPENSIVE TIER (Final Quality Gate)
	// Skip if expensiveCycles === 0
	// ========================================
	if (expensiveCycles === 0) {
		// No expensive tier - return result from cheap tier
		notify(`${roleEmoji}${phaseCtx} Skipping ${role} expensive tier (cycles: 0)`, "info");
		const finalVerdict = lastReviewOutput ? parseVerdict(lastReviewOutput) : "APPROVED";
		return {
			verdict: finalVerdict,
			lastReviewOutput,
			finalTier: "cheap",
			cheapCyclesCompleted,
			expensiveCyclesCompleted: 0,
			hadError: false,
		};
	}
	
	state.currentReviewTier = "expensive";
	saveFn();
	
	notify(`${roleEmoji}${phaseCtx} Starting ${role} (expensive tier: ${tieredConfig.expensive.model}/${tieredConfig.expensive.thinking})`, "info");
	
	for (let cycle = 1; cycle <= expensiveCycles; cycle++) {
		expensiveCyclesCompleted = cycle;
		state.expensiveCyclesCompleted = cycle;
		saveFn();
		
		notify(`${phaseCtx} Expensive cycle ${cycle}/${expensiveCycles}`, "info");
		
		// Create checkpoint before expensive review
		// Use offset cycle number to distinguish from cheap tier checkpoints
		await createCheckpointAndSave(cwd, state, role, saveFn, phaseIndex, cheapCycles + cycle, notify);
		
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
				notify,
				saveFn
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
		notify(`${phaseCtx} Expensive cycle ${cycle}/${expensiveCycles} verdict: ${verdict}`, "info");
		
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
		
		// NEEDS_CHANGES from expensive tier
		// Apply fix regardless of whether this is the last cycle - we want the final
		// implementation to address all review feedback even if we've hit the limit
		notify(`${phaseCtx} Applying fixes (${addressReviewConfig.model})...`, "info");
		
		// Check for significant issues that need immediate attention
		// (Currently informational; all fixes are applied regardless)
		if (runAddressReviewOnSignificantIssues && hasSignificantIssues(lastReviewOutput)) {
			notify(`${phaseCtx} Found significant issues - applying fix`, "info");
		}
		
		// Apply fix using dedicated addressReview model config
		const fixResult = await runAgentWithConfig(
			addressReviewConfig,
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
				addressReviewConfig.model,
				"addressReview",
				fixTask(lastReviewOutput),
				phaseIndex,
				cheapCycles + cycle,
				notify,
				saveFn
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
		
		// Create commit after addressReview
		const commitResult = await createAgentCommit(
			cwd,
			state,
			{
				role: "addressReview",
				modelConfig: addressReviewConfig,
				phase: phaseIndex,
				phaseName: ctx.phaseName,
				cycle: cheapCycles + cycle,
				reviewFeedback: lastReviewOutput,
			},
			projectConfig.models.agentCommitMessageWriter,
			saveFn,
			notify
		);
		
		if (!commitResult.success) {
			if (commitResult.usedFallback) {
				// Fallback was used - abort pipeline (R7)
				notify("Commit message generation failed - fallback used. Pipeline aborted.", "error");
				return {
					verdict: "NEEDS_CHANGES",
					lastReviewOutput,
					finalTier: "expensive",
					cheapCyclesCompleted,
					expensiveCyclesCompleted,
					hadError: true,
				};
			} else {
				// Other commit failure
				notify("Failed to create agent commit", "error");
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
	
	// Max cycles reached without approval - but fixes have been applied
	notify(`${phaseCtx} Max review cycles reached - fixes applied, proceeding (cheap=${cheapCyclesCompleted}, expensive=${expensiveCyclesCompleted})`, "warning");
	return {
		verdict: "NEEDS_CHANGES",  // Technically not approved, but we proceed
		lastReviewOutput,
		finalTier: "expensive",
		cheapCyclesCompleted,
		expensiveCyclesCompleted,
		hadError: false,
	};
}

// ============================================
// Retry Failed Operation
// ============================================

/**
 * Retry a failed agent operation using stored error details
 * Returns true if retry succeeded, false if it failed (error already handled)
 * 
 * @param saveFn - Function to save state after modifications
 */
export async function retryFailedOperation(
	state: ReviewableState,
	cwd: string,
	projectConfig: ProjectConfig,
	saveFn: () => void,
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
	const { createSystemPrompts, buildPromptOptions } = await import("./agents-config.ts");
	const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
	
	// Determine the system prompt for this role
	const systemPrompt = SYSTEM_PROMPTS[error.role as keyof typeof SYSTEM_PROMPTS];
	if (!systemPrompt) {
		ctx.ui.notify(`Unknown role: ${error.role}. Cannot retry.`, "error");
		return false;
	}
	
	// Create checkpoint before retry
	await createCheckpointAndSave(
		cwd,
		state,
		`retry_${error.role}`,
		saveFn,
		error.phase,
		error.cycle,
		ctx.ui.notify.bind(ctx.ui)
	);
	
	// Display retry notification
	ctx.ui.notify(`🔄 Retrying ${error.role}...`, "info");
	
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
		undefined,
		error.role
	);
	
	if (result.exitCode !== 0) {
		// Retry failed - handle error (this will stash changes, save state, notify)
		await handleAgentError(
			cwd,
			state,
			result,
			modelConfig.model,
			error.role,
			error.agentTask,
			error.phase,
			error.cycle,
			ctx.ui.notify.bind(ctx.ui),
			saveFn
		);
		return false;
	}
	
	// Retry succeeded - handle role-specific output capture
	if (error.role === "codeReviewer" && "previousReview" in state) {
		state.previousReview = result.output;
	}
	
	// Drop the error stash if it exists
	const { stashExists, dropStash } = await import("./git.ts");
	if (state.errorStash) {
		if (await stashExists(cwd, state.errorStash)) {
			await dropStash(cwd, state.errorStash);
			ctx.ui.notify("Dropped error stash from previous failure", "info");
		}
		state.errorStash = undefined;
	}
	
	// Clear the error state
	state.lastError = undefined;
	saveFn();
	
	// Show summary of retry output
	const { formatAgentSummary } = await import("./formatting.ts");
	ctx.ui.notify(formatAgentSummary(error.role, modelConfig.model, result.output, "🔄"), "success");
	
	return true;
}
