/**
 * Type definitions for the spec pipeline
 * 
 * Split into two separate state types:
 * - SpecState: For spec creation (/spec command)
 * - ImplementationState: For implementation (/implement command)
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
	// agentCommitMessageWriter for commits after agent operations (R5)
	agentCommitMessageWriter: Type.Optional(ModelConfigSchema),
	// commitMessageWriter allowed in config but silently ignored (R5a)
	commitMessageWriter: Type.Optional(Type.Any()),
	// Hierarchy roles (roadmaps & epics)
	scopingAgent: Type.Optional(ModelConfigSchema),
	roadmapDrafter: Type.Optional(ModelConfigSchema),
	roadmapReviewer: Type.Optional(TieredModelConfigSchema),
	epicDrafter: Type.Optional(ModelConfigSchema),
	epicReviewer: Type.Optional(TieredModelConfigSchema),
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
	roadmapReviewer: Type.Optional(SingleReviewerCyclesSchema),
	epicReviewer: Type.Optional(SingleReviewerCyclesSchema),
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
	// Explicit paths to spec template and conventions files (overrides auto-discovery)
	specTemplatePath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specConventionsPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	// Output format for generated specs: "md" (default) or file extension from template
	// Auto-detected from existing specs or template format when not specified
	specFormat: Type.Optional(Type.String()),
	discovery: Type.Optional(Type.Object({
		enabled: Type.Optional(Type.Boolean()),
		maxRounds: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
		questionsPerRound: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
	})),
	models: Type.Optional(ModelsConfigSchema),
	reviewCycles: Type.Optional(ReviewCyclesConfigSchema),
	// Experimental: skip plan generation phase (go directly from spec to implementation)
	skipPlanGeneration: Type.Optional(Type.Boolean()),
});

// ============================================
// Type Exports
// ============================================

export type ModelConfig = Static<typeof ModelConfigSchema>;
export type TieredModelConfig = Static<typeof TieredModelConfigSchema>;
export type ModelsConfig = Static<typeof ModelsConfigSchema>;
export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;
export type SingleReviewerCycles = Static<typeof SingleReviewerCyclesSchema>;
export type PerReviewerCycles = Static<typeof PerReviewerCyclesSchema>;
export type ReviewCyclesConfig = Static<typeof ReviewCyclesConfigSchema>;

// Normalized per-reviewer cycles structure used internally
export interface NormalizedReviewCycles {
	specReviewer: { cheap: number; expensive: number };
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
	roadmapReviewer: { cheap: number; expensive: number };
	epicReviewer: { cheap: number; expensive: number };
}

// ============================================
// Metrics Types
// ============================================

/**
 * Metrics for a single agent call
 */
export interface AgentCallMetrics {
	role: RoleName;
	model: "opus" | "sonnet" | "haiku";
	thinking: ThinkingLevel;
	startTime: string;      // ISO timestamp
	endTime: string;        // ISO timestamp
	durationMs: number;     // Wall clock duration
	exitCode: number;
	phase?: number;         // Phase index if applicable
	cycle?: number;         // Review cycle if applicable
	tier?: "cheap" | "expensive";  // Review tier if applicable
}

/**
 * Metrics for spec creation pipelines
 */
export interface SpecMetrics {
	pipelineStartTime: string;
	pipelineEndTime?: string;
	totalDurationMs?: number;
	discoveryDurationMs?: number;
	specDraftingDurationMs?: number;
	agentCalls: AgentCallMetrics[];
	specReviewCycles: { cheap: number; expensive: number };
	specIterations: number;
	discoverySkipped: boolean;
}

/**
 * Metrics for implementation pipelines (for A/B testing plan generation)
 */
