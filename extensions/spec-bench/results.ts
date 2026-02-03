/**
 * Benchmark results storage
 * 
 * Results are stored as JSON files in the output directory,
 * one file per benchmark session (R18)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	BenchmarkSession,
	BenchmarkConfig,
	PermutationResult,
	IterationResult,
	Permutation,
} from "./types.ts";
import { computeAggregates } from "./metrics.ts";

// ============================================
// Session ID Generation
// ============================================

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10).replace(/-/g, "");
	const time = now.toISOString().slice(11, 19).replace(/:/g, "");
	const rand = randomUUID().slice(0, 8);
	return `${date}_${time}_${rand}`;
}

// ============================================
// Session Creation
// ============================================

/**
 * Create a new benchmark session
 */
export function createSession(config: BenchmarkConfig): BenchmarkSession {
	return {
		sessionId: generateSessionId(),
		startedAt: new Date().toISOString(),
		completedAt: "",  // Set when session completes
		config,
		permutations: [],
	};
}

/**
 * Create a new permutation result structure
 */
export function createPermutationResult(
	name: string,
	config: Permutation
): PermutationResult {
	return {
		name,
		config,
		iterations: [],
		aggregates: {
			successRate: 0,
			meanDurationMs: 0,
			medianDurationMs: 0,
			p95DurationMs: 0,
			meanInputTokens: 0,
			meanOutputTokens: 0,
		},
	};
}

// ============================================
// Results File Operations
// ============================================

/**
 * Get the results file path for a session
 */
export function getResultsPath(outputDir: string, sessionId: string): string {
	return path.join(outputDir, `benchmark_${sessionId}.json`);
}

/**
 * Save benchmark session to disk
 */
export function saveSession(outputDir: string, session: BenchmarkSession): void {
	// Ensure output directory exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	
	const filePath = getResultsPath(outputDir, session.sessionId);
	fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Load a benchmark session from disk
 */
export function loadSession(filePath: string): BenchmarkSession | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(content) as BenchmarkSession;
	} catch {
		return null;
	}
}

/**
 * List all benchmark sessions in output directory
 */
export function listSessions(outputDir: string): string[] {
	if (!fs.existsSync(outputDir)) {
		return [];
	}
	
	return fs.readdirSync(outputDir)
		.filter(f => f.startsWith("benchmark_") && f.endsWith(".json"))
		.map(f => path.join(outputDir, f))
		.sort()
		.reverse();  // Most recent first
}

// ============================================
// Results Update Helpers
// ============================================

/**
 * Add iteration result to a permutation and update aggregates
 */
export function addIterationResult(
	permutation: PermutationResult,
	result: IterationResult
): void {
	permutation.iterations.push(result);
	
	// Recompute aggregates
	permutation.aggregates = computeAggregates(permutation.iterations);
}

/**
 * Finalize session (set completedAt timestamp)
 */
export function finalizeSession(session: BenchmarkSession): void {
	session.completedAt = new Date().toISOString();
}

/**
 * Check if a permutation has 0% success rate (R21)
 */
export function isUnsuitablePermutation(permutation: PermutationResult): boolean {
	return permutation.aggregates.successRate === 0 && permutation.iterations.length > 0;
}

// ============================================
// Result Summary Helpers
// ============================================

/**
 * Generate a human-readable summary of session results
 */
export function formatSessionSummary(session: BenchmarkSession): string {
	const lines: string[] = [];
	
	lines.push(`Benchmark Session: ${session.sessionId}`);
	lines.push(`Started: ${session.startedAt}`);
	lines.push(`Completed: ${session.completedAt || "In progress"}`);
	lines.push("");
	lines.push(`Permutations: ${session.permutations.length}`);
	lines.push("");
	
	for (const perm of session.permutations) {
		const successPct = (perm.aggregates.successRate * 100).toFixed(1);
		const unsuitable = isUnsuitablePermutation(perm) ? " ⚠️ UNSUITABLE" : "";
		
		lines.push(`  ${perm.name}${unsuitable}`);
		lines.push(`    Success rate: ${successPct}%`);
		lines.push(`    Iterations: ${perm.iterations.length}`);
		
		if (perm.aggregates.successRate > 0) {
			lines.push(`    Mean duration: ${(perm.aggregates.meanDurationMs / 1000).toFixed(1)}s`);
			lines.push(`    Mean tokens: ${perm.aggregates.meanInputTokens.toFixed(0)} in / ${perm.aggregates.meanOutputTokens.toFixed(0)} out`);
		}
		lines.push("");
	}
	
	return lines.join("\n");
}
