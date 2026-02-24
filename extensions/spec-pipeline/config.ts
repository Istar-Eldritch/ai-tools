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
 * These are the optimized defaults when no configuration is provided.
 * Model values are actual model identifiers passed directly to the pi CLI.
 */
export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
	planDrafter: { model: "claude-opus-4-6", thinking: "high" },         // Complex planning task
	implementer: { model: "claude-opus-4-6", thinking: "high" },         // Complex code generation
	addressReview: { model: "claude-sonnet-4-5", thinking: "medium" },    // Fix application — issues already identified by reviewer
	agentCommitMessageWriter: { model: "claude-haiku-4-5", thinking: "off" },  // Fast, cheap commit message generation (R5)
} as const;

/**
 * Default tiered configurations for reviewer roles (R14)
 */
export const DEFAULT_TIERED_CONFIGS: Record<string, TieredModelConfig> = {
	planReviewer: {
		cheap: { model: "claude-sonnet-4-5", thinking: "medium" },
		expensive: { model: "claude-opus-4-6", thinking: "high" },
	},
	codeReviewer: {
		cheap: { model: "claude-sonnet-4-5", thinking: "medium" },
		expensive: { model: "claude-opus-4-6", thinking: "high" },
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
 * Per-reviewer format has planReviewer or codeReviewer keys
 * Global format has cheap and expensive keys directly
 */
function isPerReviewerFormat(config: ReviewCyclesConfig): config is PerReviewerCycles {
	if (!config || typeof config !== "object") return false;
	// If it has any of the reviewer keys, it's per-reviewer format
	return "planReviewer" in config || "codeReviewer" in config;
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
		planDrafter: userModels?.planDrafter ?? DEFAULT_MODEL_CONFIGS.planDrafter,
		planReviewer: userModels?.planReviewer ?? DEFAULT_TIERED_CONFIGS.planReviewer,
		implementer: userModels?.implementer ?? DEFAULT_MODEL_CONFIGS.implementer,
		codeReviewer: userModels?.codeReviewer ?? DEFAULT_TIERED_CONFIGS.codeReviewer,
		addressReview: userModels?.addressReview ?? DEFAULT_MODEL_CONFIGS.addressReview,
		agentCommitMessageWriter: userModels?.agentCommitMessageWriter ?? DEFAULT_MODEL_CONFIGS.agentCommitMessageWriter,
	};
	
	// Normalize review cycles to per-reviewer format
	const reviewCycles = normalizeReviewCycles(userReviewCycles);
	
	return { models, reviewCycles };
}

// ============================================
// Configuration Loading
// ============================================

// ============================================
// Spec Template & Conventions Discovery
// ============================================

/** File extensions we can read as text-based templates */
const READABLE_EXTENSIONS = new Set([".md", ".typ", ".txt", ".rst", ".adoc"]);

/**
 * Try to read a file if it exists and has a readable text extension.
 * Returns the content or null.
 */
function readTextFile(filePath: string): string | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		const ext = path.extname(filePath).toLowerCase();
		if (!READABLE_EXTENSIONS.has(ext)) return null;
		const content = fs.readFileSync(filePath, "utf-8");
		return content.trim().length > 0 ? content : null;
	} catch {
		return null;
	}
}

/**
 * Search a directory for files matching patterns.
 * Returns relative paths from cwd.
 */
function findFilesMatching(dir: string, patterns: RegExp[]): string[] {
	const results: string[] = [];
	try {
		if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return results;
		const entries = fs.readdirSync(dir);
		for (const entry of entries) {
			const fullPath = path.join(dir, entry);
			const stat = fs.statSync(fullPath);
			if (!stat.isFile()) continue;
			for (const pattern of patterns) {
				if (pattern.test(entry)) {
					results.push(fullPath);
					break;
				}
			}
		}
	} catch { /* ignore */ }
	return results;
}

/**
 * Discover spec template file in the project.
 * 
 * Priority:
 * 1. Explicit path from config (specTemplatePath)
 * 2. Files matching *TEMPLATE* or *template* in specs directory
 * 3. Files matching *TEMPLATE* or *template* in common locations
 * 
 * Returns { path, content } or { path: null, content: null }
 */
export function discoverSpecTemplate(
	cwd: string,
	specsDir: string,
	explicitPath?: string | null
): { path: string | null; content: string | null } {
	// 1. Explicit path from config
	if (explicitPath) {
		const fullPath = path.isAbsolute(explicitPath) 
			? explicitPath 
			: path.join(cwd, explicitPath);
		const content = readTextFile(fullPath);
		if (content) {
			return { path: explicitPath, content };
		}
	}
	
	// Null means explicitly disabled
	if (explicitPath === null) {
		return { path: null, content: null };
	}
	
	// 2. Search in specs directory
	const templatePatterns = [
		/template/i,
	];
	
	const searchDirs = [
		path.join(cwd, specsDir),
		path.join(cwd, "docs"),
		path.join(cwd, "specs"),
	];
	
	// Deduplicate directories
	const seen = new Set<string>();
	for (const dir of searchDirs) {
		const resolved = path.resolve(dir);
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		
		const matches = findFilesMatching(dir, templatePatterns);
		// Prefer files with TEMPLATE in the name (case-insensitive)
		// Filter out _template.typ (the Typst layout file) - we want the spec template
		const templateFiles = matches.filter(f => {
			const basename = path.basename(f).toLowerCase();
			// Must have "template" in the name
			if (!basename.includes("template")) return false;
			// Skip binary files
			const ext = path.extname(f).toLowerCase();
			if (!READABLE_EXTENSIONS.has(ext)) return false;
			// Skip layout template files (prefixed with underscore, no date prefix)
			// These are Typst layout files, not spec templates
			if (basename.startsWith("_")) return false;
			// Skip example files
			if (basename.includes("example")) return false;
			return true;
		});
		
		if (templateFiles.length > 0) {
			// Pick the first match (sorted for determinism)
			templateFiles.sort();
			const templatePath = templateFiles[0];
			const content = readTextFile(templatePath);
			if (content) {
				const relativePath = path.relative(cwd, templatePath);
				return { path: relativePath, content };
			}
		}
	}
	
	return { path: null, content: null };
}

