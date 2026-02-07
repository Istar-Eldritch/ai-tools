/**
 * Spec creation pipeline execution logic
 * 
 * Handles: Discovery → Spec Drafting → Spec Review → User Approval → Commit
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	SpecState,
	DiscoveryQA,
	ProjectConfig,
	PipelineUIContext,
	SpecMetrics,
	AgentCallMetrics,
	RoleName,
} from "./types.ts";
import { MAX_SPEC_ITERATIONS } from "./types.ts";
import { saveSpecState, generateDiscoverySummary } from "./state.ts";
import { createAgentCommit } from "./git.ts";
import { handleAgentError } from "./errors.ts";
import {
	formatStepBanner,
	formatAgentSummary,
	formatSpecState,
	updateSpecWidget,
	clearPipelineWidget,
	formatDivider,
	formatKeyValue,
} from "./formatting.ts";
import { runAgentWithConfig } from "./agents.ts";
import { runTieredReview } from "./review.ts";
import { createSystemPrompts, buildPromptOptions } from "./agents-config.ts";

// ============================================
// Metrics Helpers
// ============================================

function initializeSpecMetrics(discoverySkipped: boolean): SpecMetrics {
	return {
		pipelineStartTime: new Date().toISOString(),
		agentCalls: [],
		specReviewCycles: { cheap: 0, expensive: 0 },
		specIterations: 0,
		discoverySkipped,
	};
}

function recordAgentCall(
	metrics: SpecMetrics,
	role: RoleName,
	model: "opus" | "sonnet" | "haiku",
	thinking: string,
	startTime: Date,
	exitCode: number,
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
	};
	metrics.agentCalls.push(call);
}

function finalizeSpecMetrics(metrics: SpecMetrics): void {
	metrics.pipelineEndTime = new Date().toISOString();
	const startTime = new Date(metrics.pipelineStartTime).getTime();
	const endTime = new Date(metrics.pipelineEndTime).getTime();
	metrics.totalDurationMs = endTime - startTime;
}

// ============================================
// Main Spec Pipeline Execution
// ============================================

/**
 * Run the spec creation pipeline
 */
