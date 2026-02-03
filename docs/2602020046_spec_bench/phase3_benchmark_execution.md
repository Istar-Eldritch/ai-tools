# Phase 3: Benchmark Execution and Automation

**Estimated Effort**: 2 days

## Overview

This phase implements the core benchmark execution engine that:
- Runs spec-pipeline for each fixture/permutation combination with automated responses
- Provides a mock `PipelineUIContext` that returns scripted responses (R26a)
- Handles SIGINT for clean abort (R5)
- Enforces timeouts per iteration (R27)
- Shows real-time progress output (R28)
- Integrates hidden tests post-implementation (R9, R15)

## Prerequisites

- Phase 1 complete (types.ts, config.ts, fixture.ts, isolation.ts, cli.ts exist)
- Phase 2 complete (metrics.ts, runner.ts, results.ts exist)

## Steps

### Step 3.1: Create Mock UI Context Module

- **Files**: `extensions/spec-bench/mock-ui.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/types.ts` PipelineUIContext interface
- **Action**: Create mock implementation that provides scripted responses for benchmark automation (R26a)

```typescript
/**
 * Mock PipelineUIContext for automated benchmark runs (R26a)
 * 
 * Provides scripted responses for all interactive prompts:
 * - Discovery answers from fixture's discovery.json
 * - Auto-approval for spec/plan review
 * - Auto-confirm for all prompts
 */

import type { LoadedFixture, DiscoveryConfig } from "./types.ts";

// ============================================
// Types
// ============================================

/**
 * UI context interface matching spec-pipeline's PipelineUIContext
 * This is a subset focusing on what we need to mock
 */
export interface MockUIContext {
	ui: {
		notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
		confirm: (title: string, msg: string) => Promise<boolean>;
		editor: (title: string, initial: string) => Promise<string | undefined>;
		select: (title: string, options: Array<{ label: string; value: string }>) => Promise<string>;
		setWidget: (id: string, content: string[] | undefined) => void;
	};
}

/**
 * Progress callback for benchmark status updates
 */
export interface ProgressCallback {
	onDiscoveryRound?: (round: number, maxRounds: number) => void;
	onStageChange?: (stage: string) => void;
	onNotify?: (msg: string, type: "info" | "error" | "success" | "warning") => void;
}

// ============================================
// Mock UI Context Factory
// ============================================

/**
 * Create a mock PipelineUIContext for automated benchmark runs (R26a)
 * 
 * @param discovery Discovery configuration from fixture (may be null)
 * @param progress Optional progress callbacks
 * @returns Mock UI context with scripted responses
 */
export function createMockUIContext(
	discovery: DiscoveryConfig | null,
	progress?: ProgressCallback
): MockUIContext {
	let discoveryRound = 0;
	
	return {
		ui: {
			/**
			 * Notify - logs to console and optionally calls progress callback
			 */
			notify: (msg: string, type: "info" | "error" | "success" | "warning") => {
				progress?.onNotify?.(msg, type);
				// Also detect stage changes from banner messages
				if (msg.includes("DISCOVERY PHASE")) {
					progress?.onStageChange?.("discovery");
				} else if (msg.includes("SPEC DRAFTING PHASE")) {
					progress?.onStageChange?.("spec_drafting");
				} else if (msg.includes("PLAN GENERATION PHASE")) {
					progress?.onStageChange?.("plan_generation");
				} else if (msg.includes("IMPLEMENTATION PHASE")) {
					progress?.onStageChange?.("implementation");
				}
			},
			
			/**
			 * Confirm - always returns true (auto-approve)
			 */
			confirm: async (_title: string, _msg: string): Promise<boolean> => {
				return true;  // Auto-approve all confirmations
			},
			
			/**
			 * Editor - returns scripted discovery answers or empty string
			 * 
			 * For discovery rounds, returns answers from discovery.json
			 * For other prompts, returns empty string (no additional feedback)
			 */
			editor: async (title: string, _initial: string): Promise<string | undefined> => {
				// Check if this is a discovery round prompt
				if (title.includes("Discovery Round")) {
					if (!discovery || !discovery.rounds) {
						// No discovery config - signal to finish discovery
						return discovery?.earlyFinish ? "done" : "";
					}
					
					const currentRound = discovery.rounds[discoveryRound];
					discoveryRound++;
					progress?.onDiscoveryRound?.(discoveryRound, discovery.rounds.length);
					
					if (currentRound) {
						return currentRound.answers;
					}
					
					// No more scripted answers - finish discovery if earlyFinish
					if (discovery.earlyFinish) {
						return "done";
					}
					
					// Return empty to trigger "no answers" handling
					return "";
				}
				
				// For other editor prompts (e.g., spec feedback), return empty
				return "";
			},
			
			/**
			 * Select - returns "approve" for approval prompts, first option otherwise
			 */
			select: async (title: string, options: Array<{ label: string; value: string }>): Promise<string> => {
				// For approval prompts, select "approve"
				const approveOption = options.find(o => o.value === "approve");
				if (approveOption) {
					return "approve";
				}
				
				// For "no answers" prompts, select "done" to proceed
				const doneOption = options.find(o => o.value === "done");
				if (doneOption && title.includes("No answers")) {
					return "done";
				}
				
				// Default to first option
				return options[0]?.value ?? "";
			},
			
			/**
			 * setWidget - no-op for benchmarks
			 */
			setWidget: (_id: string, _content: string[] | undefined) => {
				// No widget in benchmark mode
			},
		},
	};
}

/**
 * Reset discovery round counter (for multiple iterations with same discovery config)
 * Returns a new mock context with reset state
 */
export function createFreshMockUIContext(
	discovery: DiscoveryConfig | null,
	progress?: ProgressCallback
): MockUIContext {
	return createMockUIContext(discovery, progress);
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 3.2: Create Test Runner Module

- **Files**: `extensions/spec-bench/test-runner.ts` (new)
- **Pattern Reference**: Standard subprocess spawning patterns
- **Action**: Create module for running test commands and verifying results (R14, R15b)

```typescript
/**
 * Test runner for benchmark verification
 * 
 * Handles running test commands and reporting results (R14, R15b)
 */

