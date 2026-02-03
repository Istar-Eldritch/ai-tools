/**
 * Spec Pipeline Extension
 *
 * Automates the spec → implementation workflow with configurable AI agents:
 *
 * 1. Discovery (optional): Sonnet asks clarifying questions
 * 2. Spec Drafting: Opus drafts technical specification
 * 3. Spec Review: Tiered review (Sonnet → Opus), user approves or requests changes
 * 4. For each implementation phase:
 *    - Plan Drafting: Opus drafts implementation plan
 *    - Plan Review: Tiered review (Sonnet → Opus)
 * 5. Haiku creates commit message for spec
 * 6. For each implementation phase:
 *    - Implementation: Opus implements according to plan
 *    - Code Review: Tiered review (Sonnet → Opus)
 *    - Haiku creates commit after phase completion
 *
 * Tiered Review System:
 *   - Cheap tier (default: Sonnet) runs first for initial review cycles
 *   - Expensive tier (default: Opus) runs as final quality gate
 *   - Fixes during expensive tier stay at expensive tier
 *
 * Usage:
 *   /spec <description of what you want to build>
 *   /spec --quick <description>                     # Skip discovery phase
 *   /spec-resume                                    # Resume last pipeline
 *   /spec-status                                    # Show current state
 *   /spec-list                                      # List all pipelines
 *   /spec-cancel                                    # Cancel current pipeline
 *
 * Configuration:
 *   Create .pi/spec-pipeline.json in your project root:
 *   {
 *     "specsDir": "docs/specs",
 *     "testCommand": "npm test",
 *     "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
 *     "discovery": { "enabled": true, "maxRounds": 5, "questionsPerRound": 4 },
 *     "models": {
 *       "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
 *       "specDrafter": { "model": "opus", "thinking": "high" },
 *       "specReviewer": {
 *         "cheap": { "model": "sonnet", "thinking": "medium" },
 *         "expensive": { "model": "opus", "thinking": "high" }
 *       }
 *       // ... other roles
 *     },
 *     // Per-reviewer cycles (set both to 0 to skip that review):
 *     "reviewCycles": {
 *       "specReviewer": { "cheap": 2, "expensive": 2 },
 *       "planReviewer": { "cheap": 0, "expensive": 0 },  // Skip plan review
 *       "codeReviewer": { "cheap": 2, "expensive": 1 }
 *     }
 *     // Or use global format (applies to all reviewers):
 *     // "reviewCycles": { "cheap": 2, "expensive": 2 }
 *   }
 *
 * Default Model Configuration (optimized for cost/quality balance):
 *   - discoveryAgent: Sonnet (question generation doesn't need Opus)
 *   - specDrafter: Opus (complex synthesis task)
 *   - specReviewer: Sonnet → Opus (tiered)
 *   - planDrafter: Opus (complex planning task)
 *   - planReviewer: Sonnet → Opus (tiered)
 *   - implementer: Opus (complex code generation)
 *   - codeReviewer: Sonnet → Opus (tiered)
 *   - addressReview: Opus (complex fix implementation)
 *   - commitMessageWriter: Haiku (fixed, not configurable)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Import from modules
import type { PipelineState, TieredReviewerRole } from "./types.ts";
import { loadPipelineConfig, detectProjectConfig } from "./config.ts";
import {
	loadState,
	saveState,
	listStates,
	getLatestActivePipeline,
	generateSpecTimestamp,
	createInitialState,
	getStateDir,
} from "./state.ts";
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
import {
	getErrorEmoji,
	getErrorSuggestion,
	formatErrorForRetry,
	formatErrorBox,
	truncateString,
} from "./errors.ts";
import {
	formatStepBanner,
	formatEffectiveConfig,
	formatStage,
	formatState,
	formatDivider,
	formatKeyValue,
	updatePipelineWidget,
	clearPipelineWidget,
} from "./formatting.ts";
import { runAgent } from "./agents.ts";
import { retryFailedOperation } from "./review.ts";
import { runPipeline } from "./pipeline.ts";
import { createSystemPrompts } from "./agents-config.ts";

export default function (pi: ExtensionAPI) {
	// Main command to start a new spec pipeline
	pi.registerCommand("spec", {
		description: "Start the spec → implementation pipeline. Use --quick to skip discovery phase.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			// Parse --quick flag
			const isQuick = args.includes("--quick");
			const description = args.replace("--quick", "").replace(/\s+/g, " ").trim();
			
			if (!description) {
				ctx.ui.notify("Usage: /spec [--quick] <description of what you want to build>", "error");
				return;
			}

			const cwd = ctx.cwd;

			// Check for existing active pipeline
			const existingPipeline = getLatestActivePipeline(cwd);
			if (existingPipeline) {
				const resume = await ctx.ui.confirm(
					"Active Pipeline Found",
					`There's an active pipeline:\n${formatState(existingPipeline)}\n\nDo you want to continue with a NEW pipeline? (No = cancel)`
				);
				if (!resume) {
					ctx.ui.notify("Use /spec-resume to continue the existing pipeline", "info");
					return;
				}
			}

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

			// Load and validate project configuration
			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			// Display effective configuration (R5)
			ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");

			ctx.ui.notify("Starting spec pipeline...", "info");
			if (projectConfig.contextFiles.length > 0) {
				ctx.ui.notify(`Using context from: ${projectConfig.contextFiles.join(", ")}`, "info");
			}

			// Generate spec timestamp
			const specTimestamp = generateSpecTimestamp();

			// Generate short name - extract key nouns, skip common words
			const stopWords = new Set([
				"a", "an", "the", "i", "we", "you", "it", "is", "are", "was", "were",
				"want", "need", "would", "like", "to", "for", "of", "in", "on", "at",
				"with", "and", "or", "but", "that", "this", "these", "those", "be",
				"have", "has", "had", "do", "does", "did", "will", "can", "could",
				"should", "may", "might", "must", "shall", "add", "create", "make",
				"build", "implement", "new", "some", "my", "our", "your", "their"
			]);
			const shortName = description
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, "")
				.split(/\s+/)
				.filter(word => word.length > 1 && !stopWords.has(word))
				.slice(0, 3)
				.join("_") || "spec";

			// Create initial state (discovery enabled unless --quick flag used)
			const state = createInitialState(
				description,
				specTimestamp,
				shortName,
				projectConfig.specsDir,
				projectConfig.discovery,
				isQuick
			);
			
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
			
			// Show initial pipeline banner
			ctx.ui.notify(formatStepBanner(
				"SPEC PIPELINE STARTED",
				`ID: ${state.id}`,
				"🚀"
			), "info");
			ctx.ui.notify(`Branch: ${branchResult.branchName}`, "info");
			
			if (isQuick) {
				ctx.ui.notify("Skipping discovery phase (--quick mode)", "info");
			}
			
			// Initialize the status widget
			updatePipelineWidget(ctx, state, "Initializing...");

			// Run the pipeline
			await runPipeline(state, cwd, projectConfig, ctx);
		},
	});

	// Command to resume the last active pipeline
	pi.registerCommand("spec-resume", {
		description: "Resume the last active spec pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = args.trim();

			let state: PipelineState | null;
			if (pipelineId) {
				state = loadState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActivePipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active pipeline found. Use /spec to start a new one.", "error");
					return;
				}
			}

			if (state.stage === "completed") {
				ctx.ui.notify("This pipeline is already completed.", "info");
				return;
			}

			if (state.stage === "cancelled") {
				const restart = await ctx.ui.confirm(
					"Pipeline Cancelled",
					"This pipeline was cancelled. Do you want to restart it from where it left off?"
				);
				if (!restart) {
					return;
				}
				// Reset cancelled state to the appropriate resume point
				if (state.discovery && !state.discovery.completed) {
					state.stage = "discovery";
				} else if (!state.specApproved) {
					state.stage = "spec_drafting";
				} else if (!state.phasesGenerated.every(Boolean)) {
					state.stage = "plan_generation";
				} else {
					state.stage = "implementation";
				}
				saveState(cwd, state);
			}

			// Validate git repo
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
			
			// Handle pipeline branch switching
			if (state.pipelineBranch) {
				const currentBranch = await getCurrentBranch(cwd);
				
				const pipelineBranchExists = await branchExists(cwd, state.pipelineBranch);
				if (!pipelineBranchExists) {
					ctx.ui.notify(`Pipeline branch '${state.pipelineBranch}' no longer exists.`, "error");
					ctx.ui.notify("You can recreate it manually from an existing commit or start a new pipeline.", "info");
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
				
				// Drop error stash if it exists
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

			// Show resume banner
			ctx.ui.notify(formatStepBanner(
				"RESUMING PIPELINE",
				`ID: ${state.id}`,
				"🔄"
			), "info");
			ctx.ui.notify(`Current stage: ${formatStage(state.stage)}`, "info");
			
			// Initialize the status widget
			updatePipelineWidget(ctx, state, "Resuming...");

			// Load and validate project configuration
			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			// Check if we're resuming from an error state
			if (state.lastError) {
				if (typeof state.lastError === "string") {
					ctx.ui.notify(`Previous error (legacy): ${state.lastError.slice(0, 200)}`, "warning");
					ctx.ui.notify("Cannot retry legacy error format. Pipeline will attempt to continue.", "info");
					state.lastError = undefined;
					saveState(cwd, state);
				} else if (state.lastError.agentTask) {
					// Display the previous error
					const errorDisplay = formatErrorForRetry(state.lastError, state);
					ctx.ui.notify(errorDisplay, "info");
					
					const shouldRetry = await ctx.ui.confirm(
						"Retry Failed Operation?",
						`The pipeline failed at ${state.lastError.role}.\n\nRetry the same operation?`
					);
					
					if (!shouldRetry) {
						ctx.ui.notify("Resume cancelled. Use /spec-resume to try again later.", "info");
						return;
					}
					
					ctx.ui.notify("Retrying the same operation...", "info");
					
					const retrySuccess = await retryFailedOperation(state, cwd, projectConfig, ctx);
					
					if (!retrySuccess) {
						ctx.ui.notify("Retry failed. Run /spec-resume to try again.", "info");
						return;
					}
					
					ctx.ui.notify("Retry successful! Continuing pipeline...", "success");
				} else {
					ctx.ui.notify("Previous error detected but cannot retry (no task stored).", "warning");
					state.lastError = undefined;
					saveState(cwd, state);
				}
			}

			// Run the pipeline
			await runPipeline(state, cwd, projectConfig, ctx);
		},
	});

	// Command to show pipeline status
	pi.registerCommand("spec-status", {
		description: "Show current spec pipeline status",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = args.trim();

			let state: PipelineState | null;
			if (pipelineId) {
				state = loadState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActivePipeline(cwd);
				if (!state) {
					const states = listStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No pipelines found. Use /spec to start one.", "info");
						return;
					}
					state = states[0];
				}
			}

			ctx.ui.notify(formatState(state), "info");
			
			if (state.stage === "completed") {
				ctx.ui.notify("\n✅ This pipeline completed successfully.", "success");
			} else if (state.stage === "cancelled") {
				ctx.ui.notify("\n🚫 This pipeline was cancelled. Use /spec-resume to restart.", "info");
			} else if (state.lastError) {
				ctx.ui.notify("\n❌ This pipeline stopped due to an error.", "warning");
				ctx.ui.notify("   Use /spec-error for details, /spec-resume to retry", "info");
			} else {
				ctx.ui.notify("\n▶️ This pipeline is active. Use /spec-resume to continue.", "info");
			}
		},
	});

	// Command to list all pipelines
	pi.registerCommand("spec-list", {
		description: "List all spec pipelines",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No pipelines found. Use /spec to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  📋 Pipelines (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				const isActive = state.stage !== "completed" && state.stage !== "cancelled";
				const hasError = state.lastError !== undefined;
				
				let statusIcon = "  ";
				if (state.stage === "completed") {
					statusIcon = "✅";
				} else if (state.stage === "cancelled") {
					statusIcon = "🚫";
				} else if (hasError) {
					statusIcon = "❌";
				} else if (isActive) {
					statusIcon = "▶️";
				}
				
				lines.push(`${statusIcon} ${state.id}`);
				lines.push(`   ${state.description.slice(0, 55)}${state.description.length > 55 ? "..." : ""}`);
				lines.push(`   Stage: ${formatStage(state.stage)}`);
				
				if (hasError && state.lastError && typeof state.lastError !== "string") {
					const errEmoji = getErrorEmoji(state.lastError.errorType);
					lines.push(`   Error: ${errEmoji} ${state.lastError.errorType}`);
				}
				
				if (state.pipelineBranch) {
					lines.push(`   Branch: ${state.pipelineBranch}`);
				}
				
				lines.push(`   Updated: ${state.updatedAt}`);
				lines.push("");
			}

			lines.push(formatDivider(60));
			lines.push("Legend: ▶️ Active  ✅ Completed  🚫 Cancelled  ❌ Error");
			lines.push(formatDivider(60));

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// Command to view error details
	pi.registerCommand("spec-error", {
		description: "Show detailed error information for the current pipeline",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = args.trim();

			let state: PipelineState | null;
			if (pipelineId) {
				state = loadState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActivePipeline(cwd);
				if (!state) {
					const states = listStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No pipelines found.", "info");
						return;
					}
					state = states[0];
				}
			}

			if (!state.lastError) {
				ctx.ui.notify("No error recorded for this pipeline.", "info");
				ctx.ui.notify(`Pipeline stage: ${formatStage(state.stage)}`, "info");
				return;
			}

			if (typeof state.lastError === "string") {
				ctx.ui.notify("Legacy Error Format", "warning");
				ctx.ui.notify(state.lastError, "info");
				ctx.ui.notify("\nThis is a legacy error format. Limited details available.", "info");
				return;
			}

			const error = state.lastError;

			ctx.ui.notify(formatErrorBox(error, state), "info");

			if (error.stderr) {
				ctx.ui.notify("\n📜 Full Error Output:", "info");
				ctx.ui.notify(formatDivider(60), "info");
				ctx.ui.notify(error.stderr, "info");
				ctx.ui.notify(formatDivider(60), "info");
			}

			if (error.agentTask) {
				ctx.ui.notify("\n📋 Agent Task (excerpt):", "info");
				ctx.ui.notify(formatDivider(60), "info");
				const taskPreview = error.agentTask.slice(0, 1000);
				ctx.ui.notify(taskPreview, "info");
				if (error.agentTask.length > 1000) {
					ctx.ui.notify(`... (${error.agentTask.length - 1000} more characters)`, "info");
				}
				ctx.ui.notify(formatDivider(60), "info");
			}

			const logPath = path.join(getStateDir(cwd), `${state.id}.error.log`);
			if (fs.existsSync(logPath)) {
				ctx.ui.notify(`\n📁 Full error log: ${logPath}`, "info");
				ctx.ui.notify("   View with: cat " + logPath, "info");
			} else {
				ctx.ui.notify(`\n📁 Error log not found: ${logPath}`, "warning");
			}

			ctx.ui.notify("\n💡 Recovery Options:", "info");
			ctx.ui.notify(`   1. ${getErrorSuggestion(error.errorType)}`, "info");
			if (state.pipelineBranch) {
				ctx.ui.notify(`   2. View changes: git diff ${state.pipelineBranch}`, "info");
				if (state.checkpoints && state.checkpoints.length > 0) {
					const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1];
					ctx.ui.notify(`   3. Revert to checkpoint: git reset --hard ${lastCheckpoint}`, "info");
				}
			}
		},
	});

	// Command to cancel current pipeline
	pi.registerCommand("spec-cancel", {
		description: "Cancel the current spec pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = args.trim();

			let state: PipelineState | null;
			if (pipelineId) {
				state = loadState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActivePipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active pipeline to cancel.", "info");
					return;
				}
			}

			if (state.stage === "completed" || state.stage === "cancelled") {
				ctx.ui.notify("Pipeline is already finished.", "info");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Cancel Pipeline?",
				`Are you sure you want to cancel pipeline ${state.id}?\n\nYou can resume it later with /spec-resume.`
			);

			if (confirm) {
				state.stage = "cancelled";
				saveState(cwd, state);
				
				clearPipelineWidget(ctx);
				
				if (state.pipelineBranch) {
					ctx.ui.notify(`Pipeline cancelled. Branch '${state.pipelineBranch}' preserved.`, "info");
					ctx.ui.notify("You can delete it manually with: git branch -D " + state.pipelineBranch, "info");
					ctx.ui.notify("Or resume later with: /spec-resume", "info");
					
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

	// Register a tool for programmatic access
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
