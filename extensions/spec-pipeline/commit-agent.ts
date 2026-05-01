/**
 * Commit message generation using the configured model via the pi SDK for better context-aware messages.
 * 
 * Uses a minimal SDK session with NO tools so the model just generates text
 * without trying to read files or run commands.
 */

import type { ModelConfig, RoleName } from "./types.ts";

// ============================================
// Types
// ============================================

/**
 * Context for commit message generation
 */
export interface CommitMessageContext {
	/** The role that performed the work (e.g., "specDrafter", "implementer") */
	role: RoleName;
	/** The model configuration that was used */
	modelConfig: ModelConfig;
	/** Files that were modified by the agent */
	files: string[];
	/** Phase number (1-indexed) if in implementation stage */
	phase?: number;
	/** Phase name/description extracted from the phase file path */
	phaseName?: string;
	/** Document name for roadmap/epic (e.g., "warm pools", "user auth") */
	docName?: string;
	/** Cycle number (1-indexed) if in implementation stage */
	cycle?: number;
	/** Review feedback that was addressed (if applicable) */
	reviewFeedback?: string;
	/** The staged git diff showing actual changes */
	diff?: string;
}

/**
 * Result type for commit message generation
 * 
 * Always returns type "success" since generation is now deterministic.
 * The "fallback" type is retained for backward compatibility but never produced.
 * 
 * @example
 * { type: "success", message: "feat(phase-1): implement backend API endpoints" }
 */
export type CommitMessageResult = 
	| { type: "success"; message: string }
	| { type: "fallback"; message: string };

// ============================================
// Deterministic Message Templates
// ============================================

/** Maximum number of files to list in commit body */
const MAX_FILES_IN_BODY = 20;

/**
 * Extract phase name from a phase path
 * Phase paths look like: "20250209_myproject/phase1_backend_api.md"
 * This extracts "backend_api" from the filename
 */
export function extractPhaseName(phasePath: string): string | undefined {
	// Get just the filename
	const filename = phasePath.split("/").pop();
	if (!filename) return undefined;
	
	// Match pattern: phaseN_name.md
	const match = filename.match(/^phase\d+_(.+)\.md$/);
	if (!match) return undefined;
	
	// Convert underscores to spaces for readability
	return match[1].replace(/_/g, " ");
}

/**
 * Extract document name from spec/roadmap/epic filename
 * Filenames look like: 
 *   - "20250209_spec_user_auth.md"
 *   - "2602071200_roadmap_warm_pools.md"
 *   - "2602071200_epic_user_auth.md"
 * This extracts "user_auth", "warm_pools", etc. and converts to "user auth", "warm pools", etc.
 */
export function extractDocName(filename: string): string | undefined {
	// Get just the filename (in case a path was passed)
	const name = filename.split("/").pop();
	if (!name) return undefined;
	
	// Match pattern: TIMESTAMP_TYPE_name.ext where TYPE is spec, roadmap, epic, discovery, etc.
	const match = name.match(/^\d+_(?:spec|roadmap|epic|discovery|brainstorm|fix|guide)_(.+)\.(md|typ)$/);
	if (!match) return undefined;
	
	// Convert underscores to spaces for readability
	return match[1].replace(/_/g, " ");
}

/**
 * Generate a short scope string from a phase number and optional name.
 * Only used for deterministic fallback messages.
 */
function phaseScope(phase?: number, phaseName?: string): string {
	if (phase === undefined) return "pipeline";
	if (phaseName) {
		// Use phase name if available, truncate if too long
		const name = phaseName.length > 30 ? phaseName.slice(0, 27) + "..." : phaseName;
		return `phase-${phase}/${name}`;
	}
	return `phase-${phase}`;
}

/**
 * Build the commit body listing modified files
 */