import { spawn } from "node:child_process";

// ============================================
// Types
// ============================================

export interface TestResult {
	success: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
}

// ============================================
// Test Execution
// ============================================

/**
 * Run a test command and capture results
 * 
 * @param command Test command to run (e.g., "npm test")
 * @param cwd Working directory
 * @param timeoutMs Timeout in milliseconds (default: 5 minutes)
 * @param signal Optional abort signal for cancellation
 * @returns Test result with exit code and output
 */
export async function runTestCommand(
	command: string,
	cwd: string,
	timeoutMs: number = 300_000,
	signal?: AbortSignal
): Promise<TestResult> {
	const startTime = Date.now();
	
	return new Promise((resolve) => {
		// Parse command into executable and args
		// Handle common patterns: "npm test", "cargo test", etc.
		const parts = command.split(/\s+/);
		const executable = parts[0];
		const args = parts.slice(1);
		
		const proc = spawn(executable, args, {
			cwd,
			shell: true,  // Use shell for complex commands
			stdio: ["ignore", "pipe", "pipe"],
		});
		
		let stdout = "";
		let stderr = "";
		let killed = false;
		
		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		
		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		
		// Timeout handling
		const timeout = setTimeout(() => {
			killed = true;
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) {
					proc.kill("SIGKILL");
				}
			}, 5000);
		}, timeoutMs);
		
		// Abort signal handling
		if (signal) {
			const handleAbort = () => {
				killed = true;
				proc.kill("SIGTERM");
			};
			if (signal.aborted) {
				handleAbort();
			} else {
				signal.addEventListener("abort", handleAbort, { once: true });
			}
		}
		
		proc.on("close", (code) => {
			clearTimeout(timeout);
			const durationMs = Date.now() - startTime;
			
			resolve({
				success: code === 0 && !killed,
				exitCode: killed ? -1 : (code ?? 1),
				stdout,
				stderr,
				durationMs,
			});
		});
		
		proc.on("error", (err) => {
			clearTimeout(timeout);
			const durationMs = Date.now() - startTime;
			
			resolve({
				success: false,
				exitCode: 1,
				stdout,
				stderr: stderr + `\nProcess error: ${err.message}`,
				durationMs,
			});
		});
	});
}

/**
 * Run original test suite
 */
export async function runOriginalTests(
	testCommand: string,
	cwd: string,
	signal?: AbortSignal
): Promise<TestResult> {
	return runTestCommand(testCommand, cwd, 300_000, signal);
}

/**
 * Run test suite including hidden tests (R15b)
 */
