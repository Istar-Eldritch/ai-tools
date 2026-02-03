# Phase 1: Configuration Schema and Loading

**Estimated Effort**: 1 day

## Overview

This phase implements the TypeBox-based configuration schema for model and thinking level configuration per role, with support for tiered reviewer configurations. It extends the existing `ProjectConfig` system to support the new `models` and `reviewCycles` configuration options specified in the spec.

## Prerequisites

- None (first phase)

## Steps

### Step 1.1: Add TypeBox Value Import

- **Files**: `extensions/spec-pipeline/index.ts` (line 40)
- **Pattern Reference**: Existing TypeBox import
- **Action**: Modify import to include `Static` type and add `Value` import for validation

```typescript
// Before (line 40):
import { Type } from "@sinclair/typebox";

// After:
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
```

- **Verify**: Extension loads successfully in pi (no tsconfig.json exists in the extension directory, so verification is done at runtime via pi loading the extension)

### Step 1.2: Define TypeBox Schemas for Model Configuration

- **Files**: `extensions/spec-pipeline/index.ts` (after the imports, before line 43 `const AGENTS`)
- **Pattern Reference**: Based on existing TypeBox usage at lines 3150-3171 (tool parameters)
- **Action**: Add TypeBox schema definitions for model configuration

```typescript
// Add after the imports, before the AGENTS constant

// Model configuration schemas
const ModelNameSchema = Type.Union([
	Type.Literal("opus"),
	Type.Literal("sonnet"),
	Type.Literal("haiku"),
]);

const ThinkingLevelSchema = Type.Union([
	Type.Literal("high"),
	Type.Literal("medium"),
	Type.Literal("off"),
]);

const ModelConfigSchema = Type.Object({
	model: ModelNameSchema,
	thinking: ThinkingLevelSchema,
});

// Tiered config for reviewer roles (cheap + expensive)
const TieredModelConfigSchema = Type.Object({
	cheap: ModelConfigSchema,
	expensive: ModelConfigSchema,
});

// Full models configuration schema
// NOTE: commitMessageWriter is explicitly included as optional Type.Any() to allow
// it in config but silently ignore it per R5a. Using Type.Any() means any value
// is accepted but we never use it.
const ModelsConfigSchema = Type.Object({
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

// Review cycles configuration schema
const ReviewCyclesConfigSchema = Type.Object({
	cheap: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
	expensive: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
});

// Full pipeline configuration schema (extends existing config)
const SpecPipelineConfigSchema = Type.Object({
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

// Type exports for use in other parts of the code
type ModelConfig = Static<typeof ModelConfigSchema>;
type TieredModelConfig = Static<typeof TieredModelConfigSchema>;
type ModelsConfig = Static<typeof ModelsConfigSchema>;
type ReviewCyclesConfig = Static<typeof ReviewCyclesConfigSchema>;
```

- **Verify**: Extension loads without import/schema errors

### Step 1.3: Define Default Model Configurations

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Based on existing `AGENTS` constant at lines 43-58
- **Action**: Add default model configurations following R14 requirements (add after the schema definitions)

```typescript
// Add after the schema type definitions

/**
 * Default model configurations per role (R14)
 * These are the optimized defaults when no configuration is provided
 */
const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
	discoveryAgent: { model: "sonnet", thinking: "medium" },  // Question generation doesn't need Opus
	specDrafter: { model: "opus", thinking: "high" },         // Complex synthesis task
	planDrafter: { model: "opus", thinking: "high" },         // Complex planning task
	implementer: { model: "opus", thinking: "high" },         // Complex code generation
	addressReview: { model: "opus", thinking: "high" },       // Complex fix implementation
} as const;

/**
 * Default tiered configurations for reviewer roles (R14)
 */
const DEFAULT_TIERED_CONFIGS: Record<string, TieredModelConfig> = {
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
 * Default review cycle counts (R15)
 */
const DEFAULT_REVIEW_CYCLES: ReviewCyclesConfig = {
	cheap: 2,
	expensive: 2,
} as const;

/**
 * Map model name to actual model identifier
 */
const MODEL_IDENTIFIERS: Record<string, string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
} as const;
```

