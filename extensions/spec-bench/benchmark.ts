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
			currentStage = "";  // Reset stage for new permutation
		},
		
		onIterationStart: (fixture, permutation, iteration, total) => {
			const elapsed = Math.round((Date.now() - startTime) / 1000);
			const stageInfo = currentStage ? ` [${currentStage}]` : "";
			process.stdout.write(
				`\r[${elapsed}s] Iteration ${iteration}/${total}: ${fixture} (${permutation})${stageInfo}...`
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
