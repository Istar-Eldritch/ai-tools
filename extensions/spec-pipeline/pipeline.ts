/**
 * Main pipeline execution logic
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	PipelineState,
	DiscoveryQA,
	ProjectConfig,
	PipelineUIContext,
	PipelineMetrics,
	AgentCallMetrics,
	RoleName,
} from "./types.ts";
import { MAX_SPEC_ITERATIONS } from "./types.ts";
import { saveState, generateDiscoverySummary } from "./state.ts";
import { createCheckpointAndSave, createCommit, extractCommitMessage, squashCheckpointCommits, mergePipelineBranch, switchToBranch, deleteBranch, createAgentCommit } from "./git.ts";
import { handleAgentError } from "./errors.ts";
import {
	formatStepBanner,
	formatAgentSummary,
	formatState,
	updatePipelineWidget,
	clearPipelineWidget,
	formatDivider,
	formatKeyValue,
} from "./formatting.ts";
import { runAgent, runAgentWithConfig } from "./agents.ts";
import { runTieredReview } from "./review.ts";
import { createSystemPrompts } from "./agents-config.ts";

// ============================================
// Metrics Helpers
// ============================================

/**
 * Initialize metrics for a new pipeline run
 */
function initializeMetrics(skipPlanGeneration: boolean, discoverySkipped: boolean): PipelineMetrics {
	return {
		pipelineStartTime: new Date().toISOString(),
		agentCalls: [],
		specReviewCycles: { cheap: 0, expensive: 0 },
		planReviewCycles: { cheap: 0, expensive: 0 },
		codeReviewCycles: { cheap: 0, expensive: 0 },
		specIterations: 0,
		codeReviewFirstPassRate: 0,
		skipPlanGeneration,
		discoverySkipped,
	};
}

/**
 * Record an agent call in metrics
 */
function recordAgentCall(
	metrics: PipelineMetrics,
	role: RoleName,
	model: "opus" | "sonnet" | "haiku",
	thinking: string,
	startTime: Date,
	exitCode: number,
	phase?: number,
	cycle?: number,
	tier?: "cheap" | "expensive"
): void {
	const endTime = new Date();
	const call: AgentCallMetrics = {
		role,
		model,
		thinking: thinking as AgentCallMetrics["thinking"],
		startTime: startTime.toISOString(),
		endTime: endTime.toISOString(),
		durationMs: endTime.getTime() - startTime.getTime(),
		exitCode,
		phase,
		cycle,
		tier,
	};
	metrics.agentCalls.push(call);
}

/**
 * Finalize metrics at pipeline completion
 */
function finalizeMetrics(metrics: PipelineMetrics, phasesCount: number, phasesApprovedFirstPass: number): void {
	metrics.pipelineEndTime = new Date().toISOString();
	const startTime = new Date(metrics.pipelineStartTime).getTime();
	const endTime = new Date(metrics.pipelineEndTime).getTime();
	metrics.totalDurationMs = endTime - startTime;
	metrics.codeReviewFirstPassRate = phasesCount > 0 
		? Math.round((phasesApprovedFirstPass / phasesCount) * 100)
		: 0;
}

// ============================================
// Phase Extraction
// ============================================

/**
 * Extract phases from a spec document.
 * 
 * Supports two formats:
 * 1. Table format (preferred): | Phase 1 | Focus | Effort | [name](./path/phase1.md) |
 * 2. Inline format (fallback): ### Phase 1: Name
 */
export function extractPhases(specContent: string, specTimestamp: string, shortName: string): { paths: string[]; isInline: boolean } {
	// First try table format: | Phase N | ... | [name](path) |
	const tablePhases: string[] = [];
	const tableRegex = /\|\s*Phase\s*\d+\s*\|[^|]+\|[^|]+\|\s*\[([^\]]+)\]\(([^)]+)\)/g;
	let match;
	while ((match = tableRegex.exec(specContent)) !== null) {
		tablePhases.push(match[2]); // The path to phase file
	}
	
	if (tablePhases.length > 0) {
		return { paths: tablePhases, isInline: false };
	}
	
	// Fallback: detect inline phases (### Phase N: Name)
	const inlinePhases: string[] = [];
	const inlineRegex = /^###\s*Phase\s*(\d+)\s*:\s*(.+?)(?:\s*\([^)]*\))?\s*$/gm;
	while ((match = inlineRegex.exec(specContent)) !== null) {
		const phaseNum = match[1];
		const phaseName = match[2]
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, "")
			.trim()
			.split(/\s+/)
			.slice(0, 3)
			.join("_");
		inlinePhases.push(`${specTimestamp}_${shortName}/phase${phaseNum}_${phaseName}.md`);
	}
	
	return { paths: inlinePhases, isInline: true };
}

// ============================================
// Main Pipeline Execution
// ============================================

/**
 * Main pipeline execution - can be called fresh or to resume
 */
