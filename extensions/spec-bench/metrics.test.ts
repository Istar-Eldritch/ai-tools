import { describe, it, expect } from "vitest";
import {
	MetricsAccumulator,
	IterationMetricsBuilder,
	computeAggregates,
	createEmptyIterationMetrics,
} from "./metrics.ts";
import type { IterationMetrics } from "./types.ts";

describe("MetricsAccumulator", () => {
	describe("processLine", () => {
		it("ignores empty lines", () => {
			const acc = new MetricsAccumulator();
			expect(acc.processLine("")).toBeNull();
			expect(acc.processLine("  ")).toBeNull();
		});
		
		it("ignores invalid JSON", () => {
			const acc = new MetricsAccumulator();
			expect(acc.processLine("not json")).toBeNull();
			expect(acc.processLine("{ invalid }")).toBeNull();
		});
		
		it("accumulates usage_stats tokens", () => {
			const acc = new MetricsAccumulator();
			
			acc.processLine(JSON.stringify({
				type: "usage_stats",
				inputTokens: 100,
				outputTokens: 50,
			}));
			
			acc.processLine(JSON.stringify({
				type: "usage_stats",
				inputTokens: 200,
				outputTokens: 75,
			}));
			
			const tokens = acc.getCurrentTokens();
			expect(tokens.input).toBe(300);
			expect(tokens.output).toBe(125);
		});
		
		it("accumulates message_update text", () => {
			const acc = new MetricsAccumulator();
			
			const delta1 = acc.processLine(JSON.stringify({
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					delta: "Hello ",
				},
			}));
			
			const delta2 = acc.processLine(JSON.stringify({
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					delta: "world!",
				},
			}));
			
			expect(delta1).toBe("Hello ");
			expect(delta2).toBe("world!");
			expect(acc.getOutput()).toBe("Hello world!");
		});
		
		it("ignores other event types", () => {
			const acc = new MetricsAccumulator();
			
			acc.processLine(JSON.stringify({ type: "other_event" }));
			acc.processLine(JSON.stringify({ type: "tool_use" }));
			
			const tokens = acc.getCurrentTokens();
			expect(tokens.input).toBe(0);
			expect(tokens.output).toBe(0);
		});
		
		it("handles missing optional fields in usage_stats", () => {
			const acc = new MetricsAccumulator();
			
			acc.processLine(JSON.stringify({
				type: "usage_stats",
				// inputTokens and outputTokens missing
			}));
			
			const tokens = acc.getCurrentTokens();
			expect(tokens.input).toBe(0);
			expect(tokens.output).toBe(0);
		});
	});
	
	describe("finalize", () => {
		it("returns complete metrics", () => {
			const acc = new MetricsAccumulator();
			
			acc.processLine(JSON.stringify({
				type: "usage_stats",
				inputTokens: 100,
				outputTokens: 50,
			}));
			
			// Wait a bit to ensure duration > 0
			const metrics = acc.finalize("testRole", "sonnet", "medium");
			
			expect(metrics.role).toBe("testRole");
			expect(metrics.model).toBe("sonnet");
			expect(metrics.thinking).toBe("medium");
			expect(metrics.inputTokens).toBe(100);
			expect(metrics.outputTokens).toBe(50);
			expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
		});
	});
});

describe("IterationMetricsBuilder", () => {
	it("builds metrics from multiple agents", () => {
		const builder = new IterationMetricsBuilder();
		
		builder.addAgentMetrics({
			role: "specDrafter",
			model: "opus",
			thinking: "high",
			durationMs: 5000,
			inputTokens: 1000,
			outputTokens: 500,
		});
		
		builder.addAgentMetrics({
			role: "specReviewer",
			model: "sonnet",
			thinking: "medium",
			durationMs: 3000,
			inputTokens: 800,
			outputTokens: 200,
		});
		
		builder.setTestResults(true, true);
		builder.setPhasesCompleted(1);
		
		const metrics = builder.build();
		
		expect(metrics.agentMetrics.length).toBe(2);
		expect(metrics.totalInputTokens).toBe(1800);
		expect(metrics.totalOutputTokens).toBe(700);
		expect(metrics.testsOriginalPassed).toBe(true);
		expect(metrics.testsHiddenPassed).toBe(true);
		expect(metrics.phasesCompleted).toBe(1);
	});
	
	it("records review cycles", () => {
		const builder = new IterationMetricsBuilder();
		
		builder.recordReviewCycles("specReviewer", 2, 1);
		builder.recordReviewCycles("codeReviewer", 3, 2);
		
		const metrics = builder.build();
		
		expect(metrics.reviewCycles.specReviewer).toEqual({ cheap: 2, expensive: 1 });
		expect(metrics.reviewCycles.codeReviewer).toEqual({ cheap: 3, expensive: 2 });
		expect(metrics.reviewCycles.planReviewer).toEqual({ cheap: 0, expensive: 0 });
	});
});

