/**
 * Commit message generation with retry and fallback
 */

import { runAgentWithConfig } from "./agents.ts";
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
	/** Cycle number (1-indexed) if in implementation stage */
	cycle?: number;
	/** Review feedback that was addressed (if applicable) */
	reviewFeedback?: string;
}

/**
 * Result type for commit message generation
 * 
 * @example Success case
 * { type: "success", message: "feat(api): add user endpoint" }
 * 
 * @example Fallback case (after all retries exhausted)
 * { type: "fallback", message: "[FALLBACK] After implementer - Phase 1, Cycle 1 - 3 files modified" }
 */
export type CommitMessageResult = 
	| { type: "success"; message: string }
	| { type: "fallback"; message: string };

// ============================================
// Retry Configuration
// ============================================

const RETRY_ATTEMPTS = 3; // 1 initial + 2 retries
const INITIAL_DELAY_MS = 1000; // 1 second
const BACKOFF_MULTIPLIER = 2;

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Commit Message Generation
// ============================================

/**
 * Build the system prompt for commit message generation
 */
function buildCommitMessagePrompt(context: CommitMessageContext): string {
	const lines: string[] = [
		"# Commit Message Generation",
		"",
		"You are a commit message generator. Your task is to create a clear, concise commit message that describes the work that was just completed.",
		"",
		"## Guidelines",
		"",
		"- Use conventional commit format: `type(scope): subject`",
		"- Types: feat, fix, docs, refactor, test, chore, style, perf",
		"- Subject should be imperative mood (e.g., \"add feature\" not \"added feature\")",
		"- Keep the subject line under 72 characters",
		"- Include a body if needed to explain the changes",
		"- Be specific about what changed, not just that an agent ran",
		"",
		"## Output Format",
		"",
		"Return ONLY the commit message in a code block. Do not include explanations or commentary outside the code block.",
		"",
		"Example:",
		"```",
		"feat(auth): implement JWT token validation",
		"",
		"- Add middleware to verify JWT tokens",
		"- Create helper functions for token parsing",
		"- Add error handling for expired tokens",
		"```",
	];

	return lines.join("\n");
}

/**
 * Build the task description for commit message generation
 */
function buildCommitMessageTask(context: CommitMessageContext): string {
	const lines: string[] = [];
	
	// Agent and model information
	lines.push(`## Agent Information`);
	lines.push(``);
	lines.push(`- **Role**: ${context.role}`);
	lines.push(`- **Model**: ${context.modelConfig.model} (thinking: ${context.modelConfig.thinking})`);
	lines.push(``);
	
	// Phase and cycle information (if applicable)
	if (context.phase !== undefined) {
		lines.push(`## Phase Information`);
		lines.push(``);
		lines.push(`- **Phase**: ${context.phase}`);
		if (context.cycle !== undefined) {
			lines.push(`- **Cycle**: ${context.cycle}`);
		}
		lines.push(``);
	}
	
	// Modified files
	lines.push(`## Modified Files`);
	lines.push(``);
	if (context.files.length === 0) {
		lines.push(`No files were modified.`);
	} else {
		lines.push(`The following ${context.files.length} file(s) were modified:`);
		lines.push(``);
		for (const file of context.files) {
			lines.push(`- ${file}`);
		}
	}
	lines.push(``);
	
	// Review feedback (if applicable)
	if (context.reviewFeedback) {
		lines.push(`## Review Feedback Addressed`);
		lines.push(``);
		lines.push(context.reviewFeedback);
		lines.push(``);
	}
	
	// Task instruction
	lines.push(`## Task`);
	lines.push(``);
	lines.push(`Based on the information above, generate a commit message that describes the work that was completed.`);
	
	if (context.reviewFeedback) {
		lines.push(`Focus on the changes made to address the review feedback.`);
	} else {
		lines.push(`Focus on what was implemented, created, or modified.`);
	}
	
	return lines.join("\n");
}

/**
 * Generate a fallback commit message (R7)
 */
function generateFallbackMessage(context: CommitMessageContext): string {
	const parts: string[] = ["[FALLBACK] After", context.role];
	
	if (context.phase !== undefined) {
		if (context.cycle !== undefined) {
			parts.push(`- Phase ${context.phase}, Cycle ${context.cycle}`);
		} else {
			parts.push(`- Phase ${context.phase}`);
		}
	}
	
	parts.push(`- ${context.files.length} files modified`);
	
	return parts.join(" ");
}

/**
 * Generate a commit message using the configured agent with retry and fallback (R7)
 * 
 * This function:
 * 1. Attempts to generate a commit message using the agentCommitMessageWriter
 * 2. Retries up to 3 times with exponential backoff (1s, 2s)
 * 3. Falls back to a structured message if all retries fail
 * 
 * @param context - Context about the agent work and changes
 * @param agentConfig - Model configuration for the commit message writer
 * @param cwd - Working directory
 * @returns Result with type "success" or "fallback"
 */
export async function generateCommitMessage(
	context: CommitMessageContext,
	agentConfig: ModelConfig,
	cwd: string
): Promise<CommitMessageResult> {
	const systemPrompt = buildCommitMessagePrompt(context);
	const task = buildCommitMessageTask(context);
	
	let lastError: string | undefined;
	
	// Retry loop: 1 initial attempt + 2 retries = 3 total
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
		// Apply exponential backoff delay (skip on first attempt)
		if (attempt > 0) {
			const delayMs = INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
			await sleep(delayMs);
		}
		
		try {
			const result = await runAgentWithConfig(
				agentConfig,
				task,
				cwd,
				systemPrompt,
				undefined, // no abort signal
				undefined, // no output callback
				"commitMessageWriter" // role for tool restrictions
			);
			
			// Check if agent succeeded
			if (result.exitCode === 0 && result.output.trim()) {
				// Extract message from code block if present
				let message = result.output.trim();
				const codeBlockMatch = message.match(/```(?:\w+)?\n([\s\S]*?)```/);
				if (codeBlockMatch) {
					message = codeBlockMatch[1].trim();
				}
				return {
					type: "success",
					message,
				};
			}
			
			// Agent failed or returned empty output
			lastError = result.error || "Agent returned empty output";
		} catch (error) {
			// Unexpected error (e.g., spawn failure)
			lastError = error instanceof Error ? error.message : "Unknown error";
		}
	}
	
	// All retries exhausted - use fallback
	console.error(`[spec-pipeline] Commit message generation failed after ${RETRY_ATTEMPTS} attempts. Last error: ${lastError}`);
	return {
		type: "fallback",
		message: generateFallbackMessage(context),
	};
}