- **Verify**: Constants are properly typed and match spec requirements

### Step 1.4: Extend ProjectConfig Interface

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Existing `ProjectConfig` interface at lines 92-102
- **Action**: Extend the interface to include model and review cycle configurations

```typescript
// Before (existing interface around line 92):
interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	// Discovery configuration
	discovery: {
		enabled: boolean;
		maxRounds: number;
		questionsPerRound: number;
	};
}

// After:
interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	// Discovery configuration
	discovery: {
		enabled: boolean;
		maxRounds: number;
		questionsPerRound: number;
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
	// Review cycle counts
	reviewCycles: {
		cheap: number;
		expensive: number;
	};
}
```

- **Verify**: Interface compiles and all usages of `ProjectConfig` are type-safe

### Step 1.5: Add Configuration Validation Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Existing `detectProjectConfig` function at line 359
- **Action**: Add a validation function that checks config against schema and returns detailed errors (add before detectProjectConfig function)

```typescript
// Add before detectProjectConfig function

/**
 * Validation error for configuration
 */
interface ConfigValidationError {
	path: string;
	message: string;
}

/**
 * Validate configuration against schema
 * Returns array of validation errors (empty if valid)
 */
function validateConfig(config: unknown): ConfigValidationError[] {
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
function formatValidationErrors(errors: ConfigValidationError[]): string {
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
```

- **Verify**: Validation catches invalid model names, thinking levels, and missing required fields

### Step 1.6: Add Function to Merge User Config with Defaults

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Create function to merge partial user config with optimized defaults (add after validation functions)

```typescript
// Add after validation functions

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
	
	// Build complete review cycles config
	const reviewCycles: ProjectConfig["reviewCycles"] = {
		cheap: userReviewCycles?.cheap ?? DEFAULT_REVIEW_CYCLES.cheap,
		expensive: userReviewCycles?.expensive ?? DEFAULT_REVIEW_CYCLES.expensive,
	};
	
	return { models, reviewCycles };
}
```

- **Verify**: Function correctly fills in defaults for partially-specified configs

### Step 1.7: Update detectProjectConfig to Load and Validate Models Config

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Existing `detectProjectConfig` function at line 359
- **Action**: Add new config loading function and update existing function to validate config and throw on errors

```typescript
// Before (existing function starting at line 359):
function detectProjectConfig(cwd: string): ProjectConfig {
	// Try to load explicit config
	const configPath = path.join(cwd, ".pi", "spec-pipeline.json");
	let config: Partial<ProjectConfig> = {};
	
	if (fs.existsSync(configPath)) {
		try {
			config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			// Ignore parse errors
		}
	}
	// ... rest of function
}

// After (replace detectProjectConfig and add new functions before it):

/**
 * Configuration loading result
 */
interface ConfigLoadResult {
	success: true;
	config: ProjectConfig;
	fromFile: boolean;
} | {
	success: false;
	error: string;
}

/**
 * Load and validate pipeline configuration
 * Returns error if config is corrupt or invalid (R4)
 */
function loadPipelineConfig(cwd: string): ConfigLoadResult {
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
 * Legacy function - wraps loadPipelineConfig for backward compatibility
 * Throws error if config is invalid (caught by calling code)
 */
function detectProjectConfig(cwd: string): ProjectConfig {
	const result = loadPipelineConfig(cwd);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.config;
}
```

- **Verify**: Function correctly validates JSON, schema, and merges with defaults

### Step 1.8: Add Configuration Display Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Based on `formatState` function at lines 1471-1576
- **Action**: Add function to display effective configuration at startup (R5) - add after mergeWithDefaults

