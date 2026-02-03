# Phase 4: Results Aggregation and Reporting

**Estimated Effort**: 1 day

## Overview

This phase enhances the benchmark tool with comprehensive reporting capabilities:
- Detailed per-fixture and per-permutation breakdown reports
- Markdown report generation for documentation
- CSV export for spreadsheet analysis
- Comparison utilities for analyzing multiple permutations
- CLI commands for viewing and comparing benchmark results

Building on Phase 2's `computeAggregates()` and `formatSessionSummary()`, this phase adds richer reporting formats and analysis tools.

## Prerequisites

- Phase 1 complete (infrastructure, fixtures, CLI)
- Phase 2 complete (metrics capture, results storage)
- Phase 3 complete (benchmark execution, automation)

## Steps

### Step 4.1: Create Report Types Module

- **Files**: `extensions/spec-bench/report-types.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/types.ts` type organization
- **Action**: Define types for structured reports and analysis

```typescript
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
```

- **Verify**: TypeScript compiles without errors

---

### Step 4.2: Create Analysis Module

- **Files**: `extensions/spec-bench/analysis.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-bench/metrics.ts` aggregation functions
- **Action**: Create functions for analyzing benchmark results (R17a, R20, R21, R22)

```typescript
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
```

- **Verify**: TypeScript compiles without errors

---

### Step 4.3: Create Report Formatter Module

- **Files**: `extensions/spec-bench/report-formatter.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/formatting.ts` box/table formatting
- **Action**: Create functions for generating formatted reports in various formats

