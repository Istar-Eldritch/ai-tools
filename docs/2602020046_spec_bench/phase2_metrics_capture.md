# Phase 2: Metrics Capture from Pi Subprocess

**Estimated Effort**: 2 days

## Overview

This phase implements the core metrics capture functionality for spec-bench. The tool will spawn pi directly with `--mode json` and parse the stdout stream to extract:

- Token usage from `usage_stats` events
- Assistant output from `message_update` events  
- Wall-clock duration per agent invocation

This phase establishes the data model for benchmark results and the low-level runner that executes pi and captures metrics.

## Prerequisites

- Phase 1 complete (types.ts, config.ts, fixture.ts, isolation.ts, cli.ts exist)
- `extensions/spec-bench/` directory structure created
- TypeBox schemas for configuration defined

## Steps

### Step 2.1: Define Result Types for Benchmark Metrics

- **Files**: `extensions/spec-bench/types.ts` (modify)
- **Pattern Reference**: Based on spec R10, R11, R17 result format and `extensions/spec-pipeline/types.ts` patterns
- **Action**: Add result types for agent metrics, iteration results, and session results

```typescript
// Add after existing types in types.ts

// ============================================
// Agent Metrics Types (R10)
// ============================================

/**
 * Metrics captured for a single agent invocation
 */
export interface AgentMetrics {
	/** Role that was executing */
	role: string;
	/** Model used (opus, sonnet, haiku) */
	model: string;
	/** Thinking level used */
	thinking: string;
	/** Wall-clock duration in milliseconds */
	durationMs: number;
	/** Input tokens consumed */
	inputTokens: number;
	/** Output tokens produced */
	outputTokens: number;
}

// ============================================
// Review Cycles Tracking (R11)
// ============================================

/**
 * Review cycles completed per reviewer
 */
export interface ReviewCyclesMetrics {
	specReviewer: { cheap: number; expensive: number };
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
}

// ============================================
// Iteration Results (R17)
// ============================================

/**
 * Metrics for a single benchmark iteration
 */
export interface IterationMetrics {
	/** Total wall-clock duration in milliseconds */
	totalDurationMs: number;
	/** Total input tokens across all agents */
	totalInputTokens: number;
	/** Total output tokens across all agents */
	totalOutputTokens: number;
	/** Per-agent metrics in execution order */
	agentMetrics: AgentMetrics[];
	/** Review cycles completed per reviewer */
	reviewCycles: ReviewCyclesMetrics;
	/** Number of phases completed (0 if failed early) */
	phasesCompleted: number;
	/** Whether original tests passed */
	testsOriginalPassed: boolean;
	/** Whether hidden tests passed (after injection) */
	testsHiddenPassed: boolean;
}

/**
 * Result of a single benchmark iteration
 */
export interface IterationResult {
	/** Iteration number (1-indexed) */
	iterationId: number;
	/** Fixture name */
	fixture: string;
	/** ISO8601 timestamp when iteration started */
	startedAt: string;
	/** ISO8601 timestamp when iteration completed */
	completedAt: string;
	/** Whether the iteration succeeded */
	success: boolean;
	/** Failure reason if success is false */
	failureReason: FailureReason | null;
	/** Captured metrics (partial if failed) */
	metrics: IterationMetrics;
}

// ============================================
// Permutation Results (R17, R20, R21, R22)
// ============================================

/**
 * Aggregated statistics for a permutation
 */
export interface PermutationAggregates {
	/** Ratio of successful iterations */
	successRate: number;
	/** Mean duration across successful iterations */
	meanDurationMs: number;
	/** Median duration across successful iterations */
	medianDurationMs: number;
	/** 95th percentile duration */
	p95DurationMs: number;
	/** Mean input tokens across successful iterations */
	meanInputTokens: number;
	/** Mean output tokens across successful iterations */
	meanOutputTokens: number;
}

/**
 * Results for a single permutation across all fixtures and iterations
 */
export interface PermutationResult {
	/** Permutation name */
	name: string;
	/** Spec-pipeline config for this permutation */
	config: Permutation;
	/** Results from all iterations */
	iterations: IterationResult[];
	/** Aggregated statistics */
	aggregates: PermutationAggregates;
}

// ============================================
// Session Results (R17, R18)
// ============================================

/**
 * Complete benchmark session results
 */
export interface BenchmarkSession {
	/** Unique session identifier */
	sessionId: string;
	/** ISO8601 timestamp when session started */
	startedAt: string;
	/** ISO8601 timestamp when session completed */
	completedAt: string;
	/** Benchmark configuration used */
	config: BenchmarkConfig;
	/** Results per permutation */
	permutations: PermutationResult[];
}

// ============================================
// Pi JSON Event Types (for parsing)
// ============================================

/**
 * Usage stats event from pi's JSON output (R12)
 */
export interface PiUsageStatsEvent {
	type: "usage_stats";
	inputTokens: number;
	outputTokens: number;
	// Additional fields may exist but we only need these
}

/**
 * Message update event from pi's JSON output
 */
export interface PiMessageUpdateEvent {
	type: "message_update";
	assistantMessageEvent?: {
		type: "text_delta";
		delta: string;
	};
}

/**
 * Union of pi event types we care about
 */
export type PiEvent = PiUsageStatsEvent | PiMessageUpdateEvent | { type: string };
```

