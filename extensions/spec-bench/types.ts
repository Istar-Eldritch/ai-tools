/**
 * Type definitions for spec-bench fixtures and configuration
 */

import { Type, type Static } from "@sinclair/typebox";

// ============================================
// Fixture Configuration Schemas (R6, R7)
// ============================================

/**
 * Schema for fixture.json (R7)
 * 
 * Required fields:
 *   - name: Display name for the fixture
 *   - description: What this fixture tests
 *   - hiddenTestsTarget: Where to copy hidden-tests files
 * 
 * Optional fields:
 *   - project: Path or git URL to project source (omit if using project/ subdir)
 *   - projectRef: Branch/tag for git clone (default: HEAD)
 *   - testCommand: Override for test execution (default: auto-detect)
 *   - timeout: Max seconds per run (default: 3600)
 */
export const FixtureConfigSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	description: Type.String(),
	project: Type.Optional(Type.String()),
	projectRef: Type.Optional(Type.String()),
	testCommand: Type.Optional(Type.String()),
	hiddenTestsTarget: Type.String({ minLength: 1 }),
	timeout: Type.Optional(Type.Number({ minimum: 60, maximum: 86400 })),
});

export type FixtureConfig = Static<typeof FixtureConfigSchema>;

/**
 * Schema for discovery.json round (R8)
 */
export const DiscoveryRoundSchema = Type.Object({
	answers: Type.String({ minLength: 1 }),
});

/**
 * Schema for discovery.json (R8)
 */
export const DiscoveryConfigSchema = Type.Object({
	rounds: Type.Array(DiscoveryRoundSchema),
	earlyFinish: Type.Optional(Type.Boolean()),
});

export type DiscoveryConfig = Static<typeof DiscoveryConfigSchema>;

// ============================================
// Benchmark Configuration Schemas (R2, R23)
// ============================================

/**
 * Model configuration schema - matches spec-pipeline's ModelConfigSchema
 */
export const ModelConfigSchema = Type.Object({
	model: Type.Union([
		Type.Literal("opus"),
		Type.Literal("sonnet"),
		Type.Literal("haiku"),
	]),
	thinking: Type.Union([
		Type.Literal("high"),
		Type.Literal("medium"),
		Type.Literal("low"),
		Type.Literal("minimal"),
		Type.Literal("off"),
	]),
});

export type ModelConfig = Static<typeof ModelConfigSchema>;

/**
 * Tiered model config for reviewer roles
 */
export const TieredModelConfigSchema = Type.Object({
	cheap: ModelConfigSchema,
	expensive: ModelConfigSchema,
});

export type TieredModelConfig = Static<typeof TieredModelConfigSchema>;

/**
 * Review cycles configuration
 */
export const ReviewCyclesSchema = Type.Object({
	cheap: Type.Number({ minimum: 0, maximum: 10 }),
	expensive: Type.Number({ minimum: 0, maximum: 10 }),
});

/**
 * Full models configuration for a permutation
 */
export const PermutationModelsSchema = Type.Object({
	discoveryAgent: Type.Optional(ModelConfigSchema),
	specDrafter: Type.Optional(ModelConfigSchema),
	specReviewer: Type.Optional(TieredModelConfigSchema),
	planDrafter: Type.Optional(ModelConfigSchema),
	planReviewer: Type.Optional(TieredModelConfigSchema),
	implementer: Type.Optional(ModelConfigSchema),
	codeReviewer: Type.Optional(TieredModelConfigSchema),
	addressReview: Type.Optional(ModelConfigSchema),
});

export type PermutationModels = Static<typeof PermutationModelsSchema>;

/**
 * Schema for a single permutation (R23)
 */
export const PermutationSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	models: Type.Optional(PermutationModelsSchema),
	reviewCycles: Type.Optional(ReviewCyclesSchema),
});

export type Permutation = Static<typeof PermutationSchema>;

/**
 * Schema for fixture reference in benchmark config
 */
export const FixtureRefSchema = Type.Object({
	path: Type.String({ minLength: 1 }),
});

/**
 * Schema for full benchmark configuration (R2, R23)
 */
export const BenchmarkConfigSchema = Type.Object({
	fixtures: Type.Array(FixtureRefSchema, { minItems: 1 }),
	permutations: Type.Array(PermutationSchema, { minItems: 1 }),
	iterations: Type.Number({ minimum: 1, maximum: 100 }),
	outputDir: Type.String({ minLength: 1 }),
	parallelism: Type.Optional(Type.Literal(1)),  // Reserved for future, must be 1 (R4)
});

export type BenchmarkConfig = Static<typeof BenchmarkConfigSchema>;

// ============================================
// Loaded Fixture Type (runtime representation)
// ============================================

/**
 * Fully loaded fixture with resolved paths and content
 */
export interface LoadedFixture {
	/** Path to fixture directory */
	path: string;
	/** Parsed fixture.json */
	config: FixtureConfig;
	/** Content of feature.md */
	featureDescription: string;
	/** Parsed discovery.json (if present) */
	discovery: DiscoveryConfig | null;
	/** Path to hidden-tests directory (if exists) */
	hiddenTestsPath: string | null;
	/** Resolved project source (path or git URL) */
	projectSource: { type: "path"; path: string } | { type: "git"; url: string; ref?: string };
}

// ============================================
// Result Types (for future phases)
// ============================================

/**
 * Failure reasons for benchmark iterations
 */
export type FailureReason =
	| "timeout"
	| "pipeline_error"
	| "test_failure"
	| "hidden_tests_setup_failed"
	| "project_clone_failed"
	| "compile_error";

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

// ============================================
// Constants
// ============================================

export const DEFAULT_TIMEOUT_SECONDS = 3600;  // 1 hour per iteration
export const FIXTURE_CONFIG_FILE = "fixture.json";
export const DISCOVERY_CONFIG_FILE = "discovery.json";
export const FEATURE_FILE = "feature.md";
export const HIDDEN_TESTS_DIR = "hidden-tests";
export const PROJECT_SUBDIR = "project";
