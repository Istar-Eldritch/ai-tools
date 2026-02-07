/**
 * Spec Pipeline Extension
 *
 * Split into two separate workflows:
 *
 * SPEC CREATION (/spec):
 *   1. Discovery (optional): Sonnet asks clarifying questions
 *   2. Spec Drafting: Opus drafts technical specification
 *   3. Spec Review: Tiered review (Sonnet → Opus), user approves or requests changes
 *   4. Stays on spec branch for user to review and merge
 *
 * IMPLEMENTATION (/implement):
 *   1. Takes a spec file path as input
 *   2. For each implementation phase:
 *      - Plan Drafting: Opus drafts implementation plan
 *      - Plan Review: Tiered review (Sonnet → Opus)
 *   3. For each implementation phase:
 *      - Implementation: Opus implements according to plan
 *      - Code Review: Tiered review (Sonnet → Opus)
 *   4. Stays on implement branch for user to review and merge
 *
 * Usage:
 *   /spec <description>                             # Start spec creation
 *   /spec --quick <description>                     # Skip discovery phase
 *   /spec-resume                                    # Resume spec creation
 *   /spec-status                                    # Show spec status
 *   /spec-list                                      # List spec pipelines
 *   /spec-cancel                                    # Cancel spec pipeline
 *
 *   /implement <spec-path>                          # Start implementation
 *   /implement --no-plan <spec-path>                # Skip plan generation
 *   /implement-resume                               # Resume implementation
 *   /implement-status                               # Show implementation status
 *   /implement-list                                 # List implementations
 *   /implement-cancel                               # Cancel implementation
 *   /implement-metrics [id]                         # Export metrics
 *
 * Configuration:
 *   Create .pi/spec-pipeline.json in your project root (same config for both)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Import types
import type { SpecState, ImplementationState, TieredReviewerRole } from "./types.ts";

// Import config
import { loadPipelineConfig, detectProjectConfig } from "./config.ts";

// Import state management
import {
	loadSpecState,
	saveSpecState,
	listSpecStates,
	getLatestActiveSpecPipeline,
	loadImplState,
	saveImplState,
	listImplStates,
	getLatestActiveImplPipeline,
	generateTimestamp,
	generatePipelineId,
	createInitialSpecState,
	createInitialImplState,
	getStateDir,
	getSpecStateDir,
	getImplStateDir,
} from "./state.ts";

// Import git operations
import {
	validateGitRepo,
	checkGitClean,
	getCurrentBranch,
	branchExists,
	createPipelineBranch,
	switchToBranch,
	stashExists,
	dropStash,
} from "./git.ts";

// Import error handling
import {
	getErrorEmoji,
	getErrorSuggestion,
	formatErrorForRetry,
	formatErrorBox,
	truncateString,
} from "./errors.ts";

// Import formatting
import {
	formatStepBanner,
	formatEffectiveConfig,
	formatSpecStage,
	formatImplStage,
	formatSpecState,
	formatImplState,
	formatDivider,
	formatKeyValue,
	updateSpecWidget,
	updateImplWidget,
	clearPipelineWidget,
} from "./formatting.ts";

// Import agents
import { runAgent } from "./agents.ts";

// Import review
import { retryFailedOperation } from "./review.ts";

// Import pipelines
import { runSpecPipeline } from "./spec-pipeline.ts";
import { runImplementPipeline } from "./implement-pipeline.ts";

// Import system prompts
import { createSystemPrompts } from "./agents-config.ts";

// ============================================
// Helpers
// ============================================

/** Common stop words for generating short names from descriptions */
const STOP_WORDS = new Set([
	"a", "an", "the", "i", "we", "you", "it", "is", "are", "was", "were",
	"want", "need", "would", "like", "to", "for", "of", "in", "on", "at",
	"with", "and", "or", "but", "that", "this", "these", "those", "be",
	"have", "has", "had", "do", "does", "did", "will", "can", "could",
	"should", "may", "might", "must", "shall", "add", "create", "make",
	"build", "implement", "new", "some", "my", "our", "your", "their"
]);