export interface ImplementationMetrics {
	pipelineStartTime: string;
	pipelineEndTime?: string;
	totalDurationMs?: number;
	planGenerationDurationMs?: number;
	implementationDurationMs?: number;
	agentCalls: AgentCallMetrics[];
	planReviewCycles: { cheap: number; expensive: number };
	codeReviewCycles: { cheap: number; expensive: number };
	codeReviewFirstPassRate: number;
	skipPlanGeneration: boolean;
}

// ============================================
// Project Configuration
// ============================================

export interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	// Spec template content (auto-discovered or from config)
	specTemplate: string | null;
	// Path to spec template file (for reference in prompts)
	specTemplatePath: string | null;
	// Spec conventions content (auto-discovered or from config)
	specConventions: string | null;
	// Path to spec conventions file (for reference in prompts)
	specConventionsPath: string | null;
	// Output format for generated specs (file extension without dot, e.g. "md", "typ")
	specFormat: string;
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
		agentCommitMessageWriter: ModelConfig;
		// Hierarchy roles
		scopingAgent: ModelConfig;
		roadmapDrafter: ModelConfig;
		roadmapReviewer: TieredModelConfig;
		epicDrafter: ModelConfig;
		epicReviewer: TieredModelConfig;
	};
	// Review cycle counts per reviewer
	// Setting both cheap and expensive to 0 skips that review entirely
	reviewCycles: NormalizedReviewCycles;
	// Experimental: skip plan generation (go directly from spec to implementation)
	skipPlanGeneration: boolean;
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
	| "commitMessageWriter" // Role for tool restrictions (read-only for both old and new commit agents)
	| "scopingAgent"
	| "roadmapDrafter"
	| "roadmapReviewer"
	| "epicDrafter"
	| "epicReviewer";

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
// Spec State Types
// ============================================

export type SpecStage = 
	| "discovery"
	| "spec_drafting"
	| "spec_review"
	| "user_approval"
	| "completed"
	| "cancelled";

/**
 * A single exchange in conversational discovery (user message + assistant response)
 */
export interface ConversationalExchange {
	userMessage: string;
	assistantResponse: string;
	timestamp: string;
}

/**
 * Discovery stage state
 */
export interface DiscoveryState {
	/** Whether discovery was skipped via --quick flag */
	skipped: boolean;
	/** Accumulated discovery summary (synthesized from conversation) */
	discoverySummary: string;
	/** Whether discovery is complete (user chose to proceed) */
	completed: boolean;
	/** Conversational discovery exchanges */
	conversationHistory?: ConversationalExchange[];
}

/**
 * Drafting stage state (for conversational spec drafting)
 */
export interface DraftingState {
	/** Conversation history for drafting phase */
	conversationHistory: ConversationalExchange[];
	/** Whether drafting is complete (user typed /spec-draft-done) */
	completed: boolean;
	/** Last review feedback (injected into drafting context for revisions) */
	lastReviewFeedback?: string;
}

/**
 * Pipeline mode for the conversational extension state machine.
 * - idle: No active conversational mode
 * - scoping: Host LLM is acting as scoping agent (for /plan command)
 * - discovery: Host LLM is acting as discovery agent
 * - drafting: Host LLM is acting as spec drafter
 */
export type PipelineMode = "idle" | "scoping" | "discovery" | "drafting";

/**
 * Ephemeral scoping state (not persisted to disk).
 * Tracks the scoping conversation during /plan to recommend a level.
 */
export interface ScopingState {
	/** Original description from /plan command */
	description: string;
	/** Whether --quick flag was passed */
	isQuick: boolean;
	/** Conversation history */
	conversationHistory: ConversationalExchange[];
	/** Recommended level parsed from agent output */
	recommendedLevel?: HierarchyLevel;
}

/**
 * Common interface for any pipeline state that supports conversational modes.
 * Both SpecState and HierarchyState (RoadmapState, EpicState) implement this.
 */
export interface ConversationalPipelineState {
	id: string;
	description: string;
	discovery?: DiscoveryState;
	drafting?: DraftingState;
}

