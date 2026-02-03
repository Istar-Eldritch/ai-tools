/**
 * Configuration loading, validation, and defaults for the spec pipeline
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { Static } from "@sinclair/typebox";
import {
	type ModelConfig,
	type TieredModelConfig,
	type ModelsConfig,
	type ReviewCyclesConfig,
	type PerReviewerCycles,
	type NormalizedReviewCycles,
	type ProjectConfig,
	SpecPipelineConfigSchema,
} from "./types.ts";

// ============================================
// Default Configurations
// ============================================

/**
 * Default model configurations per role (R14)
 * These are the optimized defaults when no configuration is provided
 */
export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
	discoveryAgent: { model: "sonnet", thinking: "medium" },  // Question generation doesn't need Opus
	specDrafter: { model: "opus", thinking: "high" },         // Complex synthesis task
	planDrafter: { model: "opus", thinking: "high" },         // Complex planning task
	implementer: { model: "opus", thinking: "high" },         // Complex code generation
	addressReview: { model: "opus", thinking: "high" },       // Complex fix implementation
} as const;

/**
 * Default tiered configurations for reviewer roles (R14)
 */
export const DEFAULT_TIERED_CONFIGS: Record<string, TieredModelConfig> = {
	specReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	planReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	codeReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
} as const;

/**
 * Default review cycle counts per reviewer (R15)
 * Each reviewer gets the same defaults, but can be configured independently
 */
export const DEFAULT_REVIEWER_CYCLES: { cheap: number; expensive: number } = {
	cheap: 2,
	expensive: 2,
} as const;

export const DEFAULT_REVIEW_CYCLES: NormalizedReviewCycles = {
	specReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	planReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	codeReviewer: { ...DEFAULT_REVIEWER_CYCLES },
} as const;

// ============================================
// Validation
// ============================================

/**
 * Validation error for configuration
 */
export interface ConfigValidationError {
	path: string;
	message: string;
}

/**
 * Validate configuration against schema
 * Returns array of validation errors (empty if valid)
 */
export function validateConfig(config: unknown): ConfigValidationError[] {
	const errors: ConfigValidationError[] = [];
	
	// Use TypeBox Value.Check for validation
	if (!Value.Check(SpecPipelineConfigSchema, config)) {
		// Get detailed errors using Value.Errors
		for (const error of Value.Errors(SpecPipelineConfigSchema, config)) {
			errors.push({
				path: error.path,
				message: error.message,
			});
		}
	}
	
	return errors;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ConfigValidationError[]): string {
	const lines: string[] = [
		"Invalid spec-pipeline configuration:",
		"",
	];
	
	for (const error of errors) {
		lines.push(`  • ${error.path || "root"}: ${error.message}`);
	}
	
	lines.push("");
	lines.push("Please fix .pi/spec-pipeline.json and try again.");
	
	return lines.join("\n");
}

// ============================================
// Configuration Normalization
// ============================================

/**
 * Check if the review cycles config is in per-reviewer format
 * Per-reviewer format has specReviewer, planReviewer, or codeReviewer keys
 * Global format has cheap and expensive keys directly
 */
function isPerReviewerFormat(config: ReviewCyclesConfig): config is PerReviewerCycles {
	if (!config || typeof config !== "object") return false;
	// If it has any of the reviewer keys, it's per-reviewer format
	return "specReviewer" in config || "planReviewer" in config || "codeReviewer" in config;
}

/**
 * Normalize review cycles config to per-reviewer format
 * Handles both global format and per-reviewer format
 */
