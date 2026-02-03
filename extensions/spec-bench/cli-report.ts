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
