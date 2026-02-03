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
	lines.push("|-------------|--------------|---------------|-------------------|--------------------|--------|");
	
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