- **Verify**: TypeScript compiles without errors: `npx tsc --noEmit extensions/spec-bench/types.ts`

---

### Step 2.2: Create Metrics Capture Module

- **Files**: `extensions/spec-bench/metrics.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/agents.ts` event parsing pattern
- **Action**: Create module for capturing metrics from pi's JSON output stream

```typescript
/**
 * Metrics capture from pi subprocess JSON output
 * 
 * Pi emits JSON events to stdout when run with --mode json.
 * We parse these to extract:
 * - usage_stats: token counts per message
 * - message_update: assistant text output
 */

import type {
	AgentMetrics,
	IterationMetrics,
	ReviewCyclesMetrics,
	PiEvent,
	PiUsageStatsEvent,
} from "./types.ts";

// ============================================
// Metrics Accumulator
// ============================================

/**
 * Accumulates metrics during a pi subprocess run
 */
export class MetricsAccumulator {
	private inputTokens = 0;
	private outputTokens = 0;
	private output = "";
	private startTime: number;
	
	constructor() {
		this.startTime = Date.now();
	}
	
	/**
	 * Process a line of JSON output from pi
	 * Returns the text delta if this was a message_update event
	 */
	processLine(line: string): string | null {
		if (!line.trim()) return null;
		
		try {
			const event = JSON.parse(line) as PiEvent;
			return this.processEvent(event);
		} catch {
			// Ignore parse errors - pi may emit non-JSON diagnostic lines
			return null;
		}
	}
	
	/**
	 * Process a parsed pi event
	 */
	processEvent(event: PiEvent): string | null {
		if (event.type === "usage_stats") {
			const usageEvent = event as PiUsageStatsEvent;
			this.inputTokens += usageEvent.inputTokens || 0;
			this.outputTokens += usageEvent.outputTokens || 0;
			return null;
		}
		
		if (event.type === "message_update") {
			const msgEvent = event as { type: "message_update"; assistantMessageEvent?: { type: string; delta?: string } };
			if (msgEvent.assistantMessageEvent?.type === "text_delta" && msgEvent.assistantMessageEvent.delta) {
				const delta = msgEvent.assistantMessageEvent.delta;
				this.output += delta;
				return delta;
			}
		}
		
		return null;
	}
	
	/**
	 * Finalize and return captured metrics
	 */
	finalize(role: string, model: string, thinking: string): AgentMetrics {
		const endTime = Date.now();
		return {
			role,
			model,
			thinking,
			durationMs: endTime - this.startTime,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
		};
	}
	
	/**
	 * Get accumulated output text
	 */
	getOutput(): string {
		return this.output.trim();
	}
	
	/**
	 * Get current token counts (for partial results)
	 */
	getCurrentTokens(): { input: number; output: number } {
		return {
			input: this.inputTokens,
			output: this.outputTokens,
		};
	}
}

// ============================================
// Iteration Metrics Builder
// ============================================

/**
 * Builds iteration metrics from multiple agent runs
 */
export class IterationMetricsBuilder {
	private agentMetrics: AgentMetrics[] = [];
	private startTime: number;
	private reviewCycles: ReviewCyclesMetrics = {
		specReviewer: { cheap: 0, expensive: 0 },
		planReviewer: { cheap: 0, expensive: 0 },
		codeReviewer: { cheap: 0, expensive: 0 },
	};
	private phasesCompleted = 0;
	private testsOriginalPassed = false;
	private testsHiddenPassed = false;
	
	constructor() {
		this.startTime = Date.now();
	}
	
	/**
	 * Add metrics from an agent run
	 */
	addAgentMetrics(metrics: AgentMetrics): void {
		this.agentMetrics.push(metrics);
	}
	
	/**
	 * Record review cycles for a reviewer
	 */
	recordReviewCycles(
		reviewer: "specReviewer" | "planReviewer" | "codeReviewer",
		cheap: number,
		expensive: number
	): void {
		this.reviewCycles[reviewer] = { cheap, expensive };
	}
	
	/**
	 * Set phases completed count
	 */
	setPhasesCompleted(count: number): void {
		this.phasesCompleted = count;
	}
	
	/**
	 * Set test results
	 */
	setTestResults(originalPassed: boolean, hiddenPassed: boolean): void {
		this.testsOriginalPassed = originalPassed;
		this.testsHiddenPassed = hiddenPassed;
	}
	
	/**
	 * Build final iteration metrics
	 */
	build(): IterationMetrics {
		const totalDurationMs = Date.now() - this.startTime;
		const totalInputTokens = this.agentMetrics.reduce((sum, m) => sum + m.inputTokens, 0);
		const totalOutputTokens = this.agentMetrics.reduce((sum, m) => sum + m.outputTokens, 0);
		
		return {
			totalDurationMs,
			totalInputTokens,
			totalOutputTokens,
			agentMetrics: this.agentMetrics,
			reviewCycles: this.reviewCycles,
			phasesCompleted: this.phasesCompleted,
			testsOriginalPassed: this.testsOriginalPassed,
			testsHiddenPassed: this.testsHiddenPassed,
		};
	}
	
	/**
	 * Build partial metrics (for failed iterations)
	 */
	buildPartial(): IterationMetrics {
		return this.build();
	}
}

// ============================================
// Aggregation Functions (R20, R21, R22)
// ============================================

/**
 * Calculate percentile value from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	const index = (p / 100) * (sortedValues.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	const fraction = index - lower;
	
	if (lower === upper) {
		return sortedValues[lower];
	}
	return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

/**
 * Calculate median from array of values
 */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return percentile(sorted, 50);
}

/**
 * Calculate mean from array of values
 */
function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute aggregates from iteration results
 * Only includes successful iterations in calculations except for successRate (R22)
 */
export function computeAggregates(iterations: Array<{ success: boolean; metrics: IterationMetrics }>): {
	successRate: number;
	meanDurationMs: number;
	medianDurationMs: number;
	p95DurationMs: number;
	meanInputTokens: number;
	meanOutputTokens: number;
} {
	const totalIterations = iterations.length;
	const successful = iterations.filter(i => i.success);
	const successRate = totalIterations > 0 ? successful.length / totalIterations : 0;
	
	// If no successful iterations, return zeros
	if (successful.length === 0) {
		return {
			successRate,
			meanDurationMs: 0,
			medianDurationMs: 0,
			p95DurationMs: 0,
			meanInputTokens: 0,
			meanOutputTokens: 0,
		};
	}
	
	const durations = successful.map(i => i.metrics.totalDurationMs);
	const inputTokens = successful.map(i => i.metrics.totalInputTokens);
	const outputTokens = successful.map(i => i.metrics.totalOutputTokens);
	
	const sortedDurations = [...durations].sort((a, b) => a - b);
	
	return {
		successRate,
		meanDurationMs: mean(durations),
		medianDurationMs: median(durations),
		p95DurationMs: percentile(sortedDurations, 95),
		meanInputTokens: mean(inputTokens),
		meanOutputTokens: mean(outputTokens),
	};
}

// ============================================
// Empty/Default Metrics Helpers
// ============================================

/**
 * Create empty iteration metrics (for failed runs with no data)
 */
export function createEmptyIterationMetrics(): IterationMetrics {
	return {
		totalDurationMs: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		agentMetrics: [],
		reviewCycles: {
			specReviewer: { cheap: 0, expensive: 0 },
			planReviewer: { cheap: 0, expensive: 0 },
			codeReviewer: { cheap: 0, expensive: 0 },
		},
		phasesCompleted: 0,
		testsOriginalPassed: false,
		testsHiddenPassed: false,
	};
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 2.3: Create Pi Runner Module

- **Files**: `extensions/spec-bench/runner.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/agents.ts` subprocess spawning pattern
- **Action**: Create module that spawns pi subprocess and captures metrics (R12a)

```typescript
/**
 * Pi subprocess runner with metrics capture
 * 
 * Spawns pi directly with --mode json to capture full output
 * including usage_stats events for token counting (R12a)
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MetricsAccumulator } from "./metrics.ts";
import type { AgentMetrics, ModelConfig } from "./types.ts";

// ============================================
// Types
// ============================================

/** Model identifier mapping (same as spec-pipeline) */
const MODEL_IDENTIFIERS: Record<string, string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
} as const;

