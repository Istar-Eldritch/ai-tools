/**
 * Spec Pipeline Extension
 *
 * Split into two separate workflows:
 *
 * SPEC CREATION (/spec):
 *   1. Discovery (optional): Conversational — LLM proposes assumptions one at a time for user to confirm
 *   2. Spec Drafting: Conversational — user guides LLM to write specification
 *   3. User Approval: User approves, requests revisions, or cancels
 *   4. User reviews and approves the spec
 *
 * HIERARCHY (/roadmap, /epic):
 *   1. Discovery (optional): Conversational — LLM proposes assumptions one at a time for user to confirm
 *   2. Drafting: Conversational — user guides LLM to write document
 *   3. User Approval: User approves, requests revisions, or cancels
 *   4. Child extraction (auto-parses child items table from document)
 *   5. User reviews and approves the document
 *
 * IMPLEMENTATION (/implement):
 *   1. Takes a spec file path as input
 *   2. For each implementation phase (plan + implement interleaved):
 *      - Plan Drafting: Opus drafts implementation plan
 *      - Plan Review: Tiered review (Sonnet → Opus)
 *      - Implementation: Opus implements according to plan
 *      - Code Review: Tiered review (Sonnet → Opus)
 *   3. User reviews the implementation
 *
 * Usage:
 *   /plan <description>                             # Conversational scoping → recommends roadmap/epic/spec
 *   /plan-done                                      # Accept or override scoping recommendation
 *   /plan-cancel                                    # Cancel scoping session
 *   /plan --roadmap <description>                   # Skip scoping, create roadmap
 *   /plan --epic <description>                      # Skip scoping, create epic
 *   /plan --feature <description>                   # Skip scoping, create feature spec
 *
 *   /roadmap <description>                          # Create a roadmap (→ epics)
 *   /roadmap-resume                                 # Resume roadmap pipeline
 *   /roadmap-status                                 # Show roadmap status
 *   /roadmap-list                                   # List roadmaps
 *   /roadmap-cancel                                 # Cancel roadmap pipeline
 *
 *   /epic <description>                             # Create an epic (→ feature specs)
 *   /epic --roadmap <id> <description>              # Create epic linked to roadmap
 *   /epic-resume                                    # Resume epic pipeline
 *   /epic-status                                    # Show epic status
 *   /epic-list                                      # List epics
 *   /epic-cancel                                    # Cancel epic pipeline
 *
 *   /plan-overview [id]                             # Show full hierarchy tree
 *
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
import type { SpecState, ImplementationState, RoadmapState, EpicState, HierarchyState, HierarchyLevel, ConversationalExchange, ProjectConfig, PipelineMode, ScopingState, ConversationalPipelineState } from "./types.ts";

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
	loadRoadmapState,
	saveRoadmapState,
	listRoadmapStates,
	getLatestActiveRoadmapPipeline,
	loadEpicState,
	saveEpicState,
	listEpicStates,
	getLatestActiveEpicPipeline,
	createInitialRoadmapState,
	createInitialEpicState,
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
	formatHierarchyStage,
	formatSpecState,
	formatImplState,
	formatRoadmapState,
	formatEpicState,
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
import { runHierarchyPipeline } from "./hierarchy-pipeline.ts";

// Import system prompts
import { createSystemPrompts, buildPromptOptions } from "./agents-config.ts";

// ============================================
// Helpers
// ============================================

/** Common stop words for generating short names from descriptions */
const STOP_WORDS = new Set([
	// Articles, pronouns, determiners
	"a", "an", "the", "i", "we", "you", "it", "he", "she", "they", "me", "us",
	"my", "our", "your", "their", "its", "his", "her", "this", "that", "these",
	"those", "some", "any", "all", "each", "every", "no", "not",
	// Be/have/do verbs
	"is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "having",
	"do", "does", "did", "done", "doing",
	// Modal/auxiliary verbs
	"will", "would", "can", "could", "should", "may", "might", "must", "shall",
	// Common action verbs (too generic for naming)
	"want", "need", "like", "go", "get", "got", "let", "lets", "put", "set",
	"take", "give", "tell", "say", "said", "know", "see", "look", "find",
	"use", "used", "using", "try", "keep", "start", "run", "work", "call",
	"come", "think", "also", "just", "even", "still", "way", "more", "much",
	"many", "less", "most", "only", "already", "now", "here", "there",
	// Spec/dev action verbs (user intent, not content)
	"add", "create", "make", "build", "implement", "write", "spec", "plan",
	"design", "develop", "setup", "configure", "update", "modify", "change",
	"fix", "address", "handle", "support", "enable", "allow", "ensure",
	"improve", "optimize", "optimise", "refactor", "introduce", "provide",
	// Prepositions and conjunctions
	"to", "for", "of", "in", "on", "at", "by", "up", "out", "off", "from",
	"into", "with", "about", "between", "through", "after", "before",
	"and", "or", "but", "so", "if", "then", "than", "when", "where", "how",
	// Filler words
	"new", "thing", "stuff", "feature", "functionality", "ability",
	"something", "everything", "nothing", "really", "very", "quite",
	"please", "thanks", "hey", "ok", "okay", "sure", "right",
]);

function generateShortName(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(word => word.length > 1 && !STOP_WORDS.has(word))
		.slice(0, 4)
		.join("_") || "spec";
}

/**
 * Prompt the user for a short name, with the auto-generated one as default.
 * Returns { shortName }.
 */
async function promptForShortName(
	ctx: { ui: { input: (title: string, placeholder?: string) => Promise<string | undefined> } },
	description: string
): Promise<{ shortName: string }> {
	const suggested = generateShortName(description);
	const userInput = await ctx.ui.input("Short name (used for file names):", suggested);
	// Sanitize whatever the user typed (or use suggested if they cancelled/left empty)
	const raw = (userInput && userInput.trim()) ? userInput.trim() : suggested;
	const shortName = raw
		.toLowerCase()
		.replace(/[^a-z0-9\s_-]/g, "")
		.replace(/[\s-]+/g, "_")
		.replace(/^_+|_+$/g, "")
		|| "spec";
	return { shortName };
}