export async function runPipeline(
	state: PipelineState,
	cwd: string,
	projectConfig: ProjectConfig,
	ctx: PipelineUIContext
): Promise<void> {
	const specsDir = path.join(cwd, projectConfig.specsDir);
	const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);

	// Initialize or restore metrics
	if (!state.metrics) {
		const discoverySkipped = state.discovery?.skipped ?? true;
		state.metrics = initializeMetrics(projectConfig.skipPlanGeneration, discoverySkipped);
		state.skipPlanGeneration = projectConfig.skipPlanGeneration;
		saveState(cwd, state);
	}
	const metrics = state.metrics;

	// Track phase timing markers
	let phaseStartTime: Date | undefined;

	// Create specs directory if it doesn't exist
	if (!fs.existsSync(specsDir)) {
		fs.mkdirSync(specsDir, { recursive: true });
		ctx.ui.notify(`Created ${projectConfig.specsDir}/ directory`, "info");
	}

	// ============================================
	// DISCOVERY PHASE (if not skipped)
	// ============================================
	if (state.stage === "discovery" && state.discovery && !state.discovery.completed) {
		// Show step banner for discovery phase start
		ctx.ui.notify(formatStepBanner(
			"DISCOVERY PHASE",
			"Gathering requirements through interactive Q&A",
			"🔍"
		), "info");
		
		// Check if resuming mid-discovery
		if (state.discovery.currentRound > 0 && state.discovery.qaHistory.length > 0) {
			ctx.ui.notify(`🔄 Resuming discovery from round ${state.discovery.currentRound}`, "info");
			ctx.ui.notify(`Previous exchanges: ${state.discovery.qaHistory.length}`, "info");
		}
		ctx.ui.notify(`Maximum ${state.discovery.maxRounds} question rounds (you can proceed early)`, "info");
		
		// Initialize the status widget
		updatePipelineWidget(ctx, state, "Starting discovery...");

		// Initialize discovery state if needed
		if (!state.discovery.qaHistory) {
			state.discovery.qaHistory = [];
		}

		// Q&A loop
		while (
			state.discovery.currentRound < state.discovery.maxRounds &&
			!state.discovery.completed
		) {
			state.discovery.currentRound++;
			saveState(cwd, state);

			// Update widget for this round
			updatePipelineWidget(ctx, state, `Generating questions for round ${state.discovery.currentRound}`);
			
			ctx.ui.notify(formatStepBanner(
				`Discovery Round ${state.discovery.currentRound}/${state.discovery.maxRounds}`,
				"Agent is analyzing requirements and generating questions",
				"📍"
			), "info");

			// Build context for the discovery agent
			let discoveryContext = `Feature request: ${state.description}\n\n`;
			
			// Include previous Q&A if any
			if (state.discovery.qaHistory.length > 0) {
				discoveryContext += "Previous discovery exchanges:\n\n";
				for (const qa of state.discovery.qaHistory) {
					discoveryContext += `Round ${qa.round}:\n`;
					discoveryContext += `Questions:\n${qa.questions}\n`;
					discoveryContext += `Answers:\n${qa.answers}\n\n`;
				}
			}

			// Ask discovery agent to generate questions
			const discoveryConfig = projectConfig.models.discoveryAgent;
			ctx.ui.notify(`🔍 ${discoveryConfig.model} generating questions...`, "info");
			
			const questionTask = state.discovery.currentRound === 1
				? `You are starting a discovery session for this feature:

${state.description}

Explore the codebase first to understand existing patterns and architecture.
Then generate ${projectConfig.discovery.questionsPerRound} clarifying questions (Round 1).

Focus on understanding:
- Core functionality requirements
- Key user workflows
- Critical constraints or limitations`
				: `Continue the discovery session for this feature:

${discoveryContext}

Based on the previous exchanges, generate ${projectConfig.discovery.questionsPerRound} follow-up questions (Round ${state.discovery.currentRound}).

Focus on:
- Gaps still remaining
- Edge cases not yet covered
- Integration details
- Non-functional requirements`;

			const questionStartTime = new Date();
			const questionResult = await runAgentWithConfig(
				discoveryConfig,
				questionTask,
				cwd,
				SYSTEM_PROMPTS.discoveryAgent,
				undefined,
				undefined,
				"discoveryAgent"
			);
			recordAgentCall(metrics, "discoveryAgent", discoveryConfig.model, discoveryConfig.thinking, questionStartTime, questionResult.exitCode);

			if (questionResult.exitCode !== 0) {
				await handleAgentError(
					cwd,
					state,
					questionResult,
					discoveryConfig.model,
					"discoveryAgent",
					questionTask,
					undefined,
					undefined,
					ctx.ui.notify.bind(ctx.ui)
				);
				clearPipelineWidget(ctx);
				return;
			}

			const questions = questionResult.output;
			
			// Update widget to show waiting for user input
			updatePipelineWidget(ctx, state, "Waiting for your answers...");
			
			// Present questions to user with persistent display
			ctx.ui.notify(formatStepBanner(
				`Questions for Round ${state.discovery.currentRound}`,
				"Please answer in the editor that will open",
				"❓"
			), "info");
			
			// Build editor content with questions visible for reference
			const editorContent = `# Discovery Round ${state.discovery.currentRound} - Questions

${questions}

---
# Your Answers Below
# (Delete the questions above or leave them - only your answers matter)
# Options: Type 'skip' to skip, 'done' to finish discovery

`;

			const userResponse = await ctx.ui.editor(
				`Discovery Round ${state.discovery.currentRound} - Your Answers`,
				editorContent
			);

			// Extract the user's actual answers (after the separator)
			let userAnswers = "";
			if (userResponse) {
				const separatorIndex = userResponse.indexOf("# Your Answers Below");
				if (separatorIndex !== -1) {
					const afterSeparator = userResponse.slice(separatorIndex);
					const lines = afterSeparator.split("\n");
					// Skip the separator lines and comment lines, get actual content
					const answerLines = lines.filter(line => 
						!line.startsWith("# ") && 
						!line.startsWith("---") &&
						line.trim() !== ""
					);
					userAnswers = answerLines.join("\n").trim();
				} else {
					// No separator found - use full response
					userAnswers = userResponse.trim();
				}
			}

			// Handle user response
			if (userResponse === undefined || userAnswers === "") {
				// Empty response - ask what to do
				const emptyOptions = [
					"Proceed to spec drafting (skip remaining discovery)",
					"Skip this round and continue discovery",
					"Cancel pipeline",
				];
				const emptyActionLabel = await ctx.ui.select(
					"No answers provided. What would you like to do?",
					emptyOptions
				);
				
				// Map label back to value
				const emptyAction = emptyActionLabel === emptyOptions[0] ? "done"
					: emptyActionLabel === emptyOptions[1] ? "skip"
					: "cancel";
				
				if (emptyAction === "done") {
					ctx.ui.notify("Finishing discovery phase...", "info");
					state.discovery.completed = true;
					saveState(cwd, state);
					break;
				} else if (emptyAction === "skip") {
					ctx.ui.notify("Skipping this round...", "info");
					continue;
				} else {
					// cancel
					state.stage = "cancelled";
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					ctx.ui.notify("Discovery cancelled", "info");
					return;
				}
			}

			const normalizedAnswers = userAnswers.toLowerCase();

			if (normalizedAnswers === "done" || normalizedAnswers === "proceed") {
				// User wants to finish discovery early
				ctx.ui.notify("Finishing discovery phase...", "info");
				state.discovery.completed = true;
				saveState(cwd, state);
				break;
			}

			if (normalizedAnswers === "skip") {
				// Skip this round but continue discovery
				ctx.ui.notify("Skipping this round...", "info");
				continue;
			}

			// Record the Q&A exchange (userAnswers was already extracted above)
			const qaExchange: DiscoveryQA = {
				round: state.discovery.currentRound,
				questions: questions,
				answers: userAnswers,
				timestamp: new Date().toISOString(),
			};
			state.discovery.qaHistory.push(qaExchange);
			saveState(cwd, state);

			ctx.ui.notify(`✅ Round ${state.discovery.currentRound} recorded`, "success");

			// Check if max rounds reached
			if (state.discovery.currentRound >= state.discovery.maxRounds) {
				ctx.ui.notify(`\nMaximum rounds (${state.discovery.maxRounds}) reached.`, "info");
				
				const continueMore = await ctx.ui.confirm(
					"Continue Discovery?",
					"You've reached the maximum rounds. Would you like to extend by 2 more rounds?"
				);
				
				if (continueMore) {
					state.discovery.maxRounds += 2;
					saveState(cwd, state);
					ctx.ui.notify("Extended discovery by 2 rounds", "info");
				} else {
					state.discovery.completed = true;
					saveState(cwd, state);
				}
			}
		}

		// Show discovery summary and confirm before proceeding
		if (state.discovery.qaHistory.length > 0) {
			state.discovery.discoverySummary = generateDiscoverySummary(state.discovery.qaHistory);
			
			ctx.ui.notify("\n📋 Discovery Summary Preview:", "info");
			ctx.ui.notify("─────────────────────────────────────────", "info");
			
			// Show a condensed version of the summary
			const summaryPreview = state.discovery.discoverySummary.length > 2000
				? state.discovery.discoverySummary.slice(0, 2000) + "\n\n[... truncated for preview ...]"
				: state.discovery.discoverySummary;
			
			ctx.ui.notify(summaryPreview, "info");
			ctx.ui.notify("─────────────────────────────────────────", "info");
			
			const proceedToSpec = await ctx.ui.confirm(
				"Proceed to Spec Drafting?",
				`Discovery gathered ${state.discovery.qaHistory.length} Q&A exchanges.\n\nProceed to spec drafting with this context?`
			);
			
			if (!proceedToSpec) {
				// Allow user to add more context or continue discovery
				ctx.ui.notify("Options: Add additional context, or leave empty to cancel.", "info");
				
				const additionalContext = await ctx.ui.editor(
					"Add any additional context or requirements (or leave empty to cancel)",
					""
				);
				
				if (additionalContext === undefined || additionalContext.trim() === "") {
					state.stage = "cancelled";
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					ctx.ui.notify("Pipeline cancelled", "info");
					return;
				}
				
				// Append additional context as a special entry
				const additionalQA: DiscoveryQA = {
					round: state.discovery.currentRound + 1,
					questions: "User provided additional context:",
					answers: additionalContext,
					timestamp: new Date().toISOString(),
				};
				state.discovery.qaHistory.push(additionalQA);
				state.discovery.discoverySummary = generateDiscoverySummary(state.discovery.qaHistory);
				saveState(cwd, state);
				
				ctx.ui.notify("Additional context added", "success");
			}
			
			ctx.ui.notify(`\n✅ Discovery complete - ${state.discovery.qaHistory.length} Q&A exchanges recorded`, "success");
		} else {
			ctx.ui.notify("\n✅ Discovery complete (no Q&A recorded)", "success");
		}

		// Transition to spec drafting
		state.discovery.completed = true;
		state.stage = "spec_drafting";
		saveState(cwd, state);
		
		// Update widget for transition
		updatePipelineWidget(ctx, state, "Moving to spec drafting...");
	}

	// ============================================
	// PHASE 1: Spec Drafting Loop
	// ============================================
	if (!state.specApproved) {
		// Show step banner for spec drafting phase
		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING PHASE",
			"Creating and reviewing technical specification",
			"📝"
		), "info");
		
		// Check if we're resuming mid-iteration (spec_review or user_approval stage)
		const resumingMidIteration = state.stage === "spec_review" || state.stage === "user_approval";
		
		while (!state.specApproved && state.specIteration < MAX_SPEC_ITERATIONS) {
			// Only increment iteration and run specDrafter if NOT resuming mid-iteration
			const skipSpecDrafter = resumingMidIteration && state.specIteration > 0;
			
			if (!skipSpecDrafter) {
				state.specIteration++;
				state.stage = "spec_drafting";
				saveState(cwd, state);
			}

			const fullSpecPath = path.join(cwd, state.specPath);
			
			// ========================================
			// STEP 1: Spec Drafting (skip if resuming mid-iteration)
			// ========================================
			if (!skipSpecDrafter) {
				// Update widget
				updatePipelineWidget(ctx, state, `Drafting spec (iteration ${state.specIteration}/${MAX_SPEC_ITERATIONS})`);
				
				ctx.ui.notify(formatStepBanner(
					`Spec Iteration ${state.specIteration}/${MAX_SPEC_ITERATIONS}`,
					"Agent is drafting the specification",
					"📄"
				), "info");

				// Draft spec using configured model
				const specDrafterConfig = projectConfig.models.specDrafter;
				ctx.ui.notify(`📝 ${specDrafterConfig.model} drafting spec...`, "info");

				// Build discovery context if available
				const discoveryContext = state.discovery?.discoverySummary
					? `\n\n## Discovery Context\n\nThe following requirements were gathered during discovery:\n\n${state.discovery.discoverySummary}\n\nUse this information to create a comprehensive specification.\n`
					: "";

				const draftTask =
					state.specIteration === 1
						? `Create a technical specification for: ${state.description}
${discoveryContext}
The spec timestamp is: ${state.specTimestamp}

IMPORTANT: Write the spec to this EXACT path: ${fullSpecPath}

Use the timestamp for phase file paths in your implementation plan table.
Example: [phase1_api.md](./${state.specTimestamp}_feature_name/phase1_api.md)

Explore the project structure first to understand conventions:
- Look for existing specs or documentation
- Check the codebase structure
- Find similar implementations to reference

Focus on creating a clear spec that fits this project's patterns.
Incorporate all requirements gathered during discovery.
After creating the spec content, use the write tool to save it to the path above.`
						: `Revise the spec based on the feedback below.

IMPORTANT: If both user feedback and reviewer feedback are provided, USER FEEDBACK TAKES PRIORITY.
Follow user instructions even if they conflict with reviewer suggestions.

Read the current spec at: ${fullSpecPath}
Then revise it and write the updated version back to the SAME path.

Previous feedback to address:
${state.specDraft}`;

				const draftStartTime = new Date();
				const draftResult = await runAgentWithConfig(
					specDrafterConfig,
					draftTask,
					cwd,
					SYSTEM_PROMPTS.specDrafter,
					undefined,
					undefined,
					"specDrafter"
				);
				recordAgentCall(metrics, "specDrafter", specDrafterConfig.model, specDrafterConfig.thinking, draftStartTime, draftResult.exitCode);
				metrics.specIterations = state.specIteration;
				saveState(cwd, state);

				if (draftResult.exitCode !== 0) {
					await handleAgentError(
						cwd,
						state,
						draftResult,
						specDrafterConfig.model,
						"specDrafter",
						draftTask,
						undefined,
						undefined,
						ctx.ui.notify.bind(ctx.ui)
					);
					clearPipelineWidget(ctx);
					return;
				}

				// Show summary of spec drafter output
				ctx.ui.notify(formatAgentSummary("specDrafter", specDrafterConfig.model, draftResult.output), "info");

				// Read the spec file that was written by the agent
				if (!fs.existsSync(fullSpecPath)) {
					const errorMsg = `Spec file was not created at ${fullSpecPath}`;
					state.lastError = undefined;
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					ctx.ui.notify(errorMsg, "error");
					return;
				}
				state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
				ctx.ui.notify(`📄 Spec draft saved to ${projectConfig.specsDir}/${state.specFilename}`, "info");

				// Create commit after spec drafting (R1, R2)
				const commitResult = await createAgentCommit(
					cwd,
					state,
					{
						role: "specDrafter",
						modelConfig: specDrafterConfig,
					},
					projectConfig.models.agentCommitMessageWriter,
					ctx.ui.notify.bind(ctx.ui)
				);
				
				if (!commitResult.success) {
					if (commitResult.usedFallback) {
						// Fallback was used - abort pipeline (R7)
						state.lastError = "Commit message generation failed - fallback used";
						saveState(cwd, state);
						clearPipelineWidget(ctx);
						return;
					} else {
						// Other commit failure
						state.lastError = undefined;
						saveState(cwd, state);
						clearPipelineWidget(ctx);
						ctx.ui.notify("Failed to create agent commit", "error");
						return;
					}
				}

				// Mark that we're now in spec_review stage
				state.stage = "spec_review";
				saveState(cwd, state);
			} else {
				// Resuming mid-iteration - log that we're skipping specDrafter
				ctx.ui.notify(`🔄 Resuming iteration ${state.specIteration} (skipping spec drafting)`, "info");
				// Make sure we have the spec content loaded
				if (fs.existsSync(fullSpecPath)) {
					state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
				}
			}
			
			// ========================================
			// STEP 2: Spec Review (skip if resuming at user_approval)
			// ========================================
			const skipSpecReview = state.stage === "user_approval";
			
			// Variable to hold review output for user approval
			let reviewResultOutput: string;

			if (!skipSpecReview) {
				// Update widget for review phase
				updatePipelineWidget(ctx, state, "Running spec review...");
				
				ctx.ui.notify(formatStepBanner(
					"Spec Review",
					"Running tiered review (cheap → expensive)",
					"🔍"
				), "info");
				
				const specReviewResult = await runTieredReview(
					{
						cwd,
						projectConfig,
						systemPrompts: SYSTEM_PROMPTS,
						state,
						phaseIndex: undefined,
						notify: ctx.ui.notify.bind(ctx.ui),
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
					clearPipelineWidget(ctx);
					return;
				}
				
				// Track spec review metrics
				metrics.specReviewCycles.cheap += specReviewResult.cheapCyclesCompleted;
				metrics.specReviewCycles.expensive += specReviewResult.expensiveCyclesCompleted;
				saveState(cwd, state);
				
				// Show summary of spec review
				ctx.ui.notify(formatAgentSummary(
					`specReviewer (${specReviewResult.finalTier})`,
					specReviewResult.finalTier === "cheap" 
						? projectConfig.models.specReviewer.cheap.model 
						: projectConfig.models.specReviewer.expensive.model,
					specReviewResult.lastReviewOutput,
					specReviewResult.verdict === "APPROVED" ? "✅" : "🔄",
					undefined,
					`(cheap: ${specReviewResult.cheapCyclesCompleted}, expensive: ${specReviewResult.expensiveCyclesCompleted})`
				), "info");
				
				// Re-read spec after potential fixes from tiered review
				const fullSpecPathReread = path.join(cwd, state.specPath);
				if (fs.existsSync(fullSpecPathReread)) {
					state.specDraft = fs.readFileSync(fullSpecPathReread, "utf-8");
				}
				
				reviewResultOutput = specReviewResult.lastReviewOutput;
				
				// Mark that we're now in user_approval stage
				state.stage = "user_approval";
				saveState(cwd, state);
			} else {
				// Resuming at user_approval - log that we're skipping spec review
				ctx.ui.notify(`🔄 Resuming at user approval (skipping spec review)`, "info");
				reviewResultOutput = "(Review already completed - resuming at user approval)";
			}

			// Update widget for user input
			updatePipelineWidget(ctx, state, "Awaiting your approval...");
			
			ctx.ui.notify(formatStepBanner(
				"User Approval Required",
				"Please review the spec and decide whether to approve",
				"👤"
			), "info");

			const userDecision = await ctx.ui.confirm(
				"Approve Spec?",
				`${reviewResultOutput}\n\n---\n\nDo you approve this spec? (No = provide feedback)`
			);

			if (userDecision) {
				state.specApproved = true;
				saveState(cwd, state);
			} else {
				const feedback = await ctx.ui.editor("Provide feedback for spec revision (leave empty to use reviewer feedback as-is):", "");
				if (feedback === undefined) {
					state.stage = "cancelled";
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				if (feedback.trim()) {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nUser feedback (PRIORITY):\n${feedback}\n\nReviewer feedback (reference):\n${reviewResultOutput}`;
				} else {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nReviewer feedback (MUST ADDRESS):\n${reviewResultOutput}`;
				}
				saveState(cwd, state);
			}
		}

		if (!state.specApproved) {
			// Ask user what to do when max iterations reached
			const maxIterOptions = [
				"Approve current spec",
				"Add 3 more iterations",
				"Cancel",
			];
			const choiceLabel = await ctx.ui.select(
				`Reached ${MAX_SPEC_ITERATIONS} spec iterations without approval. What would you like to do?`,
				maxIterOptions
			);
			
			// Map label back to value
			const choice = choiceLabel === maxIterOptions[0] ? "approve"
				: choiceLabel === maxIterOptions[1] ? "extend"
				: "cancel";

			if (choice === "approve") {
				state.specApproved = true;
				saveState(cwd, state);
			} else if (choice === "extend") {
				// Reset iteration count to allow more attempts
				state.specIteration = MAX_SPEC_ITERATIONS - 3;
				state.lastError = undefined;
				saveState(cwd, state);
				ctx.ui.notify("Added 3 more iterations. Run /spec-resume to continue.", "info");
				return;
			} else {
				state.stage = "cancelled";
				state.lastError = undefined;
				saveState(cwd, state);
				clearPipelineWidget(ctx);
				ctx.ui.notify("Cancelled by user at max iterations", "info");
				return;
			}
		}

		ctx.ui.notify(`✅ Spec approved: ${state.specFilename}`, "success");
	}

	// ============================================
	// PHASE 2: Implementation Plan Generation
	// ============================================
	if (state.phases.length === 0) {
		// Re-read spec from file in case it was modified
		const fullSpecPath = path.join(cwd, state.specPath);
		if (fs.existsSync(fullSpecPath)) {
			state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
		}

		const shortName = state.description
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, "")
			.split(/\s+/)
			.slice(0, 3)
			.join("_");

		const phaseResult = extractPhases(state.specDraft, state.specTimestamp, shortName);
		state.phases = phaseResult.paths;

		if (phaseResult.isInline && state.phases.length > 0) {
			ctx.ui.notify(`⚠️ Detected ${state.phases.length} inline phases (table format preferred)`, "warning");
		}

		if (state.phases.length === 0) {
			ctx.ui.notify("No phases found in spec - using single implementation phase", "info");
			state.phases.push(`${state.specTimestamp}_${shortName}/phase1_implementation.md`);
		} else {
			ctx.ui.notify(`Found ${state.phases.length} phases to implement`, "info");
		}

		state.phasesGenerated = new Array(state.phases.length).fill(false);
		state.phaseCommits = state.phases.map(() => []);
		saveState(cwd, state);
	}

	// Generate implementation plans for phases that haven't been generated yet
	// UNLESS skipPlanGeneration is enabled (A/B testing experiment)
	if (projectConfig.skipPlanGeneration) {
		// Skip plan generation entirely - mark all phases as "generated" 
		// The implementer will work directly from the spec
		ctx.ui.notify(formatStepBanner(
			"PLAN GENERATION SKIPPED",
			"Direct implementation mode (skipPlanGeneration=true)",
			"⏭️"
		), "info");
		ctx.ui.notify("Implementation will work directly from spec without detailed plans", "info");
		
		// Mark all phases as generated (they'll use spec content directly)
		state.phasesGenerated = state.phases.map(() => true);
		saveState(cwd, state);
	} else {
		state.stage = "plan_generation";
		saveState(cwd, state);

		// Show step banner for plan generation
		ctx.ui.notify(formatStepBanner(
			"PLAN GENERATION PHASE",
			`Creating implementation plans for ${state.phases.length} phase(s)`,
			"📋"
		), "info");

		for (let i = 0; i < state.phases.length; i++) {
			if (state.phasesGenerated[i]) {
			continue;
		}

		const phasePath = state.phases[i];
		const fullPhasePath = path.join(specsDir, phasePath);

		// Update widget
		updatePipelineWidget(ctx, state, `Generating plan for phase ${i + 1}/${state.phases.length}`);
		
		ctx.ui.notify(formatStepBanner(
			`Phase ${i + 1}/${state.phases.length} Plan`,
			`Creating detailed implementation plan`,
			"📝"
		), "info");

		// Draft plan using configured model
		const planDrafterConfig = projectConfig.models.planDrafter;
		ctx.ui.notify(`📋 ${planDrafterConfig.model} drafting implementation plan...`, "info");
		
		const planTask = `Create detailed implementation plan for Phase ${i + 1}.

Spec:
${state.specDraft}

IMPORTANT: Write the plan file to this EXACT path: ${fullPhasePath}

Explore the codebase first to understand:
- Project structure and conventions
- Similar existing implementations
- Test patterns used

Then create a detailed, executable plan and save it to the path above.`;

		const planStartTime = new Date();
		const planDraftResult = await runAgentWithConfig(
			planDrafterConfig,
			planTask,
			cwd,
			SYSTEM_PROMPTS.planDrafter,
			undefined,
			undefined,
			"planDrafter"
		);
		recordAgentCall(metrics, "planDrafter", planDrafterConfig.model, planDrafterConfig.thinking, planStartTime, planDraftResult.exitCode, i + 1);
		saveState(cwd, state);

		if (planDraftResult.exitCode !== 0) {
			await handleAgentError(
				cwd,
				state,
				planDraftResult,
				planDrafterConfig.model,
				"planDrafter",
				planTask,
				undefined,
				undefined,
				ctx.ui.notify.bind(ctx.ui)
			);
			clearPipelineWidget(ctx);
			return;
		}

		// Show summary of plan drafter output
		ctx.ui.notify(formatAgentSummary("planDrafter", planDrafterConfig.model, planDraftResult.output, "✅", i + 1), "info");

		// Verify the file was created
		if (!fs.existsSync(fullPhasePath)) {
			const errorMsg = `Plan file was not created at ${fullPhasePath}`;
			state.lastError = undefined;
			saveState(cwd, state);
			clearPipelineWidget(ctx);
			ctx.ui.notify(errorMsg, "error");
			return;
		}

		const planContent = fs.readFileSync(fullPhasePath, "utf-8");

		// Create commit after plan drafting (R1, R2)
		const commitResult = await createAgentCommit(
			cwd,
			state,
			{
				role: "planDrafter",
				modelConfig: planDrafterConfig,
				phase: i + 1,
			},
			projectConfig.models.agentCommitMessageWriter,
			ctx.ui.notify.bind(ctx.ui)
		);
		
		if (!commitResult.success) {
			if (commitResult.usedFallback) {
				// Fallback was used - abort pipeline (R7)
				state.lastError = "Commit message generation failed - fallback used";
				saveState(cwd, state);
				clearPipelineWidget(ctx);
				return;
			} else {
				// Other commit failure
				state.lastError = undefined;
				saveState(cwd, state);
				clearPipelineWidget(ctx);
				ctx.ui.notify("Failed to create agent commit", "error");
				return;
			}
		}

		// Review plan with tiered approach
		ctx.ui.notify("📝 Running tiered plan review...", "info");
		
		const planReviewResult = await runTieredReview(
			{
				cwd,
				projectConfig,
				systemPrompts: SYSTEM_PROMPTS,
				state,
				phaseIndex: i + 1,
				notify: ctx.ui.notify.bind(ctx.ui),
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
			clearPipelineWidget(ctx);
			return;
		}
		
		// Track plan review metrics
		metrics.planReviewCycles.cheap += planReviewResult.cheapCyclesCompleted;
		metrics.planReviewCycles.expensive += planReviewResult.expensiveCyclesCompleted;
		saveState(cwd, state);
		
		// Show summary of plan review
		ctx.ui.notify(formatAgentSummary(
			`planReviewer (${planReviewResult.finalTier})`,
			planReviewResult.finalTier === "cheap" 
				? projectConfig.models.planReviewer.cheap.model 
				: projectConfig.models.planReviewer.expensive.model,
			planReviewResult.lastReviewOutput,
			planReviewResult.verdict === "APPROVED" ? "✅" : "🔄",
			i + 1,
			`(cheap: ${planReviewResult.cheapCyclesCompleted}, expensive: ${planReviewResult.expensiveCyclesCompleted})`
		), "info");

		state.phasesGenerated[i] = true;
		saveState(cwd, state);
		ctx.ui.notify(`Phase ${i + 1} plan saved to ${phasePath}`, "success");
		}
	} // End of else block for !skipPlanGeneration

	// ============================================
	// Commit spec (if not already committed)
	// ============================================
	if (!state.specCommitted) {
		state.stage = "spec_commit";
		saveState(cwd, state);

		// Update widget
		updatePipelineWidget(ctx, state, "Committing spec...");
		
		ctx.ui.notify(formatStepBanner(
			"Spec Commit",
			"Creating commit for specification",
			"💾"
		), "info");
		const specCommitTask = `Write a commit message for this new specification:

File: ${state.specFilename}
Description: ${state.description}

${state.specDraft.slice(0, 2000)}...`;

		const commitMsgResult = await runAgent(
			"haiku",
			specCommitTask,
			cwd,
			SYSTEM_PROMPTS.commitMessageWriter,
			undefined,
			undefined,
			"commitMessageWriter"
		);

		if (commitMsgResult.exitCode === 0) {
			const committed = await createCommit(cwd, extractCommitMessage(commitMsgResult.output));
			if (committed) {
				state.specCommitted = true;
				saveState(cwd, state);
				ctx.ui.notify("Spec committed", "success");
			} else {
				ctx.ui.notify("Spec commit failed (maybe no changes?)", "warning");
			}
		}
	}

	// ============================================
	// PHASE 3: Implementation with Tiered Review
	// ============================================
	state.stage = "implementation";
	saveState(cwd, state);

	// Show step banner for implementation phase
	ctx.ui.notify(formatStepBanner(
		"IMPLEMENTATION PHASE",
		`Implementing ${state.phases.length} phase(s) with code review`,
		"🚀"
	), "info");

	for (let phaseIdx = state.currentPhaseIndex; phaseIdx < state.phases.length; phaseIdx++) {
		state.currentPhaseIndex = phaseIdx;
		
		// Check if we're resuming mid-phase
		const resumingMidPhase = state.implementerCompletedForPhase === true;
		
		if (!resumingMidPhase) {
			// Starting fresh phase - reset tier tracking
			state.currentReviewTier = undefined;
			state.cheapCyclesCompleted = 0;
			state.expensiveCyclesCompleted = 0;
			state.implementerCompletedForPhase = false;
		}
		saveState(cwd, state);

		const phasePath = state.phases[phaseIdx];
		const fullPhasePath = path.join(specsDir, phasePath);
		
		// Get the implementation guidance - either from plan file or directly from spec
		let phasePlan: string;
		if (state.skipPlanGeneration || projectConfig.skipPlanGeneration) {
			// No plan file - use spec content directly with phase context
			phasePlan = `## Direct Implementation from Spec (No Plan File)

This is Phase ${phaseIdx + 1} of ${state.phases.length}.
Expected phase file: ${phasePath}

## Full Specification

${state.specDraft}

## Instructions

Implement this phase according to the specification above. 
Focus on Phase ${phaseIdx + 1} requirements.
Explore the codebase to understand existing patterns before making changes.`;
		} else if (fs.existsSync(fullPhasePath)) {
			phasePlan = fs.readFileSync(fullPhasePath, "utf-8");
		} else {
			// Fallback for edge case where plan file doesn't exist
			ctx.ui.notify(`⚠️ Plan file not found: ${fullPhasePath}, using spec`, "warning");
			phasePlan = `## Implementation from Spec (Plan File Missing)

${state.specDraft}`;
		}

		// Update widget
		updatePipelineWidget(ctx, state, `Implementing phase ${phaseIdx + 1}/${state.phases.length}`);
		
		ctx.ui.notify(formatStepBanner(
			`Implementation Phase ${phaseIdx + 1}/${state.phases.length}`,
			phasePath.split("/").pop() || "implementation",
			"🔨"
		), "info");

		// ========================================
		// STEP 1: Initial Implementation
		// ========================================
		
		let implementationSummary: string;
		
		if (!resumingMidPhase) {
			const implementerConfig = projectConfig.models.implementer;
			
			// Update widget for implementation
			updatePipelineWidget(ctx, state, `Implementing (${implementerConfig.model})...`);
			
			ctx.ui.notify(`🔵 ${implementerConfig.model} implementing phase ${phaseIdx + 1}...`, "info");
			
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

			const implementStartTime = new Date();
			const implementResult = await runAgentWithConfig(
				implementerConfig,
				implementTask,
				cwd,
				SYSTEM_PROMPTS.implementer,
				undefined,
				undefined,
				"implementer"
			);
			recordAgentCall(metrics, "implementer", implementerConfig.model, implementerConfig.thinking, implementStartTime, implementResult.exitCode, phaseIdx + 1);
			saveState(cwd, state);

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
				clearPipelineWidget(ctx);
				return;
			}

			// Show summary of implementer output
			ctx.ui.notify(formatAgentSummary("implementer", implementerConfig.model, implementResult.output, "✅", phaseIdx + 1), "info");
			
			implementationSummary = implementResult.output.slice(0, 1500);
			
			// Create commit after implementation (R1, R2, R10)
			const commitResult = await createAgentCommit(
				cwd,
				state,
				{
					role: "implementer",
					modelConfig: implementerConfig,
					phase: phaseIdx + 1,
					cycle: 1,
				},
				projectConfig.models.agentCommitMessageWriter,
				ctx.ui.notify.bind(ctx.ui)
			);
			
			if (!commitResult.success) {
				if (commitResult.usedFallback) {
					// Fallback was used - abort pipeline (R7)
					state.lastError = "Commit message generation failed - fallback used";
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					return;
				} else {
					// Other commit failure
					state.lastError = undefined;
					saveState(cwd, state);
					clearPipelineWidget(ctx);
					ctx.ui.notify("Failed to create agent commit", "error");
					return;
				}
			}
			
			// Mark implementer as completed for this phase
			state.implementerCompletedForPhase = true;
			saveState(cwd, state);
		} else {
			ctx.ui.notify(`🔄 Resuming phase ${phaseIdx + 1} (skipping implementation step)`, "info");
			implementationSummary = `(Resumed from previous run)\n\nImplementation plan:\n${phasePlan.slice(0, 1200)}`;
		}

		// ========================================
		// STEP 2: Tiered Code Review
		// ========================================
		
		// Update widget for code review
		updatePipelineWidget(ctx, state, "Running code review...");
		
		ctx.ui.notify(formatStepBanner(
			`Code Review - Phase ${phaseIdx + 1}`,
			"Running tiered review (cheap → expensive)",
			"💻"
		), "info");
		
		const codeReviewResult = await runTieredReview(
			{
				cwd,
				projectConfig,
				systemPrompts: SYSTEM_PROMPTS,
				state,
				phaseIndex: phaseIdx + 1,
				notify: ctx.ui.notify.bind(ctx.ui),
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
			clearPipelineWidget(ctx);
			return;
		}
		
		// Track code review metrics
		metrics.codeReviewCycles.cheap += codeReviewResult.cheapCyclesCompleted;
		metrics.codeReviewCycles.expensive += codeReviewResult.expensiveCyclesCompleted;
		saveState(cwd, state);
		
		// Show summary of code review
		ctx.ui.notify(formatAgentSummary(
			`codeReviewer (${codeReviewResult.finalTier})`,
			codeReviewResult.finalTier === "cheap" 
				? projectConfig.models.codeReviewer.cheap.model 
				: projectConfig.models.codeReviewer.expensive.model,
			codeReviewResult.lastReviewOutput,
			codeReviewResult.verdict === "APPROVED" ? "✅" : "🔄",
			phaseIdx + 1,
			`(cheap: ${codeReviewResult.cheapCyclesCompleted}, expensive: ${codeReviewResult.expensiveCyclesCompleted})`
		), "info");
		
		// Update state with tiered review results
		state.previousReview = codeReviewResult.lastReviewOutput;
		state.currentReviewTier = codeReviewResult.finalTier;
		state.cheapCyclesCompleted = codeReviewResult.cheapCyclesCompleted;
		state.expensiveCyclesCompleted = codeReviewResult.expensiveCyclesCompleted;
		saveState(cwd, state);

		// ========================================
		// STEP 3: Create Commit for Phase
		// ========================================
		
		// Update widget for commit
		updatePipelineWidget(ctx, state, "Creating commit...");
		
		ctx.ui.notify(`💾 Creating commit for phase ${phaseIdx + 1}...`, "info");
		const phaseCommitTask = `Write a commit message for Phase ${phaseIdx + 1} implementation.

What was implemented:
${implementationSummary}

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
		state.implementerCompletedForPhase = false;
		saveState(cwd, state);

		ctx.ui.notify(formatStepBanner(
			`Phase ${phaseIdx + 1}/${state.phases.length} Complete`,
			phaseIdx + 1 < state.phases.length ? `Moving to phase ${phaseIdx + 2}...` : "All phases complete!",
			"✅"
		), "success");
	}

	// Handle pipeline completion with squash and merge
	if (state.pipelineBranch && state.originalBranch) {
		ctx.ui.notify("\n✅ Implementation complete! Preparing to finalize...", "success");
		
		const checkpointCount = state.checkpoints?.length || 0;
		ctx.ui.notify(`Created ${checkpointCount} checkpoints during implementation`, "info");
		
		const mergeOptions = [
			"Squash commits and merge to original branch",
			"Merge as-is (keep all commits)",
			"Keep pipeline branch (manual merge later)",
		];
		const mergeChoiceLabel = await ctx.ui.select(
			"How would you like to handle the pipeline branch?",
			mergeOptions
		);
		
		// Map label back to value
		const mergeChoice = mergeChoiceLabel === mergeOptions[0] ? "squash"
			: mergeChoiceLabel === mergeOptions[1] ? "merge"
			: "keep";
		
		if (mergeChoice === "squash") {
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
	
	// Finalize metrics
	// Calculate phases approved on first pass (cheap cycle 1, no expensive needed)
	// This is a proxy for implementation quality
	let phasesApprovedFirstPass = 0;
	// We track this by checking if we needed more than 1 cheap cycle or any expensive cycles
	// For simplicity, estimate based on average cycles per phase
	const avgCheapPerPhase = state.phases.length > 0 
		? metrics.codeReviewCycles.cheap / state.phases.length 
		: 0;
	const avgExpensivePerPhase = state.phases.length > 0 
		? metrics.codeReviewCycles.expensive / state.phases.length 
		: 0;
	// If average is ~1 cheap and ~0 expensive, most phases passed first time
	if (avgCheapPerPhase <= 1.5 && avgExpensivePerPhase < 0.5) {
		phasesApprovedFirstPass = Math.round(state.phases.length * 0.8);
	} else if (avgCheapPerPhase <= 2 && avgExpensivePerPhase <= 1) {
		phasesApprovedFirstPass = Math.round(state.phases.length * 0.5);
	}
	
	finalizeMetrics(metrics, state.phases.length, phasesApprovedFirstPass);
	state.stage = "completed";
	saveState(cwd, state);
	
	// Clear the pipeline widget
	clearPipelineWidget(ctx);
	
	// Enhanced completion message
	const completionLines: string[] = [];
	completionLines.push("");
	completionLines.push(formatDivider(50));
	completionLines.push("  🎉 Spec Pipeline Complete!");
	completionLines.push(formatDivider(50));
	completionLines.push("");
	completionLines.push(formatKeyValue("  Pipeline ID", state.id));
	completionLines.push(formatKeyValue("  Spec File", state.specFilename));
	completionLines.push(formatKeyValue("  Phases", String(state.phases.length)));
	if (state.checkpoints && state.checkpoints.length > 0) {
		completionLines.push(formatKeyValue("  Checkpoints", String(state.checkpoints.length)));
	}
	
	// Show metrics summary
	if (metrics.totalDurationMs) {
		const durationMins = Math.round(metrics.totalDurationMs / 60000);
		completionLines.push(formatKeyValue("  Duration", `${durationMins} min`));
	}
	completionLines.push(formatKeyValue("  Agent Calls", String(metrics.agentCalls.length)));
	completionLines.push(formatKeyValue("  Plan Generation", metrics.skipPlanGeneration ? "Skipped" : "Enabled"));
	completionLines.push(formatKeyValue("  Code Review Cycles", `${metrics.codeReviewCycles.cheap}c/${metrics.codeReviewCycles.expensive}e`));
	
	completionLines.push("");
	completionLines.push("  📋 Next Steps:");
	completionLines.push("     • Review the implementation changes");
	if (projectConfig.testCommand) {
		completionLines.push("     • Run tests: " + projectConfig.testCommand);
	} else {
		completionLines.push("     • Run your project's test suite");
	}
	completionLines.push("     • Commit any final adjustments");
	completionLines.push("     • Run /spec-metrics to export comparison data");
	completionLines.push("");
	completionLines.push(formatDivider(50));
	
	ctx.ui.notify(completionLines.join("\n"), "success");
}