/** Roles that only need read access */
const READ_ONLY_ROLES = new Set([
	"specReviewer",
	"planReviewer",
	"codeReviewer",
	"commitMessageWriter",
	"discoveryAgent",
]);

/** Result from running pi subprocess */
export interface PiRunResult {
	/** Exit code from subprocess */
	exitCode: number;
	/** Captured metrics */
	metrics: AgentMetrics;
	/** Accumulated output text */
	output: string;
	/** Stderr output (if any) */
	stderr: string;
	/** Whether the run was aborted */
	aborted: boolean;
}

export interface PiRunOptions {
	/** Model configuration */
	modelConfig: ModelConfig;
	/** Task prompt */
	task: string;
	/** Working directory */
	cwd: string;
	/** System prompt content */
	systemPrompt: string;
	/** Role name (for tool restrictions and metrics) */
	role: string;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
	/** Callback for output text as it streams */
	onOutput?: (text: string) => void;
	/** Timeout in milliseconds */
	timeoutMs?: number;
}

// ============================================
// Pi Runner
// ============================================

/**
 * Run pi subprocess and capture metrics from JSON output
 */
export async function runPiWithMetrics(options: PiRunOptions): Promise<PiRunResult> {
	const {
		modelConfig,
		task,
		cwd,
		systemPrompt,
		role,
		signal,
		onOutput,
		timeoutMs,
	} = options;
	
	// Build arguments
	const args: string[] = [
		"--mode", "json",
		"-p",
		"--no-session",
		"--model", MODEL_IDENTIFIERS[modelConfig.model] || modelConfig.model,
		"--thinking", modelConfig.thinking,
	];
	
	// Restrict tools based on role
	if (READ_ONLY_ROLES.has(role)) {
		args.push("--tools", "read,bash,grep,find,ls");
	} else {
		args.push("--tools", "read,bash,edit,write,grep,find,ls");
	}
	
	// Write system prompt to temp file
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-"));
	const promptPath = path.join(tmpDir, "system.md");
	fs.writeFileSync(promptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	args.push("--append-system-prompt", promptPath);
	
	// Add task
	args.push(task);
	
	// Initialize metrics accumulator
	const accumulator = new MetricsAccumulator();
	let stderr = "";
	let proc: ChildProcess | null = null;
	let aborted = false;
	let timeoutHandle: NodeJS.Timeout | null = null;
	
	try {
		const exitCode = await new Promise<number>((resolve) => {
			proc = spawn("pi", args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			
			let buffer = "";
			
			const processLine = (line: string) => {
				const delta = accumulator.processLine(line);
				if (delta && onOutput) {
					onOutput(delta);
				}
			};
			
			proc.stdout?.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					processLine(line);
				}
			});
			
			proc.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			
			proc.on("close", (code) => {
				// Process any remaining buffer
				if (buffer.trim()) {
					processLine(buffer);
				}
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				resolve(code ?? 0);
			});
			
			proc.on("error", (err) => {
				stderr += `Process error: ${err.message}`;
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				resolve(1);
			});
			
			// Handle abort signal
			if (signal) {
				const killProc = () => {
					aborted = true;
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 5000);
				};
				
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", killProc, { once: true });
				}
			}
			
			// Handle timeout
			if (timeoutMs && timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					aborted = true;
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 5000);
				}, timeoutMs);
			}
		});
		
		// Finalize metrics
		const metrics = accumulator.finalize(role, modelConfig.model, modelConfig.thinking);
		
		return {
			exitCode,
			metrics,
			output: accumulator.getOutput(),
			stderr,
			aborted,
		};
	} finally {
		// Cleanup temp files
		try {
			fs.unlinkSync(promptPath);
			fs.rmdirSync(tmpDir);
		} catch {
			/* ignore cleanup errors */
		}
	}
}