describe("computeAggregates", () => {
	const makeIteration = (success: boolean, durationMs: number, inputTokens: number, outputTokens: number) => ({
		success,
		metrics: {
			totalDurationMs: durationMs,
			totalInputTokens: inputTokens,
			totalOutputTokens: outputTokens,
			agentMetrics: [],
			reviewCycles: {
				specReviewer: { cheap: 0, expensive: 0 },
				planReviewer: { cheap: 0, expensive: 0 },
				codeReviewer: { cheap: 0, expensive: 0 },
			},
			phasesCompleted: 1,
			testsOriginalPassed: success,
			testsHiddenPassed: success,
		},
	});
	
	it("computes correct success rate", () => {
		const iterations = [
			makeIteration(true, 1000, 100, 50),
			makeIteration(false, 500, 50, 25),
			makeIteration(true, 1500, 150, 75),
		];
		
		const agg = computeAggregates(iterations);
		expect(agg.successRate).toBeCloseTo(2/3);
	});
	
	it("only uses successful iterations for metrics (R22)", () => {
		const iterations = [
			makeIteration(true, 1000, 100, 50),
			makeIteration(false, 99999, 99999, 99999),  // Should be excluded
			makeIteration(true, 2000, 200, 100),
		];
		
		const agg = computeAggregates(iterations);
		expect(agg.meanDurationMs).toBe(1500);  // (1000 + 2000) / 2
		expect(agg.meanInputTokens).toBe(150);  // (100 + 200) / 2
		expect(agg.meanOutputTokens).toBe(75);  // (50 + 100) / 2
	});
	
	it("calculates correct median", () => {
		const iterations = [
			makeIteration(true, 1000, 100, 50),
			makeIteration(true, 2000, 200, 100),
			makeIteration(true, 3000, 300, 150),
		];
		
		const agg = computeAggregates(iterations);
		expect(agg.medianDurationMs).toBe(2000);
	});
	
	it("calculates p95 correctly", () => {
		// With 20 items, p95 is roughly the 19th item
		const iterations = Array.from({ length: 20 }, (_, i) => 
			makeIteration(true, (i + 1) * 1000, 100, 50)
		);
		
		const agg = computeAggregates(iterations);
		// p95 of 1000-20000 should be around 19050 (interpolated)
		expect(agg.p95DurationMs).toBeGreaterThan(18000);
		expect(agg.p95DurationMs).toBeLessThanOrEqual(20000);
	});
	
	it("returns zeros for empty iterations", () => {
		const agg = computeAggregates([]);
		expect(agg.successRate).toBe(0);
		expect(agg.meanDurationMs).toBe(0);
		expect(agg.medianDurationMs).toBe(0);
		expect(agg.p95DurationMs).toBe(0);
	});
	
	it("returns zeros when all iterations fail (R21)", () => {
		const iterations = [
			makeIteration(false, 1000, 100, 50),
			makeIteration(false, 2000, 200, 100),
		];
		
		const agg = computeAggregates(iterations);
		expect(agg.successRate).toBe(0);
		expect(agg.meanDurationMs).toBe(0);
		expect(agg.medianDurationMs).toBe(0);
	});
});

describe("createEmptyIterationMetrics", () => {
	it("creates valid empty metrics structure", () => {
		const metrics = createEmptyIterationMetrics();
		
		expect(metrics.totalDurationMs).toBe(0);
		expect(metrics.totalInputTokens).toBe(0);
		expect(metrics.totalOutputTokens).toBe(0);
		expect(metrics.agentMetrics).toEqual([]);
		expect(metrics.phasesCompleted).toBe(0);
		expect(metrics.testsOriginalPassed).toBe(false);
		expect(metrics.testsHiddenPassed).toBe(false);
		expect(metrics.reviewCycles.specReviewer).toEqual({ cheap: 0, expensive: 0 });
	});
});
