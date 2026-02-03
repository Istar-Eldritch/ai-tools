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
