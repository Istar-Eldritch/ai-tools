/**
 * Benchmark result analysis functions
 * 
 * Provides detailed breakdowns and comparisons beyond basic aggregations
 */

import type {
	BenchmarkSession,
	PermutationResult,
	IterationResult,
	AgentMetrics,
	IterationMetrics,
} from "./types.ts";
import type {
	FixtureStats,
	PermutationFixtureBreakdown,
	AgentRoleStats,
	PermutationComparison,
	ComparisonReport,
	PermutationSummary,
} from "./report-types.ts";
import { isUnsuitablePermutation } from "./results.ts";

// ============================================
// Statistical Helpers
// ============================================

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function safeRatio(a: number, b: number): number {
	if (b === 0) return a === 0 ? 1 : Infinity;
	return a / b;
}

// ============================================
// Fixture Analysis (R17a)
// ============================================

/**
 * Analyze results by fixture for a permutation
 */
export function analyzeByFixture(permutation: PermutationResult): FixtureStats[] {
	// Group iterations by fixture
	const byFixture = new Map<string, IterationResult[]>();
	
	for (const iter of permutation.iterations) {
		const existing = byFixture.get(iter.fixture) ?? [];
		existing.push(iter);
		byFixture.set(iter.fixture, existing);
	}
	
	// Compute stats for each fixture
	const stats: FixtureStats[] = [];
	
	for (const [fixtureName, iterations] of byFixture) {
		const successful = iterations.filter(i => i.success);
		const total = iterations.length;
		
		// Count failure reasons
		const failureReasons: Record<string, number> = {};
		for (const iter of iterations) {
			if (!iter.success && iter.failureReason) {
				failureReasons[iter.failureReason] = (failureReasons[iter.failureReason] ?? 0) + 1;
			}
		}
		
		stats.push({
			name: fixtureName,
			totalIterations: total,
			successfulIterations: successful.length,
			successRate: total > 0 ? successful.length / total : 0,
			meanDurationMs: mean(successful.map(i => i.metrics.totalDurationMs)),
			meanInputTokens: mean(successful.map(i => i.metrics.totalInputTokens)),
			meanOutputTokens: mean(successful.map(i => i.metrics.totalOutputTokens)),
			failureReasons,
		});
	}
	
	return stats.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get fixture breakdown for all permutations
 */
export function getFixtureBreakdowns(session: BenchmarkSession): PermutationFixtureBreakdown[] {
	return session.permutations.map(perm => ({
		permutationName: perm.name,
		fixtures: analyzeByFixture(perm),
	}));
}

// ============================================
// Agent Role Analysis
// ============================================

/**
 * Analyze metrics by agent role for a permutation
 */
export function analyzeByAgentRole(permutation: PermutationResult): AgentRoleStats[] {
	// Collect all agent metrics from successful iterations
	const byRole = new Map<string, AgentMetrics[]>();
	
	for (const iter of permutation.iterations) {
		if (!iter.success) continue;
		
		for (const agent of iter.metrics.agentMetrics) {
			const existing = byRole.get(agent.role) ?? [];
			existing.push(agent);
			byRole.set(agent.role, existing);
		}
	}
	
	// Compute stats for each role
	const stats: AgentRoleStats[] = [];
	
	for (const [role, metrics] of byRole) {
		const durations = metrics.map(m => m.durationMs);
		const inputTokens = metrics.map(m => m.inputTokens);
		const outputTokens = metrics.map(m => m.outputTokens);
		
		stats.push({
			role,
			invocations: metrics.length,
			meanDurationMs: mean(durations),
			meanInputTokens: mean(inputTokens),
			meanOutputTokens: mean(outputTokens),
			totalDurationMs: durations.reduce((a, b) => a + b, 0),
			totalInputTokens: inputTokens.reduce((a, b) => a + b, 0),
			totalOutputTokens: outputTokens.reduce((a, b) => a + b, 0),
		});
	}
	
	// Sort by total duration (most time-consuming first)
	return stats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

/**
 * Get agent role analysis for all permutations
 */
export function getAgentAnalysis(session: BenchmarkSession): Map<string, AgentRoleStats[]> {
	const result = new Map<string, AgentRoleStats[]>();
	
	for (const perm of session.permutations) {
		result.set(perm.name, analyzeByAgentRole(perm));
	}
	
	return result;
}

// ============================================
// Permutation Comparison (R20, R21)
// ============================================

/**
 * Create summary for a permutation
 */
export function createPermutationSummary(perm: PermutationResult): PermutationSummary {
	const successful = perm.iterations.filter(i => i.success);
	
	return {
		name: perm.name,
		successRate: perm.aggregates.successRate,
		meanDurationMs: perm.aggregates.meanDurationMs,
		meanInputTokens: perm.aggregates.meanInputTokens,
		meanOutputTokens: perm.aggregates.meanOutputTokens,
		totalIterations: perm.iterations.length,
		successfulIterations: successful.length,
		isUnsuitable: isUnsuitablePermutation(perm),
	};
}

/**
 * Compare two permutations
 */
export function comparePermutations(
	permA: PermutationResult,
	permB: PermutationResult
): PermutationComparison {
	return {
		permA: permA.name,
		permB: permB.name,
		durationRatio: safeRatio(permA.aggregates.meanDurationMs, permB.aggregates.meanDurationMs),
		inputTokenRatio: safeRatio(permA.aggregates.meanInputTokens, permB.aggregates.meanInputTokens),
		outputTokenRatio: safeRatio(permA.aggregates.meanOutputTokens, permB.aggregates.meanOutputTokens),
		successRateDiff: permA.aggregates.successRate - permB.aggregates.successRate,
	};
}

/**
 * Generate comparison report for a session
 */
export function generateComparisonReport(
	session: BenchmarkSession,
	baselinePermutation?: string
): ComparisonReport {
	const permutations = session.permutations.map(createPermutationSummary);
	
	// Use first permutation as baseline if not specified
	const baseline = baselinePermutation ?? permutations[0]?.name ?? "";
	
	// Generate pairwise comparisons against baseline
	const baselinePerm = session.permutations.find(p => p.name === baseline);
	const comparisons: PermutationComparison[] = [];
	
	if (baselinePerm) {
		for (const perm of session.permutations) {
			if (perm.name !== baseline) {
				comparisons.push(comparePermutations(perm, baselinePerm));
			}
		}
	}
	
	// Rank permutations: by success rate (desc), then by duration (asc)
	const ranking = [...permutations]
		.filter(p => !p.isUnsuitable)  // Exclude unsuitable (R21)
		.sort((a, b) => {
			// First by success rate (higher is better)
			if (a.successRate !== b.successRate) {
				return b.successRate - a.successRate;
			}
			// Then by duration (lower is better)
			return a.meanDurationMs - b.meanDurationMs;
		})
		.map(p => p.name);
	
	// Add unsuitable permutations at the end
	const unsuitable = permutations
		.filter(p => p.isUnsuitable)
		.map(p => p.name);
	
	return {
		sessionId: session.sessionId,
		baseline,
		permutations,
		comparisons,
		ranking: [...ranking, ...unsuitable],
	};
}

// ============================================
// Review Cycles Analysis
// ============================================

/**
 * Get average review cycles for a permutation
 */
export function getAverageReviewCycles(
	permutation: PermutationResult
): { specReviewer: { cheap: number; expensive: number }; planReviewer: { cheap: number; expensive: number }; codeReviewer: { cheap: number; expensive: number } } {
	const successful = permutation.iterations.filter(i => i.success);
	if (successful.length === 0) {
		return {
			specReviewer: { cheap: 0, expensive: 0 },
			planReviewer: { cheap: 0, expensive: 0 },
			codeReviewer: { cheap: 0, expensive: 0 },
		};
	}
	
	const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
	
	return {
		specReviewer: {
			cheap: avg(successful.map(i => i.metrics.reviewCycles.specReviewer.cheap)),
			expensive: avg(successful.map(i => i.metrics.reviewCycles.specReviewer.expensive)),
		},
		planReviewer: {
			cheap: avg(successful.map(i => i.metrics.reviewCycles.planReviewer.cheap)),
			expensive: avg(successful.map(i => i.metrics.reviewCycles.planReviewer.expensive)),
		},
		codeReviewer: {
			cheap: avg(successful.map(i => i.metrics.reviewCycles.codeReviewer.cheap)),
			expensive: avg(successful.map(i => i.metrics.reviewCycles.codeReviewer.expensive)),
		},
	};
}
