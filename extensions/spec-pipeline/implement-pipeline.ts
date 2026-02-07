/**
 * Implementation pipeline execution logic
 * 
 * Handles: Phase Extraction → Plan Generation → Plan Review → Implementation → Code Review
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	ImplementationState,
	ProjectConfig,
	PipelineUIContext,
	ImplementationMetrics,
	AgentCallMetrics,
	RoleName,
} from "./types.ts";
import { saveImplState } from "./state.ts";
import { createAgentCommit, createCommit, extractCommitMessage, squashCheckpointCommits, mergePipelineBranch, switchToBranch, deleteBranch } from "./git.ts";
import { handleAgentError } from "./errors.ts";
import {
	formatStepBanner,
	formatAgentSummary,
	updateImplWidget,
	clearPipelineWidget,
	formatDivider,
	formatKeyValue,
} from "./formatting.ts";
import { runAgent, runAgentWithConfig } from "./agents.ts";
import { runTieredReview } from "./review.ts";
import { createSystemPrompts, buildPromptOptions } from "./agents-config.ts";

// ============================================
// Metrics Helpers
// ============================================

function initializeImplMetrics(skipPlanGeneration: boolean): ImplementationMetrics {
	return {
		pipelineStartTime: new Date().toISOString(),
		agentCalls: [],
		planReviewCycles: { cheap: 0, expensive: 0 },
		codeReviewCycles: { cheap: 0, expensive: 0 },
		codeReviewFirstPassRate: 0,
		skipPlanGeneration,
	};
}

function recordAgentCall(
	metrics: ImplementationMetrics,
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

function finalizeImplMetrics(metrics: ImplementationMetrics, phasesCount: number, phasesApprovedFirstPass: number): void {
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
 * Supports three formats:
 * 1. Table format without links (preferred): | Phase 1 | Focus description | Effort |
 * 2. Table format with links (legacy): | Phase 1 | Focus | Effort | [name](./path/phase1.md) |
 * 3. Inline format (fallback): ### Phase 1: Name
 */
export function extractPhases(specContent: string, specTimestamp: string, shortName: string): { paths: string[]; isInline: boolean } {
	// First try table format with links (legacy support)
	const linkedPhases: string[] = [];
	const linkedRegex = /\|\s*Phase\s*\d+\s*\|[^|]+\|[^|]+\|\s*\[([^\]]+)\]\(([^)]+)\)/g;
	let match;
	while ((match = linkedRegex.exec(specContent)) !== null) {
		linkedPhases.push(match[2]);
	}
	
	if (linkedPhases.length > 0) {
		return { paths: linkedPhases, isInline: false };
	}
	
	// Try new table format without links: | Phase N | Focus description | Effort |
	const tablePhases: string[] = [];
	const tableRegex = /\|\s*Phase\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*[^|]+?\s*\|/g;
	while ((match = tableRegex.exec(specContent)) !== null) {
		const phaseNum = match[1];
		const focusDescription = match[2].trim();
		
		// Generate phase name from focus description (first 3 words, sanitized)
		const phaseName = focusDescription
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, "")
			.trim()
			.split(/\s+/)
			.slice(0, 3)
			.join("_");
		
		tablePhases.push(`${specTimestamp}_${shortName}/phase${phaseNum}_${phaseName}.md`);
	}
	
	if (tablePhases.length > 0) {
		return { paths: tablePhases, isInline: false };
	}
	
	// Fallback: detect inline phases
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
// Main Implementation Pipeline Execution
// ============================================

/**
 * Run the implementation pipeline
 */
