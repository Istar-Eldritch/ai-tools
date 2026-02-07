/**
 * Hierarchy pipeline execution logic (shared by roadmaps and epics)
 *
 * Handles the document lifecycle: Discovery → Drafting → Review → Approval → Child Extraction
 *
 * This is structurally similar to spec-pipeline.ts but produces a decomposition
 * (child items table) instead of an implementation phase table.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	RoadmapState,
	EpicState,
	HierarchyState,
	HierarchyLevel,
	ChildItem,
	ProjectConfig,
	PipelineUIContext,
	SpecMetrics,
	AgentCallMetrics,
	RoleName,
	TieredReviewerRole,
	ModelConfig,
	TieredModelConfig,
} from "./types.ts";
import { MAX_SPEC_ITERATIONS } from "./types.ts";
import {
	saveRoadmapState,
	saveEpicState,
	extractChildItems,
} from "./state.ts";
import { createAgentCommit } from "./git.ts";
import { handleAgentError } from "./errors.ts";
import {
	formatStepBanner,
	formatAgentSummary,
	formatHierarchyStage,
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

function initializeMetrics(discoverySkipped: boolean): SpecMetrics {
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

function finalizeMetrics(metrics: SpecMetrics): void {
	metrics.pipelineEndTime = new Date().toISOString();
	const startTime = new Date(metrics.pipelineStartTime).getTime();
	const endTime = new Date(metrics.pipelineEndTime).getTime();
	metrics.totalDurationMs = endTime - startTime;
}

// ============================================
// Config Helpers
// ============================================

/** Get the drafter role name for a hierarchy level */
function getDrafterRole(level: HierarchyLevel): RoleName {
	return level === "roadmap" ? "roadmapDrafter" : "epicDrafter";
}

/** Get the reviewer role name for a hierarchy level */
function getReviewerRole(level: HierarchyLevel): TieredReviewerRole {
	return level === "roadmap" ? "roadmapReviewer" : "epicReviewer";
}

/** Get the drafter model config */
function getDrafterConfig(level: HierarchyLevel, projectConfig: ProjectConfig): ModelConfig {
	return level === "roadmap" ? projectConfig.models.roadmapDrafter : projectConfig.models.epicDrafter;
}

/** Get the reviewer model config */
function getReviewerConfig(level: HierarchyLevel, projectConfig: ProjectConfig): TieredModelConfig {
	return level === "roadmap" ? projectConfig.models.roadmapReviewer : projectConfig.models.epicReviewer;
}

/** Get the system prompt for the drafter */
function getDrafterPrompt(level: HierarchyLevel, prompts: ReturnType<typeof createSystemPrompts>): string {
	return level === "roadmap" ? prompts.roadmapDrafter : prompts.epicDrafter;
}

/** Get the system prompt for the reviewer */
function getReviewerPrompt(level: HierarchyLevel, prompts: ReturnType<typeof createSystemPrompts>): string {
	return level === "roadmap" ? prompts.roadmapReviewer : prompts.epicReviewer;
}

/** Get the child type label */
function getChildTypeLabel(level: HierarchyLevel): string {
	return level === "roadmap" ? "epics" : "features";
}

// ============================================
// State Save Helper
// ============================================

function saveState(cwd: string, state: HierarchyState): void {
	if (state.level === "roadmap") {
		saveRoadmapState(cwd, state as RoadmapState);
	} else {
		saveEpicState(cwd, state as EpicState);
	}
}

// ============================================
// Widget Helper
// ============================================

function updateHierarchyWidget(
	ctx: PipelineUIContext,
	state: HierarchyState,
	currentAction?: string
): void {
	const emoji = state.level === "roadmap" ? "🗺️" : "📋";
	const label = state.level.charAt(0).toUpperCase() + state.level.slice(1);
	const stateId = state.id || "unknown";
	const lines: string[] = [
		`${emoji} ${label}: ${stateId.slice(0, 16)}...`,
		"────────────────────────────────────────",
		`Stage: ${formatHierarchyStage(state.stage)}`,
	];
	if (currentAction) {
		lines.push("────────────────────────────────────────");
		lines.push(`⏳ ${currentAction}`);
	}
	ctx.ui.setWidget("spec-pipeline-status", lines);
}

// ============================================
// Main Hierarchy Pipeline Execution
// ============================================

/**
 * Run the hierarchy pipeline for a roadmap or epic.
 *
 * This handles the full lifecycle: Discovery → Drafting → Review → Approval → Child Extraction
 *
 * @param state The roadmap or epic state
 * @param cwd Working directory
 * @param projectConfig Project configuration
 * @param ctx UI context
 * @param parentContext Optional context from parent document (for epics under roadmaps)
 */
