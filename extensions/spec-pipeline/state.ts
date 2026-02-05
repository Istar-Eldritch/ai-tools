/**
 * Pipeline state management - CRUD operations for pipeline state
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	type PipelineState,
	type DiscoveryState,
	type DiscoveryQA,
	type ProjectConfig,
	STATE_DIR,
} from "./types.ts";
import { classifyError } from "./errors.ts";

// ============================================
// State Directory & Path Helpers
// ============================================

/**
 * Get the state directory for a project
 */
export function getStateDir(cwd: string): string {
	return path.join(cwd, STATE_DIR);
}

/**
 * Get path to a specific pipeline state file
 */
export function getStatePath(cwd: string, id: string): string {
	return path.join(getStateDir(cwd), `${id}.json`);
}

// ============================================
// State CRUD Operations
// ============================================

/**
 * Load pipeline state by ID
 */
export function loadState(cwd: string, id: string): PipelineState | null {
	const statePath = getStatePath(cwd, id);
	if (!fs.existsSync(statePath)) {
		return null;
	}
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as PipelineState;
		
		// Migrate old state files that don't have discovery field
		if (!state.discovery) {
			state.discovery = {
				skipped: true,  // Treat existing pipelines as if discovery was skipped
				currentRound: 0,
				maxRounds: 5,
				qaHistory: [],
				discoverySummary: "",
				completed: true,  // Already past discovery
			};
		}
		
		// Migrate old state files that have absolute specPath (bug from before 2026-01-31)
		// If specPath starts with cwd, make it relative
		let needsSave = false;
		if (state.specPath && path.isAbsolute(state.specPath)) {
			const relativePath = path.relative(cwd, state.specPath);
			if (!relativePath.startsWith('..')) {
				// Only convert if it's actually within cwd
				state.specPath = relativePath;
				needsSave = true;
			}
		}
		
		// Also migrate phase paths that might be absolute
		if (state.phases && Array.isArray(state.phases)) {
			const migratedPhases = state.phases.map(phasePath => {
				if (phasePath && path.isAbsolute(phasePath)) {
					const relativePath = path.relative(cwd, phasePath);
					if (!relativePath.startsWith('..')) {
						needsSave = true;
						return relativePath;
					}
				}
				return phasePath;
			});
			if (needsSave) {
				state.phases = migratedPhases;
			}
		}
		
		// Migrate old string lastError to ErrorDetails, or remove null values
		if (state.lastError === null) {
			// JSON stores null, but we want undefined
			state.lastError = undefined;
			needsSave = true;
		} else if (state.lastError && typeof state.lastError === "string") {
			const legacyError = state.lastError as unknown as string;
			state.lastError = {
				timestamp: state.updatedAt || new Date().toISOString(),
				agent: "opus",  // Default, unknown
				role: "implementer",  // Default, unknown
				exitCode: 1,
				stderr: legacyError,
				errorType: classifyError(legacyError),
				agentTask: "(task not recorded in legacy state)",
			};
			needsSave = true;
		}
		
		// Initialize missing git-related fields for backward compatibility
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
			// Don't set needsSave - old pipelines without branches are OK
		}
		
		// Initialize tiered review fields for backward compatibility (Phase 3)
		// Old pipelines don't have tier tracking - they'll be initialized when
		// implementation resumes with the new tiered review system
		if (state.cheapCyclesCompleted === undefined) {
			state.cheapCyclesCompleted = 0;
		}
		if (state.expensiveCyclesCompleted === undefined) {
			state.expensiveCyclesCompleted = 0;
		}
		// currentReviewTier remains undefined for old pipelines - this is OK
		// The tiered review will initialize it when it starts
		
		// Save the migrated state back to disk
		if (needsSave) {
			try {
				fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
			} catch {
				// Ignore write errors, the migration will apply again on next load
			}
		}
		
		return state;
	} catch {
		return null;
	}
}

/**
 * Save pipeline state
 */