```typescript
// Add after mergeWithDefaults function

/**
 * Format model config for display
 */
function formatModelConfig(config: ModelConfig): string {
	return `${config.model}/${config.thinking}`;
}

/**
 * Format tiered model config for display
 */
function formatTieredConfig(config: TieredModelConfig): string {
	return `cheap=${config.cheap.model}/${config.cheap.thinking}, expensive=${config.expensive.model}/${config.expensive.thinking}`;
}

/**
 * Format effective configuration for display at startup (R5)
 */
function formatEffectiveConfig(config: ProjectConfig, fromFile: boolean): string {
	const lines: string[] = [];
	
	lines.push(formatDivider(60));
	lines.push(`  📋 Spec Pipeline Configuration${fromFile ? " (from .pi/spec-pipeline.json)" : " (defaults)"}`);
	lines.push(formatDivider(60));
	lines.push("");
	
	// Model configurations
	lines.push("  Model Configurations:");
	lines.push(`    discoveryAgent    : ${formatModelConfig(config.models.discoveryAgent)}`);
	lines.push(`    specDrafter       : ${formatModelConfig(config.models.specDrafter)}`);
	lines.push(`    specReviewer      : ${formatTieredConfig(config.models.specReviewer)}`);
	lines.push(`    planDrafter       : ${formatModelConfig(config.models.planDrafter)}`);
	lines.push(`    planReviewer      : ${formatTieredConfig(config.models.planReviewer)}`);
	lines.push(`    implementer       : ${formatModelConfig(config.models.implementer)}`);
	lines.push(`    codeReviewer      : ${formatTieredConfig(config.models.codeReviewer)}`);
	lines.push(`    addressReview     : ${formatModelConfig(config.models.addressReview)}`);
	lines.push(`    commitMessageWriter: haiku/off (fixed)`);
	lines.push("");
	
	// Review cycles
	lines.push("  Review Cycles:");
	lines.push(`    Cheap model cycles    : ${config.reviewCycles.cheap}`);
	lines.push(`    Expensive model cycles: ${config.reviewCycles.expensive}`);
	lines.push("");
	
	lines.push(formatDivider(60));
	
	return lines.join("\n");
}
```

- **Verify**: Output is readable and shows all effective settings

### Step 1.9: Update /spec Command to Show Config and Handle Errors

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `/spec` command handler starting at line 2603
- **Action**: Replace the `detectProjectConfig` call at line 2660 with config loading and display

```typescript
// In the /spec command handler, find and replace the detectProjectConfig call:

// Before (line 2660):
const projectConfig = detectProjectConfig(cwd);

// After:
// Load and validate project configuration
const configResult = loadPipelineConfig(cwd);
if (!configResult.success) {
	ctx.ui.notify(configResult.error, "error");
	return;
}
const projectConfig = configResult.config;

// Display effective configuration (R5)
ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");
```

- **Verify**: Invalid config shows error and stops pipeline; valid config displays settings

### Step 1.10: Update /spec-resume Command to Handle Config Errors

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `/spec-resume` command handler at line 2727
- **Action**: Replace the `detectProjectConfig` call at line 2833 with same pattern

```typescript
// In the /spec-resume command handler, find and replace:

// Before (line 2833):
const projectConfig = detectProjectConfig(cwd);

// After:
// Load and validate project configuration
const configResult = loadPipelineConfig(cwd);
if (!configResult.success) {
	ctx.ui.notify(configResult.error, "error");
	return;
}
const projectConfig = configResult.config;
```

- **Verify**: Resume also validates config and fails gracefully

### Step 1.11: Update run_spec_agent Tool to Handle Config Errors

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: `run_spec_agent` tool at line 3143, `detectProjectConfig` call at line 3173
- **Action**: Wrap `detectProjectConfig` in try/catch since it now throws on invalid config

```typescript
// In the run_spec_agent tool execute function, find and replace:

// Before (line 3173):
const projectConfig = detectProjectConfig(ctx.cwd);
const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);

// After:
let projectConfig: ProjectConfig;
try {
	projectConfig = detectProjectConfig(ctx.cwd);
} catch (e) {
	const error = e instanceof Error ? e.message : "Configuration error";
	return {
		content: [{ type: "text", text: error }],
		details: { error },
		isError: true,
	};
}
const SYSTEM_PROMPTS = createSystemPrompts(projectConfig.projectContext);
```

- **Verify**: Tool returns error response instead of crashing when config is invalid

### Step 1.12: Add Helper Functions for Model Config Resolution

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Add helpers to resolve model config for a role/tier (add after formatEffectiveConfig)

