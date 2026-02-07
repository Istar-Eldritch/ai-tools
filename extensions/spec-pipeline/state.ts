/**
 * Pipeline state management - CRUD operations for spec and implementation state
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	type SpecState,
	type ImplementationState,
	type DiscoveryState,
	type DiscoveryQA,
	type ConversationalExchange,
	type ProjectConfig,
	SPEC_STATE_DIR,
	IMPL_STATE_DIR,
	STATE_DIR,
} from "./types.ts";
import { classifyError } from "./errors.ts";

// ============================================
// State Directory & Path Helpers
// ============================================

/**
 * Get the state directory for specs
 */
export function getSpecStateDir(cwd: string): string {
	return path.join(cwd, SPEC_STATE_DIR);
}

/**
 * Get the state directory for implementations
 */
export function getImplStateDir(cwd: string): string {
	return path.join(cwd, IMPL_STATE_DIR);
}

/**
 * Get the base state directory (for shared resources like error logs)
 */
export function getStateDir(cwd: string): string {
	return path.join(cwd, STATE_DIR);
}

/**
 * Get path to a specific spec state file
 */
export function getSpecStatePath(cwd: string, id: string): string {
	return path.join(getSpecStateDir(cwd), `${id}.json`);
}

/**
 * Get path to a specific implementation state file
 */
export function getImplStatePath(cwd: string, id: string): string {
	return path.join(getImplStateDir(cwd), `${id}.json`);
}

// ============================================
// Spec State CRUD Operations
// ============================================

/**
 * Load spec state by ID
 */
export function loadSpecState(cwd: string, id: string): SpecState | null {
	const statePath = getSpecStatePath(cwd, id);
	if (!fs.existsSync(statePath)) {
		return null;
	}
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as SpecState;
		
		// Migrate: ensure discovery field exists
		if (!state.discovery) {
			state.discovery = {
				skipped: true,
				currentRound: 0,
				maxRounds: 5,
				qaHistory: [],
				discoverySummary: "",
				completed: true,
			};
		}
		
		// Migrate: convert absolute specPath to relative
		let needsSave = false;
		if (state.specPath && path.isAbsolute(state.specPath)) {
			const relativePath = path.relative(cwd, state.specPath);
			if (!relativePath.startsWith('..')) {
				state.specPath = relativePath;
				needsSave = true;
			}
		}
		
		// Migrate: handle null lastError
		if (state.lastError === null) {
			state.lastError = undefined;
			needsSave = true;
		} else if (state.lastError && typeof state.lastError === "string") {
			const legacyError = state.lastError as unknown as string;
			state.lastError = {
				timestamp: state.updatedAt || new Date().toISOString(),
				agent: "opus",
				role: "specDrafter",
				exitCode: 1,
				stderr: legacyError,
				errorType: classifyError(legacyError),
				agentTask: "(task not recorded in legacy state)",
			};
			needsSave = true;
		}
		
		// Initialize missing fields
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
		}
		
		if (needsSave) {
			try {
				fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
			} catch {
				// Ignore write errors
			}
		}
		
		return state;
	} catch {
		return null;
	}
}

/**
 * Save spec state
 */
export function saveSpecState(cwd: string, state: SpecState): void {
	const stateDir = getSpecStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}
	state.updatedAt = new Date().toISOString();
	fs.writeFileSync(getSpecStatePath(cwd, state.id), JSON.stringify(state, null, 2), "utf-8");
}

/**
 * List all spec states
 */
export function listSpecStates(cwd: string): SpecState[] {
	const stateDir = getSpecStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		return [];
	}
	const files = fs.readdirSync(stateDir).filter(f => f.endsWith(".json"));
	const states: SpecState[] = [];
	for (const file of files) {
		const id = file.replace(/\.json$/, "");
		const state = loadSpecState(cwd, id);
		if (state) {
			states.push(state);
		}
	}
	return states.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Get the most recent active spec pipeline
 */
export function getLatestActiveSpecPipeline(cwd: string): SpecState | null {
	const states = listSpecStates(cwd);
	return states.find(s => s.stage !== "completed" && s.stage !== "cancelled") || null;
}

// ============================================
// Implementation State CRUD Operations
// ============================================

/**
 * Load implementation state by ID
 */