export function saveState(cwd: string, state: PipelineState): void {
	const stateDir = getStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}
	state.updatedAt = new Date().toISOString();
	fs.writeFileSync(getStatePath(cwd, state.id), JSON.stringify(state, null, 2), "utf-8");
}

/**
 * List all pipeline states
 */
export function listStates(cwd: string): PipelineState[] {
	const stateDir = getStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		return [];
	}
	const files = fs.readdirSync(stateDir).filter(f => f.endsWith(".json"));
	const states: PipelineState[] = [];
	for (const file of files) {
		// Extract the pipeline ID from the filename (remove .json extension)
		const id = file.replace(/\.json$/, "");
		// Use loadState to apply migrations
		const state = loadState(cwd, id);
		if (state) {
			states.push(state);
		}
	}
	return states.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Get the most recent active (non-completed, non-cancelled) pipeline
 */
export function getLatestActivePipeline(cwd: string): PipelineState | null {
	const states = listStates(cwd);
	return states.find(s => s.stage !== "completed" && s.stage !== "cancelled") || null;
}

// ============================================
// State Creation Helpers
// ============================================

/**
 * Generate a unique pipeline ID
 */
export function generatePipelineId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10).replace(/-/g, "");
	const time = now.toISOString().slice(11, 19).replace(/:/g, "");
	const rand = Math.random().toString(36).slice(2, 6);
	return `${date}_${time}_${rand}`;
}

/**
 * Generate a spec timestamp in YYMMDDhhmm format
 */
export function generateSpecTimestamp(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(2);
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");
	return `${yy}${mm}${dd}${hh}${min}`;
}

/**
 * Create initial discovery state
 */
export function createInitialDiscoveryState(maxRounds: number, skipped: boolean = false): DiscoveryState {
	return {
		skipped,
		currentRound: 0,
		maxRounds,
		qaHistory: [],
		discoverySummary: "",
		completed: skipped,  // If skipped, mark as completed
	};
}

/**
 * Generate a discovery summary from Q&A history
 */
export function generateDiscoverySummary(qaHistory: DiscoveryQA[]): string {
	if (qaHistory.length === 0) {
		return "";
	}

	const sections: string[] = [];
	sections.push("## Discovery Summary\n");
	sections.push("The following information was gathered during the discovery phase:\n");

	for (const qa of qaHistory) {
		sections.push(`### Round ${qa.round}\n`);
		sections.push("**Questions Asked:**\n");
		sections.push(qa.questions);
		sections.push("\n**User Responses:**\n");
		sections.push(qa.answers);
		sections.push("\n---\n");
	}

	return sections.join("\n");
}

/**
 * Create initial pipeline state
 */
export function createInitialState(
	description: string,
	specTimestamp: string,
	shortName: string,
	specsDir: string,
	discoveryConfig: ProjectConfig["discovery"],
	skipDiscovery: boolean = false
): PipelineState {
	const specFilename = `${specTimestamp}_spec_${shortName}.md`;
	const specPath = path.join(specsDir, specFilename);
	const now = new Date().toISOString();
	
	// Determine if we should skip discovery
	const shouldSkip = skipDiscovery || !discoveryConfig.enabled;
	
	return {
		id: generatePipelineId(),
		description,
		stage: shouldSkip ? "spec_drafting" : "discovery",
		createdAt: now,
		updatedAt: now,
		
		// Initialize discovery state
		discovery: createInitialDiscoveryState(discoveryConfig.maxRounds, shouldSkip),
		
		specTimestamp,
		specFilename,
		specPath,
		specDraft: "",
		specApproved: false,
		specIteration: 0,
		
		phases: [],
		phasesGenerated: [],
		currentPhaseIndex: 0,
		
		currentReviewCycle: 1,
		previousReview: "",
		
		specCommitted: false,
		phaseCommits: [],
		
		// New pipelines use agent commits instead of checkpoints (R11)
		useAgentCommits: true,
	};
}
