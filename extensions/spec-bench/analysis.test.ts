import { describe, it, expect } from "vitest";
import {
	analyzeByFixture,
	analyzeByAgentRole,
	comparePermutations,
	generateComparisonReport,
	createPermutationSummary,
	getAverageReviewCycles,
} from "./analysis.ts";
import type { PermutationResult, IterationResult, IterationMetrics, FailureReason } from "./types.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

// Helper to create iteration result
function makeIteration(
	fixture: string,
	success: boolean,
	durationMs: number = 1000,
	inputTokens: number = 100,
	outputTokens: number = 50,
	failureReason: FailureReason = "test_failure"
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
		failureReason: success ? null : failureReason,
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