```typescript
/**
 * Report formatting utilities
 * 
 * Generates human-readable reports in various formats:
 * - Plain text with ASCII tables
 * - Markdown for documentation
 * - CSV for spreadsheet analysis
 */

import type {
	BenchmarkSession,
	PermutationResult,
	IterationResult,
} from "./types.ts";
import type {
	PermutationSummary,
	ComparisonReport,
	FixtureStats,
	AgentRoleStats,
	ExportFormat,
	ExportOptions,
} from "./report-types.ts";
import {
	analyzeByFixture,
	analyzeByAgentRole,
	generateComparisonReport,
	getAverageReviewCycles,
} from "./analysis.ts";

// ============================================
// ASCII Table Helpers
// ============================================

/**
 * Pad string to width (right-aligned for numbers)
 */
function pad(value: string | number, width: number, align: "left" | "right" = "left"): string {
	const str = String(value);
	if (align === "right") {
		return str.padStart(width);
	}
	return str.padEnd(width);
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = ((ms % 60000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}

/**
 * Format number with thousands separator
 */
function formatNumber(n: number): string {
	return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Format percentage
 */
function formatPercent(ratio: number): string {
	return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Format ratio with arrow indicator
 */
function formatRatio(ratio: number): string {
	if (ratio === 1) return "1.00x →";
	if (ratio < 1) return `${ratio.toFixed(2)}x ↓`;
	return `${ratio.toFixed(2)}x ↑`;
}

/**
 * Create ASCII table
 */
function createTable(
	headers: string[],
	rows: string[][],
	columnAligns?: ("left" | "right")[]
): string[] {
	// Calculate column widths
	const widths = headers.map((h, i) => {
		const maxRowWidth = Math.max(...rows.map(r => (r[i] ?? "").length));
		return Math.max(h.length, maxRowWidth);
	});
	
	const aligns = columnAligns ?? headers.map(() => "left");
	const lines: string[] = [];
	
	// Header
	const headerLine = headers.map((h, i) => pad(h, widths[i], aligns[i])).join(" │ ");
	lines.push(headerLine);
	
	// Separator
	const separator = widths.map(w => "─".repeat(w)).join("─┼─");
	lines.push(separator);
	
	// Rows
	for (const row of rows) {
		const rowLine = row.map((cell, i) => pad(cell ?? "", widths[i], aligns[i])).join(" │ ");
		lines.push(rowLine);
	}
	
	return lines;
}

// ============================================
// Plain Text Report
// ============================================

/**
 * Generate plain text summary report
 */
export function formatPlainTextReport(session: BenchmarkSession): string {
	const lines: string[] = [];
	const divider = "═".repeat(70);
	
	// Header
	lines.push(divider);
	lines.push(`  BENCHMARK REPORT: ${session.sessionId}`);
	lines.push(divider);
	lines.push("");
	lines.push(`  Started:   ${session.startedAt}`);
	lines.push(`  Completed: ${session.completedAt || "In progress"}`);
	lines.push(`  Fixtures:  ${session.config.fixtures.length}`);
	lines.push(`  Iterations per permutation: ${session.config.iterations}`);
	lines.push("");
	
	// Permutation Summary Table
	lines.push("─".repeat(70));
	lines.push("  PERMUTATION SUMMARY");
	lines.push("─".repeat(70));
	lines.push("");
	
	const comparison = generateComparisonReport(session);
	const summaryRows = comparison.permutations.map(p => [
		p.isUnsuitable ? `⚠️ ${p.name}` : p.name,
		formatPercent(p.successRate),
		formatDuration(p.meanDurationMs),
		formatNumber(p.meanInputTokens),
		formatNumber(p.meanOutputTokens),
	]);
	
	const summaryTable = createTable(
		["Permutation", "Success", "Duration", "Input Tok", "Output Tok"],
		summaryRows,
		["left", "right", "right", "right", "right"]
	);
	lines.push(...summaryTable.map(l => "  " + l));
	lines.push("");
	
	// Ranking
	if (comparison.ranking.length > 0) {
		lines.push("  RANKING (by success rate, then duration):");
		comparison.ranking.forEach((name, i) => {
			const isUnsuitable = comparison.permutations.find(p => p.name === name)?.isUnsuitable;
			const marker = isUnsuitable ? " ⚠️ unsuitable" : "";
			lines.push(`    ${i + 1}. ${name}${marker}`);
		});
		lines.push("");
	}
	
	// Per-Permutation Details
	for (const perm of session.permutations) {
		lines.push("─".repeat(70));
		lines.push(`  PERMUTATION: ${perm.name}`);
		lines.push("─".repeat(70));
		lines.push("");
		
		// Fixture breakdown
		const fixtureStats = analyzeByFixture(perm);
		if (fixtureStats.length > 0) {
			lines.push("  Per-Fixture Breakdown:");
			const fixtureRows = fixtureStats.map(f => [
				f.name,
				`${f.successfulIterations}/${f.totalIterations}`,
				formatDuration(f.meanDurationMs),
				formatNumber(f.meanInputTokens),
			]);
			const fixtureTable = createTable(
				["Fixture", "Success", "Duration", "Input Tokens"],
				fixtureRows,
				["left", "right", "right", "right"]
			);
			lines.push(...fixtureTable.map(l => "    " + l));
			lines.push("");
		}
		
		// Agent breakdown
		const agentStats = analyzeByAgentRole(perm);
		if (agentStats.length > 0) {
			lines.push("  Per-Agent Role Breakdown:");
			const agentRows = agentStats.map(a => [
				a.role,
				String(a.invocations),
				formatDuration(a.meanDurationMs),
				formatNumber(a.totalInputTokens),
				formatNumber(a.totalOutputTokens),
			]);
			const agentTable = createTable(
				["Role", "Calls", "Avg Duration", "Total In", "Total Out"],
				agentRows,
				["left", "right", "right", "right", "right"]
			);
			lines.push(...agentTable.map(l => "    " + l));
			lines.push("");
		}
		
		// Review cycles
		const reviewCycles = getAverageReviewCycles(perm);
		lines.push("  Average Review Cycles (cheap/expensive):");
		lines.push(`    specReviewer: ${reviewCycles.specReviewer.cheap.toFixed(1)}/${reviewCycles.specReviewer.expensive.toFixed(1)}`);
		lines.push(`    planReviewer: ${reviewCycles.planReviewer.cheap.toFixed(1)}/${reviewCycles.planReviewer.expensive.toFixed(1)}`);
		lines.push(`    codeReviewer: ${reviewCycles.codeReviewer.cheap.toFixed(1)}/${reviewCycles.codeReviewer.expensive.toFixed(1)}`);
		lines.push("");
	}
	
	lines.push(divider);
	lines.push(`  Report generated: ${new Date().toISOString()}`);
	lines.push(divider);
	
	return lines.join("\n");
}

// ============================================
// Markdown Report
// ============================================

/**
 * Generate markdown report for documentation
 */
export function formatMarkdownReport(session: BenchmarkSession): string {
	const lines: string[] = [];
	
	// Header
	lines.push(`# Benchmark Report: ${session.sessionId}`);
	lines.push("");
	lines.push(`**Started:** ${session.startedAt}  `);
	lines.push(`**Completed:** ${session.completedAt || "In progress"}  `);
	lines.push(`**Fixtures:** ${session.config.fixtures.length}  `);
	lines.push(`**Iterations:** ${session.config.iterations}  `);
	lines.push("");
	
	// Summary Table
	lines.push("## Permutation Summary");
	lines.push("");
	lines.push("| Permutation | Success Rate | Mean Duration | Mean Input Tokens | Mean Output Tokens | Status |");
	lines.push("|-------------|--------------|---------------|-------------------|--------------------|---------");
	
	const comparison = generateComparisonReport(session);
	for (const p of comparison.permutations) {
		const status = p.isUnsuitable ? "⚠️ Unsuitable" : "✅";
		lines.push(`| ${p.name} | ${formatPercent(p.successRate)} | ${formatDuration(p.meanDurationMs)} | ${formatNumber(p.meanInputTokens)} | ${formatNumber(p.meanOutputTokens)} | ${status} |`);
	}
	lines.push("");
	
	// Ranking
	lines.push("## Ranking");
	lines.push("");
	lines.push("Ranked by success rate (descending), then mean duration (ascending):");
	lines.push("");
	comparison.ranking.forEach((name, i) => {
		const perm = comparison.permutations.find(p => p.name === name);
		const note = perm?.isUnsuitable ? " *(unsuitable)*" : "";
		lines.push(`${i + 1}. **${name}**${note}`);
	});
	lines.push("");
	
	// Comparisons
	if (comparison.comparisons.length > 0) {
		lines.push("## Comparisons vs Baseline");
		lines.push("");
		lines.push(`Baseline: **${comparison.baseline}**`);
		lines.push("");
		lines.push("| Permutation | Duration | Input Tokens | Output Tokens | Success Rate Δ |");
		lines.push("|-------------|----------|--------------|---------------|----------------|");
		
		for (const c of comparison.comparisons) {
			const successDiff = c.successRateDiff >= 0 
				? `+${formatPercent(c.successRateDiff)}` 
				: formatPercent(c.successRateDiff);
			lines.push(`| ${c.permA} | ${formatRatio(c.durationRatio)} | ${formatRatio(c.inputTokenRatio)} | ${formatRatio(c.outputTokenRatio)} | ${successDiff} |`);
		}
		lines.push("");
	}
	
	// Per-Permutation Details
	lines.push("## Detailed Results");
	lines.push("");
	
	for (const perm of session.permutations) {
		lines.push(`### ${perm.name}`);
		lines.push("");
		
		// Fixture breakdown
		const fixtureStats = analyzeByFixture(perm);
		if (fixtureStats.length > 0) {
			lines.push("#### Per-Fixture Breakdown");
			lines.push("");
			lines.push("| Fixture | Success | Mean Duration | Mean Input Tokens |");
			lines.push("|---------|---------|---------------|-------------------|");
			
			for (const f of fixtureStats) {
				lines.push(`| ${f.name} | ${f.successfulIterations}/${f.totalIterations} (${formatPercent(f.successRate)}) | ${formatDuration(f.meanDurationMs)} | ${formatNumber(f.meanInputTokens)} |`);
			}
			lines.push("");
		}
		
		// Agent breakdown
		const agentStats = analyzeByAgentRole(perm);
		if (agentStats.length > 0) {
			lines.push("#### Agent Role Breakdown");
			lines.push("");
			lines.push("| Role | Invocations | Mean Duration | Total Input | Total Output |");
			lines.push("|------|-------------|---------------|-------------|--------------|");
			
			for (const a of agentStats) {
				lines.push(`| ${a.role} | ${a.invocations} | ${formatDuration(a.meanDurationMs)} | ${formatNumber(a.totalInputTokens)} | ${formatNumber(a.totalOutputTokens)} |`);
			}
			lines.push("");
		}
		
		// Failure analysis
		const failures = perm.iterations.filter(i => !i.success);
		if (failures.length > 0) {
			lines.push("#### Failures");
			lines.push("");
			
			const failureReasons = new Map<string, number>();
			for (const f of failures) {
				const reason = f.failureReason ?? "unknown";
				failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
			}
			
			for (const [reason, count] of failureReasons) {
				lines.push(`- **${reason}**: ${count} occurrence(s)`);
			}
			lines.push("");
		}
	}
	
	// Footer
	lines.push("---");
	lines.push(`*Report generated: ${new Date().toISOString()}*`);
	
	return lines.join("\n");
}

// ============================================
// CSV Export
// ============================================

/**
 * Escape value for CSV
 */