```typescript
// Add after formatEffectiveConfig

/**
 * Get the CLI arguments for model and thinking level
 */
function getModelArgs(config: ModelConfig): { model: string; thinking: string } {
	return {
		model: MODEL_IDENTIFIERS[config.model],
		thinking: config.thinking,
	};
}

/**
 * Get model config for a reviewer role at a specific tier
 */
function getReviewerConfig(
	projectConfig: ProjectConfig,
	role: "specReviewer" | "planReviewer" | "codeReviewer",
	tier: "cheap" | "expensive"
): ModelConfig {
	return projectConfig.models[role][tier];
}

/**
 * Get model config for a non-reviewer role
 */
function getRoleConfig(
	projectConfig: ProjectConfig,
	role: Exclude<keyof ProjectConfig["models"], "specReviewer" | "planReviewer" | "codeReviewer">
): ModelConfig {
	return projectConfig.models[role];
}
```

- **Verify**: Helper functions return correct configs for roles and tiers

## Files Summary

### New Files

None - all changes are in existing file.

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Add TypeBox Value import (line 40), TypeBox schemas (after imports), default configs, ProjectConfig interface extension (line 92), validation functions, config loading, display formatting, command handler updates (lines 2660, 2833), run_spec_agent tool error handling (line 3173), and helper functions |

## Completion Checklist

- [ ] Step 1.1: TypeBox Value import added
- [ ] Step 1.2: TypeBox schemas defined for all config options (with commitMessageWriter as Type.Any for R5a)
- [ ] Step 1.3: Default model configurations match R14 requirements  
- [ ] Step 1.4: ProjectConfig interface extended with models and reviewCycles
- [ ] Step 1.5: Config validation function catches all invalid inputs (R4)
- [ ] Step 1.6: Merge function fills missing values with defaults (R3, R5)
- [ ] Step 1.7: loadPipelineConfig validates and merges configs, detectProjectConfig throws on error
- [ ] Step 1.8: formatEffectiveConfig displays readable settings
- [ ] Step 1.9: /spec command shows config and handles errors
- [ ] Step 1.10: /spec-resume command validates config
- [ ] Step 1.11: run_spec_agent tool handles config errors gracefully
- [ ] Step 1.12: Helper functions for role/tier config resolution
- [ ] Extension loads successfully in pi (runtime verification)
- [ ] Code follows existing project style

## Testing Verification

After implementation, test the following scenarios:

1. **No config file**: Pipeline uses optimized defaults, displays them at startup
2. **Empty config file `{}`**: Same as no config file  
3. **Partial config**: Missing values filled with defaults
   ```json
   { "models": { "discoveryAgent": { "model": "opus", "thinking": "high" } } }
   ```
4. **Invalid model name**: Error displayed, pipeline stops
   ```json
   { "models": { "discoveryAgent": { "model": "gpt4", "thinking": "high" } } }
   ```
5. **Invalid thinking level**: Error displayed, pipeline stops
   ```json
   { "models": { "discoveryAgent": { "model": "opus", "thinking": "ultra" } } }
   ```
6. **Invalid JSON**: Parse error displayed, pipeline stops
7. **commitMessageWriter in config**: Silently ignored per R5a (no validation error)
   ```json
   { "models": { "commitMessageWriter": { "model": "opus", "thinking": "high" } } }
   ```
8. **run_spec_agent with invalid config**: Returns error response instead of crashing

**Note on TypeScript verification**: The extension directory has no `tsconfig.json`. TypeScript type checking is performed at runtime when pi loads the extension. To manually verify types, you could run from pi's installation directory or create a temporary tsconfig, but the recommended approach is to test by loading the extension in pi.

## Notes for Phase 2

This phase prepares the configuration infrastructure. Phase 2 (Verdict Standardization) will use these configs when Phase 3 (Tiered Reviews) integrates the full model selection logic into the `runAgent` calls.

The `getModelArgs`, `getReviewerConfig`, and `getRoleConfig` helpers provide the interface that Phase 3 will use to select the correct model based on role and tier.