/**
 * State for spec creation pipelines (/spec command)
 * Stored in .pi/spec-pipeline/specs/<id>/state.json
 */
export interface SpecState {
	id: string;
	description: string;
	stage: SpecStage;
	createdAt: string;
	updatedAt: string;
	
	// Stage before cancellation (for resume)
	stageBeforeCancellation?: SpecStage;
	
	// Discovery state
	discovery?: DiscoveryState;
	
	// Drafting state (conversational mode)
	drafting?: DraftingState;
	
	// Spec-related state
	specTimestamp: string;  // YYMMDDhhmm format
	specFilename: string;
	specPath: string;
	specDraft: string;
	specApproved: boolean;
	specIteration: number;
	
	// Git branch management
	originalBranch?: string;     // Branch name before pipeline started
	pipelineBranch?: string;     // e.g. "spec/2602071030-feature-name"
	useAgentCommits?: boolean;   // If true, use agent commits instead of checkpoints
	checkpoints?: string[];      // Array of checkpoint commit hashes
	errorStash?: string;         // Stash reference if error occurred
	
	// Error tracking
	lastError?: ErrorDetails | string;  // string for legacy compatibility
	
	// Metrics
	metrics?: SpecMetrics;
}

// ============================================
// Implementation State Types
// ============================================

export type ImplementationStage = 
	| "plan_generation"
	| "implementation"
	| "completed"
	| "cancelled";

/**
 * State for implementation pipelines (/implement command)
 * Stored in .pi/spec-pipeline/implementations/<id>/state.json
 */
export interface ImplementationState {
	id: string;
	implTimestamp: string;        // YYMMDDhhmm format for this implementation
	specPath: string;             // Path to the spec file being implemented
	specContent: string;          // Cached spec content at start
	stage: ImplementationStage;
	createdAt: string;
	updatedAt: string;
	
	// Stage before cancellation (for resume)
	stageBeforeCancellation?: ImplementationStage;
	
	// Phases state
	phases: string[];
	phasesGenerated: boolean[];
	currentPhaseIndex: number;
	
	// Implementation state (per phase)
	currentReviewCycle: number;
	previousReview: string;
	
	// Tiered review state
	currentReviewTier?: "cheap" | "expensive";
	cheapCyclesCompleted?: number;
	expensiveCyclesCompleted?: number;
	
	// Resume tracking
	implementerCompletedForPhase?: boolean;
	
	// Commit tracking
	phaseCommits: boolean[][];  // phaseCommits[phaseIdx][cycleIdx]
	
	// Git branch management
	originalBranch?: string;     // Branch name before pipeline started
	pipelineBranch?: string;     // e.g. "implement/2602071145-feature-name"
	useAgentCommits?: boolean;
	checkpoints?: string[];
	errorStash?: string;
	
	// Error tracking
	lastError?: ErrorDetails | string;
	
	// Flags
	skipPlanGeneration?: boolean;
	
	// Metrics
	metrics?: ImplementationMetrics;
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
export type TieredReviewerRole = "specReviewer" | "planReviewer" | "codeReviewer" | "roadmapReviewer" | "epicReviewer";

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
export const SPEC_STATE_DIR = ".pi/spec-pipeline/specs";
export const IMPL_STATE_DIR = ".pi/spec-pipeline/implementations";
export const STATE_FILE = "state.json";
export const MAX_SPEC_ITERATIONS = 5;
export const PIPELINE_WIDGET_ID = "spec-pipeline-status";

// Roles that need write/edit access to modify files
export const WRITE_ROLES = new Set(["specDrafter", "planDrafter", "implementer", "addressReview", "roadmapDrafter", "epicDrafter"]);
// Roles that only need to read and analyze (no write/edit access)
export const READ_ONLY_ROLES = new Set(["specReviewer", "planReviewer", "codeReviewer", "commitMessageWriter", "discoveryAgent", "scopingAgent", "roadmapReviewer", "epicReviewer"]);

/**
 * Map model name to actual model identifier
 */
export const MODEL_IDENTIFIERS: Record<"opus" | "sonnet" | "haiku", string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
} as const;