export default function (pi: ExtensionAPI) {

	// ============================================
	// UNIFIED CONVERSATIONAL MODE STATE
	// ============================================

	/** Current pipeline mode: idle, scoping, discovery, or drafting */
	let pipelineMode: PipelineMode = "idle";

	/** The pipeline state for the active conversational session (spec or hierarchy) */
	let activePipelineState: ConversationalPipelineState | null = null;

	/** Which kind of pipeline is active: "spec", "hierarchy", or "implement" */
	let activePipelineKind: "spec" | "hierarchy" | "implement" | null = null;

	/** Hierarchy level when activePipelineKind === "hierarchy" */
	let activeHierarchyLevel: HierarchyLevel | null = null;

	/** Parent context string for hierarchy pipelines (roadmap context, scoping context, etc.) */
	let activeParentContext: string | undefined = undefined;

	/** Function to persist the active pipeline state */
	let activeStateSaveFn: (() => void) | null = null;

	/** The cwd for the active conversational session */
	let activeCwd: string = "";

	/** The project config for the active conversational session */
	let activeProjectConfig: ProjectConfig | null = null;

	/** Ephemeral scoping state for /plan command (not persisted) */
	let activeScopingState: ScopingState | null = null;

	/** Tracks the last user message for pairing with assistant response */
	let lastUserMessage: string = "";

	/** Number of conversation exchanges in current mode */
	let exchangeCount = 0;

	/** Pending scoping context from /plan → feature route, consumed by next /spec invocation */
	let pendingScopingContext: string | undefined = undefined;

	/** Flags for implement-discovery sessions (--no-plan, --no-review)
	 * NOTE: Ephemeral (not persisted to disk) because discovery is conversational.
	 * Flags are applied after /discovery-done when creating the implementation state. */
	let pendingImplementFlags: { noPlan: boolean; noReview: boolean } | null = null;

	/** Short name for implement-discovery session
	 * NOTE: Ephemeral (not persisted) - cleared on mode exit */
	let pendingImplementShortName: string | null = null;

	/** Timestamp for implement-discovery session
	 * NOTE: Ephemeral (not persisted) - cleared on mode exit */
	let pendingImplementTimestamp: string | null = null;

	/** Helper to get the active state as SpecState (only valid when activePipelineKind === "spec") */
	function getActiveSpecState(): SpecState | null {
		return activePipelineKind === "spec" ? activePipelineState as SpecState : null;
	}

	/** Helper to get the active state as HierarchyState (only valid when activePipelineKind === "hierarchy") */
	function getActiveHierarchyState(): HierarchyState | null {
		return activePipelineKind === "hierarchy" ? activePipelineState as HierarchyState : null;
	}

	/**
	 * Enter scoping mode (no pipeline state, just ephemeral scoping)
	 */
	function enterScopingMode(cwd: string, projectConfig: ProjectConfig, scopingState: ScopingState): void {
		pipelineMode = "scoping";
		activePipelineState = null;
		activePipelineKind = null;
		activeHierarchyLevel = null;
		activeParentContext = undefined;
		activeStateSaveFn = null;
		activeCwd = cwd;
		activeProjectConfig = projectConfig;
		activeScopingState = scopingState;
		lastUserMessage = "";
		exchangeCount = scopingState.conversationHistory.length;
	}

	/**
	 * Enter discovery or drafting mode for a spec pipeline
	 */
	function enterSpecMode(mode: "discovery" | "drafting", state: SpecState, cwd: string, projectConfig: ProjectConfig): void {
		pipelineMode = mode;
		activePipelineState = state;
		activePipelineKind = "spec";
		activeHierarchyLevel = null;
		activeParentContext = undefined;
		activeStateSaveFn = () => saveSpecState(cwd, state);
		activeCwd = cwd;
		activeProjectConfig = projectConfig;
		activeScopingState = null;
		lastUserMessage = "";
		exchangeCount = mode === "discovery"
			? state.discovery?.conversationHistory?.length ?? 0
			: state.drafting?.conversationHistory?.length ?? 0;
	}

	/**
	 * Enter discovery or drafting mode for a hierarchy pipeline (roadmap/epic)
	 */
	function enterHierarchyMode(
		mode: "discovery" | "drafting",
		state: HierarchyState,
		level: HierarchyLevel,
		cwd: string,
		projectConfig: ProjectConfig,
		parentContext?: string
	): void {
		pipelineMode = mode;
		activePipelineState = state;
		activePipelineKind = "hierarchy";
		activeHierarchyLevel = level;
		activeParentContext = parentContext;
		activeStateSaveFn = () => {
			if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);
		};
		activeCwd = cwd;
		activeProjectConfig = projectConfig;
		activeScopingState = null;
		lastUserMessage = "";
		exchangeCount = mode === "discovery"
			? state.discovery?.conversationHistory?.length ?? 0
			: state.drafting?.conversationHistory?.length ?? 0;
	}

	/**
	 * Enter discovery mode for an implement pipeline (no persistent state, just ephemeral discovery)
	 */
	function enterImplementDiscoveryMode(
		cwd: string,
		projectConfig: ProjectConfig,
		discoveryState: ConversationalPipelineState,
		flags: { noPlan: boolean; noReview: boolean },
		shortName: string,
		timestamp: string
	): void {
		pipelineMode = "discovery";
		activePipelineState = discoveryState;
		activePipelineKind = "implement";
		activeHierarchyLevel = null;
		activeParentContext = undefined;
		activeStateSaveFn = null;  // No persistence for implement-discovery
		activeCwd = cwd;
		activeProjectConfig = projectConfig;
		activeScopingState = null;
		lastUserMessage = "";
		exchangeCount = discoveryState.discovery?.conversationHistory?.length ?? 0;
		
		// Store flags and metadata for use at /discovery-done
		pendingImplementFlags = flags;
		pendingImplementShortName = shortName;
		pendingImplementTimestamp = timestamp;
	}

	/**
	 * Exit any conversational mode and return to idle
	 */
	function exitMode(): { exchangeCount: number } {
		const result = { exchangeCount };
		pipelineMode = "idle";
		activePipelineState = null;
		activePipelineKind = null;
		activeHierarchyLevel = null;
		activeParentContext = undefined;
		activeStateSaveFn = null;
		activeScopingState = null;
		activeCwd = "";
		activeProjectConfig = null;
		lastUserMessage = "";
		exchangeCount = 0;
		// Clear implement-discovery ephemeral state
		pendingImplementFlags = null;
		pendingImplementShortName = null;
		pendingImplementTimestamp = null;
		return result;
	}

	/**
	 * Build the unified discovery system prompt injection for before_agent_start.
	 * This turns the host LLM into a discovery agent for any pipeline type.
	 * 
	 * @param state - The conversational pipeline state (spec, hierarchy, or implement)
	 * @param projectConfig - The project configuration
	 * @param doneCommand - Command to tell user (e.g., "/discovery-done")
	 * @param sessionLabel - Label for the session type (e.g., "Spec", "Implementation", "Roadmap")
	 * @param nextStep - What happens after discovery (e.g., "proceed to spec drafting", "proceed to implementation")
	 * @param parentContext - Optional parent context for hierarchy pipelines
	 * @returns The discovery system prompt injection string
	 */
	function buildUnifiedDiscoveryPrompt(
		state: ConversationalPipelineState,
		projectConfig: ProjectConfig,
		doneCommand: string,
		sessionLabel: string,
		nextStep: string,
		parentContext?: string
	): string {
		const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
		const discoveryPrompt = SYSTEM_PROMPTS.discoveryAgent;

		let conversationContext = "";
		if (state.discovery?.conversationHistory && state.discovery.conversationHistory.length > 0) {
			conversationContext = "\n\n## Previous Discovery Exchanges\n\n";
			for (const exchange of state.discovery.conversationHistory) {
				conversationContext += `**User**: ${exchange.userMessage}\n\n`;
				conversationContext += `**You**: ${exchange.assistantResponse}\n\n---\n\n`;
			}
		}

		const scopingSection = state.discovery?.discoverySummary
			? `\n\n## Prior Context\n\nThe following context was gathered before this discovery session:\n\n${state.discovery.discoverySummary}\n`
			: "";

		const parentSection = parentContext
			? `\n\n## Parent Context\n\n${parentContext}\n`
			: "";

		return `
${discoveryPrompt}

## Active ${sessionLabel} Discovery Session

You are currently conducting a discovery session for:

${state.description}
${scopingSection}${parentSection}${conversationContext}

## Instructions

- Explore the project using read, bash, grep, find, ls tools — USE THEM
- Reference specific files and patterns you find
- Present ONE assumption at a time — propose the most likely solution, explain your reasoning, and ask the user to confirm or correct
- The user will respond naturally — adapt based on their feedback and move to the next topic
- When you feel you have enough context, tell the user they can type ${doneCommand} to ${nextStep}
${state.discovery?.discoverySummary ? "- Prior context is available above — factor it in but don't skip exploring the codebase" : ""}

IMPORTANT: You are in DISCOVERY MODE. Do NOT write specs, plans, or code. Only propose assumptions and explore the codebase.
`;
	}

	/**
	 * Build the spec drafting system prompt injection for before_agent_start.
	 * This turns the host LLM into a spec drafter.
	 */
	function buildDraftingPromptInjection(state: SpecState, projectConfig: ProjectConfig): string {
		const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
		const specDrafterPrompt = SYSTEM_PROMPTS.specDrafter;

		const fullSpecPath = path.join(activeCwd, state.specPath);

		const discoveryContext = state.discovery?.discoverySummary
			? `\n\n## Discovery Context\n\nThe following requirements were gathered during discovery:\n\n${state.discovery.discoverySummary}\n`
			: "";

		let draftingHistory = "";
		if (state.drafting?.conversationHistory && state.drafting.conversationHistory.length > 0) {
			draftingHistory = `\n\n## Drafting Progress\n\nYou have had ${state.drafting.conversationHistory.length} exchanges with the user while drafting this spec.\n`;
		}

		return `
${specDrafterPrompt}

## Active Spec Drafting Session

You are drafting a technical specification for this feature:

${state.description}
${discoveryContext}${draftingHistory}

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
- When the user is satisfied, they will type /spec-draft-done to proceed

${state.specIteration > 0 ? `This is iteration ${state.specIteration + 1}. Read the existing spec file and revise it based on the conversation.` : "This is the first draft. Create the spec from scratch."}

IMPORTANT: You are in SPEC DRAFTING MODE. Focus on creating/refining the specification. Do NOT implement code.
`;
	}

	/**
	 * Build the scoping system prompt injection for before_agent_start.
	 * This turns the host LLM into a scoping agent for /plan.
	 */
	function buildScopingPromptInjection(scopingState: ScopingState, projectConfig: ProjectConfig): string {
		const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
		const scopingPrompt = SYSTEM_PROMPTS.scopingAgent;

		let conversationContext = "";
		if (scopingState.conversationHistory.length > 0) {
			conversationContext = "\n\n## Previous Scoping Exchanges\n\n";
			for (const exchange of scopingState.conversationHistory) {
				conversationContext += `**User**: ${exchange.userMessage}\n\n`;
				conversationContext += `**You**: ${exchange.assistantResponse}\n\n---\n\n`;
			}
		}

		return `
${scopingPrompt}

## Active Scoping Session

You are assessing the scope of this request:

${scopingState.description}

${conversationContext}

## Instructions

- Explore the codebase to understand the scope of impact
- Ask targeted scoping questions ONE AT A TIME to understand the scope (never batch multiple questions in a single message)
- Based on the answers and your codebase exploration, recommend a level: roadmap, epic, or feature
- When you have enough information, present your recommendation clearly:
  - Start a line with "**Recommended Level**: roadmap" or "**Recommended Level**: epic" or "**Recommended Level**: feature"
  - Provide a brief justification
  - If roadmap or epic, sketch what the child items might look like
- Tell the user they can type /plan-done to accept or override your recommendation

IMPORTANT: You are in SCOPING MODE. Do NOT write specs, plans, or code. Only assess scope and recommend the right planning level.
`;
	}

	/**
	 * Build a summary of the scoping conversation for forwarding to child pipelines.
	 */
	function buildScopingSummary(scopingState: ScopingState): string {
		if (scopingState.conversationHistory.length === 0) {
			return "";
		}

		const sections: string[] = [];
		sections.push("## Scoping Context\n");
		sections.push("The following information was gathered during a scoping assessment:\n");

		for (let i = 0; i < scopingState.conversationHistory.length; i++) {
			const exchange = scopingState.conversationHistory[i];
			sections.push(`### Exchange ${i + 1}\n`);
			sections.push(`**User**: ${exchange.userMessage}\n`);
			sections.push(`**Scoping Agent**: ${exchange.assistantResponse}\n`);
			sections.push("---\n");
		}

		return sections.join("\n");
	}

	/**
	 * Parse the recommended level from the scoping agent's conversation.
	 * Looks for "**Recommended Level**: roadmap|epic|feature" in the last few exchanges.
	 */
	function parseRecommendedLevel(scopingState: ScopingState): HierarchyLevel | null {
		// Search from the most recent exchange backwards
		for (let i = scopingState.conversationHistory.length - 1; i >= 0; i--) {
			const response = scopingState.conversationHistory[i].assistantResponse;
			// Match patterns like "**Recommended Level**: roadmap" or "Recommended Level: feature"
			const match = response.match(/\*?\*?Recommended\s+Level\*?\*?\s*:\s*(roadmap|epic|feature)/i);
			if (match) {
				return match[1].toLowerCase() as HierarchyLevel;
			}
		}
		return null;
	}

	/**
	 * Build the drafting system prompt injection for hierarchy pipelines (roadmap/epic).
	 * This turns the host LLM into a roadmap/epic drafter.
	 */
	function buildHierarchyDraftingPromptInjection(
		state: HierarchyState,
		level: HierarchyLevel,
		projectConfig: ProjectConfig,
		parentContext?: string
	): string {
		const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
		const drafterPrompt = level === "roadmap" ? SYSTEM_PROMPTS.roadmapDrafter : SYSTEM_PROMPTS.epicDrafter;

		const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
		const fullDocPath = path.join(activeCwd, state.docPath);

		const discoveryContext = state.discovery?.discoverySummary
			? `\n\n## Discovery Context\n\nThe following requirements were gathered during discovery:\n\n${state.discovery.discoverySummary}\n`
			: "";

		const parentSection = parentContext
			? `\n\n## Parent Context\n\n${parentContext}\n`
			: "";

		let draftingHistory = "";
		if (state.drafting?.conversationHistory && state.drafting.conversationHistory.length > 0) {
			draftingHistory = `\n\n## Drafting Progress\n\nYou have had ${state.drafting.conversationHistory.length} exchanges with the user while drafting this ${level}.\n`;
		}

		return `
${drafterPrompt}

## Active ${levelLabel} Drafting Session

You are drafting a ${level} document for:

${state.description}
${discoveryContext}${parentSection}${draftingHistory}

## Document File Details

- **Document timestamp**: ${state.docTimestamp}
- **Document file path**: ${fullDocPath}
- **Iteration**: ${state.docIteration + 1}

## Instructions

- You have FULL tool access: read, bash, edit, write, grep, find, ls
- Explore the codebase to understand existing patterns and project structure
- Write the ${level} document to the EXACT path above using the write tool
- The user will guide you conversationally — follow their instructions
- If the user asks you to focus on specific areas, adjust the document accordingly
- When the user is satisfied, they will type /draft-done to proceed to approval

${state.docIteration > 0 ? `This is iteration ${state.docIteration + 1}. Read the existing document file and revise it based on the conversation.` : `This is the first draft. Create the ${level} document from scratch.`}

IMPORTANT: You are in ${levelLabel.toUpperCase()} DRAFTING MODE. Focus on creating/refining the ${level} document. Do NOT implement code.
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
		if (pipelineMode === "idle") return;

		if (pipelineMode === "scoping" && activeScopingState) {
			ctx.ui.setWidget("spec-pipeline-status", [
				"🔎 Scoping Mode",
				"────────────────────────────────────",
				`Exchanges: ${exchangeCount}`,
				"",
				"Chat naturally to help assess scope.",
				"Type /plan-done when ready to proceed.",
			]);
			return;
		}

		if (!activePipelineState) return;

		const doneCmd = "/discovery-done";  // Unified for all pipeline types
		const draftDoneCmd = activePipelineKind === "spec" ? "/spec-draft-done" : "/draft-done";
		const kindLabel = activePipelineKind === "hierarchy" && activeHierarchyLevel
			? activeHierarchyLevel.charAt(0).toUpperCase() + activeHierarchyLevel.slice(1)
			: activePipelineKind === "implement"
				? "Implementation"
				: "Spec";

		if (pipelineMode === "discovery") {
			ctx.ui.setWidget("spec-pipeline-status", [
				`🔍 ${kindLabel} Discovery Mode`,
				"────────────────────────────────────",
				`Exchanges: ${exchangeCount}`,
				"",
				"Confirm or correct each assumption.",
				`Type ${doneCmd} when ready to proceed.`,
			]);
		} else if (pipelineMode === "drafting") {
			const specState = getActiveSpecState();
			const hierState = getActiveHierarchyState();
			if (specState) {
				const specInfo = getSpecFileInfo(activeCwd, specState.specPath);
				const iteration = specState.specIteration + 1;
				const lines = [
					"📝 Drafting Mode",
					"────────────────────────────────────",
					`Spec file: ${specInfo}`,
					`Iteration: ${iteration}`,
					`Exchanges: ${exchangeCount}`,
				];
				lines.push("", `Type ${draftDoneCmd} when satisfied.`);
				ctx.ui.setWidget("spec-pipeline-status", lines);
			} else if (hierState) {
				const docInfo = getSpecFileInfo(activeCwd, hierState.docPath);
				const iteration = hierState.docIteration + 1;
				const lines = [
					`📝 ${kindLabel} Drafting Mode`,
					"────────────────────────────────────",
					`Document: ${docInfo}`,
					`Iteration: ${iteration}`,
					`Exchanges: ${exchangeCount}`,
				];
				lines.push("", `Type ${draftDoneCmd} when satisfied.`);
				ctx.ui.setWidget("spec-pipeline-status", lines);
			}
		}
	}

	/**
	 * End discovery mode and proceed to spec drafting mode
	 */
	async function endDiscoveryAndStartDrafting(ctx: any): Promise<void> {
		const specState = getActiveSpecState();
		if (pipelineMode !== "discovery" || !specState || !activeCwd || !activeProjectConfig) {
			ctx.ui.notify("No active discovery session.", "error");
			return;
		}

		const state = specState;
		const cwd = activeCwd;
		const projectConfig = activeProjectConfig;

		// Build the discovery summary from conversation history
		if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
			state.discovery.discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
		}

		state.discovery!.completed = true;
		const discoveryExchanges = exchangeCount;

		ctx.ui.notify(formatStepBanner(
			"DISCOVERY COMPLETE",
			`${discoveryExchanges} exchanges recorded. Entering spec drafting mode...`,
			"✅"
		), "success");

		// Initialize drafting state
		state.drafting = {
			conversationHistory: [],
			completed: false,
		};
		state.stage = "spec_drafting";
		saveSpecState(cwd, state);

		// Transition to drafting mode
		enterSpecMode("drafting", state, cwd, projectConfig);

		// Update widget
		updateModeWidget(ctx);

		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING MODE",
			"The LLM will now draft the specification. Guide it conversationally.",
			"📝"
		), "info");
		ctx.ui.notify(`Spec file will be written to: ${state.specPath}`, "info");
		ctx.ui.notify("When satisfied, type /spec-draft-done to proceed.", "info");

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
				conversationHistory: [],
				completed: false,
			};
		} else {
			state.drafting.completed = false;
		}
		state.stage = "spec_drafting";
		saveSpecState(cwd, state);

		enterSpecMode("drafting", state, cwd, projectConfig);
		updateModeWidget(ctx);
	}

	/**
	 * Handle end of spec drafting: commit and present approval options (no AI review)
	 */
	async function endSpecDrafting(ctx: any): Promise<void> {
		const specState = getActiveSpecState();
		if (pipelineMode !== "drafting" || !specState || !activeCwd || !activeProjectConfig) {
			ctx.ui.notify("No active drafting session.", "error");
			return;
		}

		const state = specState;
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
		state.stage = "user_approval";
		saveSpecState(cwd, state);

		// Exit drafting mode
		const { exchangeCount: draftExchanges } = exitMode();

		ctx.ui.notify(formatStepBanner(
			"SPEC DRAFTING COMPLETE",
			`${draftExchanges} exchanges. Creating commit...`,
			"✅"
		), "success");

		// Create git commit scoped to the spec file only (dirty tree is OK for doc pipelines)
		// Conversational roles use hardcoded config (not user-configurable)
		const conversationalModelConfig = { model: "opus" as const, thinking: "high" as const };
		
		// Extract doc name from filename for better commit messages
		const { extractDocName } = await import("./commit-agent.ts");
		const docName = extractDocName(state.specFilename);
		
		const commitResult = await createAgentCommit(
			cwd, state,
			{ role: "specDrafter", modelConfig: conversationalModelConfig, docName },
			projectConfig.models.agentCommitMessageWriter,
			() => saveSpecState(cwd, state),
			ctx.ui.notify.bind(ctx.ui),
			[state.specPath]
		);

		if (!commitResult.success) {
			ctx.ui.notify("Warning: Failed to create commit for spec draft", "warning");
		}

		// Present approval options to user
		const specPreview = state.specDraft.length > 3000
			? state.specDraft.slice(0, 3000) + "\n\n[... truncated — read the file for full content ...]"
			: state.specDraft;

		ctx.ui.notify(formatStepBanner(
			"User Approval Required",
			`Review the spec at: ${state.specPath}`,
			"👤"
		), "info");

		const choices = [
			"Approve spec",
			"Revise spec conversationally",
			"Cancel pipeline",
		];
		const choice = await ctx.ui.select(
			"How would you like to proceed?",
			choices
		);

		if (choice === choices[0]) {
			// Approve
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

		// Re-enter drafting mode for revision
		state.drafting!.completed = false;
		enterDraftingMode(state, cwd, projectConfig, ctx);

		ctx.ui.notify(formatStepBanner(
			"REVISION MODE",
			"Continue chatting to refine the spec.",
			"📝"
		), "info");
		ctx.ui.notify("Type /spec-draft-done when satisfied.", "info");

		// Kick off revision
		pi.sendUserMessage(
			`Please read the current spec at ${fullSpecPath} and let me guide you on revisions.`
		);
	}

	/**
	 * Handle end of hierarchy drafting: commit and present approval options (no AI review)
	 */
	async function endHierarchyDrafting(ctx: any): Promise<void> {
		const hierState = getActiveHierarchyState();
		if (pipelineMode !== "drafting" || !hierState || !activeCwd || !activeProjectConfig) {
			ctx.ui.notify("No active hierarchy drafting session.", "error");
			return;
		}

		const state = hierState;
		const cwd = activeCwd;
		const projectConfig = activeProjectConfig;
		const level = activeHierarchyLevel!;
		const parentContext = activeParentContext;
		const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
		const fullDocPath = path.join(cwd, state.docPath);

		// Validate document file exists
		if (!fs.existsSync(fullDocPath)) {
			ctx.ui.notify(`Document file not found at: ${state.docPath}\n\nThe LLM needs to write the document file first. Continue chatting to guide it.`, "error");
			return;
		}

		// Read the document content
		state.docContent = fs.readFileSync(fullDocPath, "utf-8");
		if (!state.docContent.trim()) {
			ctx.ui.notify("Document file is empty. Continue chatting to guide the LLM.", "error");
			return;
		}

		// Mark drafting as complete
		state.drafting!.completed = true;
		state.docIteration++;
		state.stage = "user_approval";
		if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
		else saveEpicState(cwd, state as EpicState);

		// Exit drafting mode
		const { exchangeCount: draftExchanges } = exitMode();

		ctx.ui.notify(formatStepBanner(
			`${levelLabel.toUpperCase()} DRAFTING COMPLETE`,
			`${draftExchanges} exchanges. Creating commit...`,
			"✅"
		), "success");

		// Create git commit scoped to the doc file only (dirty tree is OK for doc pipelines)
		// Conversational roles use hardcoded config (not user-configurable)
		const conversationalModelConfig = { model: "opus" as const, thinking: "high" as const };
		const drafterRole = level === "roadmap" ? "roadmapDrafter" : "epicDrafter";
		
		// Extract doc name from filename for better commit messages
		const { extractDocName } = await import("./commit-agent.ts");
		const docName = extractDocName(state.docFilename);
		
		const commitResult = await createAgentCommit(
			cwd, state,
			{ role: drafterRole, modelConfig: conversationalModelConfig, docName },
			projectConfig.models.agentCommitMessageWriter,
			() => {
				if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
				else saveEpicState(cwd, state as EpicState);
			},
			ctx.ui.notify.bind(ctx.ui),
			[state.docPath]
		);

		if (!commitResult.success) {
			ctx.ui.notify("Warning: Failed to create commit for document draft", "warning");
		}

		// Present approval options to user
		ctx.ui.notify(formatStepBanner(
			"User Approval Required",
			`Review the ${level} document at: ${state.docPath}`,
			"👤"
		), "info");

		const choices = [
			`Approve ${level}`,
			`Revise ${level} conversationally`,
			"Cancel pipeline",
		];
		const choice = await ctx.ui.select(
			"How would you like to proceed?",
			choices
		);

		if (choice === choices[0]) {
			// Approve — continue to child extraction and completion
			state.docApproved = true;
			if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);

			// Run the hierarchy pipeline for child extraction and completion
			await runHierarchyPipeline(state, cwd, projectConfig, ctx, parentContext);
			return;
		}

		if (choice === choices[2]) {
			// Cancel
			state.stage = "cancelled";
			if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);
			clearPipelineWidget(ctx);
			ctx.ui.notify("Pipeline cancelled.", "info");
			return;
		}

		// Re-enter drafting mode for revision
		state.drafting!.completed = false;
		state.stage = "drafting";
		if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
		else saveEpicState(cwd, state as EpicState);

		enterHierarchyMode("drafting", state, level, cwd, projectConfig, parentContext);
		updateModeWidget(ctx);

		ctx.ui.notify(formatStepBanner(
			"REVISION MODE",
			`Continue chatting to refine the ${level} document.`,
			"📝"
		), "info");
		ctx.ui.notify("Type /draft-done when satisfied.", "info");

		// Kick off revision
		pi.sendUserMessage(
			`Please read the current ${level} document at ${fullDocPath} and let me guide you on revisions.`
		);
	}

	// ============================================
	// EVENT HANDLERS FOR CONVERSATIONAL MODES
	// ============================================

	/**
	 * Inject system prompt when in a conversational mode (scoping, discovery, or drafting)
	 */
	pi.on("before_agent_start", async (event, ctx) => {
		if (pipelineMode === "idle" || !activeProjectConfig) {
			return undefined;
		}

		let injection: string;
		let customType: string;
		let contextLabel: string;

		if (pipelineMode === "scoping" && activeScopingState) {
			injection = buildScopingPromptInjection(activeScopingState, activeProjectConfig);
			customType = "spec-scoping-context";
			contextLabel = `[SCOPING MODE ACTIVE - Assessing scope for: ${activeScopingState.description}]`;
		} else if (pipelineMode === "discovery" && activePipelineState) {
			let sessionLabel = "Spec";
			let nextStep = "proceed to spec drafting";
			
			if (activePipelineKind === "spec") {
				sessionLabel = "Spec";
				nextStep = "proceed to spec drafting";
			} else if (activePipelineKind === "hierarchy") {
				sessionLabel = activeHierarchyLevel!.charAt(0).toUpperCase() + activeHierarchyLevel!.slice(1);
				nextStep = `proceed to ${activeHierarchyLevel} drafting`;
			} else if (activePipelineKind === "implement") {
				sessionLabel = "Implementation";
				nextStep = "proceed to implementation";
			}
			
			injection = buildUnifiedDiscoveryPrompt(
				activePipelineState,
				activeProjectConfig,
				"/discovery-done",
				sessionLabel,
				nextStep,
				activeParentContext
			);
			customType = "spec-discovery-context";
			contextLabel = `[DISCOVERY MODE ACTIVE - Exploring requirements for: ${activePipelineState.description}]`;
		} else if (pipelineMode === "drafting" && activePipelineState) {
			if (activePipelineKind === "spec") {
				injection = buildDraftingPromptInjection(activePipelineState as SpecState, activeProjectConfig);
			} else {
				injection = buildHierarchyDraftingPromptInjection(
					activePipelineState as HierarchyState,
					activeHierarchyLevel!,
					activeProjectConfig,
					activeParentContext
				);
			}
			customType = "spec-drafting-context";
			contextLabel = `[DRAFTING MODE ACTIVE - Creating ${activePipelineKind === "spec" ? "spec" : activeHierarchyLevel} for: ${activePipelineState.description}]`;
		} else {
			return undefined;
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
		if (pipelineMode === "idle") {
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

			if (pipelineMode === "scoping" && activeScopingState) {
				activeScopingState.conversationHistory.push(exchange);
				exchangeCount = activeScopingState.conversationHistory.length;
				// No need to persist — scoping state is ephemeral
			} else if (pipelineMode === "discovery" && activePipelineState) {
				if (!activePipelineState.discovery!.conversationHistory) {
					activePipelineState.discovery!.conversationHistory = [];
				}
				activePipelineState.discovery!.conversationHistory.push(exchange);
				exchangeCount = activePipelineState.discovery!.conversationHistory.length;
				activeStateSaveFn?.();
			} else if (pipelineMode === "drafting" && activePipelineState) {
				if (!activePipelineState.drafting!.conversationHistory) {
					activePipelineState.drafting!.conversationHistory = [];
				}
				activePipelineState.drafting!.conversationHistory.push(exchange);
				exchangeCount = activePipelineState.drafting!.conversationHistory.length;
				activeStateSaveFn?.();
			}

			updateModeWidget(ctx);
			lastUserMessage = "";
		}
	});

	/**
	 * Filter out pipeline context messages that don't belong to the current mode.
	 * - In idle: filter out all pipeline context messages
	 * - In scoping: filter out discovery and drafting context messages
	 * - In discovery: filter out scoping and drafting context messages
	 * - In drafting: filter out scoping and discovery context messages
	 */
	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((m: any) => {
				if (m.customType === "spec-scoping-context") {
					return pipelineMode === "scoping";
				}
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

	pi.registerCommand("spec-draft-done", {
		description: "End spec drafting and proceed to approval",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "drafting" || activePipelineKind !== "spec") {
				ctx.ui.notify("No active spec drafting session. Use /spec to start one.", "error");
				return;
			}

			await endSpecDrafting(ctx);
		},
	});

	pi.registerCommand("discovery-done", {
		description: "End discovery and proceed to next phase (spec drafting, hierarchy drafting, or implementation)",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "discovery" || !activePipelineKind || !activePipelineState || !activeCwd || !activeProjectConfig) {
				ctx.ui.notify("No active discovery session.", "error");
				return;
			}

			if (exchangeCount === 0) {
				const proceed = await ctx.ui.confirm(
					"No Discovery Exchanges",
					"No conversation exchanges recorded yet. Proceed anyway?"
				);
				if (!proceed) return;
			}

			// Dispatch based on pipeline kind
			if (activePipelineKind === "spec") {
				// Absorb /spec-done logic
				await endDiscoveryAndStartDrafting(ctx);
			} else if (activePipelineKind === "hierarchy") {
				// Existing hierarchy logic
				const state = getActiveHierarchyState();
				if (!state) {
					ctx.ui.notify("No active hierarchy discovery session.", "error");
					return;
				}

				// Build the discovery summary from conversation history
				if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
					state.discovery.discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
				}

				state.discovery!.completed = true;
				const discoveryExchanges = exchangeCount;

				const level = activeHierarchyLevel!;
				const cwd = activeCwd;
				const projectConfig = activeProjectConfig;
				const parentContext = activeParentContext;
				const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

				ctx.ui.notify(formatStepBanner(
					"DISCOVERY COMPLETE",
					`${discoveryExchanges} exchanges recorded. Entering ${level} drafting mode...`,
					"✅"
				), "success");

				// Initialize drafting state and transition to drafting mode
				state.drafting = {
					conversationHistory: [],
					completed: false,
				};
				state.stage = "drafting";
				if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
				else saveEpicState(cwd, state as EpicState);

				// Enter hierarchy drafting mode
				enterHierarchyMode("drafting", state, level, cwd, projectConfig, parentContext);
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					`${levelLabel.toUpperCase()} DRAFTING MODE`,
					`The LLM will draft the ${level} document. Guide it conversationally.`,
					"📝"
				), "info");
				ctx.ui.notify(`Document will be written to: ${state.docPath}`, "info");
				ctx.ui.notify("When satisfied, type /draft-done to proceed to approval.", "info");

				// Send the kickoff message
				const fullDocPath = path.join(cwd, state.docPath);
				const discoveryContext = state.discovery?.discoverySummary
					? `\n\nHere is the context gathered during discovery:\n\n${state.discovery.discoverySummary}`
					: "";

				pi.sendUserMessage(
					`Please create a ${level} document for: ${state.description}${discoveryContext}\n\n` +
					`Write the document to this exact path: ${fullDocPath}\n` +
					`Use document timestamp: ${state.docTimestamp}\n\n` +
					`Explore the codebase first to understand existing patterns, then create a comprehensive ${level} document.`
				);
			} else if (activePipelineKind === "implement") {
				// Implement-discovery → implementation transition
				const state = activePipelineState as ConversationalPipelineState;
				const cwd = activeCwd;
				const projectConfig = activeProjectConfig;
				const flags = pendingImplementFlags!;
				const shortName = pendingImplementShortName!;
				const timestamp = pendingImplementTimestamp!;
				
				// Build discovery summary
				let discoverySummary = "";
				if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
					discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
				}
				
				const discoveryExchanges = exchangeCount;
				
				ctx.ui.notify(formatStepBanner(
					"DISCOVERY COMPLETE",
					`${discoveryExchanges} exchanges recorded. Checking git status...`,
					"✅"
				), "success");
				
				// NOW check git clean (deferred from /implement invocation)
				const gitClean = await checkGitClean(cwd);
				if (!gitClean.clean) {
					ctx.ui.notify(formatStepBanner(
						"UNCOMMITTED CHANGES DETECTED",
						"The implementation pipeline requires a clean working tree.",
						"⚠️"
					), "warning");
					ctx.ui.notify("Uncommitted changes:\n" + gitClean.status, "warning");
					ctx.ui.notify("\nPlease commit or stash your changes, then run /discovery-done again.", "info");
					ctx.ui.notify("Your discovery session will remain active.", "info");
					// Do NOT exit mode - leave discovery session active
					return;
				}
				
				// Exit discovery mode (clears all state including pendingImplementFlags)
				exitMode();
				clearPipelineWidget(ctx);
				
				ctx.ui.notify("Writing discovery summary...", "info");
				
				// Write discovery summary file to specsDir
				const discoveryFilename = `${timestamp}_discovery_${shortName}.md`;
				const discoveryContent = discoverySummary || `# Discovery Summary\n\n${state.description}\n\nNo discovery exchanges recorded.`;
				
				// Resolve absolute path to specsDir (handle both absolute and relative configs)
				const fullSpecsDir = path.isAbsolute(projectConfig.specsDir)
					? projectConfig.specsDir
					: path.join(cwd, projectConfig.specsDir);
				
				// Ensure specsDir exists
				if (!fs.existsSync(fullSpecsDir)) {
					fs.mkdirSync(fullSpecsDir, { recursive: true });
				}
				
				// Write file to absolute path, compute relative path for display/state
				const fullDiscoveryPath = path.join(fullSpecsDir, discoveryFilename);
				const discoveryPath = path.relative(cwd, fullDiscoveryPath);
				fs.writeFileSync(fullDiscoveryPath, discoveryContent, "utf-8");
				
				ctx.ui.notify(`Discovery summary written to: ${discoveryPath}`, "success");
				ctx.ui.notify(formatStepBanner(
					"STARTING IMPLEMENTATION",
					`From discovery file: ${discoveryPath}`,
					"🚀"
				), "info");
				
				// Create implementation state (using discovery file as "spec")
				const implTimestamp = generateTimestamp();
				const implState = createInitialImplState(
					discoveryPath,
					discoveryContent,
					implTimestamp,
					flags.noPlan
				);
				
				implState.checkpoints = [];
				saveImplState(cwd, implState);
				
				ctx.ui.notify(formatStepBanner(
					"IMPLEMENTATION STARTED",
					`ID: ${implState.id}`,
					"🚀"
				), "info");
				ctx.ui.notify(`Spec: ${discoveryPath}`, "info");
				if (flags.noPlan) {
					ctx.ui.notify("⚡ Skipping plan generation (--no-plan)", "info");
				}
				if (flags.noReview) {
					ctx.ui.notify("⚡ Skipping reviews (--no-review)", "info");
				}
				
				updateImplWidget(ctx, implState, "Initializing...");
				
				// Apply --no-review flag if present (clone config to avoid mutation)
				let effectiveConfig = projectConfig;
				if (flags.noReview) {
					effectiveConfig = {
						...projectConfig,
						reviewCycles: {
							planReviewer: { cheap: 0, expensive: 0 },
							codeReviewer: { cheap: 0, expensive: 0 },
						},
					};
				}
				
				// Run implementation pipeline
				await runImplementPipeline(implState, cwd, effectiveConfig, ctx);
			}
		},
	});

	pi.registerCommand("draft-done", {
		description: "End hierarchy drafting and proceed to approval",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "drafting" || activePipelineKind !== "hierarchy") {
				ctx.ui.notify("No active hierarchy drafting session. Use /roadmap or /epic to start one.", "error");
				return;
			}

			await endHierarchyDrafting(ctx);
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

			// Git validation (repo must exist, but dirty state is OK for doc pipelines)
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
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
			const { shortName } = await promptForShortName(ctx, description);

			// Create initial state
			const state = createInitialSpecState(
				description,
				specTimestamp,
				shortName,
				projectConfig.specsDir,
				isQuick,
				projectConfig.specFormat
			);
			
			state.checkpoints = [];
			saveSpecState(cwd, state);
			
			ctx.ui.notify(formatStepBanner(
				"SPEC CREATION STARTED",
				`ID: ${state.id}`,
				"📝"
			), "info");
			
			if (isQuick) {
				ctx.ui.notify("Skipping discovery phase (--quick mode)", "info");
			}
			
			updateSpecWidget(ctx, state, "Initializing...");

			// Consume any pending scoping context from /plan → feature route
			const scopingContext = pendingScopingContext;
			pendingScopingContext = undefined;
			if (scopingContext) {
				ctx.ui.notify("📎 Including scoping context from /plan session.", "info");
			}

			// If discovery is enabled (not --quick), enter conversational discovery mode
			const shouldDiscover = !isQuick && state.stage === "discovery";

			if (shouldDiscover) {
				// If we have scoping context, pre-populate the discovery summary so it's available
				if (scopingContext && state.discovery) {
					state.discovery.discoverySummary = scopingContext;
				}

				// Initialize conversational discovery state
				state.discovery!.conversationHistory = [];
				saveSpecState(cwd, state);

				// Enter discovery mode
				enterSpecMode("discovery", state, cwd, projectConfig);

				// Show discovery widget
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DISCOVERY MODE",
					"The LLM will explore the codebase, propose assumptions, and ask you to confirm.",
					"🔍"
				), "info");
				ctx.ui.notify("The LLM will propose what it thinks is the best approach for each aspect, one at a time. Confirm or correct each assumption.", "info");
				ctx.ui.notify("When you're satisfied with the discovery, type /discovery-done to proceed to spec drafting.", "info");

				// Send the initial discovery message to kick off the conversation
				const scopingNote = scopingContext
					? `\n\nThe following context was gathered during a scoping assessment:\n\n${scopingContext}\n\nPlease take this into account when forming your assumptions.`
					: "";
				pi.sendUserMessage(`I want to build the following feature: ${description}${scopingNote}\n\nPlease explore the codebase, identify the most important ambiguity or decision point, and propose your best assumption for how it should work.`);
			} else {
				// --quick mode: enter conversational drafting directly
				enterDraftingMode(state, cwd, projectConfig, ctx);

				ctx.ui.notify(formatStepBanner(
					"SPEC DRAFTING MODE",
					"The LLM will draft the specification. Guide it conversationally.",
					"📝"
				), "info");
				ctx.ui.notify(`Spec file will be written to: ${state.specPath}`, "info");
				ctx.ui.notify("When satisfied, type /spec-draft-done to proceed.", "info");

				// Send the kickoff message
				const fullSpecPath = path.join(cwd, state.specPath);
				const scopingNote = scopingContext
					? `\n\nThe following context was gathered during a scoping assessment:\n\n${scopingContext}\n\nIncorporate this context into the specification.`
					: "";
				pi.sendUserMessage(
					`Please create a technical specification for: ${description}${scopingNote}\n\n` +
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

			// Git validation (repo must exist, but dirty state is OK for doc pipelines)
			const gitValidation = await validateGitRepo(cwd);
			if (!gitValidation.valid) {
				ctx.ui.notify(gitValidation.error!, "error");
				return;
			}
			
			// Clean up error stash if present
			if (state.errorStash) {
				const stashStillExists = await stashExists(cwd, state.errorStash);
				if (stashStillExists) {
					ctx.ui.notify("Dropping stashed changes from previous error...", "info");
					await dropStash(cwd, state.errorStash);
				}
				state.errorStash = undefined;
				saveSpecState(cwd, state);
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
			if (state.stage === "discovery" && !state.discovery?.completed) {
				enterSpecMode("discovery", state, cwd, projectConfig);
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DISCOVERY MODE RESUMED",
					`${exchangeCount} previous exchanges. Continue chatting to refine requirements.`,
					"🔍"
				), "info");
				ctx.ui.notify("Type /discovery-done when ready to proceed to spec drafting.", "info");

				// Send a resume message to kick off the conversation
				pi.sendUserMessage(`I'm resuming the discovery session for: ${state.description}\n\nPlease review what we've discussed so far and continue with the next most important assumption to verify.`);
				return;
			}

			// If resuming in conversational drafting mode, re-enter drafting mode
			if (state.stage === "spec_drafting" && state.drafting && !state.drafting.completed) {
				enterSpecMode("drafting", state, cwd, projectConfig);
				updateModeWidget(ctx);

				ctx.ui.notify(formatStepBanner(
					"DRAFTING MODE RESUMED",
					`${exchangeCount} previous exchanges. Continue guiding the spec.`,
					"📝"
				), "info");
				ctx.ui.notify(`Spec file: ${state.specPath}`, "info");
				ctx.ui.notify("Type /spec-draft-done when satisfied.", "info");

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
				if (pipelineMode !== "idle" && activePipelineState?.id === state.id) {
					exitMode();
				}
				
				clearPipelineWidget(ctx);
				ctx.ui.notify("Pipeline cancelled. Resume with /spec-resume", "info");
			}
		},
	});

	// ============================================
	// IMPLEMENTATION COMMANDS
	// ============================================

	pi.registerCommand("implement", {
		description: "Start implementation from a spec file OR text description (text enters discovery mode). Use --no-plan to skip plan generation, --no-review to skip reviews.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const noPlan = argsStr.includes("--no-plan");
			const noReview = argsStr.includes("--no-review");
			const argWithoutFlags = argsStr
				.replace("--no-plan", "")
				.replace("--no-review", "")
				.replace(/\s+/g, " ")
				.trim();
			
			if (!argWithoutFlags) {
				ctx.ui.notify("Usage: /implement [--no-plan] [--no-review] <spec-file-or-description>", "error");
				return;
			}

			const cwd = ctx.cwd;

			// Check if argument is a file path
			const fullPath = path.isAbsolute(argWithoutFlags)
				? argWithoutFlags
				: path.join(cwd, argWithoutFlags);
			
			// Check if it's an existing file first (handles edge cases like "fix/bug-123" or files without extensions)
			const isFile = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();

			// Heuristic: if it looks like a file path but doesn't exist, show error
			const looksLikeFilePath = argWithoutFlags.includes("/") || /\.(md|typ)$/i.test(argWithoutFlags);
			if (looksLikeFilePath && !isFile) {
				ctx.ui.notify(`Spec file not found: ${argWithoutFlags}`, "error");
				return;
			}

			// If it's a valid file, continue with existing implementation logic
			if (isFile) {
				// *** EXISTING FILE-BASED IMPLEMENTATION LOGIC CONTINUES HERE ***
				const specPath = argWithoutFlags;
				const fullSpecPath = fullPath;
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

				if (noReview) {
					projectConfig.reviewCycles.planReviewer = { cheap: 0, expensive: 0 };
					projectConfig.reviewCycles.codeReviewer = { cheap: 0, expensive: 0 };
				}

				ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");
				
				if (noPlan) {
					ctx.ui.notify("⏭️ Plan generation will be skipped (--no-plan flag)", "info");
				}

				if (noReview) {
					ctx.ui.notify("⏭️ Reviews will be skipped (--no-review flag)", "info");
				}

				ctx.ui.notify(`Starting implementation from: ${relativeSpecPath}`, "info");

				// Generate timestamp and names
				const implTimestamp = generateTimestamp();

				// Create initial state
				const state = createInitialImplState(
					relativeSpecPath,
					specContent,
					implTimestamp,
					noPlan
				);
				
				state.checkpoints = [];
				saveImplState(cwd, state);
				
				ctx.ui.notify(formatStepBanner(
					"IMPLEMENTATION STARTED",
					`ID: ${state.id}`,
					"🚀"
				), "info");
				ctx.ui.notify(`Spec: ${relativeSpecPath}`, "info");
				
				updateImplWidget(ctx, state, "Initializing...");

				await runImplementPipeline(state, cwd, projectConfig, ctx);
			} else {
				// *** NEW: DISCOVERY MODE ENTRY ***
				const description = argWithoutFlags;
				
				// Check for existing active implement pipeline
				const existingPipeline = getLatestActiveImplPipeline(cwd);
				if (existingPipeline) {
					const proceed = await ctx.ui.confirm(
						"Active Implementation Pipeline Found",
						`There's an active implementation pipeline:\n${formatImplState(existingPipeline)}\n\nDo you want to continue with a NEW pipeline? (No = cancel)`
					);
					if (!proceed) {
						ctx.ui.notify("Use /implement-resume to continue the existing pipeline", "info");
						return;
					}
				}
				
				// Git validation (repo must exist, but don't check clean yet - deferred to /discovery-done)
				const gitValidation = await validateGitRepo(cwd);
				if (!gitValidation.valid) {
					ctx.ui.notify(gitValidation.error!, "error");
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
				ctx.ui.notify("Starting implementation discovery...", "info");
				if (projectConfig.contextFiles.length > 0) {
					ctx.ui.notify(`Using context from: ${projectConfig.contextFiles.join(", ")}`, "info");
				}
				
				// Generate timestamp and prompt for short name
				const timestamp = generateTimestamp();
				const { shortName } = await promptForShortName(ctx, description);
				
				// Create ephemeral conversational state (not persisted to disk)
				const discoveryState: ConversationalPipelineState = {
					id: generatePipelineId(),
					description,
					discovery: {
						skipped: false,
						conversationHistory: [],
						completed: false,
					},
				};
				
				// Enter implement-discovery mode
				enterImplementDiscoveryMode(cwd, projectConfig, discoveryState, { noPlan, noReview }, shortName, timestamp);
				updateModeWidget(ctx);
				
				ctx.ui.notify(formatStepBanner(
					"IMPLEMENTATION DISCOVERY MODE",
					"The LLM will explore the codebase, propose assumptions, and ask you to confirm.",
					"🔍"
				), "info");
				ctx.ui.notify("The LLM will propose what it thinks is the best approach for each aspect, one at a time. Confirm or correct each assumption.", "info");
				ctx.ui.notify("(This is the same discovery process as /spec - conversational and iterative)", "info");
				ctx.ui.notify("When you're satisfied with the discovery, type /discovery-done to proceed to implementation.", "info");
				
				if (noPlan) {
					ctx.ui.notify("⚡ --no-plan flag will be applied after discovery", "info");
				}
				if (noReview) {
					ctx.ui.notify("⚡ --no-review flag will be applied after discovery", "info");
				}
				
				// Send the initial discovery message
				pi.sendUserMessage(
					`I want to implement the following: ${description}\n\n` +
					`Please explore the codebase, identify the most important ambiguity or decision point, and propose your best assumption for how it should work.`
				);
			}
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
					// Plan generation and implementation are now interleaved per-phase,
					// so always resume into "implementation" stage
					state.stage = "implementation";
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
			
			// Clean up error stash if present
			if (state.errorStash) {
				const stashStillExists = await stashExists(cwd, state.errorStash);
				if (stashStillExists) {
					ctx.ui.notify("Dropping stashed changes from previous error...", "info");
					await dropStash(cwd, state.errorStash);
				}
				state.errorStash = undefined;
				saveImplState(cwd, state);
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
		description: "Cancel an active implementation or discovery session",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}
			
			// Check if we're in implement-discovery mode (ephemeral, not persisted)
			if (pipelineMode === "discovery" && activePipelineKind === "implement") {
				exitMode();
				clearPipelineWidget(ctx);
				ctx.ui.notify("Discovery session cancelled.", "info");
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
				ctx.ui.notify("Implementation cancelled. Resume with /implement-resume", "info");
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
	// HIERARCHY COMMANDS (Roadmaps & Epics)
	// ============================================

	/**
	 * Shared helper: start a hierarchy pipeline (roadmap or epic)
	 */
	async function startHierarchyPipeline(
		level: HierarchyLevel,
		description: string,
		isQuick: boolean,
		ctx: any,
		parentId?: string,
		parentType?: "roadmap",
		scopingSummary?: string
	): Promise<void> {
		const cwd = ctx.cwd;

		// Git validation (repo must exist, but dirty state is OK for doc pipelines)
		const gitValidation = await validateGitRepo(cwd);
		if (!gitValidation.valid) {
			ctx.ui.notify(gitValidation.error!, "error");
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
		ctx.ui.notify(`Starting ${level} creation...`, "info");

		// Generate names and timestamps
		const docTimestamp = generateTimestamp();
		const { shortName } = await promptForShortName(ctx, description);

		// Create initial state
		let state: HierarchyState;
		if (level === "roadmap") {
			state = createInitialRoadmapState(
				description, docTimestamp, shortName,
				projectConfig.specsDir,
				isQuick, projectConfig.specFormat
			);
		} else {
			state = createInitialEpicState(
				description, docTimestamp, shortName,
				projectConfig.specsDir,
				isQuick, projectConfig.specFormat,
				parentId, parentType
			);
		}

		state.checkpoints = [];

		if (level === "roadmap") {
			saveRoadmapState(cwd, state as RoadmapState);
		} else {
			saveEpicState(cwd, state as EpicState);
		}

		const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
		ctx.ui.notify(formatStepBanner(
			`${levelLabel.toUpperCase()} CREATION STARTED`,
			`ID: ${state.id}`,
			level === "roadmap" ? "🗺️" : "📋"
		), "info");

		if (isQuick) {
			ctx.ui.notify("Skipping discovery phase (--quick mode)", "info");
		}

		// Build parent context if this is an epic under a roadmap
		let parentContext: string | undefined;
		if (parentId && parentType === "roadmap") {
			const parentState = loadRoadmapState(cwd, parentId);
			if (parentState?.docContent) {
				parentContext = `## Parent Roadmap\n\n${parentState.docContent}`;
				if (parentState.discovery?.discoverySummary) {
					parentContext += `\n\n## Roadmap Discovery Context\n\n${parentState.discovery.discoverySummary}`;
				}
			}
		}

		// Append scoping context if available (from /plan command)
		if (scopingSummary) {
			parentContext = (parentContext ? parentContext + "\n\n" : "") + scopingSummary;
		}

		// If discovery is enabled (not --quick), enter conversational discovery mode
		const shouldDiscover = !isQuick && state.stage === "discovery";

		if (shouldDiscover) {
			// Initialize conversational discovery state
			state.discovery!.conversationHistory = [];
			if (level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);

			// Enter hierarchy discovery mode
			enterHierarchyMode("discovery", state, level, cwd, projectConfig, parentContext);

			// Show discovery widget
			updateModeWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				`${levelLabel.toUpperCase()} DISCOVERY MODE`,
				"The LLM will explore the codebase, propose assumptions, and ask you to confirm.",
				"🔍"
			), "info");
			ctx.ui.notify("The LLM will propose what it thinks is the best approach for each aspect, one at a time. Confirm or correct each assumption.", "info");
			ctx.ui.notify("When you're satisfied with the discovery, type /discovery-done to proceed.", "info");

			// Send the initial discovery message
			const parentNote = parentContext ? "\n\nRelevant parent context has been provided." : "";
			pi.sendUserMessage(
				`I want to create a ${level} for the following: ${description}${parentNote}\n\n` +
				`Please explore the codebase, identify the most important ambiguity or decision point, and propose your best assumption for how it should work.`
			);
		} else {
			// --quick mode or discovery disabled: enter conversational drafting directly
			state.drafting = {
				conversationHistory: [],
				completed: false,
			};
			state.stage = "drafting";
			if (level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);

			enterHierarchyMode("drafting", state, level, cwd, projectConfig, parentContext);
			updateModeWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				`${levelLabel.toUpperCase()} DRAFTING MODE`,
				`The LLM will draft the ${level} document. Guide it conversationally.`,
				"📝"
			), "info");
			ctx.ui.notify(`Document will be written to: ${state.docPath}`, "info");
			ctx.ui.notify("When satisfied, type /draft-done to proceed to approval.", "info");

			// Send the kickoff message
			const fullDocPath = path.join(cwd, state.docPath);
			const parentNote = parentContext ? "\n\nRelevant parent context has been provided." : "";
			pi.sendUserMessage(
				`Please create a ${level} document for: ${description}${parentNote}\n\n` +
				`Write the document to this exact path: ${fullDocPath}\n` +
				`Use document timestamp: ${state.docTimestamp}\n\n` +
				`Explore the codebase first to understand existing patterns, then create a comprehensive ${level} document.`
			);
		}
	}

	/**
	 * Shared helper: resume a hierarchy pipeline (roadmap or epic)
	 */
	async function resumeHierarchyPipeline(
		level: HierarchyLevel,
		pipelineId: string | undefined,
		ctx: any
	): Promise<void> {
		const cwd = ctx.cwd;
		const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

		let state: HierarchyState | null;
		if (pipelineId) {
			state = level === "roadmap" ? loadRoadmapState(cwd, pipelineId) : loadEpicState(cwd, pipelineId);
			if (!state) {
				ctx.ui.notify(`${levelLabel} pipeline not found: ${pipelineId}`, "error");
				return;
			}
		} else {
			state = level === "roadmap" ? getLatestActiveRoadmapPipeline(cwd) : getLatestActiveEpicPipeline(cwd);
			if (!state) {
				ctx.ui.notify(`No active ${level} pipeline found. Use /${level} to start one.`, "error");
				return;
			}
		}

		if (state.stage === "completed") {
			ctx.ui.notify(`This ${level} pipeline is already completed.`, "info");
			return;
		}

		if (state.stage === "cancelled") {
			const restart = await ctx.ui.confirm(
				`${levelLabel} Cancelled`,
				`This ${level} was cancelled. Restart from where it left off?`
			);
			if (!restart) return;

			if (state.stageBeforeCancellation && state.stageBeforeCancellation !== "cancelled") {
				ctx.ui.notify(`Resuming from saved stage: ${formatHierarchyStage(state.stageBeforeCancellation)}`, "info");
				state.stage = state.stageBeforeCancellation;
				state.stageBeforeCancellation = undefined;
			} else {
				if (state.discovery && !state.discovery.completed) {
					state.stage = "discovery";
				} else if (!state.docApproved) {
					const fullDocPath = path.join(cwd, state.docPath);
					if (fs.existsSync(fullDocPath) && state.docIteration > 0) {
						state.stage = "review";
					} else {
						state.stage = "drafting";
					}
				} else {
					state.stage = "approved";
				}
			}
			if (level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);
		}

		// Git validation (repo must exist, but dirty state is OK for doc pipelines)
		const gitValidation = await validateGitRepo(cwd);
		if (!gitValidation.valid) {
			ctx.ui.notify(gitValidation.error!, "error");
			return;
		}

		// Clean up error stash if present
		if (state.errorStash) {
			const stashStillExists = await stashExists(cwd, state.errorStash);
			if (stashStillExists) {
				ctx.ui.notify("Dropping stashed changes from previous error...", "info");
				await dropStash(cwd, state.errorStash);
			}
			state.errorStash = undefined;
			if (level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
			else saveEpicState(cwd, state as EpicState);
		}

		ctx.ui.notify(formatStepBanner(
			`RESUMING ${levelLabel.toUpperCase()}`,
			`ID: ${state.id}`,
			"🔄"
		), "info");
		ctx.ui.notify(`Current stage: ${formatHierarchyStage(state.stage)}`, "info");

		const configResult = loadPipelineConfig(cwd);
		if (!configResult.success) {
			ctx.ui.notify(configResult.error, "error");
			return;
		}
		const projectConfig = configResult.config;

		// If resuming in conversational discovery mode, re-enter discovery mode
		if (state.stage === "discovery" && state.discovery && !state.discovery.completed) {
			enterHierarchyMode("discovery", state, level, cwd, projectConfig);
			updateModeWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				`${levelLabel.toUpperCase()} DISCOVERY MODE RESUMED`,
				`${exchangeCount} previous exchanges. Continue chatting to refine requirements.`,
				"🔍"
			), "info");
			ctx.ui.notify("Type /discovery-done when ready to proceed.", "info");

			pi.sendUserMessage(`I'm resuming the discovery session for this ${level}: ${state.description}\n\nPlease review what we've discussed so far and continue with the next most important assumption to verify.`);
			return;
		}

		// If resuming in conversational drafting mode, re-enter drafting mode
		if (state.stage === "drafting" && state.drafting && !state.drafting.completed) {
			enterHierarchyMode("drafting", state, level, cwd, projectConfig);
			updateModeWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				`${levelLabel.toUpperCase()} DRAFTING MODE RESUMED`,
				`${exchangeCount} previous exchanges. Continue guiding the ${level} document.`,
				"📝"
			), "info");
			ctx.ui.notify(`Document: ${state.docPath}`, "info");
			ctx.ui.notify("Type /draft-done when satisfied.", "info");

			// Send a resume message
			const fullDocPath = path.join(cwd, state.docPath);
			pi.sendUserMessage(
				`I'm resuming the ${level} drafting session for: ${state.description}\n\n` +
				`Document file path: ${fullDocPath}\n\n` +
				`Please review the current state and continue drafting.`
			);
			return;
		}

		// For approved/completed stages, or user_approval after drafting, continue with pipeline
		await runHierarchyPipeline(state, cwd, projectConfig, ctx);
	}

	// ---- /plan command ----

	pi.registerCommand("plan", {
		description: "Unified entry point for planning. Assesses scope and recommends roadmap/epic/feature level. Flags: --quick, --roadmap, --epic, --feature",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const isQuick = argsStr.includes("--quick");
			const forceRoadmap = argsStr.includes("--roadmap");
			const forceEpic = argsStr.includes("--epic");
			const forceFeature = argsStr.includes("--feature");

			const description = argsStr
				.replace("--quick", "")
				.replace("--roadmap", "")
				.replace("--epic", "")
				.replace("--feature", "")
				.replace(/\s+/g, " ")
				.trim();

			if (!description) {
				ctx.ui.notify("Usage: /plan [--quick] [--roadmap|--epic|--feature] <description>", "error");
				return;
			}

			// If a level was explicitly specified, route directly
			if (forceRoadmap) {
				await startHierarchyPipeline("roadmap", description, isQuick, ctx);
				return;
			}
			if (forceEpic) {
				await startHierarchyPipeline("epic", description, isQuick, ctx);
				return;
			}
			if (forceFeature) {
				// Delegate to existing /spec command — notify user to run it
				ctx.ui.notify(`Recommendation: Feature level. Run:\n  /spec ${isQuick ? "--quick " : ""}${description}`, "info");
				return;
			}

			// Check for existing active scoping session
			if (pipelineMode === "scoping") {
				ctx.ui.notify("A scoping session is already active. Use /plan-done to finish it, or /plan-cancel to cancel.", "error");
				return;
			}

			const cwd = ctx.cwd;

			// Load config
			const configResult = loadPipelineConfig(cwd);
			if (!configResult.success) {
				ctx.ui.notify(configResult.error, "error");
				return;
			}
			const projectConfig = configResult.config;

			// Create ephemeral scoping state
			const scopingState: ScopingState = {
				description,
				isQuick,
				conversationHistory: [],
			};

			// Enter scoping mode
			enterScopingMode(cwd, projectConfig, scopingState);

			// Show scoping widget
			updateModeWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				"SCOPING MODE",
				"The agent will explore the codebase and ask questions to assess the right planning level.",
				"🔎"
			), "info");
			ctx.ui.notify("Chat naturally to help the agent understand the scope. It will recommend Roadmap, Epic, or Feature.", "info");
			ctx.ui.notify("Type /plan-done when ready to proceed with the recommendation.", "info");

			// Send the initial scoping message
			pi.sendUserMessage(
				`I want to build the following: ${description}\n\n` +
				`Please explore the codebase and assess what level of planning this needs ` +
				`(roadmap for large multi-epic initiatives, epic for medium multi-feature efforts, or feature for a single spec). ` +
				`Ask me scoping questions if needed.`
			);
		},
	});

	pi.registerCommand("plan-done", {
		description: "End scoping assessment and proceed with the recommended level",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "scoping" || !activeScopingState || !activeCwd || !activeProjectConfig) {
				ctx.ui.notify("No active scoping session. Use /plan to start one.", "error");
				return;
			}

			const scopingState = activeScopingState;
			const cwd = activeCwd;
			const projectConfig = activeProjectConfig;
			const scopingExchanges = exchangeCount;

			if (scopingExchanges === 0) {
				const proceed = await ctx.ui.confirm(
					"No Scoping Exchanges",
					"No conversation exchanges recorded yet. Proceed anyway?"
				);
				if (!proceed) return;
			}

			// Parse the recommended level from the conversation
			const recommendedLevel = parseRecommendedLevel(scopingState);

			// Build scoping summary for forwarding to child pipeline
			const scopingSummary = buildScopingSummary(scopingState);
			const description = scopingState.description;
			const isQuick = scopingState.isQuick;

			// Exit scoping mode
			exitMode();
			clearPipelineWidget(ctx);

			ctx.ui.notify(formatStepBanner(
				"SCOPING COMPLETE",
				`${scopingExchanges} exchange${scopingExchanges !== 1 ? "s" : ""} recorded.`,
				"✅"
			), "success");

			// Present recommendation or let user choose
			let chosenLevel: HierarchyLevel;

			if (recommendedLevel) {
				const levelLabels: Record<HierarchyLevel, string> = {
					roadmap: "Roadmap (large initiative → multiple epics)",
					epic: "Epic (medium effort → multiple feature specs)",
					feature: "Feature (single spec → direct implementation)",
				};

				const confirmed = await ctx.ui.confirm(
					"Scoping Recommendation",
					`The agent recommends: **${levelLabels[recommendedLevel]}**\n\nAccept this recommendation?`
				);

				if (confirmed) {
					chosenLevel = recommendedLevel;
				} else {
					// Let user override
					const levelChoices = [
						"Roadmap (large initiative → multiple epics, months of work)",
						"Epic (medium effort → multiple feature specs, weeks of work)",
						"Feature (single spec → direct implementation, days of work)",
					];

					const choice = await ctx.ui.select(
						"Override: Select the planning level",
						levelChoices
					);

					if (choice === levelChoices[0]) {
						chosenLevel = "roadmap";
					} else if (choice === levelChoices[1]) {
						chosenLevel = "epic";
					} else {
						chosenLevel = "feature";
					}
				}
			} else {
				// No recommendation found — let user choose
				ctx.ui.notify("The agent didn't provide a clear recommendation. Please choose a level.", "warning");

				const levelChoices = [
					"Roadmap (large initiative → multiple epics, months of work)",
					"Epic (medium effort → multiple feature specs, weeks of work)",
					"Feature (single spec → direct implementation, days of work)",
				];

				const choice = await ctx.ui.select(
					"Select the planning level",
					levelChoices
				);

				if (choice === levelChoices[0]) {
					chosenLevel = "roadmap";
				} else if (choice === levelChoices[1]) {
					chosenLevel = "epic";
				} else {
					chosenLevel = "feature";
				}
			}

			const levelLabel = chosenLevel.charAt(0).toUpperCase() + chosenLevel.slice(1);
			ctx.ui.notify(`Selected: ${levelLabel} level. Starting pipeline...`, "info");

			// Route to the appropriate pipeline, forwarding scoping context
			if (chosenLevel === "feature") {
				// Store scoping context so the next /spec invocation picks it up
				if (scopingSummary) {
					pendingScopingContext = scopingSummary;
				}
				ctx.ui.notify(`Run:\n  /spec ${isQuick ? "--quick " : ""}${description}`, "info");
				if (scopingSummary) {
					ctx.ui.notify("✅ Scoping context saved — it will be automatically included when you run /spec.", "info");
				}
			} else {
				await startHierarchyPipeline(chosenLevel, description, isQuick, ctx, undefined, undefined, scopingSummary);
			}
		},
	});

	pi.registerCommand("plan-cancel", {
		description: "Cancel an active scoping session",
		handler: async (_args, ctx) => {
			if (pipelineMode !== "scoping") {
				ctx.ui.notify("No active scoping session to cancel.", "info");
				return;
			}

			exitMode();
			clearPipelineWidget(ctx);
			ctx.ui.notify("Scoping session cancelled.", "info");
		},
	});

	// ---- /roadmap commands ----

	pi.registerCommand("roadmap", {
		description: "Create a roadmap (high-level initiative → epics). Use --quick to skip discovery.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const isQuick = argsStr.includes("--quick");
			const description = argsStr.replace("--quick", "").replace(/\s+/g, " ").trim();

			if (!description) {
				ctx.ui.notify("Usage: /roadmap [--quick] <description>", "error");
				return;
			}

			// Check for existing active roadmap
			const cwd = ctx.cwd;
			const existingPipeline = getLatestActiveRoadmapPipeline(cwd);
			if (existingPipeline) {
				const resume = await ctx.ui.confirm(
					"Active Roadmap Found",
					`There's an active roadmap:\n${formatRoadmapState(existingPipeline)}\n\nStart a NEW roadmap? (No = cancel)`
				);
				if (!resume) {
					ctx.ui.notify("Use /roadmap-resume to continue the existing roadmap", "info");
					return;
				}
			}

			await startHierarchyPipeline("roadmap", description, isQuick, ctx);
		},
	});

	pi.registerCommand("roadmap-resume", {
		description: "Resume an active roadmap pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}
			await resumeHierarchyPipeline("roadmap", (args || "").trim() || undefined, ctx);
		},
	});

	pi.registerCommand("roadmap-status", {
		description: "Show roadmap status with hierarchical progress",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: RoadmapState | null;
			if (pipelineId) {
				state = loadRoadmapState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Roadmap not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveRoadmapPipeline(cwd);
				if (!state) {
					const states = listRoadmapStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No roadmaps found. Use /roadmap to start one.", "info");
						return;
					}
					state = states[0];
				}
			}

			ctx.ui.notify(formatRoadmapState(state), "info");

			// Show child epic statuses
			if (state.children.length > 0) {
				for (const child of state.children) {
					if (child.childPipelineId) {
						const epicState = loadEpicState(cwd, child.childPipelineId);
						if (epicState) {
							child.childStatus = epicState.stage === "completed" ? "completed"
								: epicState.stage === "cancelled" ? "cancelled"
								: "in_progress";
						}
					}
				}
				// Re-display with updated statuses
				saveRoadmapState(cwd, state);
			}
		},
	});

	pi.registerCommand("roadmap-list", {
		description: "List all roadmaps",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listRoadmapStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No roadmaps found. Use /roadmap to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  🗺️ Roadmaps (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				let statusIcon = "  ";
				if (state.stage === "completed") statusIcon = "✅";
				else if (state.stage === "cancelled") statusIcon = "🚫";
				else if (state.lastError) statusIcon = "❌";
				else statusIcon = "▶️";

				lines.push(`${statusIcon} ${state.id || "unknown"}`);
				const desc = state.description || "(no description)";
				lines.push(`   ${desc.slice(0, 55)}${desc.length > 55 ? "..." : ""}`);
				lines.push(`   Stage: ${formatHierarchyStage(state.stage)}`);
				if (state.children.length > 0) {
					const completed = state.children.filter(c => c.childStatus === "completed").length;
					lines.push(`   Children: ${completed}/${state.children.length} completed`);
				}
				lines.push(`   Updated: ${state.updatedAt}`);
				lines.push("");
			}

			lines.push(formatDivider(60));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("roadmap-cancel", {
		description: "Cancel an active roadmap pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: RoadmapState | null;
			if (pipelineId) {
				state = loadRoadmapState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Roadmap not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveRoadmapPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active roadmap to cancel.", "info");
					return;
				}
			}

			if (state.stage === "completed" || state.stage === "cancelled") {
				ctx.ui.notify("Roadmap is already finished.", "info");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Cancel Roadmap?",
				`Cancel roadmap ${state.id}?\n\nYou can resume later with /roadmap-resume.`
			);

			if (confirm) {
				if (state.stage !== "cancelled") {
					state.stageBeforeCancellation = state.stage;
				}
				state.stage = "cancelled";
				saveRoadmapState(cwd, state);

				// Clean up conversational mode if active
				if (pipelineMode !== "idle" && activePipelineState?.id === state.id) {
					exitMode();
				}

				clearPipelineWidget(ctx);
				ctx.ui.notify("Roadmap cancelled. Resume with /roadmap-resume", "info");
			}
		},
	});

	// ---- /epic commands ----

	pi.registerCommand("epic", {
		description: "Create an epic (medium effort → feature specs). Use --quick to skip discovery, --roadmap <id> to link to a roadmap.",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const argsStr = args || "";
			const isQuick = argsStr.includes("--quick");

			// Extract --roadmap <id> flag
			let parentId: string | undefined;
			const roadmapMatch = argsStr.match(/--roadmap\s+(\S+)/);
			if (roadmapMatch) {
				parentId = roadmapMatch[1];
			}

			const description = argsStr
				.replace("--quick", "")
				.replace(/--roadmap\s+\S+/, "")
				.replace(/\s+/g, " ")
				.trim();

			if (!description) {
				ctx.ui.notify("Usage: /epic [--quick] [--roadmap <id>] <description>", "error");
				return;
			}

			// Check for existing active epic
			const cwd = ctx.cwd;
			const existingPipeline = getLatestActiveEpicPipeline(cwd);
			if (existingPipeline) {
				const resume = await ctx.ui.confirm(
					"Active Epic Found",
					`There's an active epic:\n${formatEpicState(existingPipeline)}\n\nStart a NEW epic? (No = cancel)`
				);
				if (!resume) {
					ctx.ui.notify("Use /epic-resume to continue the existing epic", "info");
					return;
				}
			}

			// Validate parent if specified
			if (parentId) {
				const parentState = loadRoadmapState(cwd, parentId);
				if (!parentState) {
					ctx.ui.notify(`Parent roadmap not found: ${parentId}`, "error");
					return;
				}
				if (!parentState.docApproved) {
					ctx.ui.notify("Parent roadmap has not been approved yet.", "error");
					return;
				}
			}

			await startHierarchyPipeline("epic", description, isQuick, ctx, parentId, parentId ? "roadmap" : undefined);
		},
	});

	pi.registerCommand("epic-resume", {
		description: "Resume an active epic pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}
			await resumeHierarchyPipeline("epic", (args || "").trim() || undefined, ctx);
		},
	});

	pi.registerCommand("epic-status", {
		description: "Show epic status with hierarchical progress",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: EpicState | null;
			if (pipelineId) {
				state = loadEpicState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Epic not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveEpicPipeline(cwd);
				if (!state) {
					const states = listEpicStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No epics found. Use /epic to start one.", "info");
						return;
					}
					state = states[0];
				}
			}

			ctx.ui.notify(formatEpicState(state), "info");

			// Show child spec statuses
			if (state.children.length > 0) {
				for (const child of state.children) {
					if (child.childPipelineId) {
						const specState = loadSpecState(cwd, child.childPipelineId);
						if (specState) {
							child.childStatus = specState.stage === "completed" ? "completed"
								: specState.stage === "cancelled" ? "cancelled"
								: "in_progress";
						}
					}
				}
				saveEpicState(cwd, state);
			}
		},
	});

	pi.registerCommand("epic-list", {
		description: "List all epics",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listEpicStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No epics found. Use /epic to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  📋 Epics (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				let statusIcon = "  ";
				if (state.stage === "completed") statusIcon = "✅";
				else if (state.stage === "cancelled") statusIcon = "🚫";
				else if (state.lastError) statusIcon = "❌";
				else statusIcon = "▶️";

				lines.push(`${statusIcon} ${state.id || "unknown"}`);
				const desc = state.description || "(no description)";
				lines.push(`   ${desc.slice(0, 55)}${desc.length > 55 ? "..." : ""}`);
				lines.push(`   Stage: ${formatHierarchyStage(state.stage)}`);
				if (state.parentId) lines.push(`   Parent: ${state.parentType}:${state.parentId}`);
				if (state.children.length > 0) {
					const completed = state.children.filter(c => c.childStatus === "completed").length;
					lines.push(`   Children: ${completed}/${state.children.length} completed`);
				}
				lines.push(`   Updated: ${state.updatedAt}`);
				lines.push("");
			}

			lines.push(formatDivider(60));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("epic-cancel", {
		description: "Cancel an active epic pipeline",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("spec-pipeline requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd;
			const pipelineId = (args || "").trim();

			let state: EpicState | null;
			if (pipelineId) {
				state = loadEpicState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Epic not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActiveEpicPipeline(cwd);
				if (!state) {
					ctx.ui.notify("No active epic to cancel.", "info");
					return;
				}
			}

			if (state.stage === "completed" || state.stage === "cancelled") {
				ctx.ui.notify("Epic is already finished.", "info");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Cancel Epic?",
				`Cancel epic ${state.id}?\n\nYou can resume later with /epic-resume.`
			);

			if (confirm) {
				if (state.stage !== "cancelled") {
					state.stageBeforeCancellation = state.stage;
				}
				state.stage = "cancelled";
				saveEpicState(cwd, state);

				// Clean up conversational mode if active
				if (pipelineMode !== "idle" && activePipelineState?.id === state.id) {
					exitMode();
				}

				clearPipelineWidget(ctx);
				ctx.ui.notify("Epic cancelled. Resume with /epic-resume", "info");
			}
		},
	});

	// ---- /plan-overview command ----

	pi.registerCommand("plan-overview", {
		description: "Show full hierarchy tree from any level. Usage: /plan-overview [id]",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const targetId = (args || "").trim();

			const lines: string[] = [];
			lines.push(formatDivider(65));
			lines.push("  🌳 Plan Overview — Hierarchical Work Tree");
			lines.push(formatDivider(65));
			lines.push("");

			const roadmaps = listRoadmapStates(cwd);
			const epics = listEpicStates(cwd);
			const specs = listSpecStates(cwd);

			// If a specific ID was given, find it and show its tree
			if (targetId) {
				// Check if it's a roadmap
				const roadmap = loadRoadmapState(cwd, targetId);
				if (roadmap) {
					renderRoadmapTree(lines, roadmap, cwd);
					lines.push("");
					lines.push(formatDivider(65));
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				// Check if it's an epic
				const epic = loadEpicState(cwd, targetId);
				if (epic) {
					// If epic has a parent roadmap, show from there
					if (epic.parentId) {
						const parentRoadmap = loadRoadmapState(cwd, epic.parentId);
						if (parentRoadmap) {
							renderRoadmapTree(lines, parentRoadmap, cwd);
							lines.push("");
							lines.push(formatDivider(65));
							ctx.ui.notify(lines.join("\n"), "info");
							return;
						}
					}
					// Show standalone epic tree
					renderEpicTree(lines, epic, cwd, "");
					lines.push("");
					lines.push(formatDivider(65));
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				// Check if it's a spec
				const spec = loadSpecState(cwd, targetId);
				if (spec) {
					lines.push(`  📄 Feature: ${spec.description?.slice(0, 50) || "(no description)"}`);
					lines.push(`     Stage: ${formatSpecStage(spec.stage)}`);
					lines.push(`     Spec: ${spec.specPath}`);
					lines.push("");
					lines.push(formatDivider(65));
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				ctx.ui.notify(`No pipeline found with ID: ${targetId}`, "error");
				return;
			}

			// No ID specified — show all hierarchies
			if (roadmaps.length === 0 && epics.length === 0 && specs.length === 0) {
				ctx.ui.notify("No pipelines found. Use /plan, /roadmap, /epic, or /spec to get started.", "info");
				return;
			}

			// Show roadmaps and their children
			for (const roadmap of roadmaps) {
				renderRoadmapTree(lines, roadmap, cwd);
				lines.push("");
			}

			// Show standalone epics (not under a roadmap)
			const standaloneEpics = epics.filter(e => !e.parentId);
			for (const epic of standaloneEpics) {
				renderEpicTree(lines, epic, cwd, "");
				lines.push("");
			}

			// Show standalone specs (not under an epic)
			const epicChildSpecIds = new Set<string>();
			for (const epic of epics) {
				for (const child of epic.children) {
					if (child.childPipelineId) epicChildSpecIds.add(child.childPipelineId);
				}
			}
			const standaloneSpecs = specs.filter(s => !epicChildSpecIds.has(s.id));
			if (standaloneSpecs.length > 0) {
				lines.push("  📄 Standalone Features:");
				for (const spec of standaloneSpecs.slice(0, 10)) {
					const stageIcon = spec.stage === "completed" ? "✅" : spec.stage === "cancelled" ? "🚫" : "▶️";
					lines.push(`     ${stageIcon} ${spec.description?.slice(0, 45) || spec.id} (${formatSpecStage(spec.stage)})`);
				}
				if (standaloneSpecs.length > 10) {
					lines.push(`     ... and ${standaloneSpecs.length - 10} more`);
				}
				lines.push("");
			}

			lines.push(formatDivider(65));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	/** Helper: render a roadmap tree into lines */
	function renderRoadmapTree(lines: string[], roadmap: RoadmapState, cwd: string): void {
		const stageIcon = roadmap.stage === "completed" ? "✅" : roadmap.stage === "cancelled" ? "🚫" : "▶️";
		lines.push(`  ${stageIcon} 🗺️ Roadmap: ${roadmap.description?.slice(0, 45) || roadmap.id}`);
		lines.push(`     Stage: ${formatHierarchyStage(roadmap.stage)} | ID: ${roadmap.id}`);

		if (roadmap.children.length > 0) {
			for (let i = 0; i < roadmap.children.length; i++) {
				const child = roadmap.children[i];
				const isLast = i === roadmap.children.length - 1;
				const prefix = isLast ? "  └── " : "  ├── ";
				const childPrefix = isLast ? "      " : "  │   ";

				if (child.childPipelineId) {
					const epicState = loadEpicState(cwd, child.childPipelineId);
					if (epicState) {
						// Update status
						child.childStatus = epicState.stage === "completed" ? "completed"
							: epicState.stage === "cancelled" ? "cancelled"
							: (epicState.stage !== "approved" && epicState.stage !== "in_progress") ? "pending" : "in_progress";

						const epicIcon = child.childStatus === "completed" ? "✅"
							: child.childStatus === "in_progress" ? "🔄"
							: child.childStatus === "cancelled" ? "🚫"
							: "⬜";
						lines.push(`${prefix}${epicIcon} ${child.number}. ${child.name} [${child.priority}]`);
						renderEpicTree(lines, epicState, cwd, childPrefix);
						continue;
					}
				}

				// Child not yet created
				const deps = child.dependencies.length > 0 ? ` (deps: ${child.dependencies.join(", ")})` : "";
				lines.push(`${prefix}⬜ ${child.number}. ${child.name} [${child.priority}]${deps} — not started`);
			}
		}
	}

	/** Helper: render an epic tree into lines */
	function renderEpicTree(lines: string[], epic: EpicState, cwd: string, indent: string): void {
		if (!indent) {
			const stageIcon = epic.stage === "completed" ? "✅" : epic.stage === "cancelled" ? "🚫" : "▶️";
			lines.push(`  ${stageIcon} 📋 Epic: ${epic.description?.slice(0, 45) || epic.id}`);
			lines.push(`     Stage: ${formatHierarchyStage(epic.stage)} | ID: ${epic.id}`);
			indent = "  ";
		}

		if (epic.children.length > 0) {
			for (let i = 0; i < epic.children.length; i++) {
				const child = epic.children[i];
				const isLast = i === epic.children.length - 1;
				const prefix = `${indent}${isLast ? "└── " : "├── "}`;

				if (child.childPipelineId) {
					const specState = loadSpecState(cwd, child.childPipelineId);
					if (specState) {
						child.childStatus = specState.stage === "completed" ? "completed"
							: specState.stage === "cancelled" ? "cancelled"
							: "in_progress";
						const specIcon = child.childStatus === "completed" ? "✅"
							: child.childStatus === "in_progress" ? "🔄"
							: child.childStatus === "cancelled" ? "🚫"
							: "⬜";
						lines.push(`${prefix}${specIcon} ${child.number}. ${child.name} [${child.priority}]`);
						continue;
					}
				}

				const deps = child.dependencies.length > 0 ? ` (deps: ${child.dependencies.join(", ")})` : "";
				lines.push(`${prefix}⬜ ${child.number}. ${child.name} [${child.priority}]${deps} — not started`);
			}
		}
	}

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
			const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
			
			const result = await runAgent(
				params.agent as "opus" | "sonnet" | "haiku",
				params.task,
				ctx.cwd,
				SYSTEM_PROMPTS[params.role as keyof typeof SYSTEM_PROMPTS],
				signal,
				(event) => {
					// Handle different event types from Phase 1 changes
					let text = "";
					if (typeof event === "string") {
						text = event;
					} else if (event.type === "text") {
						text = event.delta;
					}
					// Ignore tool events for now (Phase 2 handles these with createProgressCallback)
					
					if (text) {
						onUpdate?.({
							content: [{ type: "text", text }],
							details: {},
						});
					}
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