function escapeCSV(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Generate CSV export for iteration data
 */
export function formatCSVReport(session: BenchmarkSession, detailed: boolean = false): string {
	const lines: string[] = [];
	
	if (detailed) {
		// Detailed per-iteration export
		lines.push("permutation,fixture,iteration,success,failure_reason,duration_ms,input_tokens,output_tokens,phases_completed");
		
		for (const perm of session.permutations) {
			for (const iter of perm.iterations) {
				lines.push([
					escapeCSV(perm.name),
					escapeCSV(iter.fixture),
					String(iter.iterationId),
					iter.success ? "true" : "false",
					escapeCSV(iter.failureReason ?? ""),
					String(iter.metrics.totalDurationMs),
					String(iter.metrics.totalInputTokens),
					String(iter.metrics.totalOutputTokens),
					String(iter.metrics.phasesCompleted),
				].join(","));
			}
		}
	} else {
		// Summary export
		lines.push("permutation,success_rate,mean_duration_ms,median_duration_ms,p95_duration_ms,mean_input_tokens,mean_output_tokens,total_iterations,successful_iterations");
		
		for (const perm of session.permutations) {
			const successful = perm.iterations.filter(i => i.success).length;
			lines.push([
				escapeCSV(perm.name),
				perm.aggregates.successRate.toFixed(4),
				String(Math.round(perm.aggregates.meanDurationMs)),
				String(Math.round(perm.aggregates.medianDurationMs)),
				String(Math.round(perm.aggregates.p95DurationMs)),
				String(Math.round(perm.aggregates.meanInputTokens)),
				String(Math.round(perm.aggregates.meanOutputTokens)),
				String(perm.iterations.length),
				String(successful),
			].join(","));
		}
	}
	
	return lines.join("\n");
}

// ============================================
// Export Entry Point
// ============================================

/**
 * Generate report in specified format
 */
export function formatReport(
	session: BenchmarkSession,
	format: ExportFormat,
	options?: Omit<ExportOptions, "format">
): string {
	switch (format) {
		case "markdown":
			return formatMarkdownReport(session);
		case "csv":
			return formatCSVReport(session, options?.detailed);
		case "json":
			return JSON.stringify(session, null, 2);
		default:
			return formatPlainTextReport(session);
	}
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 4.4: Create Report CLI Command

- **Files**: `extensions/spec-bench/cli-report.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-bench/cli.ts` CLI patterns
- **Action**: Create CLI subcommand for generating reports

```typescript
/**
 * CLI command for generating benchmark reports
 * 
 * Usage:
 *   spec-bench report <session.json> [--format markdown|csv|json] [--output file]
 *   spec-bench compare <session.json> [--baseline permutation-name]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BenchmarkSession } from "./types.ts";
import type { ExportFormat } from "./report-types.ts";
import { loadSession } from "./results.ts";
import { formatReport, formatPlainTextReport, formatMarkdownReport, formatCSVReport } from "./report-formatter.ts";
import { generateComparisonReport } from "./analysis.ts";

// ============================================
// CLI Helpers
// ============================================

function printError(message: string): void {
	console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

function printSuccess(message: string): void {
	console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

// ============================================
// Report Command
// ============================================

export interface ReportOptions {
	sessionPath: string;
	format: ExportFormat;
	outputPath?: string;
	detailed?: boolean;
}

/**
 * Generate and output a benchmark report
 */
export async function runReportCommand(options: ReportOptions): Promise<boolean> {
	const { sessionPath, format, outputPath, detailed } = options;
	
	// Load session
	const session = loadSession(sessionPath);
	if (!session) {
		printError(`Could not load session from: ${sessionPath}`);
		return false;
	}
	
	// Generate report
	const report = formatReport(session, format, { detailed });
	
	// Output
	if (outputPath) {
		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}
		fs.writeFileSync(outputPath, report, "utf-8");
		printSuccess(`Report written to: ${outputPath}`);
	} else {
		console.log(report);
	}
	
	return true;
}

// ============================================
// Compare Command
// ============================================

export interface CompareOptions {
	sessionPath: string;
	baseline?: string;
}

/**
 * Display permutation comparison
 */
export async function runCompareCommand(options: CompareOptions): Promise<boolean> {
	const { sessionPath, baseline } = options;
	
	// Load session
	const session = loadSession(sessionPath);
	if (!session) {
		printError(`Could not load session from: ${sessionPath}`);
		return false;
	}
	
	if (session.permutations.length === 0) {
		printError("Session has no permutation results");
		return false;
	}
	
	// Validate baseline if specified
	if (baseline && !session.permutations.find(p => p.name === baseline)) {
		printError(`Baseline permutation not found: ${baseline}`);
		console.log("Available permutations:");
		for (const p of session.permutations) {
			console.log(`  - ${p.name}`);
		}
		return false;
	}
	
	// Generate comparison
	const comparison = generateComparisonReport(session, baseline);
	
	// Display comparison
	console.log("\n" + "═".repeat(60));
	console.log(`  PERMUTATION COMPARISON: ${session.sessionId}`);
	console.log("═".repeat(60));
	console.log("");
	console.log(`  Baseline: ${comparison.baseline}`);
	console.log("");
	
	// Summary table
	console.log("  Summary:");
	console.log("  " + "─".repeat(56));
	console.log("  " + "Permutation".padEnd(20) + "Success".padStart(10) + "Duration".padStart(12) + "Tokens (in)".padStart(14));
	console.log("  " + "─".repeat(56));
	
	for (const p of comparison.permutations) {
		const status = p.isUnsuitable ? "⚠️" : "  ";
		const successStr = (p.successRate * 100).toFixed(1) + "%";
		const durationStr = formatDurationCompact(p.meanDurationMs);
		const tokensStr = formatNumberCompact(p.meanInputTokens);
		console.log(`  ${status}${p.name.padEnd(18)}${successStr.padStart(10)}${durationStr.padStart(12)}${tokensStr.padStart(14)}`);
	}
	console.log("  " + "─".repeat(56));
	console.log("");
	
	// Comparisons vs baseline
	if (comparison.comparisons.length > 0) {
		console.log("  Comparison vs Baseline:");
		console.log("  " + "─".repeat(56));
		
		for (const c of comparison.comparisons) {
			const durationChange = c.durationRatio < 1 ? "faster" : "slower";
			const tokenChange = c.inputTokenRatio < 1 ? "fewer" : "more";
			const successChange = c.successRateDiff >= 0 ? "+" : "";
			
			console.log(`  ${c.permA}:`);
			console.log(`    Duration: ${c.durationRatio.toFixed(2)}x (${durationChange})`);
			console.log(`    Tokens:   ${c.inputTokenRatio.toFixed(2)}x (${tokenChange})`);
			console.log(`    Success:  ${successChange}${(c.successRateDiff * 100).toFixed(1)}%`);
		}
		console.log("");
	}
	
	// Ranking
	console.log("  Ranking:");
	comparison.ranking.forEach((name, i) => {
		const isUnsuitable = comparison.permutations.find(p => p.name === name)?.isUnsuitable;
		const marker = isUnsuitable ? " ⚠️ (unsuitable)" : "";
		console.log(`    ${i + 1}. ${name}${marker}`);
	});
	console.log("");
	console.log("═".repeat(60));
	
	return true;
}

// ============================================
// Formatting Helpers
// ============================================

function formatDurationCompact(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function formatNumberCompact(n: number): string {
	if (n < 1000) return String(Math.round(n));
	if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

// ============================================
// Command Parser
// ============================================

/**
 * Parse report/compare command from CLI args
 */
export function parseReportArgs(args: string[]): { command: "report" | "compare"; options: ReportOptions | CompareOptions } | null {
	if (args.length < 2) {
		return null;
	}
	
	const command = args[0];
	const sessionPath = args[1];
	
	if (command === "report") {
		let format: ExportFormat = "markdown";
		let outputPath: string | undefined;
		let detailed = false;
		
		for (let i = 2; i < args.length; i++) {
			if (args[i] === "--format" && args[i + 1]) {
				format = args[++i] as ExportFormat;
			} else if (args[i] === "--output" && args[i + 1]) {
				outputPath = args[++i];
			} else if (args[i] === "--detailed") {
				detailed = true;
			}
		}
		
		return {
			command: "report",
			options: { sessionPath, format, outputPath, detailed },
		};
	}
	
	if (command === "compare") {
		let baseline: string | undefined;
		
		for (let i = 2; i < args.length; i++) {
			if (args[i] === "--baseline" && args[i + 1]) {
				baseline = args[++i];
			}
		}
		
		return {
			command: "compare",
			options: { sessionPath, baseline },
		};
	}
	
	return null;
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 4.5: Update Main CLI with Report Commands

- **Files**: `extensions/spec-bench/cli.ts` (modify)
- **Action**: Add report and compare subcommands to the main CLI

Add new help text and command handling. Find the HELP_TEXT constant and update it:

```typescript
// Before (existing HELP_TEXT):
const HELP_TEXT = `
spec-bench - Benchmark tool for spec-pipeline configurations

USAGE:
  spec-bench <config.json>     Run benchmarks with the specified config
  spec-bench --help            Show this help message
  spec-bench --version         Show version information
...
`.trim();
```

```typescript
// After (updated HELP_TEXT):
const HELP_TEXT = `
spec-bench - Benchmark tool for spec-pipeline configurations

USAGE:
  spec-bench <config.json>              Run benchmarks with the specified config
  spec-bench report <session.json>      Generate report from results
  spec-bench compare <session.json>     Compare permutations in results
  spec-bench --help                     Show this help message
  spec-bench --version                  Show version information

COMMANDS:
  <config.json>                         Run benchmarks using configuration file
  
  report <session.json> [options]       Generate detailed report
    --format <format>                   Output format: markdown, csv, json (default: markdown)
    --output <path>                     Write to file instead of stdout
    --detailed                          Include per-iteration data (CSV only)
  
  compare <session.json> [options]      Compare permutations
    --baseline <name>                   Baseline permutation for comparisons

CONFIGURATION:
  The config file must be a JSON file with the following structure:
  {
    "fixtures": [
      { "path": "./fixtures/example" }
    ],
    "permutations": [
      {
        "name": "all-sonnet",
        "models": { ... }
      }
    ],
    "iterations": 3,
    "outputDir": "./benchmark-results"
  }

FIXTURE STRUCTURE:
  Each fixture directory must contain:
    fixture.json    - Fixture configuration
    feature.md      - Feature description for the pipeline
    discovery.json  - Pre-scripted discovery answers (optional)
    hidden-tests/   - Tests to add post-implementation (optional)
    project/        - Project source (or specify in fixture.json)

For more information, see the spec-bench documentation.
`.trim();
```

Add command handling after the help/version checks. Find the section after `// Require config file argument` and update:

```typescript
// Before:
	// Require config file argument
	if (args.length === 0) {
		printError("No configuration file specified");
		console.log("\nUsage: spec-bench <config.json>");
		console.log("Run 'spec-bench --help' for more information.");
		process.exit(1);
	}
	
	const configPath = args[0];
```

```typescript
// After:
	// Handle subcommands
	if (args[0] === "report" || args[0] === "compare") {
		const { parseReportArgs, runReportCommand, runCompareCommand } = await import("./cli-report.ts");
		
		const parsed = parseReportArgs(args);
		if (!parsed) {
			printError("Invalid command. Run 'spec-bench --help' for usage.");
			process.exit(1);
		}
		
		let success: boolean;
		if (parsed.command === "report") {
			success = await runReportCommand(parsed.options as Parameters<typeof runReportCommand>[0]);
		} else {
			success = await runCompareCommand(parsed.options as Parameters<typeof runCompareCommand>[0]);
		}
		
		process.exit(success ? 0 : 1);
	}
	
	// Require config file argument for benchmark run
	if (args.length === 0) {
		printError("No configuration file specified");
		console.log("\nUsage: spec-bench <config.json>");
		console.log("Run 'spec-bench --help' for more information.");
		process.exit(1);
	}
	
	const configPath = args[0];
```

- **Verify**: Run `npx tsx extensions/spec-bench/cli.ts --help` shows new commands

---

### Step 4.6: Update Index Exports

- **Files**: `extensions/spec-bench/index.ts` (modify)
- **Action**: Add exports for new report modules

Add to the existing index.ts:

```typescript
// Report types
export type {
	FixtureStats,
	PermutationFixtureBreakdown,
	AgentRoleStats,
	PermutationComparison,
	ComparisonReport,
	PermutationSummary,
	BenchmarkReport,
	ExportFormat,
	ExportOptions,
} from "./report-types.ts";

// Analysis functions
export {
	analyzeByFixture,
	analyzeByAgentRole,
	getFixtureBreakdowns,
	getAgentAnalysis,
	comparePermutations,
	generateComparisonReport,
	createPermutationSummary,
	getAverageReviewCycles,
} from "./analysis.ts";

// Report formatting
export {
	formatPlainTextReport,
	formatMarkdownReport,
	formatCSVReport,
	formatReport,
} from "./report-formatter.ts";

// Report CLI commands
export {
	runReportCommand,
	runCompareCommand,
	parseReportArgs,
	type ReportOptions,
	type CompareOptions,
} from "./cli-report.ts";
```

- **Verify**: TypeScript compiles without errors

---

### Step 4.7: Create Analysis Tests

- **Files**: `extensions/spec-bench/analysis.test.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-bench/metrics.test.ts` test patterns
- **Action**: Create comprehensive tests for analysis functions

```typescript
import { describe, it, expect } from "vitest";
import {
	analyzeByFixture,
	analyzeByAgentRole,
	comparePermutations,
	generateComparisonReport,
	createPermutationSummary,
	getAverageReviewCycles,
} from "./analysis.ts";
import type { PermutationResult, IterationResult, IterationMetrics } from "./types.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

// Helper to create iteration result
function makeIteration(
	fixture: string,
	success: boolean,
	durationMs: number = 1000,
	inputTokens: number = 100,
	outputTokens: number = 50,
	failureReason?: string
): IterationResult {
	const metrics: IterationMetrics = {
		...createEmptyIterationMetrics(),
		totalDurationMs: durationMs,
		totalInputTokens: inputTokens,
		totalOutputTokens: outputTokens,
		agentMetrics: [
			{ role: "specDrafter", model: "opus", thinking: "high", durationMs: durationMs / 2, inputTokens: inputTokens / 2, outputTokens: outputTokens / 2 },
			{ role: "implementer", model: "opus", thinking: "high", durationMs: durationMs / 2, inputTokens: inputTokens / 2, outputTokens: outputTokens / 2 },
		],
		testsOriginalPassed: success,
		testsHiddenPassed: success,
	};
	
	return {
		iterationId: 1,
		fixture,
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		success,
		failureReason: success ? null : (failureReason ?? "test_failure") as any,
		metrics,
	};
}

// Helper to create permutation result
function makePermutation(name: string, iterations: IterationResult[]): PermutationResult {
	const successful = iterations.filter(i => i.success);
	const durations = successful.map(i => i.metrics.totalDurationMs);
	const sorted = [...durations].sort((a, b) => a - b);
	
	return {
		name,
		config: { name },
		iterations,
		aggregates: {
			successRate: iterations.length ? successful.length / iterations.length : 0,
			meanDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
			medianDurationMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
			p95DurationMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
			meanInputTokens: successful.length ? successful.reduce((s, i) => s + i.metrics.totalInputTokens, 0) / successful.length : 0,
			meanOutputTokens: successful.length ? successful.reduce((s, i) => s + i.metrics.totalOutputTokens, 0) / successful.length : 0,
		},
	};
}

describe("analyzeByFixture", () => {
	it("groups iterations by fixture", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true, 1000, 100),
			makeIteration("fixture-a", true, 2000, 200),
			makeIteration("fixture-b", true, 1500, 150),
		]);
		
		const stats = analyzeByFixture(perm);
		
		expect(stats.length).toBe(2);
		expect(stats.find(s => s.name === "fixture-a")?.totalIterations).toBe(2);
		expect(stats.find(s => s.name === "fixture-b")?.totalIterations).toBe(1);
	});
	
	it("calculates success rate per fixture", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true),
			makeIteration("fixture-a", false),
			makeIteration("fixture-b", true),
		]);
		
		const stats = analyzeByFixture(perm);
		
		expect(stats.find(s => s.name === "fixture-a")?.successRate).toBe(0.5);
		expect(stats.find(s => s.name === "fixture-b")?.successRate).toBe(1);
	});
	
	it("tracks failure reasons", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", false, 1000, 100, 50, "timeout"),
			makeIteration("fixture-a", false, 1000, 100, 50, "timeout"),
			makeIteration("fixture-a", false, 1000, 100, 50, "test_failure"),
		]);
		
		const stats = analyzeByFixture(perm);
		const fixtureA = stats.find(s => s.name === "fixture-a");
		
		expect(fixtureA?.failureReasons["timeout"]).toBe(2);
		expect(fixtureA?.failureReasons["test_failure"]).toBe(1);
	});
	
	it("calculates means only from successful iterations", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true, 1000, 100, 50),
			makeIteration("fixture-a", false, 99999, 99999, 99999),  // Should be excluded
		]);
		
		const stats = analyzeByFixture(perm);
		const fixtureA = stats.find(s => s.name === "fixture-a");
		
		expect(fixtureA?.meanDurationMs).toBe(1000);
		expect(fixtureA?.meanInputTokens).toBe(100);
	});
});

describe("analyzeByAgentRole", () => {
	it("aggregates metrics by role", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true, 1000, 100),
			makeIteration("fixture-a", true, 2000, 200),
		]);
		
		const stats = analyzeByAgentRole(perm);
		
		expect(stats.length).toBe(2);  // specDrafter and implementer
		expect(stats.find(s => s.role === "specDrafter")?.invocations).toBe(2);
		expect(stats.find(s => s.role === "implementer")?.invocations).toBe(2);
	});
	
	it("excludes failed iterations", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true, 1000, 100),
			makeIteration("fixture-a", false, 99999, 99999),  // Should be excluded
		]);
		
		const stats = analyzeByAgentRole(perm);
		
		expect(stats.find(s => s.role === "specDrafter")?.invocations).toBe(1);
	});
	
	it("sorts by total duration descending", () => {
		const perm = makePermutation("test", [
			makeIteration("fixture-a", true, 1000, 100),
		]);
		
		// Modify to have different durations per role
		perm.iterations[0].metrics.agentMetrics = [
			{ role: "fast", model: "haiku", thinking: "off", durationMs: 100, inputTokens: 10, outputTokens: 5 },
			{ role: "slow", model: "opus", thinking: "high", durationMs: 900, inputTokens: 90, outputTokens: 45 },
		];
		
		const stats = analyzeByAgentRole(perm);
		
		expect(stats[0].role).toBe("slow");  // Highest duration first
		expect(stats[1].role).toBe("fast");
	});
});

describe("comparePermutations", () => {
	it("calculates correct ratios", () => {
		const permA = makePermutation("a", [makeIteration("f", true, 2000, 200, 100)]);
		const permB = makePermutation("b", [makeIteration("f", true, 1000, 100, 50)]);
		
		const comparison = comparePermutations(permA, permB);
		
		expect(comparison.durationRatio).toBe(2);  // A is 2x slower
		expect(comparison.inputTokenRatio).toBe(2);  // A uses 2x more
		expect(comparison.outputTokenRatio).toBe(2);
	});
	
	it("handles zero baseline gracefully", () => {
		const permA = makePermutation("a", [makeIteration("f", true, 1000, 100, 50)]);
		const permB = makePermutation("b", []);  // No successful iterations
		
		const comparison = comparePermutations(permA, permB);
		
		expect(comparison.durationRatio).toBe(Infinity);
	});
	
	it("calculates success rate difference", () => {
		const permA = makePermutation("a", [
			makeIteration("f", true),
			makeIteration("f", true),
		]);
		const permB = makePermutation("b", [
			makeIteration("f", true),
			makeIteration("f", false),
		]);
		
		const comparison = comparePermutations(permA, permB);
		
		expect(comparison.successRateDiff).toBe(0.5);  // A is 50% better
	});
});

describe("generateComparisonReport", () => {
	it("ranks permutations by success rate then duration", () => {
		const session = {
			sessionId: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			config: { fixtures: [], permutations: [], iterations: 1, outputDir: "" },
			permutations: [
				makePermutation("slow-high-success", [makeIteration("f", true, 2000, 200)]),
				makePermutation("fast-high-success", [makeIteration("f", true, 1000, 100)]),
				makePermutation("low-success", [makeIteration("f", false)]),
			],
		};
		
		const report = generateComparisonReport(session);
		
		// fast-high-success should rank first (same success, lower duration)
		expect(report.ranking[0]).toBe("fast-high-success");
		expect(report.ranking[1]).toBe("slow-high-success");
		// low-success is unsuitable and should be last
		expect(report.ranking[2]).toBe("low-success");
	});
	
	it("uses first permutation as default baseline", () => {
		const session = {
			sessionId: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			config: { fixtures: [], permutations: [], iterations: 1, outputDir: "" },
			permutations: [
				makePermutation("first", [makeIteration("f", true)]),
				makePermutation("second", [makeIteration("f", true)]),
			],
		};
		
		const report = generateComparisonReport(session);
		
		expect(report.baseline).toBe("first");
	});
	
	it("respects custom baseline", () => {
		const session = {
			sessionId: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			config: { fixtures: [], permutations: [], iterations: 1, outputDir: "" },
			permutations: [
				makePermutation("first", [makeIteration("f", true)]),
				makePermutation("second", [makeIteration("f", true)]),
			],
		};
		
		const report = generateComparisonReport(session, "second");
		
		expect(report.baseline).toBe("second");
	});
});

describe("createPermutationSummary", () => {
	it("includes all summary fields", () => {
		const perm = makePermutation("test", [
			makeIteration("f", true, 1000, 100, 50),
			makeIteration("f", false),
		]);
		
		const summary = createPermutationSummary(perm);
		
		expect(summary.name).toBe("test");
		expect(summary.totalIterations).toBe(2);
		expect(summary.successfulIterations).toBe(1);
		expect(summary.successRate).toBe(0.5);
	});
	
	it("flags unsuitable permutations", () => {
		const perm = makePermutation("failing", [
			makeIteration("f", false),
			makeIteration("f", false),
		]);
		
		const summary = createPermutationSummary(perm);
		
		expect(summary.isUnsuitable).toBe(true);
	});
});

describe("getAverageReviewCycles", () => {
	it("calculates average from successful iterations", () => {
		const iter1 = makeIteration("f", true);
		iter1.metrics.reviewCycles = {
			specReviewer: { cheap: 2, expensive: 1 },
			planReviewer: { cheap: 1, expensive: 0 },
			codeReviewer: { cheap: 3, expensive: 2 },
		};
		
		const iter2 = makeIteration("f", true);
		iter2.metrics.reviewCycles = {
			specReviewer: { cheap: 4, expensive: 1 },
			planReviewer: { cheap: 1, expensive: 0 },
			codeReviewer: { cheap: 1, expensive: 0 },
		};
		
		const perm = makePermutation("test", [iter1, iter2]);
		
		const avg = getAverageReviewCycles(perm);
		
		expect(avg.specReviewer.cheap).toBe(3);  // (2+4)/2
		expect(avg.codeReviewer.cheap).toBe(2);  // (3+1)/2
	});
	
	it("returns zeros for empty permutation", () => {
		const perm = makePermutation("empty", []);
		
		const avg = getAverageReviewCycles(perm);
		
		expect(avg.specReviewer.cheap).toBe(0);
		expect(avg.specReviewer.expensive).toBe(0);
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 4.8: Create Report Formatter Tests

- **Files**: `extensions/spec-bench/report-formatter.test.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/formatting.test.ts` test patterns
- **Action**: Create tests for report formatting functions

```typescript
import { describe, it, expect } from "vitest";
import {
	formatPlainTextReport,
	formatMarkdownReport,
	formatCSVReport,
	formatReport,
} from "./report-formatter.ts";
import type { BenchmarkSession, PermutationResult, IterationResult } from "./types.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

// Helper to create minimal session
function makeSession(permutations: PermutationResult[]): BenchmarkSession {
	return {
		sessionId: "test-session-123",
		startedAt: "2026-02-02T03:00:00Z",
		completedAt: "2026-02-02T04:00:00Z",
		config: {
			fixtures: [{ path: "./fixtures/test" }],
			permutations: permutations.map(p => ({ name: p.name })),
			iterations: 1,
			outputDir: "./results",
		},
		permutations,
	};
}

function makeIteration(fixture: string, success: boolean): IterationResult {
	return {
		iterationId: 1,
		fixture,
		startedAt: "2026-02-02T03:00:00Z",
		completedAt: "2026-02-02T03:30:00Z",
		success,
		failureReason: success ? null : "test_failure",
		metrics: {
			...createEmptyIterationMetrics(),
			totalDurationMs: 1800000,  // 30 minutes
			totalInputTokens: 50000,
			totalOutputTokens: 10000,
			agentMetrics: [
				{ role: "specDrafter", model: "opus", thinking: "high", durationMs: 600000, inputTokens: 20000, outputTokens: 5000 },
			],
		},
	};
}

function makePermutation(name: string, successRate: number): PermutationResult {
	const iterations = [
		makeIteration("test-fixture", successRate >= 0.5),
		makeIteration("test-fixture", successRate >= 1.0),
	];
	const successful = iterations.filter(i => i.success);
	
	return {
		name,
		config: { name },
		iterations,
		aggregates: {
			successRate: successful.length / iterations.length,
			meanDurationMs: 1800000,
			medianDurationMs: 1800000,
			p95DurationMs: 1800000,
			meanInputTokens: 50000,
			meanOutputTokens: 10000,
		},
	};
}

describe("formatPlainTextReport", () => {
	it("includes session header", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const report = formatPlainTextReport(session);
		
		expect(report).toContain("BENCHMARK REPORT");
		expect(report).toContain("test-session-123");
	});
	
	it("includes permutation summary table", () => {
		const session = makeSession([
			makePermutation("perm-a", 1.0),
			makePermutation("perm-b", 0.5),
		]);
		const report = formatPlainTextReport(session);
		
		expect(report).toContain("perm-a");
		expect(report).toContain("perm-b");
		expect(report).toContain("100.0%");
		expect(report).toContain("50.0%");
	});
	
	it("includes ranking", () => {
		const session = makeSession([
			makePermutation("fast", 1.0),
			makePermutation("slow", 1.0),
		]);
		const report = formatPlainTextReport(session);
		
		expect(report).toContain("RANKING");
		expect(report).toContain("1.");
	});
	
	it("marks unsuitable permutations", () => {
		const session = makeSession([makePermutation("failing", 0)]);
		const report = formatPlainTextReport(session);
		
		expect(report).toContain("⚠️");
	});
});

describe("formatMarkdownReport", () => {
	it("generates valid markdown headers", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const report = formatMarkdownReport(session);
		
		expect(report).toContain("# Benchmark Report:");
		expect(report).toContain("## Permutation Summary");
		expect(report).toContain("## Ranking");
	});
	
	it("generates markdown tables", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const report = formatMarkdownReport(session);
		
		// Markdown table syntax
		expect(report).toContain("|");
		expect(report).toContain("|---|");
	});
	
	it("includes detailed results section", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const report = formatMarkdownReport(session);
		
		expect(report).toContain("## Detailed Results");
		expect(report).toContain("### test");
	});
	
	it("includes footer with timestamp", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const report = formatMarkdownReport(session);
		
		expect(report).toContain("Report generated:");
	});
});

