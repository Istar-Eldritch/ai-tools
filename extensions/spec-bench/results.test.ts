import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	generateSessionId,
	createSession,
	createPermutationResult,
	getResultsPath,
	saveSession,
	loadSession,
	listSessions,
	addIterationResult,
	finalizeSession,
	isUnsuitablePermutation,
	formatSessionSummary,
} from "./results.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";
import type { BenchmarkConfig, IterationResult, PermutationResult } from "./types.ts";

describe("generateSessionId", () => {
	it("generates unique IDs", () => {
		const id1 = generateSessionId();
		const id2 = generateSessionId();
		expect(id1).not.toBe(id2);
	});
	
	it("generates IDs with date prefix", () => {
		const id = generateSessionId();
		// Should start with YYYYMMDD pattern
		expect(id).toMatch(/^\d{8}_\d{6}_[a-f0-9]{8}$/);
	});
});

describe("createSession", () => {
	it("creates session with correct structure", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./fixtures/test" }],
			permutations: [{ name: "default" }],
			iterations: 3,
			outputDir: "./results",
		};
		
		const session = createSession(config);
		
		expect(session.sessionId).toBeTruthy();
		expect(session.startedAt).toBeTruthy();
		expect(session.completedAt).toBe("");
		expect(session.config).toEqual(config);
		expect(session.permutations).toEqual([]);
	});
});

describe("createPermutationResult", () => {
	it("creates permutation with empty iterations", () => {
		const perm = createPermutationResult("test-perm", { name: "test-perm" });
		
		expect(perm.name).toBe("test-perm");
		expect(perm.iterations).toEqual([]);
		expect(perm.aggregates.successRate).toBe(0);
	});
});

describe("session persistence", () => {
	let tempDir: string;
	
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-results-test-"));
	});
	
	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
	
	it("saves and loads session", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./fixtures/test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: tempDir,
		};
		
		const session = createSession(config);
		session.permutations.push(createPermutationResult("test", { name: "test" }));
		
		saveSession(tempDir, session);
		
		const loaded = loadSession(getResultsPath(tempDir, session.sessionId));
		
		expect(loaded).not.toBeNull();
		expect(loaded!.sessionId).toBe(session.sessionId);
		expect(loaded!.permutations.length).toBe(1);
	});
	
	it("creates output directory if it doesn't exist", () => {
		const nestedDir = path.join(tempDir, "nested", "output");
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: nestedDir,
		};
		
		const session = createSession(config);
		saveSession(nestedDir, session);
		
		expect(fs.existsSync(nestedDir)).toBe(true);
	});
	
	it("lists sessions in reverse chronological order", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: tempDir,
		};
		
		// Create multiple sessions
		const session1 = createSession(config);
		saveSession(tempDir, session1);
		
		const session2 = createSession(config);
		saveSession(tempDir, session2);
		
		const sessions = listSessions(tempDir);
		
		expect(sessions.length).toBe(2);
		// Both sessions should be listed
		const sessionIds = sessions.map(s => path.basename(s));
		expect(sessionIds.some(id => id.includes(session1.sessionId))).toBe(true);
		expect(sessionIds.some(id => id.includes(session2.sessionId))).toBe(true);
		// Results should be sorted in reverse order (alphabetically, which corresponds to chronological for our IDs)
		expect(sessions[0] > sessions[1]).toBe(true);
	});
	
	it("returns null for non-existent session", () => {
		const loaded = loadSession(path.join(tempDir, "nonexistent.json"));
		expect(loaded).toBeNull();
	});
	
	it("returns empty array for non-existent output directory", () => {
		const sessions = listSessions(path.join(tempDir, "nonexistent"));
		expect(sessions).toEqual([]);
	});
});

describe("addIterationResult", () => {
	it("adds iteration and updates aggregates", () => {
		const perm = createPermutationResult("test", { name: "test" });
		
		const result: IterationResult = {
			iterationId: 1,
			fixture: "test-fixture",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: true,
			failureReason: null,
			metrics: {
				...createEmptyIterationMetrics(),
				totalDurationMs: 1000,
				totalInputTokens: 100,
				totalOutputTokens: 50,
			},
		};
		
		addIterationResult(perm, result);
		
		expect(perm.iterations.length).toBe(1);
		expect(perm.aggregates.successRate).toBe(1);
		expect(perm.aggregates.meanDurationMs).toBe(1000);
	});
});

describe("finalizeSession", () => {
	it("sets completedAt timestamp", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: "./results",
		};
		
		const session = createSession(config);
		expect(session.completedAt).toBe("");
		
		finalizeSession(session);
		
		expect(session.completedAt).toBeTruthy();
		expect(new Date(session.completedAt).getTime()).toBeGreaterThan(0);
	});
});

describe("isUnsuitablePermutation", () => {
	it("returns true when successRate is 0 with iterations (R21)", () => {
		const perm = createPermutationResult("test", { name: "test" });
		
		// Add a failed iteration
		const result: IterationResult = {
			iterationId: 1,
			fixture: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: false,
			failureReason: "timeout",
			metrics: createEmptyIterationMetrics(),
		};
		addIterationResult(perm, result);
		
		expect(isUnsuitablePermutation(perm)).toBe(true);
	});
	
	it("returns false when successRate is above 0", () => {
		const perm = createPermutationResult("test", { name: "test" });
		
		const result: IterationResult = {
			iterationId: 1,
			fixture: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: true,
			failureReason: null,
			metrics: createEmptyIterationMetrics(),
		};
		addIterationResult(perm, result);
		
		expect(isUnsuitablePermutation(perm)).toBe(false);
	});
	
	it("returns false for empty permutation", () => {
		const perm = createPermutationResult("test", { name: "test" });
		expect(isUnsuitablePermutation(perm)).toBe(false);
	});
});

describe("formatSessionSummary", () => {
	it("formats session with permutation results", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: "./results",
		};
		
		const session = createSession(config);
		const perm = createPermutationResult("test-perm", { name: "test-perm" });
		
		// Add a successful iteration
		const result: IterationResult = {
			iterationId: 1,
			fixture: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: true,
			failureReason: null,
			metrics: {
				...createEmptyIterationMetrics(),
				totalDurationMs: 5000,
				totalInputTokens: 1000,
				totalOutputTokens: 500,
			},
		};
		addIterationResult(perm, result);
		session.permutations.push(perm);
		
		const summary = formatSessionSummary(session);
		
		expect(summary).toContain(session.sessionId);
		expect(summary).toContain("test-perm");
		expect(summary).toContain("100.0%");  // Success rate
		expect(summary).toContain("5.0s");     // Duration
	});
	
	it("marks unsuitable permutations", () => {
		const config: BenchmarkConfig = {
			fixtures: [{ path: "./test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: "./results",
		};
		
		const session = createSession(config);
		const perm = createPermutationResult("failing-perm", { name: "failing-perm" });
		
		// Add a failed iteration
		const result: IterationResult = {
			iterationId: 1,
			fixture: "test",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			success: false,
			failureReason: "timeout",
			metrics: createEmptyIterationMetrics(),
		};
		addIterationResult(perm, result);
		session.permutations.push(perm);
		
		const summary = formatSessionSummary(session);
		
		expect(summary).toContain("UNSUITABLE");
		expect(summary).toContain("0.0%");
	});
});
