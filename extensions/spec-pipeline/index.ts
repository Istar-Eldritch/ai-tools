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
import type { SpecState, ImplementationState, TieredReviewerRole, ConversationalExchange, ProjectConfig, PipelineMode, DraftingState } from "./types.ts";

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
	generateConversationalDiscoverySummary,
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
	createAgentCommit,
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
import { retryFailedOperation, runTieredReview } from "./review.ts";

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
	// UNIFIED CONVERSATIONAL MODE STATE
	// ============================================

	/** Current pipeline mode: idle, discovery, or drafting */
	let pipelineMode: PipelineMode = "idle";

	/** The spec state for the active conversational session */
	let activeSpecState: SpecState | null = null;

	/** The cwd for the active conversational session */
	let activeCwd: string = "";

	/** The project config for the active conversational session */
	let activeProjectConfig: ProjectConfig | null = null;

	/** Tracks the last user message for pairing with assistant response */
	let lastUserMessage: string = "";

	/** Number of conversation exchanges in current mode */
	let exchangeCount = 0;

	/**
	 * Enter a conversational pipeline mode (discovery or drafting)
	 */
	function enterMode(mode: "discovery" | "drafting", state: SpecState, cwd: string, projectConfig: ProjectConfig): void {
		pipelineMode = mode;
		activeSpecState = state;
		activeCwd = cwd;
		activeProjectConfig = projectConfig;
		lastUserMessage = "";
		// Set exchange count from existing history when resuming
		if (mode === "discovery") {
			exchangeCount = state.discovery?.conversationHistory?.length ?? 0;
		} else {
			exchangeCount = state.drafting?.conversationHistory?.length ?? 0;
		}
	}

	/**
	 * Exit any conversational mode and return to idle
	 */
	function exitMode(): { exchangeCount: number; state: SpecState | null; cwd: string; projectConfig: ProjectConfig | null } {
		const result = { exchangeCount, state: activeSpecState, cwd: activeCwd, projectConfig: activeProjectConfig };
		pipelineMode = "idle";
		activeSpecState = null;
		activeCwd = "";
		activeProjectConfig = null;
		lastUserMessage = "";
		exchangeCount = 0;
		return result;
	}

	/**
	 * Build the discovery system prompt injection for before_agent_start.
	 * This turns the host LLM into a discovery agent.
	 */
	function buildDiscoveryPromptInjection(state: SpecState, projectConfig: ProjectConfig): string {
		const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);
		const discoveryPrompt = SYSTEM_PROMPTS.discoveryAgent;

		let conversationContext = "";
		if (state.discovery?.conversationHistory && state.discovery.conversationHistory.length > 0) {
			conversationContext = "\n\n## Previous Discovery Exchanges\n\n";
			for (const exchange of state.discovery.conversationHistory) {
				conversationContext += `**User**: ${exchange.userMessage}\n\n`;
				conversationContext += `**You**: ${exchange.assistantResponse}\n\n---\n\n`;
			}
		}

		return `
${discoveryPrompt}

## Active Discovery Session

You are currently conducting a discovery session for this feature:

${state.description}

${conversationContext}

## Instructions

- Ask clarifying questions to understand requirements better
- You have access to the codebase via read, bash, grep, find, ls tools — USE THEM to explore the project
- Reference specific files and patterns you find
- Keep questions focused and actionable (${projectConfig.discovery.questionsPerRound} questions at a time)
- The user will answer naturally — adapt your follow-up questions based on their responses
- When you feel you have enough context, tell the user they can type /spec-done to proceed to spec drafting

IMPORTANT: You are in DISCOVERY MODE. Do NOT write specs, plans, or code. Only ask questions and explore the codebase.
`;
	}

	/**
	 * Build the spec drafting system prompt injection for before_agent_start.
	 * This turns the host LLM into a spec drafter.
	 */
	function buildDraftingPromptInjection(state: SpecState, projectConfig: ProjectConfig): string {
		const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);
		const specDrafterPrompt = SYSTEM_PROMPTS.specDrafter;

		const fullSpecPath = path.join(activeCwd, state.specPath);

		const discoveryContext = state.discovery?.discoverySummary
			? `\n\n## Discovery Context\n\nThe following requirements were gathered during discovery:\n\n${state.discovery.discoverySummary}\n`
			: "";

		let reviewFeedback = "";
		if (state.drafting?.lastReviewFeedback) {
			reviewFeedback = `\n\n## Review Feedback to Address\n\nThe spec was reviewed and received the following feedback. Please address these issues:\n\n${state.drafting.lastReviewFeedback}\n`;
		}

		let draftingHistory = "";
		if (state.drafting?.conversationHistory && state.drafting.conversationHistory.length > 0) {
			// Only include a brief summary to avoid bloating the prompt
			draftingHistory = `\n\n## Drafting Progress\n\nYou have had ${state.drafting.conversationHistory.length} exchanges with the user while drafting this spec.\n`;
		}

		return `
${specDrafterPrompt}

## Active Spec Drafting Session

You are drafting a technical specification for this feature:

${state.description}
${discoveryContext}${reviewFeedback}${draftingHistory}

## Spec File Details

- **Spec timestamp**: ${state.specTimestamp}
- **Spec file path**: ${fullSpecPath}
- **Iteration**: ${state.specIteration + 1}

## Instructions

- You have FULL tool access: read, bash, edit, write, grep, find, ls
- Explore the codebase to understand existing patterns and conventions
- Write the spec to the EXACT path above using the write tool
- The user will guide you conversationally — follow their instructions
- If the user asks you to focus on specific areas, adjust the spec accordingly
- When the user is satisfied, they will type /spec-draft-done to proceed to review

${state.specIteration > 0 ? `This is iteration ${state.specIteration + 1}. Read the existing spec file and revise it based on the conversation.` : "This is the first draft. Create the spec from scratch."}

IMPORTANT: You are in SPEC DRAFTING MODE. Focus on creating/refining the specification. Do NOT implement code.
`;
	}

	/**
	 * Get the spec file size for widget display
	 */
	function getSpecFileInfo(cwd: string, specPath: string): string {
		const fullPath = path.join(cwd, specPath);
		if (!fs.existsSync(fullPath)) {
			return "not yet created";
		}
		const stats = fs.statSync(fullPath);
		const kb = (stats.size / 1024).toFixed(1);
		return `${kb} KB`;
	}

	/**
	 * Update the widget for the current mode
	 */
	function updateModeWidget(ctx: any): void {
		if (pipelineMode === "idle" || !activeSpecState) return;

		if (pipelineMode === "discovery") {
			ctx.ui.setWidget("spec-pipeline-status", [
				"🔍 Discovery Mode",
				"────────────────────────────────────",
				`Exchanges: ${exchangeCount}`,
				"",
				"Chat naturally to refine requirements.",
				"Type /spec-done when ready to draft spec.",
			]);
		} else if (pipelineMode === "drafting") {
			const specInfo = getSpecFileInfo(activeCwd, activeSpecState.specPath);
			const iteration = activeSpecState.specIteration + 1;
			const lines = [
				"📝 Drafting Mode",
				"────────────────────────────────────",
				`Spec file: ${specInfo}`,
				`Iteration: ${iteration}`,
				`Exchanges: ${exchangeCount}`,
			];
			if (activeSpecState.drafting?.lastReviewFeedback) {
				lines.push("", "⚠️  Addressing review feedback");
			}
			lines.push("", "Type /spec-draft-done when ready for review.");
			ctx.ui.setWidget("spec-pipeline-status", lines);
		}
	}

	/**
	 * End discovery mode and proceed to spec drafting mode
	 */
	async function endDiscoveryAndStartDrafting(ctx: any): Promise<void> {
		if (pipelineMode !== "discovery" || !activeSpecState || !activeCwd || !activeProjectConfig) {
			ctx.ui.notify("No active discovery session.", "error");
			return;
		}

		const state = activeSpecState;
		const cwd = activeCwd;
		const projectConfig = activeProjectConfig;

		// Build the discovery summary from conversation history
		if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
			state.discovery.discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
			state.discovery.currentRound = state.discovery.conversationHistory.length;
		}

		state.discovery!.completed = true;
		const discoveryExchanges = exchangeCount;

		ctx.ui.notify(formatStepBanner(
			"DISCOVERY COMPLETE",
			`${discoveryExchanges} exchanges recorded. Entering spec drafting mode...`,
			"✅"
		), "success");

		// Transition to drafting mode (reuse same active state variables — just switch mode)
		pipelineMode = "drafting";
		lastUserMessage = "";
		exchangeCount = 0;

		// Initialize drafting state
		state.drafting = {
			conversational: true,
			conversationHistory: [],
			completed: false,
		};
		state.stage = "spec_drafting";
		saveSpecState(cwd, state);

		// Update widget
		updateModeWidget(ctx);

		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING MODE",
			"The LLM will now draft the specification. Guide it conversationally.",
			"📝"
		), "info");
		ctx.ui.notify(`Spec file will be written to: ${state.specPath}`, "info");
		ctx.ui.notify("When satisfied, type /spec-draft-done to proceed to review.", "info");

		// Build the kickoff message
		const fullSpecPath = path.join(cwd, state.specPath);
		const discoveryContext = state.discovery?.discoverySummary
			? `\n\nHere is the context gathered during discovery:\n\n${state.discovery.discoverySummary}`
			: "";

		pi.sendUserMessage(
			`Please create a technical specification for: ${state.description}${discoveryContext}\n\n` +
			`Write the spec to this exact path: ${fullSpecPath}\n` +
			`Use spec timestamp: ${state.specTimestamp}\n\n` +
			`Explore the codebase first to understand existing patterns, then create a comprehensive spec.`
		);
	}

	/**
	 * Enter drafting mode directly (for --quick or after review revisions)
	 */
	function enterDraftingMode(state: SpecState, cwd: string, projectConfig: ProjectConfig, ctx: any): void {
		// Initialize drafting state if needed
		if (!state.drafting) {
			state.drafting = {
				conversational: true,
				conversationHistory: [],
				completed: false,
			};
		} else {
			state.drafting.completed = false;
		}
		state.stage = "spec_drafting";
		saveSpecState(cwd, state);

		enterMode("drafting", state, cwd, projectConfig);
		updateModeWidget(ctx);
	}

	/**
	 * Handle end of spec drafting: commit, run review, present options
	 */
	async function endDraftingAndReview(ctx: any): Promise<void> {
		if (pipelineMode !== "drafting" || !activeSpecState || !activeCwd || !activeProjectConfig) {
			ctx.ui.notify("No active drafting session.", "error");
			return;
		}

		const state = activeSpecState;
		const cwd = activeCwd;
		const projectConfig = activeProjectConfig;
		const fullSpecPath = path.join(cwd, state.specPath);

		// Validate spec file exists
		if (!fs.existsSync(fullSpecPath)) {
			ctx.ui.notify(`Spec file not found at: ${state.specPath}\n\nThe LLM needs to write the spec file first. Continue chatting to guide it.`, "error");
			return;
		}

		// Read the spec content
		state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
		if (!state.specDraft.trim()) {
			ctx.ui.notify("Spec file is empty. Continue chatting to guide the LLM.", "error");
			return;
		}

		// Mark drafting as complete
		state.drafting!.completed = true;
		state.specIteration++;
		state.stage = "spec_review";
		saveSpecState(cwd, state);

		// Exit drafting mode for the review phase
		const { exchangeCount: draftExchanges } = exitMode();

		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING COMPLETE",
			`${draftExchanges} exchanges. Creating commit and running review...`,
			"✅"
		), "success");

		// Create git commit for the spec draft
		const specDrafterConfig = projectConfig.models.specDrafter;
		const commitResult = await createAgentCommit(
			cwd, state,
			{ role: "specDrafter", modelConfig: specDrafterConfig },
			projectConfig.models.agentCommitMessageWriter,
			() => saveSpecState(cwd, state),
			ctx.ui.notify.bind(ctx.ui)
		);

		if (!commitResult.success) {
			ctx.ui.notify("Warning: Failed to create commit for spec draft", "warning");
		}

		// Update widget for review phase
		ctx.ui.setWidget("spec-pipeline-status", [
			"🔍 Spec Review in Progress",
			"────────────────────────────────────",
			`Iteration: ${state.specIteration}`,
			"",
			"Running tiered review (cheap → expensive)...",
		]);

		const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);

		// Run tiered spec review (subprocess-based for isolated judgment)
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
				saveFn: () => saveSpecState(cwd, state),
				phaseIndex: undefined,
				notify: ctx.ui.notify.bind(ctx.ui),
			},
			{
				role: "specReviewer",
				reviewTask: `Review this spec draft:\n\n${state.specDraft}`,
				fixTask: (reviewOutput) => `Revise the spec to address review feedback.

Current spec at: ${fullSpecPath}

Review feedback:
${reviewOutput}

Read the current spec, apply fixes, and write the updated version back to the same path.`,
			}
		);

		if (specReviewResult.hadError) {
			clearPipelineWidget(ctx);
			ctx.ui.notify("Review encountered an error. Use /spec-resume to retry.", "error");
			return;
		}

		// Re-read spec after review fixes
		if (fs.existsSync(fullSpecPath)) {
			state.specDraft = fs.readFileSync(fullSpecPath, "utf-8");
		}

		const verdict = specReviewResult.verdict;
		const reviewOutput = specReviewResult.lastReviewOutput;

		// Update widget with review result
		ctx.ui.setWidget("spec-pipeline-status", [
			verdict === "APPROVED" ? "✅ Spec Review: APPROVED" : "🔄 Spec Review: NEEDS_CHANGES",
			"────────────────────────────────────",
			`Iteration: ${state.specIteration}`,
			`Review cycles: cheap=${specReviewResult.cheapCyclesCompleted}, expensive=${specReviewResult.expensiveCyclesCompleted}`,
		]);

		// Show review summary
		const reviewPreview = reviewOutput.length > 2000
			? reviewOutput.slice(0, 2000) + "\n\n[... truncated ...]"
			: reviewOutput;
		ctx.ui.notify(formatStepBanner(
			`Review Result: ${verdict}`,
			`Cheap: ${specReviewResult.cheapCyclesCompleted}, Expensive: ${specReviewResult.expensiveCyclesCompleted}`,
			verdict === "APPROVED" ? "✅" : "🔄"
		), "info");
		ctx.ui.notify(reviewPreview, "info");

		// Present options to user
		if (verdict === "APPROVED") {
			const approve = await ctx.ui.confirm(
				"Spec Approved by Reviewer",
				"The spec was approved by the reviewer. Do you approve it too?"
			);

			if (approve) {
				state.specApproved = true;
				state.stage = "completed";
				saveSpecState(cwd, state);
				clearPipelineWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"🎉 Spec Creation Complete!",
					`Spec: ${state.specPath}`,
					"✅"
				), "success");
				ctx.ui.notify(`Next: /implement ${state.specPath}`, "info");
				return;
			}
		}

		// User wants to revise (or reviewer said NEEDS_CHANGES)
		const choices = [
			"Revise spec conversationally (recommended)",
			"Approve spec as-is",
			"Cancel pipeline",
		];
		const choice = await ctx.ui.select(
			"How would you like to proceed?",
			choices
		);

		if (choice === choices[1]) {
			// Approve anyway
			state.specApproved = true;
			state.stage = "completed";
			saveSpecState(cwd, state);
			clearPipelineWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				"🎉 Spec Creation Complete!",
				`Spec: ${state.specPath}`,
				"✅"
			), "success");
			ctx.ui.notify(`Next: /implement ${state.specPath}`, "info");
			return;
		}

		if (choice === choices[2]) {
			// Cancel
			state.stage = "cancelled";
			saveSpecState(cwd, state);
			clearPipelineWidget(ctx);
			ctx.ui.notify("Pipeline cancelled.", "info");
			return;
		}

		// Re-enter drafting mode with review feedback
		state.drafting!.lastReviewFeedback = reviewOutput;
		state.drafting!.completed = false;
		enterDraftingMode(state, cwd, projectConfig, ctx);

		ctx.ui.notify(formatStepBanner(
			"REVISION MODE",
			"Guide the LLM to address the review feedback.",
			"📝"
		), "info");
		ctx.ui.notify("The review feedback has been injected into the LLM's context.", "info");
		ctx.ui.notify("Type /spec-draft-done when ready for another review cycle.", "info");

		// Kick off revision
		pi.sendUserMessage(
			`The spec at ${fullSpecPath} received review feedback. Please read the current spec and the review feedback, then revise accordingly.\n\n` +
			`Key issues from reviewer:\n${reviewOutput.slice(0, 3000)}`
		);
	}

	// ============================================
	// EVENT HANDLERS FOR CONVERSATIONAL MODES
	// ============================================

	/**
	 * Inject system prompt when in a conversational mode (discovery or drafting)
	 */
	pi.on("before_agent_start", async (event, ctx) => {
		if (pipelineMode === "idle" || !activeSpecState || !activeProjectConfig) {
			return undefined;
		}

		let injection: string;
		let customType: string;
		let contextLabel: string;

		if (pipelineMode === "discovery") {
			injection = buildDiscoveryPromptInjection(activeSpecState, activeProjectConfig);
			customType = "spec-discovery-context";
			contextLabel = `[DISCOVERY MODE ACTIVE - Exploring requirements for: ${activeSpecState.description}]`;
		} else {
			injection = buildDraftingPromptInjection(activeSpecState, activeProjectConfig);
			customType = "spec-drafting-context";
			contextLabel = `[DRAFTING MODE ACTIVE - Creating spec for: ${activeSpecState.description}]`;
		}

		return {
			systemPrompt: event.systemPrompt + "\n\n" + injection,
			message: {
				customType,
				content: contextLabel,
				display: false,
			},
		};
	});

	/**
	 * Capture user input during any conversational mode to track conversation
	 */
	pi.on("input", async (event, ctx) => {
		if (pipelineMode === "idle") {
			return { action: "continue" as const };
		}

		// Don't intercept extension-injected messages
		if (event.source === "extension") {
			return { action: "continue" as const };
		}

		// Store the user message for pairing with assistant response
		lastUserMessage = event.text;

		return { action: "continue" as const };
	});

	/**
	 * After each agent turn, capture the assistant response
	 * and pair it with the user message to build conversation history
	 */
	pi.on("agent_end", async (event, ctx) => {
		if (pipelineMode === "idle" || !activeSpecState || !activeCwd) {
			return;
		}

		// Extract the last assistant text from the messages
		let assistantText = "";
		const messages = event.messages || [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as any;
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				const textParts = msg.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text);
				if (textParts.length > 0) {
					assistantText = textParts.join("\n");
					break;
				}
			}
		}

		if (assistantText && lastUserMessage) {
			const exchange: ConversationalExchange = {
				userMessage: lastUserMessage,
				assistantResponse: assistantText,
				timestamp: new Date().toISOString(),
			};

			if (pipelineMode === "discovery") {
				if (!activeSpecState.discovery!.conversationHistory) {
					activeSpecState.discovery!.conversationHistory = [];
				}
				activeSpecState.discovery!.conversationHistory.push(exchange);
				exchangeCount = activeSpecState.discovery!.conversationHistory.length;
			} else if (pipelineMode === "drafting") {
				if (!activeSpecState.drafting!.conversationHistory) {
					activeSpecState.drafting!.conversationHistory = [];
				}
				activeSpecState.drafting!.conversationHistory.push(exchange);
				exchangeCount = activeSpecState.drafting!.conversationHistory.length;
			}

			saveSpecState(activeCwd, activeSpecState);
			updateModeWidget(ctx);
			lastUserMessage = "";
		}
	});

	/**
	 * Filter out pipeline context messages that don't belong to the current mode.
	 * - In idle: filter out all pipeline context messages
	 * - In discovery: filter out drafting context messages
	 * - In drafting: filter out discovery context messages
	 */
	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((m: any) => {
				if (m.customType === "spec-discovery-context") {
					return pipelineMode === "discovery";
				}
				if (m.customType === "spec-drafting-context") {
					return pipelineMode === "drafting";
				}
				return true;
			}),
		};
	});

	// ============================================
	// SPEC CREATION COMMANDS
	// ============================================

	pi.registerCommand("spec-done", {
		description: "End discovery and proceed to spec drafting",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "discovery") {
				ctx.ui.notify("No active discovery session. Use /spec to start one.", "error");
				return;
			}

			if (exchangeCount === 0) {
				const proceed = await ctx.ui.confirm(
					"No Discovery Exchanges",
					"No conversation exchanges recorded yet. Proceed to spec drafting anyway?"
				);
				if (!proceed) return;
			}

			await endDiscoveryAndStartDrafting(ctx);
		},
	});

	pi.registerCommand("spec-draft-done", {
		description: "End spec drafting and proceed to review",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "drafting") {
				ctx.ui.notify("No active drafting session. Use /spec to start one.", "error");
				return;
			}

			await endDraftingAndReview(ctx);
		},
	});

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

			// If discovery is enabled (not --quick), enter conversational discovery mode
			const shouldDiscover = !isQuick && projectConfig.discovery.enabled && state.stage === "discovery";

			if (shouldDiscover) {
				// Initialize conversational discovery state
				state.discovery!.conversational = true;
				state.discovery!.conversationHistory = [];
				saveSpecState(cwd, state);

				// Enter discovery mode
				enterMode("discovery", state, cwd, projectConfig);

				// Show discovery widget
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DISCOVERY MODE",
					"Chat naturally to explore requirements. The LLM will ask clarifying questions.",
					"🔍"
				), "info");
				ctx.ui.notify("Just type your answers in the editor below. The LLM has access to your codebase and will ask questions to understand your requirements.", "info");
				ctx.ui.notify("When you're satisfied with the discovery, type /spec-done to proceed to spec drafting.", "info");

				// Send the initial discovery message to kick off the conversation
				pi.sendUserMessage(`I want to build the following feature: ${description}\n\nPlease explore the codebase and ask me clarifying questions to understand the requirements better.`);
			} else {
				// --quick mode: enter conversational drafting directly
				enterDraftingMode(state, cwd, projectConfig, ctx);

				ctx.ui.notify(formatStepBanner(
					"SPEC DRAFTING MODE",
					"The LLM will draft the specification. Guide it conversationally.",
					"📝"
				), "info");
				ctx.ui.notify(`Spec file will be written to: ${state.specPath}`, "info");
				ctx.ui.notify("When satisfied, type /spec-draft-done to proceed to review.", "info");

				// Send the kickoff message
				const fullSpecPath = path.join(cwd, state.specPath);
				pi.sendUserMessage(
					`Please create a technical specification for: ${description}\n\n` +
					`Write the spec to this exact path: ${fullSpecPath}\n` +
					`Use spec timestamp: ${state.specTimestamp}\n\n` +
					`Explore the codebase first to understand existing patterns, then create a comprehensive spec.`
				);
			}
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

			// If resuming in conversational discovery mode, re-enter discovery mode
			if (state.stage === "discovery" && state.discovery?.conversational && !state.discovery.completed) {
				enterMode("discovery", state, cwd, projectConfig);
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DISCOVERY MODE RESUMED",
					`${exchangeCount} previous exchanges. Continue chatting to refine requirements.`,
					"🔍"
				), "info");
				ctx.ui.notify("Type /spec-done when ready to proceed to spec drafting.", "info");

				// Send a resume message to kick off the conversation
				pi.sendUserMessage(`I'm resuming the discovery session for: ${state.description}\n\nPlease review what we've discussed so far and continue asking clarifying questions.`);
				return;
			}

			// If resuming in conversational drafting mode, re-enter drafting mode
			if (state.stage === "spec_drafting" && state.drafting?.conversational && !state.drafting.completed) {
				enterMode("drafting", state, cwd, projectConfig);
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DRAFTING MODE RESUMED",
					`${exchangeCount} previous exchanges. Continue guiding the spec.`,
					"📝"
				), "info");
				ctx.ui.notify(`Spec file: ${state.specPath}`, "info");
				ctx.ui.notify("Type /spec-draft-done when ready for review.", "info");

				// Send a resume message
				const fullSpecPath = path.join(cwd, state.specPath);
				pi.sendUserMessage(
					`I'm resuming the spec drafting session for: ${state.description}\n\n` +
					`Spec file path: ${fullSpecPath}\n\n` +
					`Please review the current state and continue drafting.`
				);
				return;
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
				
				// Clean up conversational mode if active
				if (pipelineMode !== "idle" && activeSpecState?.id === state.id) {
					exitMode();
				}
				
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