function normalizeReviewCycles(userReviewCycles: ReviewCyclesConfig | undefined): NormalizedReviewCycles {
	if (!userReviewCycles) {
		// No config provided - use defaults
		return { ...DEFAULT_REVIEW_CYCLES };
	}
	
	if (isPerReviewerFormat(userReviewCycles)) {
		// Per-reviewer format - merge each reviewer with defaults
		return {
			specReviewer: {
				cheap: userReviewCycles.specReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.specReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			planReviewer: {
				cheap: userReviewCycles.planReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.planReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			codeReviewer: {
				cheap: userReviewCycles.codeReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.codeReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
		};
	}
	
	// Global format - apply to all reviewers
	const globalCheap = userReviewCycles.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap;
	const globalExpensive = userReviewCycles.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive;
	return {
		specReviewer: { cheap: globalCheap, expensive: globalExpensive },
		planReviewer: { cheap: globalCheap, expensive: globalExpensive },
		codeReviewer: { cheap: globalCheap, expensive: globalExpensive },
	};
}

/**
 * Merge user-provided model config with defaults
 * Fills in missing values with optimized defaults (R3)
 * Note: commitMessageWriter in userModels is silently ignored (R5a)
 */
function mergeWithDefaults(
	userModels: ModelsConfig | undefined,
	userReviewCycles: ReviewCyclesConfig | undefined
): {
	models: ProjectConfig["models"];
	reviewCycles: ProjectConfig["reviewCycles"];
} {
	// Build complete models config by merging user values with defaults
	// Note: commitMessageWriter from userModels is intentionally not used (R5a)
	const models: ProjectConfig["models"] = {
		discoveryAgent: userModels?.discoveryAgent ?? DEFAULT_MODEL_CONFIGS.discoveryAgent,
		specDrafter: userModels?.specDrafter ?? DEFAULT_MODEL_CONFIGS.specDrafter,
		specReviewer: userModels?.specReviewer ?? DEFAULT_TIERED_CONFIGS.specReviewer,
		planDrafter: userModels?.planDrafter ?? DEFAULT_MODEL_CONFIGS.planDrafter,
		planReviewer: userModels?.planReviewer ?? DEFAULT_TIERED_CONFIGS.planReviewer,
		implementer: userModels?.implementer ?? DEFAULT_MODEL_CONFIGS.implementer,
		codeReviewer: userModels?.codeReviewer ?? DEFAULT_TIERED_CONFIGS.codeReviewer,
		addressReview: userModels?.addressReview ?? DEFAULT_MODEL_CONFIGS.addressReview,
	};
	
	// Normalize review cycles to per-reviewer format
	const reviewCycles = normalizeReviewCycles(userReviewCycles);
	
	return { models, reviewCycles };
}

// ============================================
// Configuration Loading
// ============================================

/**
 * Configuration loading result
 */
export type ConfigLoadResult = {
	success: true;
	config: ProjectConfig;
	fromFile: boolean;
} | {
	success: false;
	error: string;
};

/**
 * Build complete ProjectConfig from validated raw config
 */
function buildProjectConfig(
	cwd: string,
	config: Static<typeof SpecPipelineConfigSchema>
): ProjectConfig {
	// Detect specs directory (existing logic)
	let specsDir = config.specsDir;
	if (!specsDir) {
		if (fs.existsSync(path.join(cwd, "docs", "specs"))) {
			specsDir = "docs/specs";
		} else if (fs.existsSync(path.join(cwd, "docs"))) {
			specsDir = "docs";
		} else if (fs.existsSync(path.join(cwd, "specs"))) {
			specsDir = "specs";
		} else {
			specsDir = "docs";
		}
	}

	// Detect test command (existing logic)
	let testCommand = config.testCommand ?? null;
	if (!testCommand) {
		if (fs.existsSync(path.join(cwd, "package.json"))) {
			try {
				const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
				if (pkg.scripts?.test) {
					testCommand = "npm test";
				}
			} catch { /* ignore */ }
		}
		if (!testCommand && fs.existsSync(path.join(cwd, "Cargo.toml"))) {
			testCommand = "cargo test";
		}
		if (!testCommand && fs.existsSync(path.join(cwd, "pyproject.toml"))) {
			testCommand = "pytest";
		}
		if (!testCommand && fs.existsSync(path.join(cwd, "go.mod"))) {
			testCommand = "go test ./...";
		}
		if (!testCommand && fs.existsSync(path.join(cwd, "Makefile"))) {
			const makefile = fs.readFileSync(path.join(cwd, "Makefile"), "utf-8");
			if (makefile.includes("test:")) {
				testCommand = "make test";
			}
		}
		if (!testCommand && fs.existsSync(path.join(cwd, "scripts", "test.sh"))) {
			testCommand = "./scripts/test.sh";
		}
	}

	// Gather context files (existing logic)
	const contextFiles = config.contextFiles ?? [];
	const defaultContextFiles = [
		"AGENTS.md",
		"CONTRIBUTING.md",
		"ARCHITECTURE.md",
		"README.md",
		"docs/CONTRIBUTING.md",
		"docs/architecture.md",
		".github/CONTRIBUTING.md",
	];

	let projectContext = "## Project Context\n\n";
	const foundFiles: string[] = [];

	for (const file of [...contextFiles, ...defaultContextFiles]) {
		const filePath = path.join(cwd, file);
		if (fs.existsSync(filePath)) {
			try {
				const content = fs.readFileSync(filePath, "utf-8");
				if (content.trim().length > 100) {
					foundFiles.push(file);
					const truncated = content.length > 5000 
						? content.slice(0, 5000) + "\n\n[... truncated ...]" 
						: content;
					projectContext += `### From ${file}:\n\n${truncated}\n\n`;
				}
			} catch { /* ignore */ }
		}
	}

	if (foundFiles.length === 0) {
		projectContext = "## Project Context\n\nNo project documentation found. Explore the codebase to understand conventions.\n";
	} else {
		projectContext = `## Project Context\n\nFound documentation in: ${foundFiles.join(", ")}\n\n` + projectContext;
	}

	if (testCommand) {
		projectContext += `\n## Testing\n\nYou MUST run tests with: \`${testCommand}\`\n`;
	}

	// Discovery configuration with defaults
	const discoveryConfig = {
		enabled: config.discovery?.enabled ?? true,
		maxRounds: config.discovery?.maxRounds ?? 5,
		questionsPerRound: config.discovery?.questionsPerRound ?? 4,
	};

	// Merge model configs with defaults (R3, R5)
	// Note: commitMessageWriter in config.models is silently ignored (R5a)
	const { models, reviewCycles } = mergeWithDefaults(
		config.models,
		config.reviewCycles
	);

	return {
		specsDir,
		testCommand,
		contextFiles: foundFiles,
		projectContext,
		discovery: discoveryConfig,
		models,
		reviewCycles,
	};
}

/**
 * Load and validate pipeline configuration
 * Returns error if config is corrupt or invalid (R4)
 */
export function loadPipelineConfig(cwd: string): ConfigLoadResult {
	const configPath = path.join(cwd, ".pi", "spec-pipeline.json");
	let rawConfig: unknown = {};
	let fromFile = false;
	
	if (fs.existsSync(configPath)) {
		fromFile = true;
		try {
			const content = fs.readFileSync(configPath, "utf-8");
			rawConfig = JSON.parse(content);
		} catch (e) {
			// JSON parse error - return error (R4)
			const parseError = e instanceof Error ? e.message : "Unknown parse error";
			return {
				success: false,
				error: `Failed to parse .pi/spec-pipeline.json: ${parseError}`,
			};
		}
		
		// Validate against schema (R4)
		const validationErrors = validateConfig(rawConfig);
		if (validationErrors.length > 0) {
			return {
				success: false,
				error: formatValidationErrors(validationErrors),
			};
		}
	}
	
	// Cast to typed config after validation
	const typedConfig = rawConfig as Static<typeof SpecPipelineConfigSchema>;
	
	return {
		success: true,
		config: buildProjectConfig(cwd, typedConfig),
		fromFile,
	};
}

/**
 * Legacy function - wraps loadPipelineConfig for backward compatibility
 * Throws error if config is invalid (caught by calling code)
 */
export function detectProjectConfig(cwd: string): ProjectConfig {
	const result = loadPipelineConfig(cwd);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.config;
}
