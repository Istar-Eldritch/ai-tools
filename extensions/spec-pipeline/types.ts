/**
 * Type definitions for the spec pipeline
 */

import { Type, type Static } from "@sinclair/typebox";

// ============================================
// Model Configuration Schemas
// ============================================

export const ModelNameSchema = Type.Union([
	Type.Literal("opus"),
	Type.Literal("sonnet"),
	Type.Literal("haiku"),
]);

export const ThinkingLevelSchema = Type.Union([
	Type.Literal("high"),
	Type.Literal("medium"),
	Type.Literal("low"),
	Type.Literal("minimal"),
	Type.Literal("off"),
]);

export const ModelConfigSchema = Type.Object({
	model: ModelNameSchema,
	thinking: ThinkingLevelSchema,
});

// Tiered config for reviewer roles (cheap + expensive)
export const TieredModelConfigSchema = Type.Object({
	cheap: ModelConfigSchema,
	expensive: ModelConfigSchema,
});

// Full models configuration schema
// NOTE: commitMessageWriter is explicitly included as optional Type.Any() to allow
// it in config but silently ignore it per R5a. Using Type.Any() means any value
// is accepted but we never use it.
export const ModelsConfigSchema = Type.Object({
	discoveryAgent: Type.Optional(ModelConfigSchema),
	specDrafter: Type.Optional(ModelConfigSchema),
	specReviewer: Type.Optional(TieredModelConfigSchema),
	planDrafter: Type.Optional(ModelConfigSchema),
	planReviewer: Type.Optional(TieredModelConfigSchema),
	implementer: Type.Optional(ModelConfigSchema),
	codeReviewer: Type.Optional(TieredModelConfigSchema),
	addressReview: Type.Optional(ModelConfigSchema),
	// commitMessageWriter allowed in config but silently ignored (R5a)
	commitMessageWriter: Type.Optional(Type.Any()),
});

// Single reviewer cycle configuration (allows 0 to skip)
export const SingleReviewerCyclesSchema = Type.Object({
	cheap: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
	expensive: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
});

// Per-reviewer cycle configuration
export const PerReviewerCyclesSchema = Type.Object({
	specReviewer: Type.Optional(SingleReviewerCyclesSchema),
	planReviewer: Type.Optional(SingleReviewerCyclesSchema),
	codeReviewer: Type.Optional(SingleReviewerCyclesSchema),
});

// Review cycles configuration schema - supports both global and per-reviewer formats
// Global format: { "cheap": 2, "expensive": 2 } - applies to all reviewers
// Per-reviewer format: { "specReviewer": { "cheap": 2 }, "planReviewer": { "cheap": 0 } }
export const ReviewCyclesConfigSchema = Type.Union([
	SingleReviewerCyclesSchema,
	PerReviewerCyclesSchema,
]);

// Full pipeline configuration schema
export const SpecPipelineConfigSchema = Type.Object({
	specsDir: Type.Optional(Type.String()),
	testCommand: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	contextFiles: Type.Optional(Type.Array(Type.String())),
	discovery: Type.Optional(Type.Object({
		enabled: Type.Optional(Type.Boolean()),
		maxRounds: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
		questionsPerRound: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
	})),
	models: Type.Optional(ModelsConfigSchema),
	reviewCycles: Type.Optional(ReviewCyclesConfigSchema),
});

// ============================================
// Type Exports
// ============================================

export type ModelConfig = Static<typeof ModelConfigSchema>;
export type TieredModelConfig = Static<typeof TieredModelConfigSchema>;
export type ModelsConfig = Static<typeof ModelsConfigSchema>;
export type SingleReviewerCycles = Static<typeof SingleReviewerCyclesSchema>;
export type PerReviewerCycles = Static<typeof PerReviewerCyclesSchema>;
export type ReviewCyclesConfig = Static<typeof ReviewCyclesConfigSchema>;

// Normalized per-reviewer cycles structure used internally
export interface NormalizedReviewCycles {
	specReviewer: { cheap: number; expensive: number };
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
}

// ============================================
// Project Configuration
// ============================================

export interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	// Discovery configuration
	discovery: {
		enabled: boolean;         // Whether discovery runs by default
		maxRounds: number;        // Maximum Q&A rounds (default: 5)
		questionsPerRound: number; // Target questions per round (default: 3-5)
	};
	// Model configurations per role
	models: {
		discoveryAgent: ModelConfig;
		specDrafter: ModelConfig;
		specReviewer: TieredModelConfig;
		planDrafter: ModelConfig;
		planReviewer: TieredModelConfig;
		implementer: ModelConfig;
		codeReviewer: TieredModelConfig;
		addressReview: ModelConfig;
	};
	// Review cycle counts per reviewer
	// Setting both cheap and expensive to 0 skips that review entirely
	reviewCycles: NormalizedReviewCycles;
}

// ============================================
// Error Handling Types
// ============================================

export type ErrorType = "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "VALIDATION" | "UNKNOWN";

export type RoleName = 
	| "discoveryAgent"
	| "specDrafter"
	| "specReviewer"
	| "planDrafter"
	| "planReviewer"
	| "implementer"
	| "codeReviewer"
	| "addressReview"
	| "commitMessageWriter";

export interface ErrorDetails {
	timestamp: string;           // ISO timestamp of error
	agent: AgentName;            // Which agent failed
	role: RoleName;              // Which role was executing
	phase?: number;              // Phase index (1-indexed, if in implementation stage)
	cycle?: number;              // Review cycle (1-indexed, if in implementation stage)
	exitCode: number;            // Subprocess exit code
	stderr?: string;             // Error output from subprocess (truncated to 2000 chars)
	errorType: ErrorType;        // Classified error type
	agentTask: string;           // The exact task prompt sent to the agent
}