function buildFileListBody(files: string[]): string {
	if (files.length === 0) return "";
	
	const lines: string[] = [""];
	if (files.length <= MAX_FILES_IN_BODY) {
		for (const file of files) {
			lines.push(`- ${file}`);
		}
	} else {
		for (const file of files.slice(0, MAX_FILES_IN_BODY)) {
			lines.push(`- ${file}`);
		}
		lines.push(`- ... and ${files.length - MAX_FILES_IN_BODY} more files`);
	}
	return lines.join("\n");
}

/**
 * Generate a fallback commit message based on the agent context.
 * Used when model generation fails or times out.
 */
function generateFallbackMessage(context: CommitMessageContext): string {
	const { role, files, phase, phaseName, cycle } = context;
	const scope = phaseScope(phase, phaseName);
	const body = buildFileListBody(files);
	
	let subject: string;
	
	switch (role) {
		case "brainstormAgent":
			subject = `docs(${scope}): capture brainstorm session`;
			break;
		
		case "planDrafter":
			subject = `docs(${scope}): create implementation plan`;
			break;
		
		case "implementer":
			subject = `feat(${scope}): implement phase changes`;
			break;
		
		case "addressReview":
			if (cycle !== undefined) {
				subject = `fix(${scope}): address review feedback (cycle ${cycle})`;
			} else {
				subject = `fix(${scope}): address review feedback`;
			}
			break;
		
		case "planReviewer":
			subject = `docs(${scope}): revise plan after review`;
			break;
		
		case "codeReviewer":
			subject = `refactor(${scope}): apply code review changes`;
			break;
		
		default:
			subject = `chore(${scope}): ${role} changes`;
			break;
	}
	
	return body ? `${subject}\n${body}` : subject;
}

/**
 * Build a prompt to generate a contextual commit message
 */
function buildCommitPrompt(context: CommitMessageContext): string {
	const { role, files, phase, phaseName, docName, cycle, reviewFeedback, diff } = context;
	
	const parts: string[] = [
		"Generate a concise git commit message following conventional commits format.",
		"The message MUST accurately describe the actual changes shown in the diff below.",
		"Do NOT invent or hallucinate functionality that is not in the diff.",
		"",
		"Context:",
	];
	
	// Add role context
	switch (role) {
		case "brainstormAgent":
			parts.push("- Role: Capturing brainstorm session");
			parts.push("- Action: Wrote brainstorm document synthesizing exploratory discussion");
			break;
		case "planDrafter":
			parts.push(`- Role: Planning phase ${phase ?? 'N/A'}${phaseName ? ` (${phaseName})` : ''}`);
			parts.push("- Action: Created an implementation plan document");
			break;
		case "implementer":
			parts.push(`- Role: Implementing phase ${phase ?? 'N/A'}${phaseName ? ` (${phaseName})` : ''}`);
			parts.push("- Action: Implemented code changes based on the plan");
			break;
		case "addressReview":
			parts.push(`- Role: Addressing code review feedback${cycle ? ` (cycle ${cycle})` : ''}`);
			if (reviewFeedback) {
				parts.push(`- Feedback: ${reviewFeedback.slice(0, 200)}${reviewFeedback.length > 200 ? '...' : ''}`);
			}
			break;
		case "planReviewer":
			parts.push(`- Role: Revising plan after review`);
			break;
		case "codeReviewer":
			parts.push(`- Role: Applying code review suggestions`);
			break;
	}
	
	// Add document context if available
	if (docName) {
		parts.push(`- Document: ${docName}`);
	}
	
	// Add files context
	parts.push("", "Files modified:");
	if (files.length === 0) {
		parts.push("- (no files)");
	} else if (files.length <= 10) {
		files.forEach(f => parts.push(`- ${f}`));
	} else {
		files.slice(0, 10).forEach(f => parts.push(`- ${f}`));
		parts.push(`- ... and ${files.length - 10} more files`);
	}
	
	// Add the actual diff - this is critical for accurate commit messages
	if (diff) {
		parts.push("");
		parts.push("Git diff of staged changes:");
		parts.push("```");
		parts.push(diff);
		parts.push("```");
	}
	
	parts.push("");
	parts.push("Requirements:");
	parts.push("- Use conventional commits format: <type>(<scope>): <subject>");
	parts.push("- Type must be one of: feat, fix, docs, refactor, test, chore");
	if (docName) {
		parts.push(`- Scope MUST be: ${docName}`);
	} else {
		parts.push("- Scope should be a short, meaningful word or two derived from what was actually changed (e.g., 'billing', 'auth', 'api', 'jobs')");
	}
	parts.push("- Subject line MUST accurately reflect what the diff actually changes");
	parts.push("- Subject must be lowercase and under 72 characters");
	parts.push("- Subject should describe WHAT was done based on the diff content");
	parts.push("- Do NOT include a body with file list");
	parts.push("- Output ONLY the commit message, nothing else");
	
	return parts.join("\n");
}