export async function runAllTests(
	testCommand: string,
	cwd: string,
	signal?: AbortSignal
): Promise<TestResult> {
	// Same as original tests - hidden tests have already been copied
	return runTestCommand(testCommand, cwd, 300_000, signal);
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 3.3: Create Pipeline Executor Module

- **Files**: `extensions/spec-bench/executor.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/pipeline.ts` runPipeline pattern
- **Action**: Create module that executes spec-pipeline with mocked UI for a single iteration

```typescript
/**
 * Pipeline executor for benchmark iterations
 * 
 * Executes spec-pipeline with mocked UI context and captures metrics
 * This module bridges spec-bench to spec-pipeline for actual execution
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	LoadedFixture,
	Permutation,
	IterationResult,
	IterationMetrics,
	FailureReason,
	AgentMetrics,
} from "./types.ts";
import { createFreshMockUIContext, type ProgressCallback } from "./mock-ui.ts";
import { IterationMetricsBuilder, createEmptyIterationMetrics } from "./metrics.ts";
import { runPiWithMetrics, type PiRunOptions } from "./runner.ts";
import { createIsolatedProject, copyHiddenTests } from "./isolation.ts";
import { runOriginalTests, runAllTests } from "./test-runner.ts";

// ============================================
// Types
// ============================================

export interface ExecutionOptions {
	/** Fixture to run */
	fixture: LoadedFixture;
	/** Permutation configuration */
	permutation: Permutation;
	/** Iteration number (1-indexed) */
	iterationId: number;
	/** Session ID for isolation */
	sessionId: string;
	/** Timeout in milliseconds */
	timeoutMs: number;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
	/** Progress callback */
	progress?: ProgressCallback;
	/** Test command override (from fixture or detected) */
	testCommand?: string;
}

export interface ExecutionResult {
	success: boolean;
	failureReason: FailureReason | null;
	metrics: IterationMetrics;
	workDir?: string;  // For debugging - temp directory used
}

// ============================================
// Spec-Pipeline Config Generation
// ============================================

/**
 * Generate spec-pipeline config JSON from permutation
 */
function generateSpecPipelineConfig(
	permutation: Permutation,
	testCommand?: string
): object {
	const config: Record<string, unknown> = {};
	
	if (permutation.models) {
		config.models = permutation.models;
	}
	
	if (permutation.reviewCycles) {
		config.reviewCycles = permutation.reviewCycles;
	}
	
	if (testCommand) {
		config.testCommand = testCommand;
	}
	
	// Disable discovery by default for benchmarks (use scripted responses)
	// The mock UI handles discovery responses
	config.discovery = {
		enabled: true,  // Enable discovery but mock will provide answers
		maxRounds: 5,
	};
	
	return config;
}

// ============================================
// Pipeline Execution
// ============================================

/**
 * Execute a single benchmark iteration
 * 
 * This function:
 * 1. Creates isolated project copy
 * 2. Writes spec-pipeline config
 * 3. Runs spec-pipeline via pi subprocess
 * 4. Captures metrics from JSON output
 * 5. Copies hidden tests after code review
 * 6. Runs final verification
 */
export async function executeIteration(
	options: ExecutionOptions
): Promise<ExecutionResult> {
	const {
		fixture,
		permutation,
		iterationId,
		sessionId,
		timeoutMs,
		signal,
		progress,
		testCommand,
	} = options;
	
	const metricsBuilder = new IterationMetricsBuilder();
	let workDir: string | undefined;
	let cleanup: (() => Promise<void>) | undefined;
	
	try {
		// Step 1: Create isolated project
		progress?.onStageChange?.("setup");
		const isolation = await createIsolatedProject(fixture, sessionId, iterationId);
		
		if (!isolation.success || !isolation.workDir) {
			return {
				success: false,
				failureReason: "project_clone_failed",
				metrics: createEmptyIterationMetrics(),
			};
		}
		
		workDir = isolation.workDir;
		cleanup = isolation.cleanup;
		
		// Step 2: Write spec-pipeline config
		const piConfigDir = path.join(workDir, ".pi");
		if (!fs.existsSync(piConfigDir)) {
			fs.mkdirSync(piConfigDir, { recursive: true });
		}
		
		const specPipelineConfig = generateSpecPipelineConfig(
			permutation,
			testCommand || fixture.config.testCommand
		);
		
		fs.writeFileSync(
			path.join(piConfigDir, "spec-pipeline.json"),
			JSON.stringify(specPipelineConfig, null, 2)
		);
		
		// Step 3: Run spec-pipeline via pi subprocess
		// We use /spec command to start the pipeline
		progress?.onStageChange?.("pipeline");
		
		const pipelineResult = await runSpecPipeline(
			workDir,
			fixture,
			permutation,
			metricsBuilder,
			timeoutMs,
			signal,
			progress
		);
		
		if (!pipelineResult.success) {
			return {
				success: false,
				failureReason: pipelineResult.failureReason,
				metrics: metricsBuilder.buildPartial(),
				workDir,
			};
		}
		
		// Step 4: Copy hidden tests (R9, R15)
		if (fixture.hiddenTestsPath) {
			progress?.onStageChange?.("hidden_tests");
			
			const copyResult = copyHiddenTests(
				fixture.hiddenTestsPath,
				workDir,
				fixture.config.hiddenTestsTarget
			);
			
			if (!copyResult.success) {
				return {
					success: false,
					failureReason: "hidden_tests_setup_failed",
					metrics: metricsBuilder.buildPartial(),
					workDir,
				};
			}
		}
		
		// Step 5: Run final tests (R15b)
		progress?.onStageChange?.("verification");
		const effectiveTestCommand = testCommand || fixture.config.testCommand || "npm test";
		
		// First verify original tests passed
		const originalTestResult = await runOriginalTests(effectiveTestCommand, workDir, signal);
		metricsBuilder.setTestResults(originalTestResult.success, false);
		
		if (!originalTestResult.success) {
			return {
				success: false,
				failureReason: "test_failure",
				metrics: metricsBuilder.buildPartial(),
				workDir,
			};
		}
		
		// Run with hidden tests
		if (fixture.hiddenTestsPath) {
			const allTestResult = await runAllTests(effectiveTestCommand, workDir, signal);
			metricsBuilder.setTestResults(true, allTestResult.success);
			
			if (!allTestResult.success) {
				return {
					success: false,
					failureReason: "test_failure",
					metrics: metricsBuilder.buildPartial(),
					workDir,
				};
			}
		} else {
			metricsBuilder.setTestResults(true, true);  // No hidden tests to fail
		}
		
		return {
			success: true,
			failureReason: null,
			metrics: metricsBuilder.build(),
			workDir,
		};
		
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		
		// Check for specific error types
		if (errorMsg.includes("timeout") || errorMsg.includes("TIMEOUT")) {
			return {
				success: false,
				failureReason: "timeout",
				metrics: metricsBuilder.buildPartial(),
				workDir,
			};
		}
		
		return {
			success: false,
			failureReason: "pipeline_error",
			metrics: metricsBuilder.buildPartial(),
			workDir,
		};
		
	} finally {
		// Cleanup is handled by caller to allow debugging
		// If cleanup needed immediately, uncomment:
		// await cleanup?.();
	}
}

// ============================================
// Spec-Pipeline Runner
// ============================================

interface PipelineRunResult {
	success: boolean;
	failureReason: FailureReason | null;
}

/**
 * Run spec-pipeline as a subprocess via pi
 * 
 * Uses the /spec command to start a pipeline with the feature description
 */
async function runSpecPipeline(
	workDir: string,
	fixture: LoadedFixture,
	permutation: Permutation,
	metricsBuilder: IterationMetricsBuilder,
	timeoutMs: number,
	signal?: AbortSignal,
	progress?: ProgressCallback
): Promise<PipelineRunResult> {
	// Create mock UI context for scripted responses
	const mockUI = createFreshMockUIContext(fixture.discovery, progress);
	
	// Build the task for pi - using the /spec command pattern
	// The feature description comes from the fixture's feature.md
	const task = `/spec --quick ${fixture.featureDescription}`;
	
	// Build system prompt that includes mock UI behavior
	// This tells the agent how to behave in benchmark mode
	const systemPrompt = `You are running in automated benchmark mode.
All interactive prompts will be auto-approved.
Discovery responses are pre-scripted from the benchmark fixture.
Focus on completing the spec-pipeline workflow efficiently.`;
	
	// Determine model config from permutation (use specDrafter as the main model)
	const modelConfig = permutation.models?.specDrafter ?? {
		model: "opus" as const,
		thinking: "high" as const,
	};
	
	const runOptions: PiRunOptions = {
		modelConfig,
		task,
		cwd: workDir,
		systemPrompt,
		role: "benchmark",
		signal,
		timeoutMs,
		onOutput: (text) => {
			// Forward output to progress callback for monitoring
			progress?.onNotify?.(text, "info");
		},
	};
	
	const result = await runPiWithMetrics(runOptions);
	
	// Record metrics from this run
	metricsBuilder.addAgentMetrics(result.metrics);
	
	if (result.aborted) {
		return {
			success: false,
			failureReason: "timeout",
		};
	}
	
	if (result.exitCode !== 0) {
		return {
			success: false,
			failureReason: "pipeline_error",
		};
	}
	
	// Check output for completion indicators
	const output = result.output.toLowerCase();
	if (output.includes("pipeline complete") || output.includes("completed")) {
		return {
			success: true,
			failureReason: null,
		};
	}
	
	// If no clear completion, check for error indicators
	if (output.includes("error") || output.includes("failed")) {
		return {
			success: false,
			failureReason: "pipeline_error",
		};
	}
	
	// Assume success if exit code was 0 and no errors
	return {
		success: true,
		failureReason: null,
	};
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 3.4: Create Benchmark Orchestrator Module

- **Files**: `extensions/spec-bench/benchmark.ts` (new)
- **Pattern Reference**: Based on standard orchestration patterns
- **Action**: Create main benchmark orchestrator that runs all permutations and iterations (R4, R5, R27, R28)

```typescript
/**
 * Benchmark orchestrator
 * 
 * Coordinates execution of all permutations and iterations:
 * - Sequential execution (R4)
 * - SIGINT handling for clean abort (R5)
 * - Per-iteration timeouts (R27)
 * - Progress reporting (R28)
 */

import type {
	BenchmarkConfig,
	LoadedFixture,
	Permutation,
	BenchmarkSession,
	PermutationResult,
	IterationResult,
} from "./types.ts";
import { DEFAULT_TIMEOUT_SECONDS } from "./types.ts";
import {
	createSession,
	createPermutationResult,
	addIterationResult,
	finalizeSession,
	saveSession,
	formatSessionSummary,
	isUnsuitablePermutation,
} from "./results.ts";
import { executeIteration, type ExecutionOptions } from "./executor.ts";
import { createEmptyIterationMetrics } from "./metrics.ts";

// ============================================
// Types
// ============================================

export interface BenchmarkOptions {
	/** Benchmark configuration */
	config: BenchmarkConfig;
	/** Loaded fixtures */
	fixtures: LoadedFixture[];
	/** Output directory for results */
	outputDir: string;
	/** Optional abort controller for cancellation */
	abortController?: AbortController;
	/** Progress callbacks */
	onProgress?: BenchmarkProgressCallback;
}

export interface BenchmarkProgressCallback {
	/** Called when starting a new permutation */
	onPermutationStart?: (permutation: Permutation, index: number, total: number) => void;
	/** Called when starting a new iteration */
	onIterationStart?: (fixture: string, permutation: string, iteration: number, total: number) => void;
	/** Called when an iteration completes */
	onIterationComplete?: (result: IterationResult) => void;
	/** Called when a permutation completes */
	onPermutationComplete?: (result: PermutationResult) => void;
	/** Called with stage updates during execution */
	onStageChange?: (stage: string) => void;
	/** Called with log messages */
	onLog?: (msg: string, level: "info" | "warn" | "error") => void;
}

export interface BenchmarkResult {
	session: BenchmarkSession;
	aborted: boolean;
}

// ============================================
// SIGINT Handling
// ============================================

/**
 * Setup SIGINT handler for clean abort (R5)
 */
function setupSigintHandler(
	abortController: AbortController,
	onAbort: () => void
): () => void {
	const handler = () => {
		onAbort();
		abortController.abort();
	};
	
	process.on("SIGINT", handler);
	
	// Return cleanup function
	return () => {
		process.off("SIGINT", handler);
	};
}

// ============================================
// Main Benchmark Execution
// ============================================

/**
 * Run the full benchmark suite
 * 
 * Executes all permutations × fixtures × iterations sequentially (R4)
 */
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
	const {
		config,
		fixtures,
		outputDir,
		abortController = new AbortController(),
		onProgress,
	} = options;
	
	// Create session
	const session = createSession(config);
	let aborted = false;
	
	// Setup SIGINT handler (R5)
	const cleanupSigint = setupSigintHandler(abortController, () => {
		aborted = true;
		onProgress?.onLog?.("\n⚠️ Received SIGINT - aborting benchmark...", "warn");
	});
	
	try {
		const totalPermutations = config.permutations.length;
		
		// Execute each permutation
		for (let permIdx = 0; permIdx < config.permutations.length; permIdx++) {
			if (aborted) break;
			
			const permutation = config.permutations[permIdx];
			onProgress?.onPermutationStart?.(permutation, permIdx + 1, totalPermutations);
			
			const permResult = createPermutationResult(permutation.name, permutation);
			
			// Execute each fixture × iteration
			const totalIterations = fixtures.length * config.iterations;
			let iterationNum = 0;
			
			for (const fixture of fixtures) {
				if (aborted) break;
				
				for (let iter = 1; iter <= config.iterations; iter++) {
					if (aborted) break;
					
					iterationNum++;
					onProgress?.onIterationStart?.(
						fixture.config.name,
						permutation.name,
						iterationNum,
						totalIterations
					);
					
					// Execute single iteration
					const startedAt = new Date().toISOString();
					const timeout = (fixture.config.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
					
					const execOptions: ExecutionOptions = {
						fixture,
						permutation,
						iterationId: iter,
						sessionId: session.sessionId,
						timeoutMs: timeout,
						signal: abortController.signal,
						progress: {
							onStageChange: onProgress?.onStageChange,
							onNotify: (msg, type) => {
								if (type === "error") {
									onProgress?.onLog?.(msg, "error");
								}
							},
						},
					};
					
					const execResult = await executeIteration(execOptions);
					
					// Build iteration result
					const iterResult: IterationResult = {
						iterationId: iter,
						fixture: fixture.config.name,
						startedAt,
						completedAt: new Date().toISOString(),
						success: execResult.success,
						failureReason: execResult.failureReason,
						metrics: execResult.metrics,
					};
					
					addIterationResult(permResult, iterResult);
					onProgress?.onIterationComplete?.(iterResult);
					
					// Save session after each iteration for recovery
					session.permutations = session.permutations.filter(p => p.name !== permutation.name);
					session.permutations.push(permResult);
					saveSession(outputDir, session);
				}
			}
			
			onProgress?.onPermutationComplete?.(permResult);
			
			// Check if permutation is unsuitable (R21)
			if (isUnsuitablePermutation(permResult)) {
				onProgress?.onLog?.(
					`⚠️ Permutation "${permutation.name}" has 0% success rate - flagged as unsuitable`,
					"warn"
				);
			}
		}
		
		// Finalize session
		finalizeSession(session);
		saveSession(outputDir, session);
		
		return { session, aborted };
		
	} finally {
		cleanupSigint();
	}
}

// ============================================
// Progress Display Helpers
// ============================================

/**
 * Create console progress callbacks (R28)
 */
export function createConsoleProgress(): BenchmarkProgressCallback {
	let currentStage = "";
	let startTime = Date.now();
	
	return {
		onPermutationStart: (perm, index, total) => {
			console.log("\n" + "═".repeat(60));
			console.log(`Permutation ${index}/${total}: ${perm.name}`);
			console.log("═".repeat(60));
			startTime = Date.now();
		},
		
		onIterationStart: (fixture, permutation, iteration, total) => {
			const elapsed = Math.round((Date.now() - startTime) / 1000);
			process.stdout.write(
				`\r[${elapsed}s] Iteration ${iteration}/${total}: ${fixture} (${permutation})...`
			);
		},
		
		onIterationComplete: (result) => {
			const status = result.success ? "✓" : `✗ (${result.failureReason})`;
			const duration = Math.round(result.metrics.totalDurationMs / 1000);
			console.log(` ${status} [${duration}s]`);
		},
		
		onPermutationComplete: (result) => {
			const successRate = (result.aggregates.successRate * 100).toFixed(1);
			console.log(`\nPermutation complete: ${successRate}% success rate`);
		},
		
		onStageChange: (stage) => {
			if (stage !== currentStage) {
				currentStage = stage;
				// Stage change is informational - shown in iteration line
			}
		},
		
		onLog: (msg, level) => {
			if (level === "error") {
				console.error(`\n❌ ${msg}`);
			} else if (level === "warn") {
				console.log(`\n⚠️ ${msg}`);
			} else {
				console.log(`ℹ️ ${msg}`);
			}
		},
	};
}

/**
 * Format final benchmark summary
 */
export function formatBenchmarkSummary(result: BenchmarkResult): string {
	const lines: string[] = [];
	
	if (result.aborted) {
		lines.push("\n⚠️ Benchmark was aborted - partial results saved\n");
	} else {
		lines.push("\n✅ Benchmark completed successfully\n");
	}
	
	lines.push(formatSessionSummary(result.session));
	
	return lines.join("\n");
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 3.5: Update CLI with Benchmark Execution

- **Files**: `extensions/spec-bench/cli.ts` (modify)
- **Pattern Reference**: Based on existing cli.ts from Phase 1
- **Action**: Add benchmark execution logic to the CLI entry point

Find and replace the TODO comment section in cli.ts:

```typescript
// Before (in cli.ts):
	// TODO: Phase 2+ will implement actual benchmark execution
	printWarning("Benchmark execution not yet implemented (Phase 2+)");
	printInfo("Configuration and fixtures validated successfully");
```

```typescript
// After:
	// Run benchmark
	const abortController = new AbortController();
	
	// Import benchmark modules
	const { runBenchmark, createConsoleProgress, formatBenchmarkSummary } = await import("./benchmark.ts");
	
	console.log("\n🚀 Starting benchmark...\n");
	
	const result = await runBenchmark({
		config,
		fixtures,
		outputDir,
		abortController,
		onProgress: createConsoleProgress(),
	});
	
	// Print summary
	console.log(formatBenchmarkSummary(result));
	
	// Print results file location
	const { getResultsPath } = await import("./results.ts");
	const resultsPath = getResultsPath(outputDir, result.session.sessionId);
	printSuccess(`Results saved to: ${resultsPath}`);
	
	if (result.aborted) {
		process.exit(130);  // Standard exit code for SIGINT
	}
```

Also add the necessary import at the top of cli.ts if not present:

```typescript
// Add near the top of cli.ts after other imports:
import type { BenchmarkConfig, LoadedFixture } from "./types.ts";
```

- **Verify**: Run `npx tsx extensions/spec-bench/cli.ts --help` still works

---

### Step 3.6: Update Index Exports

- **Files**: `extensions/spec-bench/index.ts` (modify)
- **Action**: Add exports for new modules

Add to the existing index.ts:

```typescript
// Mock UI context
export {
	createMockUIContext,
	createFreshMockUIContext,
	type MockUIContext,
	type ProgressCallback,
} from "./mock-ui.ts";

// Test runner
export {
	runTestCommand,
	runOriginalTests,
	runAllTests,
	type TestResult,
} from "./test-runner.ts";

// Pipeline executor
export {
	executeIteration,
	type ExecutionOptions,
	type ExecutionResult,
} from "./executor.ts";

// Benchmark orchestrator
export {
	runBenchmark,
	createConsoleProgress,
	formatBenchmarkSummary,
	type BenchmarkOptions,
	type BenchmarkProgressCallback,
	type BenchmarkResult,
} from "./benchmark.ts";
```

- **Verify**: TypeScript compiles without errors

---

### Step 3.7: Create Mock UI Tests

- **Files**: `extensions/spec-bench/mock-ui.test.ts` (new)
- **Pattern Reference**: Based on existing test patterns
- **Action**: Create tests for mock UI context

```typescript
import { describe, it, expect } from "vitest";
import {
	createMockUIContext,
	createFreshMockUIContext,
} from "./mock-ui.ts";
import type { DiscoveryConfig } from "./types.ts";

describe("createMockUIContext", () => {
	describe("notify", () => {
		it("calls progress callback", () => {
			const messages: Array<{ msg: string; type: string }> = [];
			const ctx = createMockUIContext(null, {
				onNotify: (msg, type) => messages.push({ msg, type }),
			});
			
			ctx.ui.notify("Test message", "info");
			
			expect(messages.length).toBe(1);
			expect(messages[0].msg).toBe("Test message");
			expect(messages[0].type).toBe("info");
		});
		
		it("detects stage changes from banners", () => {
			const stages: string[] = [];
			const ctx = createMockUIContext(null, {
				onStageChange: (stage) => stages.push(stage),
			});
			
			ctx.ui.notify("DISCOVERY PHASE starting...", "info");
			ctx.ui.notify("SPEC DRAFTING PHASE starting...", "info");
			ctx.ui.notify("PLAN GENERATION PHASE starting...", "info");
			ctx.ui.notify("IMPLEMENTATION PHASE starting...", "info");
			
			expect(stages).toEqual(["discovery", "spec_drafting", "plan_generation", "implementation"]);
		});
	});
	
	describe("confirm", () => {
		it("always returns true (auto-approve)", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.confirm("Approve?", "Do you approve this?");
			
			expect(result).toBe(true);
		});
	});
	
	describe("editor", () => {
		it("returns scripted discovery answers", async () => {
			const discovery: DiscoveryConfig = {
				rounds: [
					{ answers: "Answer for round 1" },
					{ answers: "Answer for round 2" },
				],
			};
			const ctx = createMockUIContext(discovery);
			
			const answer1 = await ctx.ui.editor("Discovery Round 1", "");
			const answer2 = await ctx.ui.editor("Discovery Round 2", "");
			
			expect(answer1).toBe("Answer for round 1");
			expect(answer2).toBe("Answer for round 2");
		});
		
		it("returns 'done' when earlyFinish is true and no more answers", async () => {
			const discovery: DiscoveryConfig = {
				rounds: [{ answers: "Single answer" }],
				earlyFinish: true,
			};
			const ctx = createMockUIContext(discovery);
			
			await ctx.ui.editor("Discovery Round 1", "");  // Consume first answer
			const answer2 = await ctx.ui.editor("Discovery Round 2", "");
			
			expect(answer2).toBe("done");
		});
		
		it("returns empty string for non-discovery prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.editor("Spec Feedback", "");
			
			expect(result).toBe("");
		});
		
		it("calls progress callback on discovery round", async () => {
			const rounds: Array<{ round: number; max: number }> = [];
			const discovery: DiscoveryConfig = {
				rounds: [{ answers: "Answer 1" }, { answers: "Answer 2" }],
			};
			const ctx = createMockUIContext(discovery, {
				onDiscoveryRound: (round, max) => rounds.push({ round, max }),
			});
			
			await ctx.ui.editor("Discovery Round 1", "");
			await ctx.ui.editor("Discovery Round 2", "");
			
			expect(rounds.length).toBe(2);
			expect(rounds[0]).toEqual({ round: 1, max: 2 });
			expect(rounds[1]).toEqual({ round: 2, max: 2 });
		});
	});
	
	describe("select", () => {
		it("returns approve for approval prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("Choose action", [
				{ label: "Reject", value: "reject" },
				{ label: "Approve", value: "approve" },
			]);
			
			expect(result).toBe("approve");
		});
		
		it("returns done for no-answers prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("No answers provided. What would you like to do?", [
				{ label: "Done", value: "done" },
				{ label: "Skip", value: "skip" },
			]);
			
			expect(result).toBe("done");
		});
		
		it("returns first option as fallback", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("Choose", [
				{ label: "First", value: "first" },
				{ label: "Second", value: "second" },
			]);
			
			expect(result).toBe("first");
		});
	});
	
	describe("setWidget", () => {
		it("is a no-op", () => {
			const ctx = createMockUIContext(null);
			
			// Should not throw
			ctx.ui.setWidget("test", ["content"]);
			ctx.ui.setWidget("test", undefined);
		});
	});
});

describe("createFreshMockUIContext", () => {
	it("resets discovery round counter", async () => {
		const discovery: DiscoveryConfig = {
			rounds: [{ answers: "Answer 1" }],
		};
		
		// First context
		const ctx1 = createFreshMockUIContext(discovery);
		await ctx1.ui.editor("Discovery Round 1", "");
		
		// Second fresh context should reset counter
		const ctx2 = createFreshMockUIContext(discovery);
		const answer = await ctx2.ui.editor("Discovery Round 1", "");
		
		expect(answer).toBe("Answer 1");  // Counter was reset
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 3.8: Create Test Runner Tests

- **Files**: `extensions/spec-bench/test-runner.test.ts` (new)
- **Pattern Reference**: Based on existing test patterns
- **Action**: Create tests for test runner module

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTestCommand } from "./test-runner.ts";

describe("runTestCommand", () => {
	let tempDir: string;
	
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-test-runner-"));
	});
	
	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
	
	it("runs successful command", async () => {
		const result = await runTestCommand("echo hello", tempDir);
		
		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hello");
	});
	
	it("captures exit code from failed command", async () => {
		const result = await runTestCommand("exit 42", tempDir);
		
		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(42);
	});
	
	it("captures stderr", async () => {
		const result = await runTestCommand("echo error >&2", tempDir);
		
		expect(result.stderr).toContain("error");
	});
	
	it("respects timeout", async () => {
		const result = await runTestCommand("sleep 10", tempDir, 100);
		
		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(-1);  // Killed
	});
	
	it("records duration", async () => {
		const result = await runTestCommand("sleep 0.1", tempDir, 5000);
		
		expect(result.durationMs).toBeGreaterThan(50);
		expect(result.durationMs).toBeLessThan(2000);
	});
	
	it("handles abort signal", async () => {
		const controller = new AbortController();
		
		// Start command and abort quickly
		const resultPromise = runTestCommand("sleep 10", tempDir, 60000, controller.signal);
		
		setTimeout(() => controller.abort(), 50);
		
		const result = await resultPromise;
		
		expect(result.success).toBe(false);
	});
	
	it("runs in correct working directory", async () => {
		// Create a test file in the temp dir
		const testFile = path.join(tempDir, "testfile.txt");
		fs.writeFileSync(testFile, "content");
		
		const result = await runTestCommand("ls testfile.txt", tempDir);
		
		expect(result.success).toBe(true);
		expect(result.stdout).toContain("testfile.txt");
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 3.9: Create Executor Tests

- **Files**: `extensions/spec-bench/executor.test.ts` (new)
- **Pattern Reference**: Based on existing test patterns
- **Action**: Create tests for executor module (unit tests, not integration)

```typescript
import { describe, it, expect } from "vitest";
// Executor tests are primarily integration tests that require:
// - pi to be installed and configured
// - Valid API credentials
// - Would be slow due to actual API calls
//
// Unit tests for helper functions can go here.

describe("executor", () => {
	// Note: The executor module primarily orchestrates other modules
	// (isolation, runner, test-runner, mock-ui) which are tested separately.
	// 
	// Integration tests would verify the full pipeline execution but are
	// expensive to run and require real API access.
	
	describe("module structure", () => {
		it("exports executeIteration", async () => {
			const { executeIteration } = await import("./executor.ts");
			expect(typeof executeIteration).toBe("function");
		});
	});
	
	// Integration test placeholder:
	// describe.skip("executeIteration integration", () => {
	//   it("executes pipeline for simple fixture", async () => {
	//     // This would require a real fixture and pi access
	//   });
	// });
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 3.10: Create Benchmark Orchestrator Tests

- **Files**: `extensions/spec-bench/benchmark.test.ts` (new)
- **Pattern Reference**: Based on existing test patterns
- **Action**: Create tests for benchmark orchestrator

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	createConsoleProgress,
	formatBenchmarkSummary,
} from "./benchmark.ts";
import type { BenchmarkSession, PermutationResult, IterationResult } from "./types.ts";
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
```

- **Verify**: Run `npm test` and ensure all tests pass

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-bench/mock-ui.ts` | Mock PipelineUIContext for automation | `extensions/spec-pipeline/types.ts` interface |
| `extensions/spec-bench/test-runner.ts` | Test command execution | Standard subprocess patterns |
| `extensions/spec-bench/executor.ts` | Single iteration execution | `extensions/spec-pipeline/pipeline.ts` patterns |
| `extensions/spec-bench/benchmark.ts` | Benchmark orchestrator | Standard orchestration patterns |
| `extensions/spec-bench/mock-ui.test.ts` | Mock UI tests | Existing test patterns |
| `extensions/spec-bench/test-runner.test.ts` | Test runner tests | Existing test patterns |
| `extensions/spec-bench/executor.test.ts` | Executor tests | Existing test patterns |
| `extensions/spec-bench/benchmark.test.ts` | Benchmark orchestrator tests | Existing test patterns |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-bench/cli.ts` | Add benchmark execution logic after validation |
| `extensions/spec-bench/index.ts` | Add exports for new modules |

## Completion Checklist

- [ ] Step 3.1: Mock UI context module implemented
- [ ] Step 3.2: Test runner module implemented
- [ ] Step 3.3: Pipeline executor module implemented
- [ ] Step 3.4: Benchmark orchestrator module implemented
- [ ] Step 3.5: CLI updated with benchmark execution
- [ ] Step 3.6: Index exports updated
- [ ] Step 3.7: Mock UI tests passing
- [ ] Step 3.8: Test runner tests passing
- [ ] Step 3.9: Executor tests passing
- [ ] Step 3.10: Benchmark tests passing
- [ ] All tests pass (`npm test`)
- [ ] Code follows project conventions (TypeScript, vitest patterns)
- [ ] SIGINT handling works correctly
- [ ] Progress output displays during execution

## Verification Commands

```bash
# After completing all steps:

# Run all tests
npm test

# Type check
npx tsc --noEmit

# Test SIGINT handling (Ctrl+C during execution)
# Create a minimal test fixture first:
mkdir -p /tmp/bench-test/fixture/project
echo '{"name":"Test","description":"Test","hiddenTestsTarget":"tests"}' > /tmp/bench-test/fixture/fixture.json
echo '# Test Feature\n\nCreate a simple test function.' > /tmp/bench-test/fixture/feature.md
echo '{"fixtures":[{"path":"./fixture"}],"permutations":[{"name":"default"}],"iterations":1,"outputDir":"./results"}' > /tmp/bench-test/config.json

# Run benchmark (will fail due to missing pi/API, but tests structure)
cd /tmp/bench-test
npx tsx /path/to/ai_tools/extensions/spec-bench/cli.ts config.json

# Press Ctrl+C to test abort handling
```

## Technical Notes

### Mock UI Context Design (R26a)

The mock UI context provides scripted responses that match spec-pipeline's expected UI interactions:

1. **Discovery Q&A**: Returns answers from `discovery.json` in order by round
2. **Approvals**: Always returns `true` for `confirm()` prompts
3. **Selection**: Returns "approve" for approval prompts, "done" for empty-answer prompts
4. **Editor**: Returns scripted discovery answers or empty string for other prompts

This design allows the benchmark to run without human interaction while maintaining compatibility with spec-pipeline's UI contract.

### SIGINT Handling (R5)

SIGINT handling is implemented at the benchmark orchestrator level:
1. A cleanup handler is registered on `process.on("SIGINT", ...)`
2. When triggered, it aborts the `AbortController`
3. All in-progress operations receive the abort signal
4. Partial results are discarded for the current iteration
5. Session is saved with partial results before exit

### Timeout Implementation (R27)

Timeouts are enforced at two levels:
1. **Per-iteration**: The executor enforces the timeout from `fixture.config.timeout`
2. **Per-agent**: The runner enforces timeout passed from executor

When a timeout triggers:
1. SIGTERM is sent to the subprocess
2. After 5 seconds, SIGKILL is sent if still running
3. The iteration is marked as failed with reason "timeout"

### Progress Output (R28)

Progress is displayed via the `BenchmarkProgressCallback` interface:
- Permutation start/end
- Iteration start/end with timing
- Stage changes during execution
- Log messages at various levels

The console progress implementation provides:
- Clear progress lines with timing
- Success/failure indicators
- Warnings for unsuitable permutations