// ============================================
// Hierarchy Types (Roadmaps & Epics)
// ============================================

/** Document types in the hierarchy */
export type HierarchyLevel = "roadmap" | "epic" | "feature";

/** Stages for roadmap/epic pipelines */
export type HierarchyStage =
	| "scoping"          // /plan scoping assessment
	| "discovery"
	| "drafting"
	| "review"
	| "user_approval"
	| "approved"         // Approved, children can be created
	| "in_progress"      // At least one child started
	| "completed"
	| "cancelled";

/** A child item extracted from a roadmap/epic document */
export interface ChildItem {
	/** Sequential number within parent (1-indexed) */
	number: number;
	/** Name/title of the child item */
	name: string;
	/** Description of the child item */
	description: string;
	/** Priority: High, Medium, Low */
	priority: "High" | "Medium" | "Low";
	/** Dependencies as item numbers within same parent */
	dependencies: number[];
	/** Reference to the child pipeline once created */
	childPipelineId?: string;
	/** Type of child pipeline */
	childPipelineType?: HierarchyLevel;
	/** Status of the child (derived from child pipeline state) */
	childStatus?: "pending" | "in_progress" | "completed" | "cancelled";
}

/** State for roadmap pipelines */
export interface RoadmapState {
	id: string;
	level: "roadmap";
	description: string;
	stage: HierarchyStage;
	createdAt: string;
	updatedAt: string;

	// Stage before cancellation (for resume)
	stageBeforeCancellation?: HierarchyStage;

	// Discovery state (reuses existing DiscoveryState)
	discovery?: DiscoveryState;

	// Drafting state (reuses existing DraftingState)
	drafting?: DraftingState;

	// Document details
	docTimestamp: string;       // YYMMDDhhmm format
	docFilename: string;        // e.g. "2602071200_roadmap_warm_pools.md"
	docPath: string;            // relative path to document
	docContent: string;         // current document content
	docApproved: boolean;
	docIteration: number;

	// Child items (extracted from document after approval)
	children: ChildItem[];

	// Git branch management
	originalBranch?: string;
	pipelineBranch?: string;
	useAgentCommits?: boolean;
	checkpoints?: string[];
	errorStash?: string;

	// Error tracking
	lastError?: ErrorDetails | string;

	// Metrics (reuses SpecMetrics structure)
	metrics?: SpecMetrics;
}

/** State for epic pipelines */
export interface EpicState {
	id: string;
	level: "epic";
	description: string;
	stage: HierarchyStage;
	createdAt: string;
	updatedAt: string;

	// Stage before cancellation (for resume)
	stageBeforeCancellation?: HierarchyStage;

	// Parent reference (optional — epic can be standalone)
	parentId?: string;
	parentType?: "roadmap";

	// Discovery state
	discovery?: DiscoveryState;

	// Drafting state
	drafting?: DraftingState;

	// Document details
	docTimestamp: string;
	docFilename: string;
	docPath: string;
	docContent: string;
	docApproved: boolean;
	docIteration: number;

	// Child items (features extracted from document after approval)
	children: ChildItem[];

	// Git branch management
	originalBranch?: string;
	pipelineBranch?: string;
	useAgentCommits?: boolean;
	checkpoints?: string[];
	errorStash?: string;

	// Error tracking
	lastError?: ErrorDetails | string;

	// Metrics
	metrics?: SpecMetrics;
}

/** Union type for any hierarchy state */
export type HierarchyState = RoadmapState | EpicState;

/** State directories for hierarchy types */
export const ROADMAP_STATE_DIR = ".pi/spec-pipeline/roadmaps";
export const EPIC_STATE_DIR = ".pi/spec-pipeline/epics";
