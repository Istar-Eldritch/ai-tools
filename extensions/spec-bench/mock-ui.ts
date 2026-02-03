/**
 * Mock PipelineUIContext for automated benchmark runs (R26a)
 * 
 * Provides scripted responses for all interactive prompts:
 * - Discovery answers from fixture's discovery.json
 * - Auto-approval for spec/plan review
 * - Auto-confirm for all prompts
 * 
 * CURRENT LIMITATION:
 * This module is designed for in-process execution where the mock UI context
 * can be injected directly. However, the current implementation runs pi as a
 * subprocess with stdin disconnected, which prevents interactive response injection.
 * 
 * As a result:
 * - discovery.json fixtures are loaded but NOT used (reserved for future)
 * - The benchmark uses --quick to skip discovery
 * - Auto-approval is achieved via system prompt instructions
 * 
 * FUTURE: When in-process spec-pipeline execution is supported, this mock UI
 * will handle all interactive prompts with scripted responses.
 */

import type { DiscoveryConfig } from "./types.ts";

// ============================================
// Types
// ============================================

/**
 * UI context interface matching spec-pipeline's PipelineUIContext
 * This is a subset focusing on what we need to mock
 */
export interface MockUIContext {
	ui: {
		notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
		confirm: (title: string, msg: string) => Promise<boolean>;
		editor: (title: string, initial: string) => Promise<string | undefined>;
		select: (title: string, options: Array<{ label: string; value: string }>) => Promise<string>;
		setWidget: (id: string, content: string[] | undefined) => void;
	};
}

/**
 * Progress callback for benchmark status updates
 */
export interface ProgressCallback {
	onDiscoveryRound?: (round: number, maxRounds: number) => void;
	onStageChange?: (stage: string) => void;
	onNotify?: (msg: string, type: "info" | "error" | "success" | "warning") => void;
}

// ============================================
// Mock UI Context Factory
// ============================================

/**
 * Create a mock PipelineUIContext for automated benchmark runs (R26a)
 * 
 * @param discovery Discovery configuration from fixture (may be null)
 * @param progress Optional progress callbacks
 * @returns Mock UI context with scripted responses
 */
export function createMockUIContext(
	discovery: DiscoveryConfig | null,
	progress?: ProgressCallback
): MockUIContext {
	let discoveryRound = 0;
	
	return {
		ui: {
			/**
			 * Notify - logs to console and optionally calls progress callback
			 */
			notify: (msg: string, type: "info" | "error" | "success" | "warning") => {
				progress?.onNotify?.(msg, type);
				// Also detect stage changes from banner messages
				if (msg.includes("DISCOVERY PHASE")) {
					progress?.onStageChange?.("discovery");
				} else if (msg.includes("SPEC DRAFTING PHASE")) {
					progress?.onStageChange?.("spec_drafting");
				} else if (msg.includes("PLAN GENERATION PHASE")) {
					progress?.onStageChange?.("plan_generation");
				} else if (msg.includes("IMPLEMENTATION PHASE")) {
					progress?.onStageChange?.("implementation");
				}
			},
			
			/**
			 * Confirm - always returns true (auto-approve)
			 */
			confirm: async (_title: string, _msg: string): Promise<boolean> => {
				return true;  // Auto-approve all confirmations
			},
			
			/**
			 * Editor - returns scripted discovery answers or empty string
			 * 
			 * For discovery rounds, returns answers from discovery.json
			 * For other prompts, returns empty string (no additional feedback)
			 */
			editor: async (title: string, _initial: string): Promise<string | undefined> => {
				// Check if this is a discovery round prompt
				if (title.includes("Discovery Round")) {
					if (!discovery || !discovery.rounds) {
						// No discovery config - signal to finish discovery
						return discovery?.earlyFinish ? "done" : "";
					}
					
					const currentRound = discovery.rounds[discoveryRound];
					discoveryRound++;
					progress?.onDiscoveryRound?.(discoveryRound, discovery.rounds.length);
					
					if (currentRound) {
						return currentRound.answers;
					}
					
					// No more scripted answers - finish discovery if earlyFinish
					if (discovery.earlyFinish) {
						return "done";
					}
					
					// Return empty to trigger "no answers" handling
					return "";
				}
				
				// For other editor prompts (e.g., spec feedback), return empty
				return "";
			},
			
			/**
			 * Select - returns "approve" for approval prompts, first option otherwise
			 */
			select: async (title: string, options: Array<{ label: string; value: string }>): Promise<string> => {
				// For approval prompts, select "approve"
				const approveOption = options.find(o => o.value === "approve");
				if (approveOption) {
					return "approve";
				}
				
				// For "no answers" prompts, select "done" to proceed
				const doneOption = options.find(o => o.value === "done");
				if (doneOption && title.includes("No answers")) {
					return "done";
				}
				
				// Default to first option
				return options[0]?.value ?? "";
			},
			
			/**
			 * setWidget - no-op for benchmarks
			 */
			setWidget: (_id: string, _content: string[] | undefined) => {
				// No widget in benchmark mode
			},
		},
	};
}

/**
 * Reset discovery round counter (for multiple iterations with same discovery config)
 * Returns a new mock context with reset state
 */
export function createFreshMockUIContext(
	discovery: DiscoveryConfig | null,
	progress?: ProgressCallback
): MockUIContext {
	return createMockUIContext(discovery, progress);
}
