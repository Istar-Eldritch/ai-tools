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
	FailureReason,
	IterationMetrics,
} from "./types.ts";
import type { ProgressCallback } from "./mock-ui.ts";
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
 * Uses the /spec command to start a pipeline with the feature description.
 * 
 * LIMITATION: Pi runs as a subprocess with stdin disconnected, so we cannot
 * inject interactive responses. The --quick flag skips discovery, and the
 * system prompt instructs the agent to auto-approve all prompts. This means:
 * - discovery.json fixtures are NOT used (reserved for future in-process mode)
 * - The agent must handle approvals via the /spec-resume flow
 * 
 * Future improvement: Run spec-pipeline in-process to enable true mock UI injection.
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
	// NOTE: Mock UI context cannot be used with subprocess execution.
	// The fixture.discovery config is reserved for future in-process mode.
	// For now, we rely on --quick and auto-approve instructions in the system prompt.
	
	// Build the task for pi - using the /spec command pattern
	// The feature description comes from the fixture's feature.md
	// --quick skips discovery phase (we can't provide interactive responses)
	const task = `/spec --quick ${fixture.featureDescription}`;
	
	// Build system prompt that instructs auto-approval behavior
	// Since we can't inject UI responses, we tell the agent to approve everything
	const systemPrompt = `You are running in automated benchmark mode.
When the spec-pipeline prompts for approval (spec review, plan review), always approve by selecting the approve option.
When asked for feedback or changes, provide empty feedback to accept as-is.
Focus on completing the spec-pipeline workflow efficiently without requesting user input.
If a prompt appears, choose the option that continues the workflow (approve, continue, done).`;
	
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