export async function runSpecPipeline(
	state: SpecState,
	cwd: string,
	projectConfig: ProjectConfig,
	ctx: PipelineUIContext
): Promise<void> {
	const specsDir = path.join(cwd, projectConfig.specsDir);
	const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));

	// Helper to save state
	const save = () => saveSpecState(cwd, state);

	// Initialize or restore metrics
	if (!state.metrics) {
		const discoverySkipped = state.discovery?.skipped ?? true;
		state.metrics = initializeSpecMetrics(discoverySkipped);
		save();
	}
	const metrics = state.metrics;

	// Create specs directory if it doesn't exist
	if (!fs.existsSync(specsDir)) {
		fs.mkdirSync(specsDir, { recursive: true });
		ctx.ui.notify(`Created ${projectConfig.specsDir}/ directory`, "info");
	}

	// ============================================
	// DISCOVERY PHASE (if not skipped)
	// ============================================
	// Skip discovery if it was handled via conversational mode (already completed before runSpecPipeline is called)
	if (state.stage === "discovery" && state.discovery?.conversational && state.discovery.completed) {
		ctx.ui.notify(`✅ Discovery completed via conversation (${state.discovery.conversationHistory?.length ?? 0} exchanges)`, "success");
		state.stage = "spec_drafting";
		save();
	}

	if (state.stage === "discovery" && state.discovery && !state.discovery.completed) {
		ctx.ui.notify(formatStepBanner(
			"DISCOVERY PHASE",
			"Gathering requirements through interactive Q&A",
			"🔍"
		), "info");
		
		if (state.discovery.currentRound > 0 && state.discovery.qaHistory.length > 0) {
			ctx.ui.notify(`🔄 Resuming discovery from round ${state.discovery.currentRound}`, "info");
			ctx.ui.notify(`Previous exchanges: ${state.discovery.qaHistory.length}`, "info");
		}
		ctx.ui.notify(`Maximum ${state.discovery.maxRounds} question rounds (you can proceed early)`, "info");
		
		updateSpecWidget(ctx, state, "Starting discovery...");

		if (!state.discovery.qaHistory) {
			state.discovery.qaHistory = [];
		}

		while (
			state.discovery.currentRound < state.discovery.maxRounds &&
			!state.discovery.completed
		) {
			state.discovery.currentRound++;
			save();

			updateSpecWidget(ctx, state, `Generating questions for round ${state.discovery.currentRound}`);
			
			ctx.ui.notify(formatStepBanner(
				`Discovery Round ${state.discovery.currentRound}/${state.discovery.maxRounds}`,
				"Agent is analyzing requirements and generating questions",
				"📍"
			), "info");

			let discoveryContext = `Feature request: ${state.description}\n\n`;
			
			if (state.discovery.qaHistory.length > 0) {
				discoveryContext += "Previous discovery exchanges:\n\n";
				for (const qa of state.discovery.qaHistory) {
					discoveryContext += `Round ${qa.round}:\n`;
					discoveryContext += `Questions:\n${qa.questions}\n`;
					discoveryContext += `Answers:\n${qa.answers}\n\n`;
				}
			}

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
					cwd, state, questionResult,
					discoveryConfig.model, "discoveryAgent", questionTask,
					undefined, undefined,
					ctx.ui.notify.bind(ctx.ui), save
				);
				clearPipelineWidget(ctx);
				return;
			}

			const questions = questionResult.output;
			
			updateSpecWidget(ctx, state, "Waiting for your answers...");
			
			ctx.ui.notify(formatStepBanner(
				`Questions for Round ${state.discovery.currentRound}`,
				"Please answer in the editor that will open",
				"❓"
			), "info");

			const displayQuestions = questions.length > 3000
				? questions.slice(0, 3000) + "\n\n[... truncated for display ...]"
				: questions;
			ctx.ui.notify(displayQuestions, "info");
			
			const answerChoices = [
				"Answer questions",
				"Proceed to spec drafting (enough context)",
				"Cancel pipeline",
			];
			const answerChoiceLabel = await ctx.ui.select(
				`Round ${state.discovery.currentRound}: How would you like to proceed?`,
				answerChoices
			);
			
			const answerChoice = answerChoiceLabel === answerChoices[0] ? "answer"
				: answerChoiceLabel === answerChoices[1] ? "proceed"
				: "cancel";

			if (answerChoice === "cancel") {
				state.stage = "cancelled";
				save();
				clearPipelineWidget(ctx);
				ctx.ui.notify("Pipeline cancelled", "info");
				return;
			}

			if (answerChoice === "proceed") {
				state.discovery.completed = true;
				save();
				break;
			}

			const answers = await ctx.ui.editor(
				`Answers for Round ${state.discovery.currentRound}`,
				`# Round ${state.discovery.currentRound} Answers\n\nPlease answer the questions below:\n\n${questions}\n\n---\n\n# Your Answers:\n\n`
			);

			if (answers === undefined) {
				state.stage = "cancelled";
				save();
				clearPipelineWidget(ctx);
				ctx.ui.notify("Pipeline cancelled", "info");
				return;
			}

			const qaEntry: DiscoveryQA = {
				round: state.discovery.currentRound,
				questions,
				answers: answers.trim(),
				timestamp: new Date().toISOString(),
			};
			state.discovery.qaHistory.push(qaEntry);
			save();

			ctx.ui.notify(`✅ Round ${state.discovery.currentRound} recorded`, "success");

			if (state.discovery.currentRound >= state.discovery.maxRounds) {
				ctx.ui.notify(`\nMaximum rounds (${state.discovery.maxRounds}) reached.`, "info");
				
				const continueMore = await ctx.ui.confirm(
					"Continue Discovery?",
					"You've reached the maximum rounds. Would you like to extend by 2 more rounds?"
				);
				
				if (continueMore) {
					state.discovery.maxRounds += 2;
					save();
					ctx.ui.notify("Extended discovery by 2 rounds", "info");
				} else {
					state.discovery.completed = true;
					save();
				}
			}
		}

		if (state.discovery.qaHistory.length > 0) {
			state.discovery.discoverySummary = generateDiscoverySummary(state.discovery.qaHistory);
			
			ctx.ui.notify("\n📋 Discovery Summary Preview:", "info");
			ctx.ui.notify("─────────────────────────────────────────", "info");
			
			const discoverySummary = state.discovery.discoverySummary || "";
			const summaryPreview = discoverySummary.length > 2000
				? discoverySummary.slice(0, 2000) + "\n\n[... truncated for preview ...]"
				: discoverySummary;
			
			ctx.ui.notify(summaryPreview, "info");
			ctx.ui.notify("─────────────────────────────────────────", "info");
			
			const proceedToSpec = await ctx.ui.confirm(
				"Proceed to Spec Drafting?",
				`Discovery gathered ${state.discovery.qaHistory.length} Q&A exchanges.\n\nProceed to spec drafting with this context?`
			);
			
			if (!proceedToSpec) {
				ctx.ui.notify("Options: Add additional context, or leave empty to cancel.", "info");
				
				const additionalContext = await ctx.ui.editor(
					"Add any additional context or requirements (or leave empty to cancel)",
					""
				);
				
				if (additionalContext === undefined || additionalContext.trim() === "") {
					state.stage = "cancelled";
					save();
					clearPipelineWidget(ctx);
					ctx.ui.notify("Pipeline cancelled", "info");
					return;
				}
				
				const additionalQA: DiscoveryQA = {
					round: state.discovery.currentRound + 1,
					questions: "User provided additional context:",
					answers: additionalContext,
					timestamp: new Date().toISOString(),
				};
				state.discovery.qaHistory.push(additionalQA);
				state.discovery.discoverySummary = generateDiscoverySummary(state.discovery.qaHistory);
				save();
				
				ctx.ui.notify("Additional context added", "success");
			}
			
			ctx.ui.notify(`\n✅ Discovery complete - ${state.discovery.qaHistory.length} Q&A exchanges recorded`, "success");
		} else {
			ctx.ui.notify("\n✅ Discovery complete (no Q&A recorded)", "success");
		}

		state.discovery.completed = true;
		state.stage = "spec_drafting";
		save();
		
		updateSpecWidget(ctx, state, "Moving to spec drafting...");
	}

	// ============================================
	// SPEC DRAFTING & REVIEW LOOP
	// ============================================
	if (!state.specApproved) {
		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING PHASE",
			"Creating and reviewing technical specification",
			"📝"
		), "info");
		
		const resumingMidIteration = state.stage === "spec_review" || state.stage === "user_approval";
		
		while (!state.specApproved && state.specIteration < MAX_SPEC_ITERATIONS) {
			const fullSpecPath = path.join(cwd, state.specPath);
			const specFileExists = fs.existsSync(fullSpecPath);
			
			const skipSpecDrafter = resumingMidIteration && state.specIteration > 0 && specFileExists;
			
			if (state.specIteration > 0 && !specFileExists) {
				ctx.ui.notify("🔄 Detected cancelled mid-draft, resetting iteration counter", "info");
				state.specIteration = 0;
				save();
			}
			
			if (!skipSpecDrafter) {
				state.specIteration++;
				state.stage = "spec_drafting";
				save();
			}
			
			// ========================================
			// STEP 1: Spec Drafting
			// ========================================
			if (!skipSpecDrafter) {
				updateSpecWidget(ctx, state, `Drafting spec (iteration ${state.specIteration}/${MAX_SPEC_ITERATIONS})`);
				
				ctx.ui.notify(formatStepBanner(
					`Spec Iteration ${state.specIteration}/${MAX_SPEC_ITERATIONS}`,
					"Agent is drafting the specification",
					"📄"
				), "info");

				const specDrafterConfig = projectConfig.models.specDrafter;
				ctx.ui.notify(`📝 ${specDrafterConfig.model} drafting spec...`, "info");

				const discoveryContext = state.discovery?.discoverySummary
					? `\n\n## Discovery Context\n\nThe following requirements were gathered during discovery:\n\n${state.discovery.discoverySummary}\n\nUse this information to create a comprehensive specification.\n`
					: "";

				const isFirstIteration = state.specIteration === 1 || !specFileExists;
				
				const draftTask = isFirstIteration
					? `Create a technical specification for: ${state.description}
${discoveryContext}
The spec timestamp is: ${state.specTimestamp}

IMPORTANT: Write the spec to this EXACT path: ${fullSpecPath}

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
				save();

				if (draftResult.exitCode !== 0) {
					await handleAgentError(
						cwd, state, draftResult,
						specDrafterConfig.model, "specDrafter", draftTask,
						undefined, undefined,
						ctx.ui.notify.bind(ctx.ui), save
					);
					clearPipelineWidget(ctx);
					return;
				}

				ctx.ui.notify(formatAgentSummary("specDrafter", specDrafterConfig.model, draftResult.output), "info");

				if (!fs.existsSync(fullSpecPath)) {
					const errorMsg = `Spec file was not created at ${fullSpecPath}`;
					state.lastError = undefined;
					save();
					clearPipelineWidget(ctx);
					ctx.ui.notify(errorMsg, "error");
					return;
				}
				state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
				ctx.ui.notify(`📄 Spec draft saved to ${projectConfig.specsDir}/${state.specFilename}`, "info");

				// Create commit after spec drafting
				const commitResult = await createAgentCommit(
					cwd, state,
					{ role: "specDrafter", modelConfig: specDrafterConfig },
					projectConfig.models.agentCommitMessageWriter,
					save,
					ctx.ui.notify.bind(ctx.ui)
				);
				
				if (!commitResult.success) {
					if (commitResult.usedFallback) {
						state.lastError = "Commit message generation failed - fallback used";
						save();
						clearPipelineWidget(ctx);
						return;
					} else {
						state.lastError = undefined;
						save();
						clearPipelineWidget(ctx);
						ctx.ui.notify("Failed to create agent commit", "error");
						return;
					}
				}

				state.stage = "spec_review";
				save();
			} else {
				ctx.ui.notify(`🔄 Resuming iteration ${state.specIteration} (skipping spec drafting)`, "info");
				const fullSpecPathRead = path.join(cwd, state.specPath);
				if (fs.existsSync(fullSpecPathRead)) {
					state.specDraft = fs.readFileSync(fullSpecPathRead, "utf-8");
				}
			}
			
			// ========================================
			// STEP 2: Spec Review
			// ========================================
			const skipSpecReview = state.stage === "user_approval";
			
			let reviewResultOutput: string;

			if (!skipSpecReview) {
				updateSpecWidget(ctx, state, "Running spec review...");
				
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
						saveFn: save,
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
				
				metrics.specReviewCycles.cheap += specReviewResult.cheapCyclesCompleted;
				metrics.specReviewCycles.expensive += specReviewResult.expensiveCyclesCompleted;
				save();
				
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
				
				const fullSpecPathReread = path.join(cwd, state.specPath);
				if (fs.existsSync(fullSpecPathReread)) {
					state.specDraft = fs.readFileSync(fullSpecPathReread, "utf-8");
				}
				
				reviewResultOutput = specReviewResult.lastReviewOutput;
				
				state.stage = "user_approval";
				save();
			} else {
				ctx.ui.notify(`🔄 Resuming at user approval (skipping spec review)`, "info");
				reviewResultOutput = "(Review already completed - resuming at user approval)";
			}

			// ========================================
			// STEP 3: User Approval
			// ========================================
			updateSpecWidget(ctx, state, "Awaiting your approval...");
			
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
				save();
			} else {
				const feedback = await ctx.ui.editor("Provide feedback for spec revision (leave empty to use reviewer feedback as-is):", "");
				if (feedback === undefined) {
					state.stage = "cancelled";
					save();
					clearPipelineWidget(ctx);
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				if (feedback.trim()) {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nUser feedback (PRIORITY):\n${feedback}\n\nReviewer feedback (reference):\n${reviewResultOutput}`;
				} else {
					state.specDraft = `Previous draft:\n${state.specDraft}\n\nReviewer feedback (MUST ADDRESS):\n${reviewResultOutput}`;
				}
				save();
			}
		}

		if (!state.specApproved) {
			const maxIterOptions = [
				"Approve current spec",
				"Add 3 more iterations",
				"Cancel",
			];
			const choiceLabel = await ctx.ui.select(
				`Reached ${MAX_SPEC_ITERATIONS} spec iterations without approval. What would you like to do?`,
				maxIterOptions
			);
			
			const choice = choiceLabel === maxIterOptions[0] ? "approve"
				: choiceLabel === maxIterOptions[1] ? "extend"
				: "cancel";

			if (choice === "approve") {
				state.specApproved = true;
				save();
			} else if (choice === "extend") {
				state.specIteration = MAX_SPEC_ITERATIONS - 3;
				state.lastError = undefined;
				save();
				ctx.ui.notify("Added 3 more iterations. Run /spec-resume to continue.", "info");
				return;
			} else {
				state.stage = "cancelled";
				state.lastError = undefined;
				save();
				clearPipelineWidget(ctx);
				ctx.ui.notify("Cancelled by user at max iterations", "info");
				return;
			}
		}

		ctx.ui.notify(`✅ Spec approved: ${state.specFilename}`, "success");
	}

	// ============================================
	// COMPLETION
	// ============================================
	finalizeSpecMetrics(metrics);
	state.stage = "completed";
	save();
	
	clearPipelineWidget(ctx);
	
	const completionLines: string[] = [];
	completionLines.push("");
	completionLines.push(formatDivider(50));
	completionLines.push("  🎉 Spec Creation Complete!");
	completionLines.push(formatDivider(50));
	completionLines.push("");
	completionLines.push(formatKeyValue("  Pipeline ID", state.id));
	completionLines.push(formatKeyValue("  Spec File", state.specFilename));
	completionLines.push(formatKeyValue("  Spec Path", state.specPath));
	
	if (metrics.totalDurationMs) {
		const durationMins = Math.round(metrics.totalDurationMs / 60000);
		completionLines.push(formatKeyValue("  Duration", `${durationMins} min`));
	}
	completionLines.push(formatKeyValue("  Agent Calls", String(metrics.agentCalls.length)));
	
	if (state.pipelineBranch) {
		completionLines.push("");
		completionLines.push(`  🔀 You are on branch: ${state.pipelineBranch}`);
	}
	
	completionLines.push("");
	completionLines.push("  📋 Next Steps:");
	completionLines.push("     • Review the spec on this branch");
	completionLines.push("     • Merge to main when satisfied");
	completionLines.push(`     • Then run: /implement ${state.specPath}`);
	completionLines.push("");
	completionLines.push(formatDivider(50));
	
	ctx.ui.notify(completionLines.join("\n"), "success");
}