export async function runImplementPipeline(
	state: ImplementationState,
	cwd: string,
	projectConfig: ProjectConfig,
	ctx: PipelineUIContext
): Promise<void> {
	const specsDir = path.join(cwd, projectConfig.specsDir);
	const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));

	// Helper to save state
	const save = () => saveImplState(cwd, state);

	// Initialize or restore metrics
	if (!state.metrics) {
		state.metrics = initializeImplMetrics(state.skipPlanGeneration ?? false);
		save();
	}
	const metrics = state.metrics;

	const effectiveSkipPlanGeneration = state.skipPlanGeneration ?? projectConfig.skipPlanGeneration;

	// Create specs directory if it doesn't exist
	if (!fs.existsSync(specsDir)) {
		fs.mkdirSync(specsDir, { recursive: true });
	}

	// ============================================
	// PHASE EXTRACTION (if phases not yet extracted)
	// ============================================
	if (state.phases.length === 0) {
		const specContent = state.specContent;
		
		// Derive short name from spec path
		const specBasename = path.basename(state.specPath, path.extname(state.specPath));
		const shortName = specBasename
			.replace(/^\d+_spec_/, "")
			.replace(/^\d+_/, "")
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, "_")
			.slice(0, 30);

		// Try to extract timestamp from spec filename, otherwise use implTimestamp
		const timestampMatch = specBasename.match(/^(\d{10})/);
		const specTimestamp = timestampMatch ? timestampMatch[1] : state.implTimestamp;

		const phaseResult = extractPhases(specContent, specTimestamp, shortName);
		state.phases = phaseResult.paths;

		if (phaseResult.isInline && state.phases.length > 0) {
			ctx.ui.notify(`⚠️ Detected ${state.phases.length} inline phases (table format preferred)`, "warning");
		}

		if (state.phases.length === 0) {
			ctx.ui.notify("No phases found in spec - using single implementation phase", "info");
			state.phases.push(`${specTimestamp}_${shortName}/phase1_implementation.md`);
		} else {
			ctx.ui.notify(`Found ${state.phases.length} phases to implement`, "info");
		}

		state.phasesGenerated = new Array(state.phases.length).fill(false);
		state.phaseCommits = state.phases.map(() => []);
		save();
	}

	// ============================================
	// PLAN GENERATION
	// ============================================
	if (effectiveSkipPlanGeneration) {
		ctx.ui.notify(formatStepBanner(
			"PLAN GENERATION SKIPPED",
			"Direct implementation mode (skipPlanGeneration=true)",
			"⏭️"
		), "info");
		
		state.phasesGenerated = state.phases.map(() => true);
		save();
	} else if (state.stage === "plan_generation") {
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

			updateImplWidget(ctx, state, `Generating plan for phase ${i + 1}/${state.phases.length}`);
			
			ctx.ui.notify(formatStepBanner(
				`Phase ${i + 1}/${state.phases.length} Plan`,
				`Creating detailed implementation plan`,
				"📝"
			), "info");

			const planDrafterConfig = projectConfig.models.planDrafter;
			ctx.ui.notify(`📋 ${planDrafterConfig.model} drafting implementation plan...`, "info");
			
			const planTask = `Create detailed implementation plan for Phase ${i + 1}.

Spec:
${state.specContent}

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
			save();

			if (planDraftResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, planDraftResult,
					planDrafterConfig.model, "planDrafter", planTask,
					undefined, undefined,
					ctx.ui.notify.bind(ctx.ui), save
				);
				clearPipelineWidget(ctx);
				return;
			}

			ctx.ui.notify(formatAgentSummary("planDrafter", planDrafterConfig.model, planDraftResult.output, "✅", i + 1), "info");

			if (!fs.existsSync(fullPhasePath)) {
				const errorMsg = `Plan file was not created at ${fullPhasePath}`;
				state.lastError = undefined;
				save();
				clearPipelineWidget(ctx);
				ctx.ui.notify(errorMsg, "error");
				return;
			}

			const planContent = fs.readFileSync(fullPhasePath, "utf-8");

			// Create commit after plan drafting
			const commitResult = await createAgentCommit(
				cwd, state,
				{ role: "planDrafter", modelConfig: planDrafterConfig, phase: i + 1 },
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

			// Review plan with tiered approach
			ctx.ui.notify("📝 Running tiered plan review...", "info");
			
			const planReviewResult = await runTieredReview(
				{
					cwd,
					projectConfig,
					systemPrompts: SYSTEM_PROMPTS,
					state,
					saveFn: save,
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
			
			metrics.planReviewCycles.cheap += planReviewResult.cheapCyclesCompleted;
			metrics.planReviewCycles.expensive += planReviewResult.expensiveCyclesCompleted;
			save();
			
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
			save();
			ctx.ui.notify(`Phase ${i + 1} plan saved to ${phasePath}`, "success");
		}
	}

	// ============================================
	// IMPLEMENTATION PHASE
	// ============================================
	state.stage = "implementation";
	save();

	ctx.ui.notify(formatStepBanner(
		"IMPLEMENTATION PHASE",
		`Implementing ${state.phases.length} phase(s) with code review`,
		"🚀"
	), "info");

	for (let phaseIdx = state.currentPhaseIndex; phaseIdx < state.phases.length; phaseIdx++) {
		state.currentPhaseIndex = phaseIdx;
		
		const resumingMidPhase = state.implementerCompletedForPhase === true;
		
		if (!resumingMidPhase) {
			state.currentReviewTier = undefined;
			state.cheapCyclesCompleted = 0;
			state.expensiveCyclesCompleted = 0;
			state.implementerCompletedForPhase = false;
		}
		save();

		const phasePath = state.phases[phaseIdx];
		const fullPhasePath = path.join(specsDir, phasePath);
		
		let phasePlan: string;
		if (effectiveSkipPlanGeneration) {
			phasePlan = `## Direct Implementation from Spec (No Plan File)

This is Phase ${phaseIdx + 1} of ${state.phases.length}.
Expected phase file: ${phasePath}

## Full Specification

${state.specContent}

## Instructions

Implement this phase according to the specification above. 
Focus on Phase ${phaseIdx + 1} requirements.
Explore the codebase to understand existing patterns before making changes.`;
		} else if (fs.existsSync(fullPhasePath)) {
			phasePlan = fs.readFileSync(fullPhasePath, "utf-8");
		} else {
			ctx.ui.notify(`⚠️ Plan file not found: ${fullPhasePath}, using spec`, "warning");
			phasePlan = `## Implementation from Spec (Plan File Missing)

${state.specContent}`;
		}

		updateImplWidget(ctx, state, `Implementing phase ${phaseIdx + 1}/${state.phases.length}`);
		
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
			
			updateImplWidget(ctx, state, `Implementing (${implementerConfig.model})...`);
			
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
			save();

			if (implementResult.exitCode !== 0) {
				await handleAgentError(
					cwd, state, implementResult,
					implementerConfig.model, "implementer", implementTask,
					phaseIdx + 1, 1,
					ctx.ui.notify.bind(ctx.ui), save
				);
				clearPipelineWidget(ctx);
				return;
			}

			ctx.ui.notify(formatAgentSummary("implementer", implementerConfig.model, implementResult.output, "✅", phaseIdx + 1), "info");
			
			const implementOutput = implementResult.output || "";
			implementationSummary = implementOutput.slice(0, 1500);
			
			// Create commit after implementation
			const commitResult = await createAgentCommit(
				cwd, state,
				{
					role: "implementer",
					modelConfig: implementerConfig,
					phase: phaseIdx + 1,
					cycle: 1,
				},
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
			
			state.implementerCompletedForPhase = true;
			save();
		} else {
			ctx.ui.notify(`🔄 Resuming phase ${phaseIdx + 1} (skipping implementation step)`, "info");
			const planPreview = phasePlan || "";
			implementationSummary = `(Resumed from previous run)\n\nImplementation plan:\n${planPreview.slice(0, 1200)}`;
		}

		// ========================================
		// STEP 2: Tiered Code Review
		// ========================================
		updateImplWidget(ctx, state, "Running code review...");
		
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
				saveFn: save,
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
		
		metrics.codeReviewCycles.cheap += codeReviewResult.cheapCyclesCompleted;
		metrics.codeReviewCycles.expensive += codeReviewResult.expensiveCyclesCompleted;
		save();
		
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
		
		state.previousReview = codeReviewResult.lastReviewOutput;
		state.currentReviewTier = codeReviewResult.finalTier;
		state.cheapCyclesCompleted = codeReviewResult.cheapCyclesCompleted;
		state.expensiveCyclesCompleted = codeReviewResult.expensiveCyclesCompleted;
		save();

		// ========================================
		// STEP 3: Create Commit for Phase
		// ========================================
		updateImplWidget(ctx, state, "Creating commit...");
		
		ctx.ui.notify(`💾 Creating commit for phase ${phaseIdx + 1}...`, "info");
		const lastReviewOutput = codeReviewResult.lastReviewOutput || "";
		const phaseCommitTask = `Write a commit message for Phase ${phaseIdx + 1} implementation.

What was implemented:
${implementationSummary}

Review summary:
${lastReviewOutput.slice(0, 500)}

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
				save();
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
		save();

		ctx.ui.notify(formatStepBanner(
			`Phase ${phaseIdx + 1}/${state.phases.length} Complete`,
			phaseIdx + 1 < state.phases.length ? `Moving to phase ${phaseIdx + 2}...` : "All phases complete!",
			"✅"
		), "success");
	}

	// ============================================
	// COMPLETION
	// ============================================
	
	// Finalize metrics
	let phasesApprovedFirstPass = 0;
	const avgCheapPerPhase = state.phases.length > 0 
		? metrics.codeReviewCycles.cheap / state.phases.length 
		: 0;
	const avgExpensivePerPhase = state.phases.length > 0 
		? metrics.codeReviewCycles.expensive / state.phases.length 
		: 0;
	if (avgCheapPerPhase <= 1.5 && avgExpensivePerPhase < 0.5) {
		phasesApprovedFirstPass = Math.round(state.phases.length * 0.8);
	} else if (avgCheapPerPhase <= 2 && avgExpensivePerPhase <= 1) {
		phasesApprovedFirstPass = Math.round(state.phases.length * 0.5);
	}
	
	finalizeImplMetrics(metrics, state.phases.length, phasesApprovedFirstPass);
	state.stage = "completed";
	save();
	
	clearPipelineWidget(ctx);
	
	// Completion message
	const completionLines: string[] = [];
	completionLines.push("");
	completionLines.push(formatDivider(50));
	completionLines.push("  🎉 Implementation Complete!");
	completionLines.push(formatDivider(50));
	completionLines.push("");
	completionLines.push(formatKeyValue("  Pipeline ID", state.id));
	completionLines.push(formatKeyValue("  Spec Path", state.specPath));
	completionLines.push(formatKeyValue("  Phases", String(state.phases.length)));
	if (state.checkpoints && state.checkpoints.length > 0) {
		completionLines.push(formatKeyValue("  Checkpoints", String(state.checkpoints.length)));
	}
	
	if (metrics.totalDurationMs) {
		const durationMins = Math.round(metrics.totalDurationMs / 60000);
		completionLines.push(formatKeyValue("  Duration", `${durationMins} min`));
	}
	completionLines.push(formatKeyValue("  Agent Calls", String(metrics.agentCalls.length)));
	completionLines.push(formatKeyValue("  Plan Generation", metrics.skipPlanGeneration ? "Skipped" : "Enabled"));
	completionLines.push(formatKeyValue("  Code Review Cycles", `${metrics.codeReviewCycles.cheap}c/${metrics.codeReviewCycles.expensive}e`));
	
	if (state.pipelineBranch) {
		completionLines.push("");
		completionLines.push(`  🔀 You are on branch: ${state.pipelineBranch}`);
	}
	
	completionLines.push("");
	completionLines.push("  📋 Next Steps:");
	completionLines.push("     • Review the implementation changes");
	if (projectConfig.testCommand) {
		completionLines.push("     • Run tests: " + projectConfig.testCommand);
	} else {
		completionLines.push("     • Run your project's test suite");
	}
	completionLines.push("     • Merge to main when ready");
	completionLines.push("     • Run /implement-metrics to export comparison data");
	completionLines.push("");
	completionLines.push(formatDivider(50));
	
	ctx.ui.notify(completionLines.join("\n"), "success");
}