// ============================================
// Pipeline State Types
// ============================================

export type PipelineStage = 
	| "discovery"
	| "spec_drafting"
	| "spec_review"
	| "user_approval"
	| "plan_generation"
	| "spec_commit"
	| "implementation"
	| "completed"
	| "cancelled";

/**
 * Represents a single Q&A exchange in discovery
 */
export interface DiscoveryQA {
	round: number;
	questions: string;   // Formatted questions from agent
	answers: string;     // User's responses
	timestamp: string;   // ISO timestamp
}

/**
 * Discovery stage state
 */
export interface DiscoveryState {
	/** Whether discovery was skipped via --quick flag */
	skipped: boolean;
	/** Current question round (1-indexed) */
	currentRound: number;
	/** Maximum rounds allowed (from config) */
	maxRounds: number;
	/** All Q&A exchanges */
	qaHistory: DiscoveryQA[];
	/** Accumulated discovery summary (synthesized from Q&A) */
	discoverySummary: string;
	/** Whether discovery is complete (user chose to proceed) */
	completed: boolean;
}

export interface PipelineState {
	id: string;
	description: string;
	stage: PipelineStage;
	createdAt: string;
	updatedAt: string;
	
	// Discovery state (optional for backward compatibility)
	discovery?: DiscoveryState;
	
	// Spec-related state
	specTimestamp: string;  // YYMMDDhhmm format
	specFilename: string;
	specPath: string;
	specDraft: string;
	specApproved: boolean;
	specIteration: number;
	
	// Phases state
	phases: string[];
	phasesGenerated: boolean[];
	currentPhaseIndex: number;
	
	// Implementation state (per phase)
	currentReviewCycle: number;
	previousReview: string;
	
	// Tiered review state (added in Phase 3)
	currentReviewTier?: "cheap" | "expensive";  // Which tier we're currently in
	cheapCyclesCompleted?: number;               // Cycles done in cheap tier
	expensiveCyclesCompleted?: number;           // Cycles done in expensive tier
	
	// Resume tracking - helps skip already-completed steps when resuming
	implementerCompletedForPhase?: boolean;      // True if implementer finished for current phase
	
	// Commit tracking
	specCommitted: boolean;
	phaseCommits: boolean[][];  // phaseCommits[phaseIdx][cycleIdx]
	
	// Error tracking
	lastError?: ErrorDetails | string;  // string for legacy compatibility
	
	// Git branch management
	originalBranch?: string;     // Branch name before pipeline started
	pipelineBranch?: string;     // Generated branch name for this pipeline
	checkpoints?: string[];      // Array of checkpoint commit hashes
	errorStash?: string;         // Stash reference if error occurred
}

// ============================================
// Agent Types
// ============================================

/**
 * Legacy agent configurations
 */
export const AGENTS = {
	opus: {
		model: "claude-opus-4-5",
		thinking: "high",
	},
	sonnet: {
		model: "claude-sonnet-4-5",
		thinking: "medium",
	},
	haiku: {
		model: "claude-haiku-4-5",
		thinking: "off",
	},
} as const;

export type AgentName = keyof typeof AGENTS;

export interface AgentResult {
	output: string;
	exitCode: number;
	error?: string;
}

// ============================================
// Review Types
// ============================================

/**
 * Review verdict types
 */
export type ReviewVerdict = "APPROVED" | "NEEDS_CHANGES";

/**
 * Result from a tiered review process
 */
export interface TieredReviewResult {
	/** Final verdict from the review process */
	verdict: ReviewVerdict;
	/** Output from the last review */
	lastReviewOutput: string;
	/** Which tier produced the final verdict */
	finalTier: "cheap" | "expensive";
	/** Number of cheap tier cycles completed */
	cheapCyclesCompleted: number;
	/** Number of expensive tier cycles completed */
	expensiveCyclesCompleted: number;
	/** Whether the process was interrupted by an error */
	hadError: boolean;
}

/** Reviewer role names that support tiered configuration */
export type TieredReviewerRole = "specReviewer" | "planReviewer" | "codeReviewer";

// ============================================
// UI Context Types
// ============================================

/** UI context type for widget functions */
export type WidgetUIContext = { 
	ui: { 
		setWidget: (id: string, content: string[] | undefined) => void;
	};
};

/** Full UI context for pipeline operations */
export interface PipelineUIContext {
	ui: {
		notify: (msg: string, type: "info" | "error" | "success" | "warning") => void;
		confirm: (title: string, msg: string) => Promise<boolean>;
		editor: (title: string, initial: string) => Promise<string | undefined>;
		select: (title: string, options: Array<string>) => Promise<string>;
		setWidget: (id: string, content: string[] | undefined) => void;
	};
}

// ============================================
// Constants
// ============================================

export const STATE_DIR = ".pi/spec-pipeline";
export const STATE_FILE = "state.json";
export const MAX_SPEC_ITERATIONS = 5;
export const PIPELINE_WIDGET_ID = "spec-pipeline-status";

// Roles that need write/edit access to modify files
export const WRITE_ROLES = new Set(["specDrafter", "planDrafter", "implementer", "addressReview"]);
// Roles that only need to read and analyze (no write/edit access)
export const READ_ONLY_ROLES = new Set(["specReviewer", "planReviewer", "codeReviewer", "commitMessageWriter", "discoveryAgent"]);

/**
 * Map model name to actual model identifier
 */
export const MODEL_IDENTIFIERS: Record<"opus" | "sonnet" | "haiku", string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
} as const;