/**
 * Generate a commit message using the configured commit-message model via the pi SDK.
 * Uses a minimal session with NO tools for fast text-only generation.
 * Falls back to template-based message if model generation fails.
 * 
 * @param context - Context about the agent work and changes
 * @param _agentConfig - Unused, retained for backward compatibility
 * @param _cwd - Unused, retained for backward compatibility
 * @returns Result with generated message and whether fallback was used
 */
export async function generateCommitMessage(
	context: CommitMessageContext,
	agentConfig?: ModelConfig,
	_cwd?: string
): Promise<CommitMessageResult> {
	try {
		const prompt = buildCommitPrompt(context);
		const configuredModel = agentConfig?.model ?? context.modelConfig.model;
		const configuredThinking = agentConfig?.thinking ?? context.modelConfig.thinking;
		const provider = configuredModel.startsWith("gpt-") ? "openai" : "anthropic";
		
		// Dynamically import the SDK to avoid circular dependencies
		const { createAgentSession, SessionManager, SettingsManager } = await import("@mariozechner/pi-coding-agent");
		const { getModel } = await import("@mariozechner/pi-ai");
		
		const model = getModel(provider, configuredModel);
		if (!model) {
			return { type: "fallback", message: generateFallbackMessage(context) };
		}
		
		// Create session with no tools and in-memory storage
		const { session } = await createAgentSession({
			model,
			thinkingLevel: configuredThinking,
			tools: [],              // NO tools — just text generation
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: false },
			}),
		});
		
		// Collect output
		let output = "";
		session.subscribe((event: any) => {
			if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
				output += event.assistantMessageEvent.delta;
			}
		});
		
		// Run with a timeout
		const timeoutPromise = new Promise<void>((_, reject) => 
			setTimeout(() => reject(new Error("timeout")), 10000)
		);
		
		await Promise.race([
			session.prompt(prompt),
			timeoutPromise,
		]);
		
		session.dispose();
		
		// Process output
		let message = output.trim();
		
		if (process.env.DEBUG_COMMIT_MESSAGES) {
			console.error("Commit message model output:", JSON.stringify(message));
		}
		
		// Remove markdown code blocks if present
		const codeBlockMatch = message.match(/```(?:\w*\n)?([\s\S]*?)```/);
		if (codeBlockMatch) {
			message = codeBlockMatch[1].trim();
		}
		
		// Validate it looks like a conventional commit
		if (message.match(/^(feat|fix|docs|refactor|test|chore)\([^)]+\):/)) {
			// Take only the first line as the subject
			const firstLine = message.split("\n")[0].trim();
			return { type: "success", message: firstLine };
		}
		
		// If output didn't look valid, use fallback
		return { type: "fallback", message: generateFallbackMessage(context) };
		
	} catch (error) {
		// On any error, use fallback
		if (process.env.DEBUG_COMMIT_MESSAGES) {
			console.error("Commit message model error:", error);
		}
		return { type: "fallback", message: generateFallbackMessage(context) };
	}
}
