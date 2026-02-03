/**
 * Report types for benchmark result analysis
 */

import type {
	BenchmarkSession,
	PermutationResult,
	IterationResult,
	AgentMetrics,
	ReviewCyclesMetrics,
} from "./types.ts";

// ============================================
// Per-Fixture Analysis
// ============================================

/**
 * Aggregated metrics for a single fixture across all iterations
 */
export interface FixtureStats {
	/** Fixture name */
	name: string;
	/** Total iterations for this fixture */
	totalIterations: number;
	/** Successful iterations */
	successfulIterations: number;
	/** Success rate (0-1) */
	successRate: number;
	/** Mean duration for successful runs (ms) */
	meanDurationMs: number;
	/** Mean input tokens for successful runs */
	meanInputTokens: number;
	/** Mean output tokens for successful runs */
	meanOutputTokens: number;
	/** Failure reasons breakdown */
	failureReasons: Record<string, number>;
}

/**
 * Per-fixture breakdown within a permutation
 */
export interface PermutationFixtureBreakdown {
	permutationName: string;
	fixtures: FixtureStats[];
}

// ============================================
// Per-Agent Analysis
// ============================================

/**
 * Aggregated metrics for a specific agent role
 */
export interface AgentRoleStats {
	/** Role name (e.g., "specDrafter", "codeReviewer") */
	role: string;
	/** Number of invocations */
	invocations: number;
	/** Mean duration per invocation (ms) */
	meanDurationMs: number;
	/** Mean input tokens per invocation */
	meanInputTokens: number;
	/** Mean output tokens per invocation */
	meanOutputTokens: number;
	/** Total duration across all invocations (ms) */
	totalDurationMs: number;
	/** Total input tokens */
	totalInputTokens: number;
	/** Total output tokens */
	totalOutputTokens: number;
}

// ============================================
// Comparison Types
// ============================================

/**
 * Comparison metrics between two permutations
 */
export interface PermutationComparison {
	/** First permutation name */
	permA: string;
	/** Second permutation name */
	permB: string;
	/** Duration ratio (A/B, <1 means A is faster) */
	durationRatio: number;
	/** Input token ratio (A/B, <1 means A uses fewer) */
	inputTokenRatio: number;
	/** Output token ratio (A/B) */
	outputTokenRatio: number;
	/** Success rate difference (A - B) */
	successRateDiff: number;
}

/**
 * Full comparison report across all permutations
 */
export interface ComparisonReport {
	/** Session ID being analyzed */
	sessionId: string;
	/** Baseline permutation for comparisons */
	baseline: string;
	/** All permutation summaries */
	permutations: PermutationSummary[];
	/** Pairwise comparisons */
	comparisons: PermutationComparison[];
	/** Ranking by success rate then duration */
	ranking: string[];
}

/**
 * Summary for a single permutation in comparison
 */
export interface PermutationSummary {
	name: string;
	successRate: number;
	meanDurationMs: number;
	meanInputTokens: number;
	meanOutputTokens: number;
	totalIterations: number;
	successfulIterations: number;
	isUnsuitable: boolean;
}

// ============================================
// Report Output Types
// ============================================

/**
 * Structured report data for rendering
 */
export interface BenchmarkReport {
	/** Report generation timestamp */
	generatedAt: string;
	/** Session being reported */
	session: BenchmarkSession;
	/** Per-permutation fixture breakdown */
	fixtureBreakdowns: PermutationFixtureBreakdown[];
	/** Per-role agent statistics */
	agentStats: Map<string, AgentRoleStats[]>;
	/** Review cycles summary per permutation */
	reviewCyclesSummary: Map<string, ReviewCyclesMetrics>;
	/** Comparison data */
	comparison: ComparisonReport;
}

// ============================================
// Export Formats
// ============================================

export type ExportFormat = "markdown" | "csv" | "json";

export interface ExportOptions {
	/** Output format */
	format: ExportFormat;
	/** Include detailed per-iteration data */
	detailed?: boolean;
	/** Include agent-level breakdown */
	includeAgents?: boolean;
	/** Output file path (stdout if not specified) */
	outputPath?: string;
}
