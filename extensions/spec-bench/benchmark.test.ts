import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	createConsoleProgress,
	formatBenchmarkSummary,
} from "./benchmark.ts";
import type { BenchmarkSession, IterationResult } from "./types.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

describe("createConsoleProgress", () => {
	it("returns object with all callback properties", () => {
		const progress = createConsoleProgress();
		
		expect(typeof progress.onPermutationStart).toBe("function");
		expect(typeof progress.onIterationStart).toBe("function");
		expect(typeof progress.onIterationComplete).toBe("function");
		expect(typeof progress.onPermutationComplete).toBe("function");
		expect(typeof progress.onStageChange).toBe("function");
		expect(typeof progress.onLog).toBe("function");
	});
	
	it("onPermutationStart logs to console", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const progress = createConsoleProgress();
		
		progress.onPermutationStart!({ name: "test-perm" }, 1, 2);
		
		expect(consoleSpy).toHaveBeenCalled();
		const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
		expect(output).toContain("test-perm");
		
		consoleSpy.mockRestore();
	});
	
	it("onIterationComplete shows success/failure", () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const progress = createConsoleProgress();
		
		const successResult: IterationResult = {
			iterationId: 1,
			fixture: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: true,
			failureReason: null,
			metrics: createEmptyIterationMetrics(),
		};
		
		progress.onIterationComplete!(successResult);
		
		const output = consoleSpy.mock.calls.map(c => c[0]).join("\n");
		expect(output).toContain("✓");
		
		consoleSpy.mockRestore();
	});
	
	it("onLog handles different levels", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const progress = createConsoleProgress();
		
		progress.onLog!("Error message", "error");
		progress.onLog!("Warning message", "warn");
		progress.onLog!("Info message", "info");
		
		expect(errorSpy).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalled();
		
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});
});

describe("formatBenchmarkSummary", () => {
	it("indicates when benchmark was aborted", () => {
		const session: BenchmarkSession = {
			sessionId: "test-session",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			config: {
				fixtures: [],
				permutations: [],
				iterations: 1,
				outputDir: "./results",
			},
			permutations: [],
		};
		
		const summary = formatBenchmarkSummary({ session, aborted: true });
		
		expect(summary).toContain("aborted");
	});
	
	it("indicates success when not aborted", () => {
		const session: BenchmarkSession = {
			sessionId: "test-session",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			config: {
				fixtures: [],
				permutations: [],
				iterations: 1,
				outputDir: "./results",
			},
			permutations: [],
		};
		
		const summary = formatBenchmarkSummary({ session, aborted: false });
		
		expect(summary).toContain("completed successfully");
	});
});

// Note: runBenchmark integration tests would require:
// - Mock implementation of executeIteration
// - Real fixtures and configuration
// - These are better suited for e2e tests