/**
 * Check if pi is available in PATH
 */
export async function checkPiAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("pi", ["--version"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 2.4: Create Results Storage Module

- **Files**: `extensions/spec-bench/results.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/state.ts` JSON persistence pattern
- **Action**: Create module for saving and loading benchmark results (R17, R18)

```typescript
/**
 * Benchmark results storage
 * 
 * Results are stored as JSON files in the output directory,
 * one file per benchmark session (R18)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	BenchmarkSession,
	BenchmarkConfig,
	PermutationResult,
	IterationResult,
} from "./types.ts";
import { computeAggregates } from "./metrics.ts";

// ============================================
// Session ID Generation
// ============================================

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
	const now = new Date();
	const date = now.toISOString().slice(0, 10).replace(/-/g, "");
	const time = now.toISOString().slice(11, 19).replace(/:/g, "");
	const rand = randomUUID().slice(0, 8);
	return `${date}_${time}_${rand}`;
}

// ============================================
// Session Creation
// ============================================

/**
 * Create a new benchmark session
 */
export function createSession(config: BenchmarkConfig): BenchmarkSession {
	return {
		sessionId: generateSessionId(),
		startedAt: new Date().toISOString(),
		completedAt: "",  // Set when session completes
		config,
		permutations: [],
	};
}

/**
 * Create a new permutation result structure
 */
export function createPermutationResult(
	name: string,
	config: BenchmarkConfig["permutations"][0]
): PermutationResult {
	return {
		name,
		config,
		iterations: [],
		aggregates: {
			successRate: 0,
			meanDurationMs: 0,
			medianDurationMs: 0,
			p95DurationMs: 0,
			meanInputTokens: 0,
			meanOutputTokens: 0,
		},
	};
}

// ============================================
// Results File Operations
// ============================================

/**
 * Get the results file path for a session
 */
export function getResultsPath(outputDir: string, sessionId: string): string {
	return path.join(outputDir, `benchmark_${sessionId}.json`);
}

/**
 * Save benchmark session to disk
 */
export function saveSession(outputDir: string, session: BenchmarkSession): void {
	// Ensure output directory exists
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}
	
	const filePath = getResultsPath(outputDir, session.sessionId);
	fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Load a benchmark session from disk
 */
export function loadSession(filePath: string): BenchmarkSession | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(content) as BenchmarkSession;
	} catch {
		return null;
	}
}

/**
 * List all benchmark sessions in output directory
 */
export function listSessions(outputDir: string): string[] {
	if (!fs.existsSync(outputDir)) {
		return [];
	}
	
	return fs.readdirSync(outputDir)
		.filter(f => f.startsWith("benchmark_") && f.endsWith(".json"))
		.map(f => path.join(outputDir, f))
		.sort()
		.reverse();  // Most recent first
}

// ============================================
// Results Update Helpers
// ============================================

/**
 * Add iteration result to a permutation and update aggregates
 */
export function addIterationResult(
	permutation: PermutationResult,
	result: IterationResult
): void {
	permutation.iterations.push(result);
	
	// Recompute aggregates
	permutation.aggregates = computeAggregates(permutation.iterations);
}

/**
 * Finalize session (set completedAt timestamp)
 */
export function finalizeSession(session: BenchmarkSession): void {
	session.completedAt = new Date().toISOString();
}

/**
 * Check if a permutation has 0% success rate (R21)
 */
export function isUnsuitablePermutation(permutation: PermutationResult): boolean {
	return permutation.aggregates.successRate === 0 && permutation.iterations.length > 0;
}

// ============================================
// Result Summary Helpers
// ============================================

/**
 * Generate a human-readable summary of session results
 */
export function formatSessionSummary(session: BenchmarkSession): string {
	const lines: string[] = [];
	
	lines.push(`Benchmark Session: ${session.sessionId}`);
	lines.push(`Started: ${session.startedAt}`);
	lines.push(`Completed: ${session.completedAt || "In progress"}`);
	lines.push("");
	lines.push(`Permutations: ${session.permutations.length}`);
	lines.push("");
	
	for (const perm of session.permutations) {
		const successPct = (perm.aggregates.successRate * 100).toFixed(1);
		const unsuitable = isUnsuitablePermutation(perm) ? " ⚠️ UNSUITABLE" : "";
		
		lines.push(`  ${perm.name}${unsuitable}`);
		lines.push(`    Success rate: ${successPct}%`);
		lines.push(`    Iterations: ${perm.iterations.length}`);
		
		if (perm.aggregates.successRate > 0) {
			lines.push(`    Mean duration: ${(perm.aggregates.meanDurationMs / 1000).toFixed(1)}s`);
			lines.push(`    Mean tokens: ${perm.aggregates.meanInputTokens.toFixed(0)} in / ${perm.aggregates.meanOutputTokens.toFixed(0)} out`);
		}
		lines.push("");
	}
	
	return lines.join("\n");
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 2.5: Update Barrel Export

- **Files**: `extensions/spec-bench/index.ts` (modify)
- **Action**: Add exports for new metrics, runner, and results modules

Add the following exports to the existing `index.ts`:

```typescript
// Metrics capture
export {
	MetricsAccumulator,
	IterationMetricsBuilder,
	computeAggregates,
	createEmptyIterationMetrics,
} from "./metrics.ts";

// Pi runner
export {
	runPiWithMetrics,
	checkPiAvailable,
	type PiRunResult,
	type PiRunOptions,
} from "./runner.ts";

// Results storage
export {
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

// Additional types from types.ts
export type {
	AgentMetrics,
	ReviewCyclesMetrics,
	IterationMetrics,
	IterationResult,
	PermutationAggregates,
	PermutationResult,
	BenchmarkSession,
	PiUsageStatsEvent,
	PiMessageUpdateEvent,
	PiEvent,
} from "./types.ts";
```

- **Verify**: TypeScript compiles without errors

---

### Step 2.6: Create Metrics Tests

- **Files**: `extensions/spec-bench/metrics.test.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/config.test.ts` test patterns
- **Action**: Create comprehensive tests for metrics capture

```typescript
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
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 2.7: Create Results Tests

- **Files**: `extensions/spec-bench/results.test.ts` (new)
- **Pattern Reference**: Based on test patterns with temp directories
- **Action**: Create tests for results storage

```typescript
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
		// Most recent should be first
		expect(sessions[0]).toContain(session2.sessionId);
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
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 2.8: Create Runner Integration Test

- **Files**: `extensions/spec-bench/runner.test.ts` (new)
- **Pattern Reference**: Integration test pattern
- **Action**: Create tests for runner module (tests actual subprocess spawning)

```typescript
import { describe, it, expect } from "vitest";
import { checkPiAvailable } from "./runner.ts";

// Note: Full runner tests require pi to be installed and would be slow.
// These tests verify the module structure and basic functionality.

describe("runner", () => {
	describe("checkPiAvailable", () => {
		it("returns boolean", async () => {
			const result = await checkPiAvailable();
			expect(typeof result).toBe("boolean");
		});
	});
	
	// Integration tests for runPiWithMetrics would go here but require:
	// 1. Pi to be installed and configured
	// 2. Valid API credentials
	// 3. Would be slow due to actual API calls
	// 
	// These should be run manually or in a dedicated integration test suite:
	// 
	// describe.skip("runPiWithMetrics integration", () => {
	//   it("captures metrics from simple task", async () => { ... });
	//   it("handles abort signal", async () => { ... });
	//   it("respects timeout", async () => { ... });
	// });
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-bench/metrics.ts` | Metrics accumulation from pi JSON output | `extensions/spec-pipeline/agents.ts` event parsing |
| `extensions/spec-bench/runner.ts` | Pi subprocess spawning with metrics capture | `extensions/spec-pipeline/agents.ts` spawn pattern |
| `extensions/spec-bench/results.ts` | Benchmark results persistence | `extensions/spec-pipeline/state.ts` JSON persistence |
| `extensions/spec-bench/metrics.test.ts` | Metrics capture tests | `extensions/spec-pipeline/config.test.ts` |
| `extensions/spec-bench/results.test.ts` | Results storage tests | Temp directory test pattern |
| `extensions/spec-bench/runner.test.ts` | Runner integration tests | Integration test pattern |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-bench/types.ts` | Add AgentMetrics, IterationMetrics, IterationResult, PermutationResult, BenchmarkSession, Pi event types |
| `extensions/spec-bench/index.ts` | Add exports for metrics, runner, results modules |

## Completion Checklist

- [ ] Step 2.1: Result types added to types.ts
- [ ] Step 2.2: MetricsAccumulator and IterationMetricsBuilder implemented
- [ ] Step 2.3: Pi runner with metrics capture implemented
- [ ] Step 2.4: Results storage module implemented
- [ ] Step 2.5: Barrel exports updated
- [ ] Step 2.6: Metrics tests passing
- [ ] Step 2.7: Results tests passing
- [ ] Step 2.8: Runner tests passing
- [ ] All tests pass (`npm test`)
- [ ] Code follows project conventions (TypeScript, vitest patterns)

## Verification Commands

```bash
# After completing all steps:

# Run all tests
npm test

# Type check
npx tsc --noEmit

# Verify metrics parsing works (manual check)
# Create a mock JSON event stream and test MetricsAccumulator:
node -e "
const { MetricsAccumulator } = require('./extensions/spec-bench/metrics.ts');
const acc = new MetricsAccumulator();
acc.processLine(JSON.stringify({ type: 'usage_stats', inputTokens: 100, outputTokens: 50 }));
console.log('Tokens:', acc.getCurrentTokens());
// Expected: { input: 100, output: 50 }
"
```

## Technical Notes

### Pi JSON Output Format

Pi emits various events when run with `--mode json`. The relevant events for metrics capture are:

1. **usage_stats**: Token usage per API call
   ```json
   {"type": "usage_stats", "inputTokens": 1234, "outputTokens": 567, ...}
   ```

2. **message_update**: Assistant output text
   ```json
   {"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "..."}}
   ```

The `MetricsAccumulator` class parses these events line-by-line and accumulates:
- Total input tokens (sum of all usage_stats events)
- Total output tokens (sum of all usage_stats events)
- Full assistant output text (concatenation of all text_delta events)

### Model Identifiers

The runner uses the same model identifier mapping as spec-pipeline:
- `opus` → `claude-opus-4-5`
- `sonnet` → `claude-sonnet-4-5`
- `haiku` → `claude-haiku-4-5`

### Tool Restrictions

The runner applies the same tool restrictions as spec-pipeline based on role:
- Read-only roles (reviewers, discovery): `read,bash,grep,find,ls`
- Write roles (drafters, implementer): `read,bash,edit,write,grep,find,ls`

This ensures consistent behavior between spec-pipeline and spec-bench.
