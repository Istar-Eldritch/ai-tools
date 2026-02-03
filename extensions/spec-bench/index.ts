/**
 * spec-bench - Benchmark tool for spec-pipeline configurations
 * 
 * This module exports types and utilities for programmatic usage.
 * For CLI usage, run: npx tsx extensions/spec-bench/cli.ts
 */

// Types
export type {
	FixtureConfig,
	DiscoveryConfig,
	ModelConfig,
	TieredModelConfig,
	Permutation,
	PermutationModels,
	BenchmarkConfig,
	LoadedFixture,
	FailureReason,
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

// Constants
export {
	DEFAULT_TIMEOUT_SECONDS,
	FIXTURE_CONFIG_FILE,
	DISCOVERY_CONFIG_FILE,
	FEATURE_FILE,
	HIDDEN_TESTS_DIR,
	PROJECT_SUBDIR,
} from "./types.ts";

// Config loading
export {
	loadBenchmarkConfig,
	validateBenchmarkConfig,
	formatValidationErrors,
	type ConfigLoadResult,
	type ConfigValidationError,
} from "./config.ts";

// Fixture loading
export {
	loadFixture,
	loadAllFixtures,
	type FixtureLoadResult,
} from "./fixture.ts";

// Isolation utilities
export {
	createIsolatedProject,
	copyHiddenTests,
	type IsolationResult,
	type CleanupHandle,
} from "./isolation.ts";

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

// Report types
export type {
	FixtureStats,
	PermutationFixtureBreakdown,
	AgentRoleStats,
	PermutationComparison,
	ComparisonReport,
	PermutationSummary,
	BenchmarkReport,
	ExportFormat,
	ExportOptions,
} from "./report-types.ts";

// Analysis functions
export {
	analyzeByFixture,
	analyzeByAgentRole,
	getFixtureBreakdowns,
	getAgentAnalysis,
	comparePermutations,
	generateComparisonReport,
	createPermutationSummary,
	getAverageReviewCycles,
} from "./analysis.ts";

// Report formatting
export {
	formatPlainTextReport,
	formatMarkdownReport,
	formatCSVReport,
	formatReport,
} from "./report-formatter.ts";

// Report CLI commands
export {
	runReportCommand,
	runCompareCommand,
	parseReportArgs,
	type ReportOptions,
	type CompareOptions,
} from "./cli-report.ts";

// Fixture validation
export {
	validateFixture,
	validateAllFixtures,
	formatValidationResult,
	type ValidationSeverity,
	type ValidationIssue,
	type ValidationResult,
} from "./validator.ts";

// Validate CLI commands
export {
	runValidateCommand,
	parseValidateArgs,
	type ValidateOptions,
} from "./cli-validate.ts";