function generateShortName(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter(word => word.length > 1 && !STOP_WORDS.has(word))
		.slice(0, 3)
		.join("_") || "spec";
}

function generateBranchShortName(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter(word => word.length > 1 && !STOP_WORDS.has(word))
		.slice(0, 3)
		.join("-") || "spec";
}

export default function (pi: ExtensionAPI) {

	// ============================================
	// SPEC CREATION COMMANDS
	// ============================================

	pi.registerCommand("spec", {
		description: "Start spec creation. Use --quick to skip discovery.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const isQuick = argsStr.includes("--quick");
			const description = argsStr
				.replace("--quick", "")
				.replace(/\s+/g, " ")
				.trim();
			
			if (!description) {
				ctx.ui.notify("Usage: /spec [--quick] <description of what you want to build>", "error");
				return;
			}

			const cwd = ctx.cwd;

			// Check for existing active spec pipeline
			const existingPipeline = getLatestActiveSpecPipeline(cwd);
			if (existingPipeline) {
				const resume = await ctx.ui.confirm(
					"Active Spec Pipeline Found",
					`There's an active spec pipeline:\n${formatSpecState(existingPipeline)}\n\nDo you want to continue with a NEW pipeline? (No = cancel)`
				);
				if (!resume) {
					ctx.ui.notify("Use /spec-resume to continue the existing pipeline", "info");
					return;
				}
			}

			// Git validation
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash first.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			const originalBranch = await getCurrentBranch(cwd);
			if (!originalBranch) {
				ctx.ui.notify("Failed to determine current branch", "error");
				return;
			}

			// Load config
			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");
			ctx.ui.notify("Starting spec creation...", "info");
			if (projectConfig.contextFiles.length > 0) {
				ctx.ui.notify(`Using context from: ${projectConfig.contextFiles.join(", ")}`, "info");
			}

			// Generate names and timestamps
			const specTimestamp = generateTimestamp();
			const shortName = generateShortName(description);
			const branchShortName = generateBranchShortName(description);

			// Create initial state
			const state = createInitialSpecState(
				description,
				specTimestamp,
				shortName,
				projectConfig.specsDir,
				projectConfig.discovery,
				isQuick
			);
			
			state.originalBranch = originalBranch;
			state.checkpoints = [];
			saveSpecState(cwd, state);
			
			// Create branch: spec/<timestamp>-<short-name>
			const branchResult = await createPipelineBranch(cwd, "spec", `${specTimestamp}-${branchShortName}`);
			if (!branchResult.success) {
				ctx.ui.notify(`Failed to create spec branch: ${branchResult.error}`, "error");
				state.stage = "cancelled";
				saveSpecState(cwd, state);
				return;
			}
			state.pipelineBranch = branchResult.branchName;
			saveSpecState(cwd, state);
			
			ctx.ui.notify(formatStepBanner(
				"SPEC CREATION STARTED",
				`ID: ${state.id}`,
				"📝"
			), "info");
			ctx.ui.notify(`Branch: ${branchResult.branchName}`, "info");
			
			if (isQuick) {
				ctx.ui.notify("Skipping discovery phase (--quick mode)", "info");
			}
			
			updateSpecWidget(ctx, state, "Initializing...");

			await runSpecPipeline(state, cwd, projectConfig, ctx);
		},
	});

	pi.registerCommand("spec-resume", {
		description: "Resume an active spec pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: SpecState | null;
			if (pipelineId) {
				state = loadSpecState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Spec pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveSpecPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active spec pipeline found. Use /spec to start one.", "error");
					return;
				}
			}

			if (state.stage === "completed") {
				ctx.ui.notify("This spec pipeline is already completed.", "info");
				return;
			}

			if (state.stage === "cancelled") {
				const restart = await ctx.ui.confirm(
					"Pipeline Cancelled",
					"This pipeline was cancelled. Restart from where it left off?"
				);
				if (!restart) return;
				
				if (state.stageBeforeCancellation && state.stageBeforeCancellation !== "cancelled") {
					ctx.ui.notify(`Resuming from saved stage: ${formatSpecStage(state.stageBeforeCancellation)}`, "info");
					state.stage = state.stageBeforeCancellation;
					state.stageBeforeCancellation = undefined;
				} else {
					if (state.discovery && !state.discovery.completed) {
						state.stage = "discovery";
					} else if (!state.specApproved) {
						const fullSpecPath = path.join(cwd, state.specPath);
						if (fs.existsSync(fullSpecPath) && state.specIteration > 0) {
							state.stage = "spec_review";
						} else {
							state.stage = "spec_drafting";
						}
					} else {
						state.stage = "completed";
					}
				}
				saveSpecState(cwd, state);
			}

			// Git validation
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash first.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			// Switch to pipeline branch
			if (state.pipelineBranch) {
				const currentBranch = await getCurrentBranch(cwd);
				const pipelineBranchExists = await branchExists(cwd, state.pipelineBranch);
				if (!pipelineBranchExists) {
					ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' no longer exists.`, "error");
					return;
				}
				if (currentBranch !== state.pipelineBranch) {
					ctx.ui.notify(`Switching to pipeline branch: ${state.pipelineBranch}`, "info");
					const switchResult = await switchToBranch(cwd, state.pipelineBranch);
					if (!switchResult.success) {
						ctx.ui.notify(`Failed to switch to pipeline branch: ${switchResult.error}`, "error");
						return;
					}
				}
				
				if (state.errorStash) {
					const stashStillExists = await stashExists(cwd, state.errorStash);
					if (stashStillExists) {
						ctx.ui.notify("Dropping stashed changes from previous error...", "info");
						await dropStash(cwd, state.errorStash);
					}
					state.errorStash = undefined;
					saveSpecState(cwd, state);
				}
			}

			ctx.ui.notify(formatStepBanner(
				"RESUMING SPEC PIPELINE",
				`ID: ${state.id}`,
				"🔄"
			), "info");
			ctx.ui.notify(`Current stage: ${formatSpecStage(state.stage)}`, "info");
			
			if (state.discovery?.skipped) {
				ctx.ui.notify("📌 Discovery was skipped (--quick)", "info");
			}
			
			updateSpecWidget(ctx, state, "Resuming...");

			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			// Handle error retry
			if (state.lastError) {
				if (typeof state.lastError === "string") {
					ctx.ui.notify(`Previous error (legacy): ${state.lastError.slice(0, 200)}`, "warning");
					state.lastError = undefined;
					saveSpecState(cwd, state);
				} else if (state.lastError.agentTask) {
					const errorDisplay = formatErrorForRetry(state.lastError, state);
					ctx.ui.notify(errorDisplay, "info");
					
					const shouldRetry = await ctx.ui.confirm(
						"Retry Failed Operation?",
						`The pipeline failed at ${state.lastError.role}.\n\nRetry the same operation?`
					);
					
					if (!shouldRetry) {
						ctx.ui.notify("Resume cancelled.", "info");
						return;
					}
					
					const retrySuccess = await retryFailedOperation(
						state, cwd, projectConfig,
						() => saveSpecState(cwd, state),
						ctx
					);
					
					if (!retrySuccess) {
						ctx.ui.notify("Retry failed. Run /spec-resume to try again.", "info");
						return;
					}
					
					ctx.ui.notify("Retry successful! Continuing pipeline...", "success");
				} else {
					state.lastError = undefined;
					saveSpecState(cwd, state);
				}
			}

			await runSpecPipeline(state, cwd, projectConfig, ctx);
		},
	});

	pi.registerCommand("spec-status", {
		description: "Show spec pipeline status",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: SpecState | null;
			if (pipelineId) {
				state = loadSpecState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Spec pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveSpecPipeline(cwd);
				if (!state) {
					const states = listSpecStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No spec pipelines found. Use /spec to start one.", "info");
						return;
					}
					state = states[0];
				}
			}

			ctx.ui.notify(formatSpecState(state), "info");
			
			if (state.stage === "completed") {
				ctx.ui.notify(`\n✅ Spec completed. Run: /implement ${state.specPath}`, "success");
			} else if (state.stage === "cancelled") {
				ctx.ui.notify("\n🚫 Cancelled. Use /spec-resume to restart.", "info");
			} else if (state.lastError) {
				ctx.ui.notify("\n❌ Stopped due to error. Use /spec-resume to retry.", "warning");
			} else {
				ctx.ui.notify("\n▶️ Active. Use /spec-resume to continue.", "info");
			}
		},
	});

	pi.registerCommand("spec-list", {
		description: "List all spec pipelines",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listSpecStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No spec pipelines found. Use /spec to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  📋 Spec Pipelines (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				const hasError = state.lastError !== undefined;
				let statusIcon = "  ";
				if (state.stage === "completed") statusIcon = "✅";
				else if (state.stage === "cancelled") statusIcon = "🚫";
				else if (hasError) statusIcon = "❌";
				else statusIcon = "▶️";
				
				lines.push(`${statusIcon} ${state.id || "unknown"}`);
				const desc = state.description || "(no description)";
				lines.push(`   ${desc.slice(0, 55)}${desc.length > 55 ? "..." : ""}`);
				lines.push(`   Stage: ${formatSpecStage(state.stage)}`);
				if (state.pipelineBranch) lines.push(`   Branch: ${state.pipelineBranch}`);
				lines.push(`   Updated: ${state.updatedAt}`);
				if (state.stage === "completed") {
					lines.push(`   Spec: ${state.specPath}`);
				}
				lines.push("");
			}

			lines.push(formatDivider(60));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("spec-cancel", {
		description: "Cancel an active spec pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: SpecState | null;
			if (pipelineId) {
				state = loadSpecState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Spec pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveSpecPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active spec pipeline to cancel.", "info");
					return;
				}
			}

			if (state.stage === "completed" || state.stage === "cancelled") {
				ctx.ui.notify("Pipeline is already finished.", "info");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Cancel Spec Pipeline?",
				`Cancel spec pipeline ${state.id}?\n\nYou can resume later with /spec-resume.`
			);

			if (confirm) {
				if (state.stage !== "cancelled") {
					state.stageBeforeCancellation = state.stage;
				}
				state.stage = "cancelled";
				saveSpecState(cwd, state);
				
				clearPipelineWidget(ctx);
				
				if (state.pipelineBranch) {
					ctx.ui.notify(`Pipeline cancelled. Branch '${state.pipelineBranch}' preserved.`, "info");
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
		},
	});

	// ============================================
	// IMPLEMENTATION COMMANDS
	// ============================================

	pi.registerCommand("implement", {
		description: "Start implementation from a spec file. Use --no-plan to skip plan generation.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const noPlan = argsStr.includes("--no-plan");
			const specPath = argsStr
				.replace("--no-plan", "")
				.replace(/\s+/g, " ")
				.trim();
			
			if (!specPath) {
				ctx.ui.notify("Usage: /implement [--no-plan] <path-to-spec-file>", "error");
				return;
			}

			const cwd = ctx.cwd;

			// Validate spec file exists
			const fullSpecPath = path.isAbsolute(specPath)
				? specPath
				: path.join(cwd, specPath);
			
			if (!fs.existsSync(fullSpecPath)) {
				ctx.ui.notify(`Spec file not found: ${specPath}`, "error");
				return;
			}

			const specContent = fs.readFileSync(fullSpecPath, "utf-8");
			if (!specContent.trim()) {
				ctx.ui.notify("Spec file is empty", "error");
				return;
			}

			// Make specPath relative to cwd
			const relativeSpecPath = path.isAbsolute(specPath)
				? path.relative(cwd, specPath)
				: specPath;

			// Check for existing active implementation
			const existingPipeline = getLatestActiveImplPipeline(cwd);
			if (existingPipeline) {
				const resume = await ctx.ui.confirm(
					"Active Implementation Found",
					`There's an active implementation:\n${formatImplState(existingPipeline)}\n\nStart a NEW implementation? (No = cancel)`
				);
				if (!resume) {
					ctx.ui.notify("Use /implement-resume to continue the existing implementation", "info");
					return;
				}
			}

			// Git validation
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash first.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			const originalBranch = await getCurrentBranch(cwd);
			if (!originalBranch) {
				ctx.ui.notify("Failed to determine current branch", "error");
				return;
			}

			// Load config
			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			if (noPlan) {
				projectConfig.skipPlanGeneration = true;
			}

			ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");
			
			if (noPlan) {
				ctx.ui.notify("⏭️ Plan generation will be skipped (--no-plan flag)", "info");
			}

			ctx.ui.notify(`Starting implementation from: ${relativeSpecPath}`, "info");

			// Generate timestamp and names
			const implTimestamp = generateTimestamp();
			const branchShortName = generateBranchShortName(
				path.basename(relativeSpecPath, path.extname(relativeSpecPath))
			);

			// Create initial state
			const state = createInitialImplState(
				relativeSpecPath,
				specContent,
				implTimestamp,
				noPlan
			);
			
			state.originalBranch = originalBranch;
			state.checkpoints = [];
			saveImplState(cwd, state);
			
			// Create branch: implement/<timestamp>-<short-name>
			const branchResult = await createPipelineBranch(cwd, "implement", `${implTimestamp}-${branchShortName}`);
			if (!branchResult.success) {
				ctx.ui.notify(`Failed to create implementation branch: ${branchResult.error}`, "error");
				state.stage = "cancelled";
				saveImplState(cwd, state);
				return;
			}
			state.pipelineBranch = branchResult.branchName;
			saveImplState(cwd, state);
			
			ctx.ui.notify(formatStepBanner(
				"IMPLEMENTATION STARTED",
				`ID: ${state.id}`,
				"🚀"
			), "info");
			ctx.ui.notify(`Branch: ${branchResult.branchName}`, "info");
			ctx.ui.notify(`Spec: ${relativeSpecPath}`, "info");
			
			updateImplWidget(ctx, state, "Initializing...");

			await runImplementPipeline(state, cwd, projectConfig, ctx);
		},
	});

	pi.registerCommand("implement-resume", {
		description: "Resume an active implementation pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: ImplementationState | null;
			if (pipelineId) {
				state = loadImplState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Implementation not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveImplPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active implementation found. Use /implement to start one.", "error");
					return;
				}
			}

			if (state.stage === "completed") {
				ctx.ui.notify("This implementation is already completed.", "info");
				return;
			}

			if (state.stage === "cancelled") {
				const restart = await ctx.ui.confirm(
					"Implementation Cancelled",
					"This implementation was cancelled. Restart from where it left off?"
				);
				if (!restart) return;
				
				if (state.stageBeforeCancellation && state.stageBeforeCancellation !== "cancelled") {
					ctx.ui.notify(`Resuming from saved stage: ${formatImplStage(state.stageBeforeCancellation)}`, "info");
					state.stage = state.stageBeforeCancellation;
					state.stageBeforeCancellation = undefined;
				} else {
					if (!state.phasesGenerated.every(Boolean)) {
						state.stage = "plan_generation";
					} else {
						state.stage = "implementation";
					}
				}
				saveImplState(cwd, state);
			}

			// Git validation
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			const gitClean = await checkGitClean(cwd);
			if (!gitClean.clean) {
				ctx.ui.notify("Working directory has uncommitted changes. Please commit or stash first.", "error");
				if (gitClean.status) {
					ctx.ui.notify(`Changed files:\n${gitClean.status.slice(0, 500)}`, "info");
				}
				return;
			}
			
			// Switch to pipeline branch
			if (state.pipelineBranch) {
				const currentBranch = await getCurrentBranch(cwd);
				const pipelineBranchExists = await branchExists(cwd, state.pipelineBranch);
				if (!pipelineBranchExists) {
					ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' no longer exists.`, "error");
					return;
				}
				if (currentBranch !== state.pipelineBranch) {
					ctx.ui.notify(`Switching to pipeline branch: ${state.pipelineBranch}`, "info");
					const switchResult = await switchToBranch(cwd, state.pipelineBranch);
					if (!switchResult.success) {
						ctx.ui.notify(`Failed to switch to pipeline branch: ${switchResult.error}`, "error");
						return;
					}
				}
				
				if (state.errorStash) {
					const stashStillExists = await stashExists(cwd, state.errorStash);
					if (stashStillExists) {
						ctx.ui.notify("Dropping stashed changes from previous error...", "info");
						await dropStash(cwd, state.errorStash);
					}
					state.errorStash = undefined;
					saveImplState(cwd, state);
				}
			}

			ctx.ui.notify(formatStepBanner(
				"RESUMING IMPLEMENTATION",
				`ID: ${state.id}`,
				"🔄"
			), "info");
			ctx.ui.notify(`Current stage: ${formatImplStage(state.stage)}`, "info");
			
			if (state.skipPlanGeneration) {
				ctx.ui.notify("📌 Plan generation is skipped (--no-plan)", "info");
			}
			
			updateImplWidget(ctx, state, "Resuming...");

			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			// Handle error retry
			if (state.lastError) {
				if (typeof state.lastError === "string") {
					ctx.ui.notify(`Previous error (legacy): ${state.lastError.slice(0, 200)}`, "warning");
					state.lastError = undefined;
					saveImplState(cwd, state);
				} else if (state.lastError.agentTask) {
					const errorDisplay = formatErrorForRetry(state.lastError, state);
					ctx.ui.notify(errorDisplay, "info");
					
					const shouldRetry = await ctx.ui.confirm(
						"Retry Failed Operation?",
						`The implementation failed at ${state.lastError.role}.\n\nRetry the same operation?`
					);
					
					if (!shouldRetry) {
						ctx.ui.notify("Resume cancelled.", "info");
						return;
					}
					
					const retrySuccess = await retryFailedOperation(
						state, cwd, projectConfig,
						() => saveImplState(cwd, state),
						ctx
					);
					
					if (!retrySuccess) {
						ctx.ui.notify("Retry failed. Run /implement-resume to try again.", "info");
						return;
					}
					
					ctx.ui.notify("Retry successful! Continuing pipeline...", "success");
				} else {
					state.lastError = undefined;
					saveImplState(cwd, state);
				}
			}

			await runImplementPipeline(state, cwd, projectConfig, ctx);
		},
	});

	pi.registerCommand("implement-status", {
		description: "Show implementation status",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: ImplementationState | null;
			if (pipelineId) {
				state = loadImplState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Implementation not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveImplPipeline(cwd);
				if (!state) {
					const states = listImplStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No implementations found. Use /implement to start one.", "info");
						return;
					}
					state = states[0];
				}
			}

			ctx.ui.notify(formatImplState(state), "info");
			
			if (state.stage === "completed") {
				ctx.ui.notify("\n✅ Implementation completed.", "success");
			} else if (state.stage === "cancelled") {
				ctx.ui.notify("\n🚫 Cancelled. Use /implement-resume to restart.", "info");
			} else if (state.lastError) {
				ctx.ui.notify("\n❌ Stopped due to error. Use /implement-resume to retry.", "warning");
			} else {
				ctx.ui.notify("\n▶️ Active. Use /implement-resume to continue.", "info");
			}
		},
	});

	pi.registerCommand("implement-list", {
		description: "List all implementations",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listImplStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No implementations found. Use /implement to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  🚀 Implementations (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				const hasError = state.lastError !== undefined;
				let statusIcon = "  ";
				if (state.stage === "completed") statusIcon = "✅";
				else if (state.stage === "cancelled") statusIcon = "🚫";
				else if (hasError) statusIcon = "❌";
				else statusIcon = "▶️";
				
				lines.push(`${statusIcon} ${state.id || "unknown"}`);
				lines.push(`   Spec: ${state.specPath}`);
				lines.push(`   Stage: ${formatImplStage(state.stage)}`);
				if (state.pipelineBranch) lines.push(`   Branch: ${state.pipelineBranch}`);
				const phases = state.phases || [];
				if (phases.length > 0) {
					lines.push(`   Phases: ${state.currentPhaseIndex + 1}/${phases.length}`);
				}
				lines.push(`   Updated: ${state.updatedAt}`);
				lines.push("");
			}

			lines.push(formatDivider(60));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("implement-cancel", {
		description: "Cancel an active implementation",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: ImplementationState | null;
			if (pipelineId) {
				state = loadImplState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Implementation not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveImplPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active implementation to cancel.", "info");
					return;
				}
			}

			if (state.stage === "completed" || state.stage === "cancelled") {
				ctx.ui.notify("Implementation is already finished.", "info");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Cancel Implementation?",
				`Cancel implementation ${state.id}?\n\nYou can resume later with /implement-resume.`
			);

			if (confirm) {
				if (state.stage !== "cancelled") {
					state.stageBeforeCancellation = state.stage;
				}
				state.stage = "cancelled";
				saveImplState(cwd, state);
				
				clearPipelineWidget(ctx);
				
				if (state.pipelineBranch) {
					ctx.ui.notify(`Implementation cancelled. Branch '${state.pipelineBranch}' preserved.`, "info");
					if (state.originalBranch) {
						const switchResult = await switchToBranch(cwd, state.originalBranch);
						if (switchResult.success) {
							ctx.ui.notify(`Switched back to '${state.originalBranch}'`, "info");
						}
					}
				} else {
					ctx.ui.notify("Implementation cancelled. Resume with /implement-resume", "info");
				}
			}
		},
	});

	pi.registerCommand("implement-metrics", {
		description: "Export implementation metrics for A/B testing",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let statesToExport: ImplementationState[] = [];
			
			if (pipelineId === "--all") {
				statesToExport = listImplStates(cwd).filter(s => s.stage === "completed" && s.metrics);
			} else if (pipelineId) {
				const state = loadImplState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Implementation not found: ${pipelineId}`, "error");
					return;
				}
				if (state.metrics) {
					statesToExport = [state];
				} else {
					ctx.ui.notify(`Implementation ${pipelineId} has no metrics`, "warning");
					return;
				}
			} else {
				const states = listImplStates(cwd);
				const completed = states.filter(s => s.stage === "completed" && s.metrics);
				if (completed.length === 0) {
					ctx.ui.notify("No completed implementations with metrics found.", "info");
					return;
				}
				statesToExport = [completed[0]];
			}

			if (statesToExport.length === 0) {
				ctx.ui.notify("No implementations with metrics to export.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(70));
			lines.push(`  📊 Implementation Metrics (${statesToExport.length} pipeline${statesToExport.length > 1 ? 's' : ''})`);
			lines.push(formatDivider(70));
			lines.push("");

			lines.push("| ID | Plan Gen | Duration | Code Review (c/e) | First Pass |");
			lines.push("|-----|----------|----------|-------------------|------------|");

			for (const state of statesToExport) {
				const m = state.metrics!;
				const durationMins = m.totalDurationMs ? Math.round(m.totalDurationMs / 60000) : "?";
				const planGen = m.skipPlanGeneration ? "SKIP" : "YES";
				const codeReview = `${m.codeReviewCycles.cheap}/${m.codeReviewCycles.expensive}`;
				const firstPass = `${m.codeReviewFirstPassRate}%`;
				
				const stateId = state.id || "unknown";
				lines.push(`| ${stateId.slice(0, 16)} | ${planGen.padEnd(8)} | ${String(durationMins).padEnd(8)} | ${codeReview.padEnd(17)} | ${firstPass.padEnd(10)} |`);
			}

			lines.push("");

			if (statesToExport.length === 1) {
				const state = statesToExport[0];
				const m = state.metrics!;
				
				lines.push("📋 Detailed Metrics:");
				lines.push("");
				lines.push(formatKeyValue("  Pipeline ID", state.id || "unknown"));
				lines.push(formatKeyValue("  Spec Path", state.specPath));
				lines.push(formatKeyValue("  Status", state.stage));
				lines.push("");
				lines.push("  Configuration:");
				lines.push(formatKeyValue("    Skip Plan Generation", m.skipPlanGeneration ? "Yes (A/B test)" : "No (normal)"));
				lines.push("");
				lines.push("  Timing:");
				if (m.totalDurationMs) {
					lines.push(formatKeyValue("    Total Duration", `${Math.round(m.totalDurationMs / 60000)} minutes`));
				}
				lines.push(formatKeyValue("    Agent Calls", String(m.agentCalls.length)));
				lines.push("");
				lines.push("  Review Cycles:");
				lines.push(formatKeyValue("    Plan Review", `${m.planReviewCycles.cheap} cheap, ${m.planReviewCycles.expensive} expensive`));
				lines.push(formatKeyValue("    Code Review", `${m.codeReviewCycles.cheap} cheap, ${m.codeReviewCycles.expensive} expensive`));
				lines.push("");
				lines.push("  Quality:");
				lines.push(formatKeyValue("    First Pass Rate", `${m.codeReviewFirstPassRate}%`));
				lines.push("");

				const callsByRole: Record<string, number> = {};
				for (const call of m.agentCalls) {
					callsByRole[call.role] = (callsByRole[call.role] || 0) + 1;
				}
				lines.push("  Agent Calls by Role:");
				for (const [role, count] of Object.entries(callsByRole)) {
					lines.push(`    ${role}: ${count}`);
				}
			}

			lines.push("");
			lines.push(formatDivider(70));
			
			const stateDir = getStateDir(cwd);
			if (!fs.existsSync(stateDir)) {
				fs.mkdirSync(stateDir, { recursive: true });
			}
			const exportPath = path.join(stateDir, "metrics-export.json");
			const exportData = statesToExport.map(s => ({
				id: s.id,
				specPath: s.specPath,
				stage: s.stage,
				createdAt: s.createdAt,
				metrics: s.metrics,
			}));
			fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
			lines.push(`\n📁 Full metrics exported to: ${exportPath}`);

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ============================================
	// SHARED TOOL (programmatic access)
	// ============================================

	pi.registerTool({
		name: "run_spec_agent",
		label: "Run Spec Agent",
		description: `Run a specialized agent for the spec pipeline.

IMPORTANT: The subagent runs in a completely isolated context with NO memory of prior conversation.
The 'task' parameter is the ONLY input the subagent receives.
You MUST include ALL relevant context in the task.`,
		parameters: Type.Object({
			agent: Type.Union([Type.Literal("opus"), Type.Literal("sonnet"), Type.Literal("haiku")], {
				description: "Agent to run (opus for complex tasks, sonnet for reviews, haiku for simple tasks)",
			}),
			role: Type.Union(
				[
					Type.Literal("discoveryAgent"),
					Type.Literal("specDrafter"),
					Type.Literal("specReviewer"),
					Type.Literal("planDrafter"),
					Type.Literal("planReviewer"),
					Type.Literal("implementer"),
					Type.Literal("codeReviewer"),
					Type.Literal("commitMessageWriter"),
					Type.Literal("addressReview"),
				],
				{ description: "Role/system prompt to use" }
			),
			task: Type.String({ 
				description: "Complete task description including ALL context" 
			}),
		}),
		async execute(_id, params, onUpdate, ctx, signal) {
			let projectConfig;
			try {
				projectConfig = detectProjectConfig(ctx.cwd);
			} catch (e) {
				const error = e instanceof Error ? e.message : "Configuration error";
				return {
					content: [{ type: "text", text: error }],
					details: { error },
					isError: true,
				};
			}
			const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);
			
			const result = await runAgent(
				params.agent as "opus" | "sonnet" | "haiku",
				params.task,
				ctx.cwd,
				SYSTEM_PROMPTS[params.role as keyof typeof SYSTEM_PROMPTS],
				signal,
				(text) => {
					onUpdate?.({
						content: [{ type: "text", text }],
						details: {},
					});
				},
				params.role
			);

			return {
				content: [{ type: "text", text: result.output }],
				details: {
					agent: params.agent,
					role: params.role,
					exitCode: result.exitCode,
					error: result.error,
				},
				isError: result.exitCode !== 0,
			};
		},
	});
}