export async function runHierarchyPipeline(
	state: HierarchyState,
	cwd: string,
	projectConfig: ProjectConfig,
	ctx: PipelineUIContext,
	parentContext?: string
): Promise<void> {
	const specsDir = path.join(cwd, projectConfig.specsDir);
	const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
	const level = state.level;
	const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
	const childLabel = getChildTypeLabel(level);

	const save = () => saveState(cwd, state);

	// Initialize or restore metrics
	if (!state.metrics) {
		const discoverySkipped = state.discovery?.skipped ?? true;
		state.metrics = initializeMetrics(discoverySkipped);
		save();
	}
	const metrics = state.metrics;

	// Create specs directory if it doesn't exist
	if (!fs.existsSync(specsDir)) {
		fs.mkdirSync(specsDir, { recursive: true });
		ctx.ui.notify(`Created ${projectConfig.specsDir}/ directory`, "info");
	}

	// ============================================
	// DISCOVERY → DRAFTING TRANSITION
	// ============================================
	// Discovery is handled conversationally in index.ts.
	// By the time runHierarchyPipeline is called, discovery is either completed or skipped.
	if (state.stage === "discovery" && state.discovery?.completed) {
		ctx.ui.notify(`✅ Discovery completed (${state.discovery.conversationHistory?.length ?? 0} exchanges)`, "success");
		state.stage = "drafting";
		save();

		updateHierarchyWidget(ctx, state, `Moving to ${level} drafting...`);
	}

	// ============================================
	// DRAFTING & REVIEW LOOP
	// ============================================
	if (!state.docApproved) {
		ctx.ui.notify(formatStepBanner(
			`${levelLabel.toUpperCase()} DRAFTING PHASE`,
			`Creating and reviewing ${level} document`,
			"📝"
		), "info");

		const resumingMidIteration = state.stage === "review" || state.stage === "user_approval";

		while (!state.docApproved && state.docIteration < MAX_SPEC_ITERATIONS) {
			const fullDocPath = path.join(cwd, state.docPath);
			const docFileExists = fs.existsSync(fullDocPath);

			const skipDrafter = resumingMidIteration && state.docIteration > 0 && docFileExists;

			if (state.docIteration > 0 && !docFileExists) {
				ctx.ui.notify("🔄 Detected cancelled mid-draft, resetting iteration counter", "info");
				state.docIteration = 0;
				save();
			}

			if (!skipDrafter) {
				state.docIteration++;
				state.stage = "drafting";
				save();
			}

			// ========================================
			// STEP 1: Drafting
			// ========================================
			if (!skipDrafter) {
				updateHierarchyWidget(ctx, state, `Drafting ${level} (iteration ${state.docIteration}/${MAX_SPEC_ITERATIONS})`);

				ctx.ui.notify(formatStepBanner(
					`${levelLabel} Iteration ${state.docIteration}/${MAX_SPEC_ITERATIONS}`,
					`Agent is drafting the ${level} document`,
					"📄"
				), "info");

				const drafterConfig = getDrafterConfig(level, projectConfig);
				const drafterRole = getDrafterRole(level);
				const drafterPrompt = getDrafterPrompt(level, SYSTEM_PROMPTS);
				ctx.ui.notify(`📝 ${drafterConfig.model} drafting ${level}...`, "info");

				const discoveryContext = state.discovery?.discoverySummary
					? `\n\n## Discovery Context\n\n${state.discovery.discoverySummary}\n`
					: "";

				const parentCtx = parentContext
					? `\n\n## Parent Context\n\n${parentContext}\n`
					: "";

				const isFirstIteration = state.docIteration === 1 || !docFileExists;

				const draftTask = isFirstIteration
					? `Create a ${level} document for: ${state.description}
${discoveryContext}${parentCtx}
The document timestamp is: ${state.docTimestamp}

IMPORTANT: Write the document to this EXACT path: ${fullDocPath}

Explore the project structure first to understand conventions.
Focus on creating a clear ${level} that decomposes the work into well-scoped ${childLabel}.
After creating the document, use the write tool to save it to the path above.`
					: `Revise the ${level} document based on the feedback below.

IMPORTANT: If both user feedback and reviewer feedback are provided, USER FEEDBACK TAKES PRIORITY.

Read the current document at: ${fullDocPath}
Then revise it and write the updated version back to the SAME path.

Previous feedback to address:
${state.docContent}`;

				const draftStartTime = new Date();
				const draftResult = await runAgentWithConfig(
					drafterConfig,
					draftTask,
					cwd,
					drafterPrompt,
					undefined,
					undefined,
					drafterRole
				);
				recordAgentCall(metrics, drafterRole, drafterConfig.model, drafterConfig.thinking, draftStartTime, draftResult.exitCode);
				metrics.specIterations = state.docIteration;
				save();

				if (draftResult.exitCode !== 0) {
					await handleAgentError(
						cwd, state, draftResult,
						drafterConfig.model, drafterRole, draftTask,
						undefined, undefined,
						ctx.ui.notify.bind(ctx.ui), save
					);
					clearPipelineWidget(ctx);
					return;
				}

				ctx.ui.notify(formatAgentSummary(drafterRole, drafterConfig.model, draftResult.output), "info");

				if (!fs.existsSync(fullDocPath)) {
					const errorMsg = `${levelLabel} document was not created at ${fullDocPath}`;
					state.lastError = undefined;
					save();
					clearPipelineWidget(ctx);
					ctx.ui.notify(errorMsg, "error");
					return;
				}
				state.docContent = fs.readFileSync(fullDocPath, "utf-8");
				ctx.ui.notify(`📄 ${levelLabel} draft saved to ${state.docFilename}`, "info");

				// Create commit
				const commitResult = await createAgentCommit(
					cwd, state,
					{ role: drafterRole, modelConfig: drafterConfig },
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

				state.stage = "review";
				save();
			} else {
				ctx.ui.notify(`🔄 Resuming iteration ${state.docIteration} (skipping drafting)`, "info");
				const fullDocPathRead = path.join(cwd, state.docPath);
				if (fs.existsSync(fullDocPathRead)) {
					state.docContent = fs.readFileSync(fullDocPathRead, "utf-8");
				}
			}

			// ========================================
			// STEP 2: Review
			// ========================================
			const skipReview = state.stage === "user_approval";

			let reviewResultOutput: string;

			if (!skipReview) {
				updateHierarchyWidget(ctx, state, `Running ${level} review...`);

				ctx.ui.notify(formatStepBanner(
					`${levelLabel} Review`,
					"Running tiered review (cheap → expensive)",
					"🔍"
				), "info");

				const reviewerRole = getReviewerRole(level);

				const reviewResult = await runTieredReview(
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
						role: reviewerRole,
						reviewTask: `Review this ${level} document:\n\n${state.docContent}`,
						fixTask: (reviewOutput) => `Revise the ${level} document to address review feedback.

Current document at: ${path.join(cwd, state.docPath)}

Review feedback:
${reviewOutput}

Read the current document, apply fixes, and write the updated version back to the same path.`,
					}
				);

				if (reviewResult.hadError) {
					clearPipelineWidget(ctx);
					return;
				}

				metrics.specReviewCycles.cheap += reviewResult.cheapCyclesCompleted;
				metrics.specReviewCycles.expensive += reviewResult.expensiveCyclesCompleted;
				save();

				const reviewerConfig = getReviewerConfig(level, projectConfig);
				ctx.ui.notify(formatAgentSummary(
					`${reviewerRole} (${reviewResult.finalTier})`,
					reviewResult.finalTier === "cheap"
						? reviewerConfig.cheap.model
						: reviewerConfig.expensive.model,
					reviewResult.lastReviewOutput,
					reviewResult.verdict === "APPROVED" ? "✅" : "🔄",
					undefined,
					`(cheap: ${reviewResult.cheapCyclesCompleted}, expensive: ${reviewResult.expensiveCyclesCompleted})`
				), "info");

				// Re-read after review fixes
				const fullDocPathReread = path.join(cwd, state.docPath);
				if (fs.existsSync(fullDocPathReread)) {
					state.docContent = fs.readFileSync(fullDocPathReread, "utf-8");
				}

				reviewResultOutput = reviewResult.lastReviewOutput;

				state.stage = "user_approval";
				save();
			} else {
				ctx.ui.notify(`🔄 Resuming at user approval (skipping review)`, "info");
				reviewResultOutput = "(Review already completed - resuming at user approval)";
			}

			// ========================================
			// STEP 3: User Approval
			// ========================================
			updateHierarchyWidget(ctx, state, "Awaiting your approval...");

			ctx.ui.notify(formatStepBanner(
				"User Approval Required",
				`Please review the ${level} and decide whether to approve`,
				"👤"
			), "info");

			const userDecision = await ctx.ui.confirm(
				`Approve ${levelLabel}?`,
				`${reviewResultOutput}\n\n---\n\nDo you approve this ${level}? (No = provide feedback)`
			);

			if (userDecision) {
				state.docApproved = true;
				save();
			} else {
				const feedback = await ctx.ui.editor(`Provide feedback for ${level} revision (leave empty to use reviewer feedback as-is):`, "");
				if (feedback === undefined) {
					state.stage = "cancelled";
					save();
					clearPipelineWidget(ctx);
					ctx.ui.notify("Cancelled", "info");
					return;
				}
				if (feedback.trim()) {
					state.docContent = `Previous draft:\n${state.docContent}\n\nUser feedback (PRIORITY):\n${feedback}\n\nReviewer feedback (reference):\n${reviewResultOutput}`;
				} else {
					state.docContent = `Previous draft:\n${state.docContent}\n\nReviewer feedback (MUST ADDRESS):\n${reviewResultOutput}`;
				}
				save();
			}
		}

		if (!state.docApproved) {
			const maxIterOptions = [
				`Approve current ${level}`,
				"Add 3 more iterations",
				"Cancel",
			];
			const choiceLabel = await ctx.ui.select(
				`Reached ${MAX_SPEC_ITERATIONS} iterations without approval. What would you like to do?`,
				maxIterOptions
			);

			const choice = choiceLabel === maxIterOptions[0] ? "approve"
				: choiceLabel === maxIterOptions[1] ? "extend"
				: "cancel";

			if (choice === "approve") {
				state.docApproved = true;
				save();
			} else if (choice === "extend") {
				state.docIteration = MAX_SPEC_ITERATIONS - 3;
				state.lastError = undefined;
				save();
				ctx.ui.notify(`Added 3 more iterations. Use /${level}-resume to continue.`, "info");
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

		ctx.ui.notify(`✅ ${levelLabel} approved: ${state.docFilename}`, "success");
	}

	// ============================================
	// CHILD EXTRACTION
	// ============================================
	if (state.docApproved && state.children.length === 0) {
		// Re-read the approved document
		const fullDocPath = path.join(cwd, state.docPath);
		if (fs.existsSync(fullDocPath)) {
			state.docContent = fs.readFileSync(fullDocPath, "utf-8");
		}

		const children = extractChildItems(state.docContent);
		if (children.length === 0) {
			ctx.ui.notify(`⚠️ No child items table found in the ${level} document. You can add ${childLabel} manually later.`, "warning");
		} else {
			state.children = children;
			save();
			ctx.ui.notify(`📦 Extracted ${children.length} ${childLabel} from the ${level} document`, "success");
		}
	}

	// ============================================
	// COMPLETION
	// ============================================
	finalizeMetrics(metrics);
	state.stage = "approved";
	save();

	clearPipelineWidget(ctx);

	const completionLines: string[] = [];
	completionLines.push("");
	completionLines.push(formatDivider(50));
	completionLines.push(`  🎉 ${levelLabel} Creation Complete!`);
	completionLines.push(formatDivider(50));
	completionLines.push("");
	completionLines.push(formatKeyValue("  Pipeline ID", state.id));
	completionLines.push(formatKeyValue("  Document", state.docFilename));
	completionLines.push(formatKeyValue("  Document Path", state.docPath));

	if (metrics.totalDurationMs) {
		const durationMins = Math.round(metrics.totalDurationMs / 60000);
		completionLines.push(formatKeyValue("  Duration", `${durationMins} min`));
	}
	completionLines.push(formatKeyValue("  Agent Calls", String(metrics.agentCalls.length)));

	if (state.pipelineBranch) {
		completionLines.push("");
		completionLines.push(`  🔀 You are on branch: ${state.pipelineBranch}`);
	}

	if (state.children.length > 0) {
		completionLines.push("");
		completionLines.push(`  📦 ${state.children.length} ${childLabel} ready to create:`);
		for (const child of state.children) {
			const deps = child.dependencies.length > 0 ? ` (deps: ${child.dependencies.join(", ")})` : "";
			completionLines.push(`     ${child.number}. ${child.name} [${child.priority}]${deps}`);
		}
		completionLines.push("");
		completionLines.push("  📋 Next Steps:");
		completionLines.push(`     • Review the ${level} on this branch`);
		completionLines.push("     • Merge to main when satisfied");
		if (level === "roadmap") {
			completionLines.push("     • Use /epic <description> to create each epic");
		} else {
			completionLines.push("     • Use /spec <description> to create each feature spec");
		}
		completionLines.push("     • The agent will suggest next steps but won't auto-start");
	} else {
		completionLines.push("");
		completionLines.push("  📋 Next Steps:");
		completionLines.push(`     • Review the ${level} document`);
		completionLines.push("     • Merge to main when satisfied");
	}

	completionLines.push("");
	completionLines.push(formatDivider(50));

	ctx.ui.notify(completionLines.join("\n"), "success");
}