/**
 * Discover spec conventions/guide file in the project.
 * 
 * Priority:
 * 1. Explicit path from config (specConventionsPath)
 * 2. Files matching *guide*spec* or *spec*convention* in specs directory
 * 3. Files matching similar patterns in common locations
 * 
 * Returns { path, content } or { path: null, content: null }
 */
export function discoverSpecConventions(
	cwd: string,
	specsDir: string,
	explicitPath?: string | null
): { path: string | null; content: string | null } {
	// 1. Explicit path from config
	if (explicitPath) {
		const fullPath = path.isAbsolute(explicitPath)
			? explicitPath
			: path.join(cwd, explicitPath);
		const content = readTextFile(fullPath);
		if (content) {
			return { path: explicitPath, content };
		}
	}
	
	// Null means explicitly disabled
	if (explicitPath === null) {
		return { path: null, content: null };
	}
	
	// 2. Search for convention files
	const conventionPatterns = [
		/guide.*spec/i,
		/spec.*guide/i,
		/spec.*convention/i,
		/convention.*spec/i,
		/writing.*spec/i,
		/spec.*standard/i,
	];
	
	const searchDirs = [
		path.join(cwd, specsDir),
		path.join(cwd, "docs"),
		path.join(cwd, "specs"),
	];
	
	const seen = new Set<string>();
	for (const dir of searchDirs) {
		const resolved = path.resolve(dir);
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		
		const matches = findFilesMatching(dir, conventionPatterns);
		const conventionFiles = matches.filter(f => {
			const ext = path.extname(f).toLowerCase();
			return READABLE_EXTENSIONS.has(ext);
		});
		
		if (conventionFiles.length > 0) {
			conventionFiles.sort();
			const conventionPath = conventionFiles[0];
			const content = readTextFile(conventionPath);
			if (content) {
				const relativePath = path.relative(cwd, conventionPath);
				return { path: relativePath, content };
			}
		}
	}
	
	return { path: null, content: null };
}

/**
 * Detect the spec output format.
 * 
 * Priority:
 * 1. Explicit format from config
 * 2. Extension of the discovered template file
 * 3. Default to "md"
 */
export function detectSpecFormat(
	explicitFormat?: string,
	templatePath?: string | null,
): string {
	if (explicitFormat) {
		return explicitFormat.replace(/^\./, "");
	}
	if (templatePath) {
		const ext = path.extname(templatePath).toLowerCase().replace(/^\./, "");
		if (ext) return ext;
	}
	return "md";
}

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

	// Discover spec template, conventions, and output format
	const template = discoverSpecTemplate(cwd, specsDir, config.specTemplatePath);
	const conventions = discoverSpecConventions(cwd, specsDir, config.specConventionsPath);
	const specFormat = detectSpecFormat(config.specFormat, template.path);

	if (template.content) {
		const truncatedTemplate = template.content.length > 8000
			? template.content.slice(0, 8000) + "\n\n[... truncated ...]"
			: template.content;
		projectContext += `\n## Spec Template (from ${template.path})\n\nUse this template as the basis for new specifications:\n\n\`\`\`\n${truncatedTemplate}\n\`\`\`\n`;
	}

	if (conventions.content) {
		const truncatedConventions = conventions.content.length > 8000
			? conventions.content.slice(0, 8000) + "\n\n[... truncated ...]"
			: conventions.content;
		projectContext += `\n## Spec Conventions (from ${conventions.path})\n\nFollow these conventions when writing specs:\n\n\`\`\`\n${truncatedConventions}\n\`\`\`\n`;
	}

	// Merge model configs with defaults (R3, R5)
	// Note: commitMessageWriter in config.models is silently ignored (R5a)
	const { models, reviewCycles } = mergeWithDefaults(
		config.models,
		config.reviewCycles
	);

	// Skip plan generation (experimental A/B testing)
	const skipPlanGeneration = config.skipPlanGeneration ?? false;

	return {
		specsDir,
		testCommand,
		contextFiles: foundFiles,
		projectContext,
		specTemplate: template.content,
		specTemplatePath: template.path,
		specConventions: conventions.content,
		specConventionsPath: conventions.path,
		specFormat,
		models,
		reviewCycles,
		skipPlanGeneration,
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