describe("formatCSVReport", () => {
	it("generates CSV header row", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const csv = formatCSVReport(session, false);
		
		const lines = csv.split("\n");
		expect(lines[0]).toContain("permutation");
		expect(lines[0]).toContain("success_rate");
	});
	
	it("includes data rows", () => {
		const session = makeSession([
			makePermutation("perm-a", 1.0),
			makePermutation("perm-b", 0.5),
		]);
		const csv = formatCSVReport(session, false);
		
		const lines = csv.split("\n");
		expect(lines.length).toBe(3);  // Header + 2 data rows
		expect(lines[1]).toContain("perm-a");
		expect(lines[2]).toContain("perm-b");
	});
	
	it("detailed mode includes per-iteration data", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		const csv = formatCSVReport(session, true);
		
		expect(csv).toContain("iteration");
		expect(csv).toContain("fixture");
	});
	
	it("escapes values with commas", () => {
		const session = makeSession([makePermutation("test, with comma", 1.0)]);
		const csv = formatCSVReport(session, false);
		
		expect(csv).toContain('"test, with comma"');
	});
});

describe("formatReport", () => {
	it("dispatches to correct formatter", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		
		const markdown = formatReport(session, "markdown");
		expect(markdown).toContain("# Benchmark Report");
		
		const csv = formatReport(session, "csv");
		expect(csv).toContain("permutation,success_rate");
		
		const json = formatReport(session, "json");
		expect(JSON.parse(json).sessionId).toBe("test-session-123");
	});
	
	it("passes options to formatters", () => {
		const session = makeSession([makePermutation("test", 1.0)]);
		
		const detailed = formatReport(session, "csv", { detailed: true });
		expect(detailed).toContain("iteration");
		
		const summary = formatReport(session, "csv", { detailed: false });
		expect(summary).not.toContain("iteration");
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 4.9: Create CLI Report Tests

- **Files**: `extensions/spec-bench/cli-report.test.ts` (new)
- **Pattern Reference**: Based on existing CLI test patterns
- **Action**: Create tests for CLI report commands

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseReportArgs, runReportCommand, runCompareCommand } from "./cli-report.ts";
import type { BenchmarkSession } from "./types.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

describe("parseReportArgs", () => {
	describe("report command", () => {
		it("parses minimal report command", () => {
			const result = parseReportArgs(["report", "session.json"]);
			
			expect(result?.command).toBe("report");
			expect(result?.options).toEqual({
				sessionPath: "session.json",
				format: "markdown",
				outputPath: undefined,
				detailed: false,
			});
		});
		
		it("parses format option", () => {
			const result = parseReportArgs(["report", "session.json", "--format", "csv"]);
			
			expect((result?.options as any).format).toBe("csv");
		});
		
		it("parses output option", () => {
			const result = parseReportArgs(["report", "session.json", "--output", "report.md"]);
			
			expect((result?.options as any).outputPath).toBe("report.md");
		});
		
		it("parses detailed flag", () => {
			const result = parseReportArgs(["report", "session.json", "--detailed"]);
			
			expect((result?.options as any).detailed).toBe(true);
		});
		
		it("parses multiple options", () => {
			const result = parseReportArgs([
				"report", "session.json",
				"--format", "csv",
				"--output", "report.csv",
				"--detailed"
			]);
			
			expect((result?.options as any).format).toBe("csv");
			expect((result?.options as any).outputPath).toBe("report.csv");
			expect((result?.options as any).detailed).toBe(true);
		});
	});
	
	describe("compare command", () => {
		it("parses minimal compare command", () => {
			const result = parseReportArgs(["compare", "session.json"]);
			
			expect(result?.command).toBe("compare");
			expect(result?.options).toEqual({
				sessionPath: "session.json",
				baseline: undefined,
			});
		});
		
		it("parses baseline option", () => {
			const result = parseReportArgs(["compare", "session.json", "--baseline", "perm-a"]);
			
			expect((result?.options as any).baseline).toBe("perm-a");
		});
	});
	
	describe("invalid commands", () => {
		it("returns null for unknown command", () => {
			const result = parseReportArgs(["unknown", "session.json"]);
			expect(result).toBeNull();
		});
		
		it("returns null for missing arguments", () => {
			const result = parseReportArgs(["report"]);
			expect(result).toBeNull();
		});
		
		it("returns null for empty args", () => {
			const result = parseReportArgs([]);
			expect(result).toBeNull();
		});
	});
});

describe("runReportCommand", () => {
	let tempDir: string;
	let sessionPath: string;
	
	const sampleSession: BenchmarkSession = {
		sessionId: "test-123",
		startedAt: "2026-02-02T03:00:00Z",
		completedAt: "2026-02-02T04:00:00Z",
		config: {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "test-perm" }],
			iterations: 1,
			outputDir: "./results",
		},
		permutations: [{
			name: "test-perm",
			config: { name: "test-perm" },
			iterations: [{
				iterationId: 1,
				fixture: "test-fixture",
				startedAt: "2026-02-02T03:00:00Z",
				completedAt: "2026-02-02T03:30:00Z",
				success: true,
				failureReason: null,
				metrics: {
					...createEmptyIterationMetrics(),
					totalDurationMs: 1000,
					totalInputTokens: 100,
					totalOutputTokens: 50,
				},
			}],
			aggregates: {
				successRate: 1,
				meanDurationMs: 1000,
				medianDurationMs: 1000,
				p95DurationMs: 1000,
				meanInputTokens: 100,
				meanOutputTokens: 50,
			},
		}],
	};
	
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-cli-test-"));
		sessionPath = path.join(tempDir, "session.json");
		fs.writeFileSync(sessionPath, JSON.stringify(sampleSession));
	});
	
	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
	
	it("generates report to stdout", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		
		const result = await runReportCommand({
			sessionPath,
			format: "markdown",
		});
		
		expect(result).toBe(true);
		expect(consoleSpy).toHaveBeenCalled();
		const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
		expect(output).toContain("# Benchmark Report");
		
		consoleSpy.mockRestore();
	});
	
	it("writes report to file", async () => {
		const outputPath = path.join(tempDir, "report.md");
		
		const result = await runReportCommand({
			sessionPath,
			format: "markdown",
			outputPath,
		});
		
		expect(result).toBe(true);
		expect(fs.existsSync(outputPath)).toBe(true);
		const content = fs.readFileSync(outputPath, "utf-8");
		expect(content).toContain("# Benchmark Report");
	});
	
	it("returns false for missing session", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		
		const result = await runReportCommand({
			sessionPath: path.join(tempDir, "missing.json"),
			format: "markdown",
		});
		
		expect(result).toBe(false);
		
		errorSpy.mockRestore();
	});
});

