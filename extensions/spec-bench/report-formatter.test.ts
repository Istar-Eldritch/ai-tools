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
		expect(report).toContain("|--");  // Check for separator row pattern (dashes vary by column width)
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
		
		expect(csv).toContain("failure_reason");  // Column only in detailed mode
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
		expect(detailed).toContain("failure_reason");  // Only in detailed mode
		
		const summary = formatReport(session, "csv", { detailed: false });
		expect(summary).not.toContain("failure_reason");  // Not in summary mode
	});
});