export function loadImplState(cwd: string, id: string): ImplementationState | null {
	const statePath = getImplStatePath(cwd, id);
	if (!fs.existsSync(statePath)) {
		return null;
	}
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as ImplementationState;
		
		let needsSave = false;
		
		// Migrate: handle null lastError
		if (state.lastError === null) {
			state.lastError = undefined;
			needsSave = true;
		} else if (state.lastError && typeof state.lastError === "string") {
			const legacyError = state.lastError as unknown as string;
			state.lastError = {
				timestamp: state.updatedAt || new Date().toISOString(),
				agent: "opus",
				role: "implementer",
				exitCode: 1,
				stderr: legacyError,
				errorType: classifyError(legacyError),
				agentTask: "(task not recorded in legacy state)",
			};
			needsSave = true;
		}
		
		// Initialize missing fields
		if (state.checkpoints === undefined) {
			state.checkpoints = [];
		}
		if (state.cheapCyclesCompleted === undefined) {
			state.cheapCyclesCompleted = 0;
		}
		if (state.expensiveCyclesCompleted === undefined) {
			state.expensiveCyclesCompleted = 0;
		}
		
		if (needsSave) {
			try {
				fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
			} catch {
				// Ignore write errors
			}
		}
		
		return state;
	} catch {
		return null;
	}
}

/**
 * Save implementation state
 */
export function saveImplState(cwd: string, state: ImplementationState): void {
	const stateDir = getImplStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}
	state.updatedAt = new Date().toISOString();
	fs.writeFileSync(getImplStatePath(cwd, state.id), JSON.stringify(state, null, 2), "utf-8");
}

/**
 * List all implementation states
 */
export function listImplStates(cwd: string): ImplementationState[] {
	const stateDir = getImplStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		return [];
	}
	const files = fs.readdirSync(stateDir).filter(f => f.endsWith(".json"));
	const states: ImplementationState[] = [];
	for (const file of files) {
		const id = file.replace(/\.json$/, "");
		const state = loadImplState(cwd, id);
		if (state) {
			states.push(state);
		}
	}
	return states.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Get the most recent active implementation pipeline
 */
export function getLatestActiveImplPipeline(cwd: string): ImplementationState | null {
	const states = listImplStates(cwd);
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
 * Generate a timestamp in YYMMDDhhmm format
 */
export function generateTimestamp(): string {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(2);
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");
	return `${yy}${mm}${dd}${hh}${min}`;
}

// Keep old name as alias
export const generateSpecTimestamp = generateTimestamp;

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
		completed: skipped,
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
 * Generate a discovery summary from conversational exchanges
 */
export function generateConversationalDiscoverySummary(exchanges: ConversationalExchange[]): string {
	if (exchanges.length === 0) {
		return "";
	}

	const sections: string[] = [];
	sections.push("## Discovery Summary\n");
	sections.push("The following information was gathered during an interactive discovery conversation:\n");

	for (let i = 0; i < exchanges.length; i++) {
		const exchange = exchanges[i];
		sections.push(`### Exchange ${i + 1}\n`);
		sections.push("**User:**\n");
		sections.push(exchange.userMessage);
		sections.push("\n**Discovery Agent:**\n");
		sections.push(exchange.assistantResponse);
		sections.push("\n---\n");
	}

	return sections.join("\n");
}

/**
 * Create initial spec state
 */
export function createInitialSpecState(
	description: string,
	specTimestamp: string,
	shortName: string,
	specsDir: string,
	discoveryConfig: ProjectConfig["discovery"],
	skipDiscovery: boolean = false,
	specFormat: string = "md"
): SpecState {
	const specFilename = `${specTimestamp}_spec_${shortName}.${specFormat}`;
	const specPath = path.join(specsDir, specFilename);
	const now = new Date().toISOString();
	
	const shouldSkip = skipDiscovery || !discoveryConfig.enabled;
	
	return {
		id: generatePipelineId(),
		description,
		stage: shouldSkip ? "spec_drafting" : "discovery",
		createdAt: now,
		updatedAt: now,
		
		discovery: createInitialDiscoveryState(discoveryConfig.maxRounds, shouldSkip),
		
		specTimestamp,
		specFilename,
		specPath,
		specDraft: "",
		specApproved: false,
		specIteration: 0,
		
		useAgentCommits: true,
	};
}

/**
 * Create initial implementation state
 */
export function createInitialImplState(
	specPath: string,
	specContent: string,
	implTimestamp: string,
	skipPlanGeneration: boolean = false
): ImplementationState {
	const now = new Date().toISOString();
	
	return {
		id: generatePipelineId(),
		implTimestamp,
		specPath,
		specContent,
		stage: "plan_generation",
		createdAt: now,
		updatedAt: now,
		
		phases: [],
		phasesGenerated: [],
		currentPhaseIndex: 0,
		
		currentReviewCycle: 1,
		previousReview: "",
		
		phaseCommits: [],
		
		skipPlanGeneration,
		useAgentCommits: true,
	};
}