describe("runCompareCommand", () => {
	let tempDir: string;
	let sessionPath: string;
	
	const sampleSession: BenchmarkSession = {
		sessionId: "test-123",
		startedAt: "2026-02-02T03:00:00Z",
		completedAt: "2026-02-02T04:00:00Z",
		config: {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "perm-a" }, { name: "perm-b" }],
			iterations: 1,
			outputDir: "./results",
		},
		permutations: [
			{
				name: "perm-a",
				config: { name: "perm-a" },
				iterations: [{
					iterationId: 1,
					fixture: "test",
					startedAt: "2026-02-02T03:00:00Z",
					completedAt: "2026-02-02T03:30:00Z",
					success: true,
					failureReason: null,
					metrics: { ...createEmptyIterationMetrics(), totalDurationMs: 1000, totalInputTokens: 100, totalOutputTokens: 50 },
				}],
				aggregates: { successRate: 1, meanDurationMs: 1000, medianDurationMs: 1000, p95DurationMs: 1000, meanInputTokens: 100, meanOutputTokens: 50 },
			},
			{
				name: "perm-b",
				config: { name: "perm-b" },
				iterations: [{
					iterationId: 1,
					fixture: "test",
					startedAt: "2026-02-02T03:00:00Z",
					completedAt: "2026-02-02T03:30:00Z",
					success: true,
					failureReason: null,
					metrics: { ...createEmptyIterationMetrics(), totalDurationMs: 2000, totalInputTokens: 200, totalOutputTokens: 100 },
				}],
				aggregates: { successRate: 1, meanDurationMs: 2000, medianDurationMs: 2000, p95DurationMs: 2000, meanInputTokens: 200, meanOutputTokens: 100 },
			},
		],
	};
	
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-compare-test-"));
		sessionPath = path.join(tempDir, "session.json");
		fs.writeFileSync(sessionPath, JSON.stringify(sampleSession));
	});
	
	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
	
	it("shows comparison output", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		
		const result = await runCompareCommand({ sessionPath });
		
		expect(result).toBe(true);
		const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
		expect(output).toContain("PERMUTATION COMPARISON");
		expect(output).toContain("perm-a");
		expect(output).toContain("perm-b");
		
		consoleSpy.mockRestore();
	});
	
	it("uses custom baseline", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		
		const result = await runCompareCommand({
			sessionPath,
			baseline: "perm-b",
		});
		
		expect(result).toBe(true);
		const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
		expect(output).toContain("Baseline: perm-b");
		
		consoleSpy.mockRestore();
	});
	
	it("returns false for invalid baseline", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		
		const result = await runCompareCommand({
			sessionPath,
			baseline: "nonexistent",
		});
		
		expect(result).toBe(false);
		
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-bench/report-types.ts` | Type definitions for reports and analysis | `extensions/spec-pipeline/types.ts` |
| `extensions/spec-bench/analysis.ts` | Analysis functions for benchmark results | `extensions/spec-bench/metrics.ts` |
| `extensions/spec-bench/report-formatter.ts` | Report generation in various formats | `extensions/spec-pipeline/formatting.ts` |
| `extensions/spec-bench/cli-report.ts` | CLI commands for report/compare | `extensions/spec-bench/cli.ts` |
| `extensions/spec-bench/analysis.test.ts` | Analysis function tests | `extensions/spec-bench/metrics.test.ts` |
| `extensions/spec-bench/report-formatter.test.ts` | Report formatter tests | `extensions/spec-pipeline/formatting.test.ts` |
| `extensions/spec-bench/cli-report.test.ts` | CLI report command tests | Existing CLI test patterns |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-bench/cli.ts` | Add report/compare subcommands, update help text |
| `extensions/spec-bench/index.ts` | Add exports for report modules |

## Completion Checklist

- [ ] Step 4.1: Report types defined
- [ ] Step 4.2: Analysis module implemented
- [ ] Step 4.3: Report formatter module implemented
- [ ] Step 4.4: CLI report command implemented
- [ ] Step 4.5: Main CLI updated with subcommands
- [ ] Step 4.6: Index exports updated
- [ ] Step 4.7: Analysis tests passing
- [ ] Step 4.8: Report formatter tests passing
- [ ] Step 4.9: CLI report tests passing
- [ ] All tests pass (`npm test`)
- [ ] Code follows project conventions (TypeScript, vitest patterns)
- [ ] Report and compare commands work correctly

## Verification Commands

```bash
# After completing all steps:

# Run all tests
npm test

# Type check
npx tsc --noEmit

# Test CLI help shows new commands
npx tsx extensions/spec-bench/cli.ts --help

# Create a sample session file for testing
cat > /tmp/test-session.json << 'EOF'
{
  "sessionId": "test-20260202",
  "startedAt": "2026-02-02T03:00:00Z",
  "completedAt": "2026-02-02T04:00:00Z",
  "config": {
    "fixtures": [{"path": "./test"}],
    "permutations": [{"name": "test"}],
    "iterations": 1,
    "outputDir": "./results"
  },
  "permutations": [{
    "name": "test-perm",
    "config": {"name": "test-perm"},
    "iterations": [{
      "iterationId": 1,
      "fixture": "test-fixture",
      "startedAt": "2026-02-02T03:00:00Z",
      "completedAt": "2026-02-02T03:30:00Z",
      "success": true,
      "failureReason": null,
      "metrics": {
        "totalDurationMs": 1800000,
        "totalInputTokens": 50000,
        "totalOutputTokens": 10000,
        "agentMetrics": [],
        "reviewCycles": {"specReviewer":{"cheap":2,"expensive":1},"planReviewer":{"cheap":1,"expensive":0},"codeReviewer":{"cheap":2,"expensive":1}},
        "phasesCompleted": 3,
        "testsOriginalPassed": true,
        "testsHiddenPassed": true
      }
    }],
    "aggregates": {
      "successRate": 1,
      "meanDurationMs": 1800000,
      "medianDurationMs": 1800000,
      "p95DurationMs": 1800000,
      "meanInputTokens": 50000,
      "meanOutputTokens": 10000
    }
  }]
}
EOF

# Test report command (markdown)
npx tsx extensions/spec-bench/cli.ts report /tmp/test-session.json

# Test report command (csv)
npx tsx extensions/spec-bench/cli.ts report /tmp/test-session.json --format csv

# Test report command (with output file)
npx tsx extensions/spec-bench/cli.ts report /tmp/test-session.json --format markdown --output /tmp/report.md
cat /tmp/report.md

# Test compare command
npx tsx extensions/spec-bench/cli.ts compare /tmp/test-session.json
```

## Technical Notes

### Report Formats

The module supports three export formats:

1. **Markdown** (`--format markdown`): Human-readable format suitable for documentation
   - Headers, tables, and lists
   - Includes all analysis sections
   - Good for sharing results

2. **CSV** (`--format csv`): Spreadsheet-compatible format
   - Summary mode: One row per permutation with aggregated stats
   - Detailed mode (`--detailed`): One row per iteration
   - Good for data analysis in Excel/Google Sheets

3. **JSON** (`--format json`): Raw session data
   - Full session structure as stored
   - Good for programmatic processing

### Analysis Functions

Key analysis functions provided:

- `analyzeByFixture()`: Groups results by fixture, calculates per-fixture success rates
- `analyzeByAgentRole()`: Aggregates metrics by agent role (specDrafter, implementer, etc.)
- `comparePermutations()`: Calculates ratios between two permutations
- `generateComparisonReport()`: Full comparison with ranking

### Comparison Logic

Permutations are ranked by:
1. Success rate (descending) - higher success is better
2. Mean duration (ascending) - faster is better

Unsuitable permutations (0% success rate, R21) are:
- Flagged with ⚠️ in reports
- Placed at the end of rankings
- Still included in comparison data

### Integration with Phase 2/3

This phase builds on:
- `computeAggregates()` from Phase 2's metrics.ts
- `formatSessionSummary()` from Phase 2's results.ts
- Session JSON structure defined in Phase 2's types.ts
- CLI patterns from Phase 3's cli.ts
