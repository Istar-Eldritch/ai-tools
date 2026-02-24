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

export const ModelNameSchema = Type.String({ minLength: 1 });

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
	planDrafter: Type.Optional(ModelConfigSchema),
	planReviewer: Type.Optional(TieredModelConfigSchema),
	implementer: Type.Optional(ModelConfigSchema),
	codeReviewer: Type.Optional(TieredModelConfigSchema),
	addressReview: Type.Optional(ModelConfigSchema),
	// agentCommitMessageWriter for commits after agent operations (R5)
	agentCommitMessageWriter: Type.Optional(ModelConfigSchema),
	// commitMessageWriter allowed in config but silently ignore it per R5a
	commitMessageWriter: Type.Optional(Type.Any()),
});

// Single reviewer cycle configuration (allows 0 to skip)
export const SingleReviewerCyclesSchema = Type.Object({
	cheap: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
	expensive: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
});

// Per-reviewer cycle configuration
export const PerReviewerCyclesSchema = Type.Object({
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
	// Explicit paths to spec template and conventions files (overrides auto-discovery)
	specTemplatePath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specConventionsPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	// Output format for generated specs: "md" (default) or file extension from template
	// Auto-detected from existing specs or template format when not specified
	specFormat: Type.Optional(Type.String()),
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
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
}

// ============================================
// Metrics Types
// ============================================

/**
 * Metrics for a single agent call
 */
export interface AgentCallMetrics {
	role: RoleName;
	model: string;
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
	// Model configurations per role
	models: {
		planDrafter: ModelConfig;
		planReviewer: TieredModelConfig;
		implementer: ModelConfig;
		codeReviewer: TieredModelConfig;
		addressReview: ModelConfig;
		agentCommitMessageWriter: ModelConfig;
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
	| "planDrafter"
	| "planReviewer"
	| "implementer"
	| "codeReviewer"
	| "addressReview"
	| "commitMessageWriter"
	| "brainstormAgent"; // Role for tool restrictions (read-only for both old and new commit agents)

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
 * Drafting stage state (for conversational drafting)
 */
export interface DraftingState {
	/** Conversation history for drafting phase */
	conversationHistory: ConversationalExchange[];
	/** Whether drafting is complete (user typed /spec-draft-done or /draft-done) */
	completed: boolean;
}

/**
 * Pipeline mode for the conversational extension state machine.
 * - idle: No active conversational mode
 * - scoping: Host LLM is acting as scoping agent (for /plan command)
 * - discovery: Host LLM is acting as discovery agent
 * - drafting: Host LLM is acting as spec drafter
 */
export type PipelineMode = "idle" | "scoping" | "discovery" | "drafting" | "brainstorm";

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
	
	// Git state
	checkpoints?: string[];      // Array of commit hashes
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
	
	// Git state
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

export type AgentName = string;

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
export type TieredReviewerRole = "planReviewer" | "codeReviewer";

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
export const BRAINSTORM_STATE_DIR = ".pi/spec-pipeline/brainstorms";
export const STATE_FILE = "state.json";
export const MAX_SPEC_ITERATIONS = 5;
export const PIPELINE_WIDGET_ID = "spec-pipeline-status";

// Roles that need write/edit access to modify files
export const WRITE_ROLES = new Set(["planDrafter", "implementer", "addressReview"]);
// Roles that only need to read and analyze (no write/edit access)
export const READ_ONLY_ROLES = new Set(["planReviewer", "codeReviewer", "commitMessageWriter"]);



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

	// Git state
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

	// Git state
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

// ============================================
// Brainstorm Types
// ============================================

/** Stages for brainstorm pipelines */
export type BrainstormStage = "brainstorming" | "completed" | "cancelled";

/**
 * State for brainstorm pipelines (/brainstorm command)
 * Stored in .pi/spec-pipeline/brainstorms/<id>.json
 */
export interface BrainstormState {
	id: string;
	description: string;
	stage: BrainstormStage;
	createdAt: string;
	updatedAt: string;

	// Stage before cancellation (for potential future resume)
	stageBeforeCancellation?: BrainstormStage;

	// Document details
	docTimestamp: string;     // YYMMDDhhmm format
	docFilename: string;      // e.g. "2602171119_brainstorm_billing_redesign.md"
	docPath: string;          // relative path to document
	docContent: string;       // written at completion

	// Conversation history
	conversationHistory: ConversationalExchange[];

	// Git state
	checkpoints?: string[];

	// Error tracking
	lastError?: string;
}

// ============================================
// Agent Progress Event Types
// ============================================

/**
 * Data structure for tool invocation events from pi subprocess
 */
export interface ToolEventData {
	type: "tool";
	name: string;
	arguments: Record<string, any>;
}

/**
 * Data structure for text delta events from pi subprocess (legacy)
 */
export interface TextEventData {
	type: "text";
	delta: string;
}

/**
 * Union type for agent output events
 * 
 * Supports both legacy string callbacks and structured event data:
 * - `string`: Text delta from agent output (backward compatible)
 * - `TextEventData`: Structured text delta with explicit type
 * - `ToolEventData`: Tool invocation events (name, arguments)
 * 
 * **Type Narrowing Example:**
 * ```typescript
 * function handleOutput(event: AgentOutputEvent) {
 *     if (typeof event === "string") {
 *         // Legacy text delta
 *     } else if (event.type === "tool") {
 *         // Tool invocation: event.name, event.arguments
 *     } else if (event.type === "text") {
 *         // Structured text: event.delta
 *     }
 * }
 * ```
 * 
 * @since Phase 1 - Event parsing infrastructure
 * @see Phase 2 will introduce progress callbacks that leverage ToolEventData
 */
export type AgentOutputEvent = TextEventData | ToolEventData | string;
