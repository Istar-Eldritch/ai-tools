/**
 * Commit message generation — deterministic template-based approach
 * 
 * Previously this spawned a pi subprocess with Haiku for each commit message.
 * Now it generates messages deterministically from context, eliminating 5-10+
 * subprocess spawns per phase.
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
	
	// Match pattern: TIMESTAMP_TYPE_name.ext where TYPE is spec, roadmap, or epic
	const match = name.match(/^\d+_(spec|roadmap|epic)_(.+)\.(md|typ)$/);
	if (!match) return undefined;
	
	// Convert underscores to spaces for readability
	return match[2].replace(/_/g, " ");
}

/**
 * Generate a short scope string from a phase number and optional name
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
 * Generate a deterministic commit message based on the agent context.
 * 
 * This replaces the previous LLM-based approach, eliminating subprocess
 * spawning overhead entirely.
 * 
 * @param context - Context about the agent work and changes
 * @param _agentConfig - Unused, retained for backward compatibility
 * @param _cwd - Unused, retained for backward compatibility
 * @returns Result with type "success" (always deterministic, never fails)
 */
export function generateCommitMessage(
	context: CommitMessageContext,
	_agentConfig?: ModelConfig,
	_cwd?: string
): CommitMessageResult {
	const { role, files, phase, phaseName, docName, cycle, reviewFeedback } = context;
	const scope = phaseScope(phase, phaseName);
	const body = buildFileListBody(files);
	
	let subject: string;
	
	switch (role) {
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
	
	const message = body ? `${subject}\n${body}` : subject;
	
	return { type: "success", message };
}
