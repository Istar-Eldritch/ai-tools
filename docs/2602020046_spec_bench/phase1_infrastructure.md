# Phase 1: Core Infrastructure and Fixture Handling

**Estimated Effort**: 2 days

## Overview

This phase establishes the foundational infrastructure for the spec-bench CLI tool:
- Directory structure and package configuration
- TypeBox schemas for fixture and benchmark configuration validation
- Fixture loading, validation, and project cloning/copying
- Basic CLI entry point with argument parsing

## Prerequisites
- None (first phase)

## Steps

### Step 1.1: Create Directory Structure

- **Files**: `extensions/spec-bench/` (new directory)
- **Pattern Reference**: Based on `extensions/spec-pipeline/` structure
- **Action**: Create the spec-bench extension directory with standard TypeScript module layout

```bash
mkdir -p extensions/spec-bench
```

**Expected structure:**
```
extensions/spec-bench/
├── package.json           # Package configuration
├── cli.ts                 # CLI entry point
├── types.ts               # TypeBox schemas and type definitions
├── config.ts              # Configuration loading/validation
├── fixture.ts             # Fixture loading and validation
├── isolation.ts           # Project cloning/copying utilities
├── index.ts               # Barrel export (for potential library usage)
└── *.test.ts              # Test files (added in later steps)
```

- **Verify**: Directory exists with `ls extensions/spec-bench/`

---

### Step 1.2: Create Package Configuration

- **Files**: `extensions/spec-bench/package.json` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/package.json`
- **Action**: Create minimal package.json for the spec-bench workspace

```json
{
  "name": "spec-bench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "spec-bench": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "tsx cli.ts"
  },
  "dependencies": {
    "@sinclair/typebox": "^0.34.0"
  }
}
```

Note: The root `package.json` already includes `"workspaces": ["extensions/*"]`, so this package will be automatically included. Dependencies like `@sinclair/typebox` are already available from the root workspace via hoisting.

- **Verify**: Run `npm install` from root to ensure workspace is recognized

---

### Step 1.3: Define TypeBox Schemas for Fixture Configuration

- **Files**: `extensions/spec-bench/types.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/types.ts` TypeBox patterns
- **Action**: Create TypeBox schemas for `fixture.json` and `discovery.json` per spec R6, R7, R8

```typescript
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
// Constants
// ============================================

export const DEFAULT_TIMEOUT_SECONDS = 3600;  // 1 hour per iteration
export const FIXTURE_CONFIG_FILE = "fixture.json";
export const DISCOVERY_CONFIG_FILE = "discovery.json";
export const FEATURE_FILE = "feature.md";
export const HIDDEN_TESTS_DIR = "hidden-tests";
export const PROJECT_SUBDIR = "project";
```

- **Verify**: Run `npx tsc --noEmit extensions/spec-bench/types.ts` (after TypeScript config is set up)

---

### Step 1.4: Create Configuration Loading and Validation

- **Files**: `extensions/spec-bench/config.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/config.ts` validation patterns
- **Action**: Create config loading with TypeBox validation (R25)

```typescript
/**
 * Benchmark configuration loading and validation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
	BenchmarkConfigSchema,
	type BenchmarkConfig,
} from "./types.ts";

// ============================================
// Validation Types
// ============================================

export interface ConfigValidationError {
	path: string;
	message: string;
}

export type ConfigLoadResult =
	| { success: true; config: BenchmarkConfig }
	| { success: false; errors: ConfigValidationError[] };

// ============================================
// Validation Functions
// ============================================

/**
 * Validate benchmark configuration against schema
 */
export function validateBenchmarkConfig(config: unknown): ConfigValidationError[] {
	const errors: ConfigValidationError[] = [];
	
	if (!Value.Check(BenchmarkConfigSchema, config)) {
		for (const error of Value.Errors(BenchmarkConfigSchema, config)) {
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
		"Invalid benchmark configuration:",
		"",
	];
	
	for (const error of errors) {
		lines.push(`  • ${error.path || "root"}: ${error.message}`);
	}
	
	return lines.join("\n");
}

// ============================================
// Configuration Loading
// ============================================

/**
 * Load and validate benchmark configuration from a JSON file
 */
export function loadBenchmarkConfig(configPath: string): ConfigLoadResult {
	// Check file exists
	if (!fs.existsSync(configPath)) {
		return {
			success: false,
			errors: [{ path: "", message: `Configuration file not found: ${configPath}` }],
		};
	}
	
	// Parse JSON
	let rawConfig: unknown;
	try {
		const content = fs.readFileSync(configPath, "utf-8");
		rawConfig = JSON.parse(content);
	} catch (e) {
		const parseError = e instanceof Error ? e.message : "Unknown parse error";
		return {
			success: false,
			errors: [{ path: "", message: `Failed to parse JSON: ${parseError}` }],
		};
	}
	
	// Validate against schema
	const validationErrors = validateBenchmarkConfig(rawConfig);
	if (validationErrors.length > 0) {
		return {
			success: false,
			errors: validationErrors,
		};
	}
	
	// Additional semantic validation
	const config = rawConfig as BenchmarkConfig;
	const semanticErrors: ConfigValidationError[] = [];
	
	// Check for duplicate fixture paths
	const fixturePaths = new Set<string>();
	for (const fixture of config.fixtures) {
		const normalizedPath = path.resolve(fixture.path);
		if (fixturePaths.has(normalizedPath)) {
			semanticErrors.push({
				path: "/fixtures",
				message: `Duplicate fixture path: ${fixture.path}`,
			});
		}
		fixturePaths.add(normalizedPath);
	}
	
	// Check for duplicate permutation names
	const permutationNames = new Set<string>();
	for (const perm of config.permutations) {
		if (permutationNames.has(perm.name)) {
			semanticErrors.push({
				path: "/permutations",
				message: `Duplicate permutation name: ${perm.name}`,
			});
		}
		permutationNames.add(perm.name);
	}
	
	// Check parallelism is 1 if specified (R4)
	if (config.parallelism !== undefined && config.parallelism !== 1) {
		semanticErrors.push({
			path: "/parallelism",
			message: "Parallelism must be 1 (parallel execution not yet supported)",
		});
	}
	
	if (semanticErrors.length > 0) {
		return {
			success: false,
			errors: semanticErrors,
		};
	}
	
	return { success: true, config };
}
```

- **Verify**: Add tests in Step 1.8

---

### Step 1.5: Create Fixture Loading and Validation

- **Files**: `extensions/spec-bench/fixture.ts` (new)
- **Pattern Reference**: Follows validation pattern from `extensions/spec-pipeline/config.ts`
- **Action**: Create fixture loading with validation of required files (R6, R7)

```typescript
/**
 * Fixture loading and validation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
	FixtureConfigSchema,
	DiscoveryConfigSchema,
	type FixtureConfig,
	type DiscoveryConfig,
	type LoadedFixture,
	FIXTURE_CONFIG_FILE,
	DISCOVERY_CONFIG_FILE,
	FEATURE_FILE,
	HIDDEN_TESTS_DIR,
	PROJECT_SUBDIR,
} from "./types.ts";

// ============================================
// Fixture Loading Types
// ============================================

export type FixtureLoadResult =
	| { success: true; fixture: LoadedFixture }
	| { success: false; error: string };

// ============================================
// Fixture Loading
// ============================================

/**
 * Determine project source from fixture config and directory contents
 * Per R6a: project field can be path, git URL, or omitted (uses project/ subdir)
 */
function resolveProjectSource(
	fixturePath: string,
	config: FixtureConfig
): LoadedFixture["projectSource"] | { error: string } {
	if (config.project) {
		// Check if it's a git URL
		if (
			config.project.startsWith("git@") ||
			config.project.startsWith("https://") ||
			config.project.startsWith("git://") ||
			config.project.includes(".git")
		) {
			return {
				type: "git",
				url: config.project,
				ref: config.projectRef,
			};
		}
		
		// Treat as local path (absolute or relative to fixture)
		const resolvedPath = path.isAbsolute(config.project)
			? config.project
			: path.resolve(fixturePath, config.project);
		
		if (!fs.existsSync(resolvedPath)) {
			return { error: `Project path does not exist: ${resolvedPath}` };
		}
		
		return { type: "path", path: resolvedPath };
	}
	
	// No project field - check for project/ subdirectory
	const projectSubdir = path.join(fixturePath, PROJECT_SUBDIR);
	if (fs.existsSync(projectSubdir) && fs.statSync(projectSubdir).isDirectory()) {
		return { type: "path", path: projectSubdir };
	}
	
	return { error: `No project source: specify 'project' in fixture.json or provide a 'project/' subdirectory` };
}

/**
 * Load and validate a fixture from a directory (R6)
 */
export function loadFixture(fixturePath: string): FixtureLoadResult {
	const absolutePath = path.resolve(fixturePath);
	
	// Check fixture directory exists
	if (!fs.existsSync(absolutePath)) {
		return { success: false, error: `Fixture directory not found: ${absolutePath}` };
	}
	
	if (!fs.statSync(absolutePath).isDirectory()) {
		return { success: false, error: `Not a directory: ${absolutePath}` };
	}
	
	// Load fixture.json (required)
	const configPath = path.join(absolutePath, FIXTURE_CONFIG_FILE);
	if (!fs.existsSync(configPath)) {
		return { success: false, error: `Missing ${FIXTURE_CONFIG_FILE} in fixture directory` };
	}
	
	let fixtureConfig: FixtureConfig;
	try {
		const content = fs.readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(content);
		
		if (!Value.Check(FixtureConfigSchema, parsed)) {
			const errors = [...Value.Errors(FixtureConfigSchema, parsed)];
			const errorMsg = errors.map(e => `${e.path}: ${e.message}`).join("; ");
			return { success: false, error: `Invalid fixture.json: ${errorMsg}` };
		}
		
		fixtureConfig = parsed;
	} catch (e) {
		const parseError = e instanceof Error ? e.message : "Unknown error";
		return { success: false, error: `Failed to parse fixture.json: ${parseError}` };
	}
	
	// Load feature.md (required)
	const featurePath = path.join(absolutePath, FEATURE_FILE);
	if (!fs.existsSync(featurePath)) {
		return { success: false, error: `Missing ${FEATURE_FILE} in fixture directory` };
	}
	
	let featureDescription: string;
	try {
		featureDescription = fs.readFileSync(featurePath, "utf-8");
	} catch (e) {
		const readError = e instanceof Error ? e.message : "Unknown error";
		return { success: false, error: `Failed to read feature.md: ${readError}` };
	}
	
	if (featureDescription.trim().length === 0) {
		return { success: false, error: "feature.md is empty" };
	}
	
	// Load discovery.json (optional)
	let discovery: DiscoveryConfig | null = null;
	const discoveryPath = path.join(absolutePath, DISCOVERY_CONFIG_FILE);
	if (fs.existsSync(discoveryPath)) {
		try {
			const content = fs.readFileSync(discoveryPath, "utf-8");
			const parsed = JSON.parse(content);
			
			if (!Value.Check(DiscoveryConfigSchema, parsed)) {
				const errors = [...Value.Errors(DiscoveryConfigSchema, parsed)];
				const errorMsg = errors.map(e => `${e.path}: ${e.message}`).join("; ");
				return { success: false, error: `Invalid discovery.json: ${errorMsg}` };
			}
			
			discovery = parsed;
		} catch (e) {
			const parseError = e instanceof Error ? e.message : "Unknown error";
			return { success: false, error: `Failed to parse discovery.json: ${parseError}` };
		}
	}
	
	// Check hidden-tests directory (optional but noted)
	let hiddenTestsPath: string | null = null;
	const hiddenTestsDir = path.join(absolutePath, HIDDEN_TESTS_DIR);
	if (fs.existsSync(hiddenTestsDir) && fs.statSync(hiddenTestsDir).isDirectory()) {
		hiddenTestsPath = hiddenTestsDir;
	}
	
	// Resolve project source
	const projectSource = resolveProjectSource(absolutePath, fixtureConfig);
	if ("error" in projectSource) {
		return { success: false, error: projectSource.error };
	}
	
	return {
		success: true,
		fixture: {
			path: absolutePath,
			config: fixtureConfig,
			featureDescription,
			discovery,
			hiddenTestsPath,
			projectSource,
		},
	};
}

/**
 * Load all fixtures from a benchmark config
 */
export function loadAllFixtures(
	fixturePaths: Array<{ path: string }>,
	basePath: string
): { fixtures: LoadedFixture[]; errors: Array<{ path: string; error: string }> } {
	const fixtures: LoadedFixture[] = [];
	const errors: Array<{ path: string; error: string }> = [];
	
	for (const ref of fixturePaths) {
		// Resolve relative paths against base path (config file directory)
		const resolvedPath = path.isAbsolute(ref.path)
			? ref.path
			: path.resolve(basePath, ref.path);
		
		const result = loadFixture(resolvedPath);
		if (result.success) {
			fixtures.push(result.fixture);
		} else {
			errors.push({ path: ref.path, error: result.error });
		}
	}
	
	return { fixtures, errors };
}
```

- **Verify**: Add tests in Step 1.8

---

### Step 1.6: Create Project Isolation Utilities

- **Files**: `extensions/spec-bench/isolation.ts` (new)
- **Pattern Reference**: Standard Node.js filesystem and child_process patterns
- **Action**: Create utilities for cloning/copying projects to temp directories (R3, R3a, R3b)

```typescript
/**
 * Project isolation utilities - cloning and copying for benchmark isolation (R3)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import type { LoadedFixture } from "./types.ts";

// ============================================
// Types
// ============================================

export interface IsolationResult {
	success: boolean;
	workDir?: string;  // Temp directory containing the cloned/copied project
	error?: string;
}

export interface CleanupHandle {
	workDir: string;
	cleanup: () => Promise<void>;
}

// ============================================
// Git Operations
// ============================================

/**
 * Clone a git repository to a temp directory (R3a)
 */
async function gitClone(
	url: string,
	targetDir: string,
	ref?: string
): Promise<{ success: boolean; error?: string }> {
	return new Promise((resolve) => {
		const args = ["clone", "--depth", "1"];
		if (ref) {
			args.push("--branch", ref);
		}
		args.push(url, targetDir);
		
		const proc = spawn("git", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		
		let stderr = "";
		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		
		proc.on("close", (code) => {
			if (code === 0) {
				resolve({ success: true });
			} else {
				resolve({ success: false, error: stderr || `git clone exited with code ${code}` });
			}
		});
		
		proc.on("error", (err) => {
			resolve({ success: false, error: err.message });
		});
	});
}

// ============================================
// Filesystem Operations
// ============================================

/**
 * Recursively copy a directory (R3b)
 * Excludes common development artifacts for efficiency
 */
function copyDir(src: string, dest: string): void {
	// Directories to skip during copy
	const skipDirs = new Set([
		"node_modules",
		".git",
		"target",          // Rust
		"dist",
		"build",
		".next",
		"__pycache__",
		".venv",
		"venv",
		".tox",
		".pytest_cache",
		".mypy_cache",
	]);
	
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}
	
	const entries = fs.readdirSync(src, { withFileTypes: true });
	
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		
		if (entry.isDirectory()) {
			if (!skipDirs.has(entry.name)) {
				copyDir(srcPath, destPath);
			}
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, destPath);
		} else if (entry.isSymbolicLink()) {
			// Preserve symlinks
			const linkTarget = fs.readlinkSync(srcPath);
			fs.symlinkSync(linkTarget, destPath);
		}
	}
}

/**
 * Recursively remove a directory
 */
async function removeDir(dir: string): Promise<void> {
	if (fs.existsSync(dir)) {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

// ============================================
// Isolation Functions
// ============================================

/**
 * Create an isolated copy of the fixture's project (R3)
 * Returns a temp directory path and cleanup function
 */
export async function createIsolatedProject(
	fixture: LoadedFixture,
	sessionId: string,
	iterationId: number
): Promise<IsolationResult & { cleanup?: () => Promise<void> }> {
	// Create temp directory for this iteration
	const tempBase = path.join(os.tmpdir(), "spec-bench");
	const workDir = path.join(tempBase, `${sessionId}_iter${iterationId}_${Date.now()}`);
	
	try {
		fs.mkdirSync(workDir, { recursive: true });
		
		if (fixture.projectSource.type === "git") {
			// Git clone (R3a)
			const cloneResult = await gitClone(
				fixture.projectSource.url,
				workDir,
				fixture.projectSource.ref
			);
			
			if (!cloneResult.success) {
				await removeDir(workDir);
				return {
					success: false,
					error: `Git clone failed: ${cloneResult.error}`,
				};
			}
		} else {
			// Local copy (R3b)
			copyDir(fixture.projectSource.path, workDir);
		}
		
		return {
			success: true,
			workDir,
			cleanup: async () => {
				await removeDir(workDir);
			},
		};
	} catch (e) {
		// Clean up on error
		await removeDir(workDir);
		const errorMsg = e instanceof Error ? e.message : "Unknown error";
		return {
			success: false,
			error: `Failed to create isolated project: ${errorMsg}`,
		};
	}
}

/**
 * Copy hidden tests to the target directory (R9, R15)
 */
export function copyHiddenTests(
	hiddenTestsPath: string,
	targetDir: string,
	hiddenTestsTarget: string
): { success: boolean; error?: string } {
	const destDir = path.join(targetDir, hiddenTestsTarget);
	
	try {
		// Create target directory if it doesn't exist
		fs.mkdirSync(destDir, { recursive: true });
		
		// Copy all files from hidden-tests to target
		copyDir(hiddenTestsPath, destDir);
		
		return { success: true };
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : "Unknown error";
		return {
			success: false,
			error: `Failed to copy hidden tests: ${errorMsg}`,
		};
	}
}
```

- **Verify**: Add tests in Step 1.8

---

### Step 1.7: Create CLI Entry Point

- **Files**: `extensions/spec-bench/cli.ts` (new)
- **Pattern Reference**: Standard Node.js CLI patterns
- **Action**: Create basic CLI with argument parsing and validation (R1, R2, R25)

```typescript
#!/usr/bin/env node
/**
 * spec-bench CLI - Benchmark tool for spec-pipeline configurations
 * 
 * Usage:
 *   spec-bench <config.json>
 *   spec-bench --help
 *   spec-bench --version
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { loadBenchmarkConfig, formatValidationErrors } from "./config.ts";
import { loadAllFixtures } from "./fixture.ts";
import type { BenchmarkConfig, LoadedFixture } from "./types.ts";

// ============================================
// Constants
// ============================================

const VERSION = "0.1.0";
const HELP_TEXT = `
spec-bench - Benchmark tool for spec-pipeline configurations

USAGE:
  spec-bench <config.json>     Run benchmarks with the specified config
  spec-bench --help            Show this help message
  spec-bench --version         Show version information

CONFIGURATION:
  The config file must be a JSON file with the following structure:
  {
    "fixtures": [
      { "path": "./fixtures/example" }
    ],
    "permutations": [
      {
        "name": "all-sonnet",
        "models": { ... }
      }
    ],
    "iterations": 3,
    "outputDir": "./benchmark-results"
  }

FIXTURE STRUCTURE:
  Each fixture directory must contain:
    fixture.json    - Fixture configuration
    feature.md      - Feature description for the pipeline
    discovery.json  - Pre-scripted discovery answers (optional)
    hidden-tests/   - Tests to add post-implementation (optional)
    project/        - Project source (or specify in fixture.json)

For more information, see the spec-bench documentation.
`.trim();

// ============================================
// CLI Functions
// ============================================

function printError(message: string): void {
	console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

function printSuccess(message: string): void {
	console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

function printInfo(message: string): void {
	console.log(`\x1b[34mℹ\x1b[0m ${message}`);
}

function printWarning(message: string): void {
	console.log(`\x1b[33m⚠\x1b[0m ${message}`);
}

// ============================================
// Main Entry Point
// ============================================

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	
	// Handle flags
	if (args.includes("--help") || args.includes("-h")) {
		console.log(HELP_TEXT);
		process.exit(0);
	}
	
	if (args.includes("--version") || args.includes("-v")) {
		console.log(`spec-bench v${VERSION}`);
		process.exit(0);
	}
	
	// Require config file argument
	if (args.length === 0) {
		printError("No configuration file specified");
		console.log("\nUsage: spec-bench <config.json>");
		console.log("Run 'spec-bench --help' for more information.");
		process.exit(1);
	}
	
	const configPath = args[0];
	
	// Load and validate configuration
	printInfo(`Loading configuration from ${configPath}...`);
	const configResult = loadBenchmarkConfig(configPath);
	
	if (!configResult.success) {
		printError(formatValidationErrors(configResult.errors));
		process.exit(1);
	}
	
	const config = configResult.config;
	printSuccess(`Configuration loaded: ${config.permutations.length} permutation(s), ${config.fixtures.length} fixture(s)`);
	
	// Load all fixtures
	printInfo("Loading fixtures...");
	const basePath = path.dirname(path.resolve(configPath));
	const fixtureResult = loadAllFixtures(config.fixtures, basePath);
	
	if (fixtureResult.errors.length > 0) {
		for (const err of fixtureResult.errors) {
			printError(`Fixture ${err.path}: ${err.error}`);
		}
		process.exit(1);
	}
	
	const fixtures = fixtureResult.fixtures;
	printSuccess(`Loaded ${fixtures.length} fixture(s):`);
	for (const fixture of fixtures) {
		const projectType = fixture.projectSource.type === "git" ? "(git)" : "(local)";
		const hasDiscovery = fixture.discovery ? "with discovery" : "no discovery";
		const hasHiddenTests = fixture.hiddenTestsPath ? "with hidden tests" : "no hidden tests";
		console.log(`  • ${fixture.config.name} ${projectType} - ${hasDiscovery}, ${hasHiddenTests}`);
	}
	
	// Validate output directory
	const outputDir = path.resolve(basePath, config.outputDir);
	if (!fs.existsSync(outputDir)) {
		printInfo(`Creating output directory: ${outputDir}`);
		fs.mkdirSync(outputDir, { recursive: true });
	}
	
	// Print benchmark summary
	console.log("\n" + "═".repeat(60));
	console.log("Benchmark Configuration");
	console.log("═".repeat(60));
	console.log(`Fixtures:      ${fixtures.length}`);
	console.log(`Permutations:  ${config.permutations.length}`);
	console.log(`Iterations:    ${config.iterations}`);
	console.log(`Total runs:    ${fixtures.length * config.permutations.length * config.iterations}`);
	console.log(`Output:        ${outputDir}`);
	console.log("═".repeat(60) + "\n");
	
	// TODO: Phase 2+ will implement actual benchmark execution
	printWarning("Benchmark execution not yet implemented (Phase 2+)");
	printInfo("Configuration and fixtures validated successfully");
}

// Run main
main().catch((e) => {
	printError(e instanceof Error ? e.message : String(e));
	process.exit(1);
});
```

- **Verify**: Run with `npx tsx extensions/spec-bench/cli.ts --help`

---

### Step 1.8: Create Unit Tests

- **Files**: `extensions/spec-bench/config.test.ts`, `extensions/spec-bench/fixture.test.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/config.test.ts` patterns
- **Action**: Create tests for configuration and fixture validation

**File: `extensions/spec-bench/config.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	validateBenchmarkConfig,
	loadBenchmarkConfig,
	formatValidationErrors,
} from "./config.ts";

describe("validateBenchmarkConfig", () => {
	describe("valid configurations", () => {
		it("accepts minimal valid config", () => {
			const config = {
				fixtures: [{ path: "./fixtures/test" }],
				permutations: [{ name: "default" }],
				iterations: 1,
				outputDir: "./results",
			};
			expect(validateBenchmarkConfig(config)).toEqual([]);
		});

		it("accepts full valid config with model overrides", () => {
			const config = {
				fixtures: [
					{ path: "./fixtures/test1" },
					{ path: "./fixtures/test2" },
				],
				permutations: [
					{
						name: "all-sonnet",
						models: {
							specDrafter: { model: "sonnet", thinking: "high" },
							specReviewer: {
								cheap: { model: "haiku", thinking: "off" },
								expensive: { model: "sonnet", thinking: "medium" },
							},
						},
						reviewCycles: { cheap: 2, expensive: 1 },
					},
				],
				iterations: 5,
				outputDir: "./benchmark-results",
				parallelism: 1,
			};
			expect(validateBenchmarkConfig(config)).toEqual([]);
		});
	});

	describe("invalid configurations", () => {
		it("rejects missing fixtures", () => {
			const config = {
				permutations: [{ name: "test" }],
				iterations: 1,
				outputDir: "./results",
			};
			expect(validateBenchmarkConfig(config).length).toBeGreaterThan(0);
		});

		it("rejects empty fixtures array", () => {
			const config = {
				fixtures: [],
				permutations: [{ name: "test" }],
				iterations: 1,
				outputDir: "./results",
			};
			expect(validateBenchmarkConfig(config).length).toBeGreaterThan(0);
		});

		it("rejects invalid model name", () => {
			const config = {
				fixtures: [{ path: "./fixtures/test" }],
				permutations: [{
					name: "test",
					models: {
						specDrafter: { model: "gpt-4", thinking: "high" },
					},
				}],
				iterations: 1,
				outputDir: "./results",
			};
			expect(validateBenchmarkConfig(config).length).toBeGreaterThan(0);
		});

		it("rejects iterations less than 1", () => {
			const config = {
				fixtures: [{ path: "./fixtures/test" }],
				permutations: [{ name: "test" }],
				iterations: 0,
				outputDir: "./results",
			};
			expect(validateBenchmarkConfig(config).length).toBeGreaterThan(0);
		});

		it("rejects parallelism other than 1", () => {
			const config = {
				fixtures: [{ path: "./fixtures/test" }],
				permutations: [{ name: "test" }],
				iterations: 1,
				outputDir: "./results",
				parallelism: 4,
			};
			expect(validateBenchmarkConfig(config).length).toBeGreaterThan(0);
		});
	});
});

describe("loadBenchmarkConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns error for non-existent file", () => {
		const result = loadBenchmarkConfig(path.join(tempDir, "missing.json"));
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors[0].message).toContain("not found");
		}
	});

	it("returns error for invalid JSON", () => {
		const configPath = path.join(tempDir, "invalid.json");
		fs.writeFileSync(configPath, "{ invalid json }");
		const result = loadBenchmarkConfig(configPath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors[0].message).toContain("parse");
		}
	});

	it("loads valid config successfully", () => {
		const configPath = path.join(tempDir, "valid.json");
		fs.writeFileSync(configPath, JSON.stringify({
			fixtures: [{ path: "./fixtures/test" }],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: "./results",
		}));
		const result = loadBenchmarkConfig(configPath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.config.iterations).toBe(1);
		}
	});

	it("detects duplicate fixture paths", () => {
		const configPath = path.join(tempDir, "duplicates.json");
		fs.writeFileSync(configPath, JSON.stringify({
			fixtures: [
				{ path: "./fixtures/test" },
				{ path: "./fixtures/test" },
			],
			permutations: [{ name: "default" }],
			iterations: 1,
			outputDir: "./results",
		}));
		const result = loadBenchmarkConfig(configPath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors.some(e => e.message.includes("Duplicate fixture"))).toBe(true);
		}
	});

	it("detects duplicate permutation names", () => {
		const configPath = path.join(tempDir, "duplicates.json");
		fs.writeFileSync(configPath, JSON.stringify({
			fixtures: [{ path: "./fixtures/test" }],
			permutations: [
				{ name: "test" },
				{ name: "test" },
			],
			iterations: 1,
			outputDir: "./results",
		}));
		const result = loadBenchmarkConfig(configPath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errors.some(e => e.message.includes("Duplicate permutation"))).toBe(true);
		}
	});
});

describe("formatValidationErrors", () => {
	it("formats single error", () => {
		const errors = [{ path: "/fixtures", message: "Expected array" }];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain("Invalid benchmark configuration");
		expect(formatted).toContain("/fixtures");
		expect(formatted).toContain("Expected array");
	});

	it("formats multiple errors", () => {
		const errors = [
			{ path: "/fixtures", message: "Expected array" },
			{ path: "/iterations", message: "Expected number" },
		];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain("/fixtures");
		expect(formatted).toContain("/iterations");
	});
});
```

**File: `extensions/spec-bench/fixture.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadFixture, loadAllFixtures } from "./fixture.ts";

describe("loadFixture", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-fixture-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns error for non-existent directory", () => {
		const result = loadFixture(path.join(tempDir, "missing"));
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("not found");
		}
	});

	it("returns error when fixture.json is missing", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Test feature");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("fixture.json");
		}
	});

	it("returns error when feature.md is missing", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test fixture",
				hiddenTestsTarget: "tests/hidden",
			})
		);
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("feature.md");
		}
	});

	it("returns error when no project source is available", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test fixture",
				hiddenTestsTarget: "tests/hidden",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Test feature");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain("No project source");
		}
	});

	it("loads valid fixture with project/ subdirectory", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test Fixture",
				description: "A test fixture",
				hiddenTestsTarget: "tests/hidden",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Test Feature\n\nImplement a test feature.");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.fixture.config.name).toBe("Test Fixture");
			expect(result.fixture.featureDescription).toContain("Test Feature");
			expect(result.fixture.projectSource.type).toBe("path");
			expect(result.fixture.discovery).toBeNull();
			expect(result.fixture.hiddenTestsPath).toBeNull();
		}
	});

	it("loads fixture with local project path", () => {
		const projectPath = path.join(tempDir, "my-project");
		fs.mkdirSync(projectPath);
		fs.writeFileSync(path.join(projectPath, "package.json"), "{}");
		
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test",
				project: projectPath,
				hiddenTestsTarget: "tests",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.fixture.projectSource.type).toBe("path");
			if (result.fixture.projectSource.type === "path") {
				expect(result.fixture.projectSource.path).toBe(projectPath);
			}
		}
	});

	it("recognizes git URL as project source", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test",
				project: "git@github.com:example/repo.git",
				projectRef: "main",
				hiddenTestsTarget: "tests",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.fixture.projectSource.type).toBe("git");
			if (result.fixture.projectSource.type === "git") {
				expect(result.fixture.projectSource.url).toBe("git@github.com:example/repo.git");
				expect(result.fixture.projectSource.ref).toBe("main");
			}
		}
	});

	it("loads discovery.json when present", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test",
				hiddenTestsTarget: "tests",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature");
		fs.writeFileSync(
			path.join(fixturePath, "discovery.json"),
			JSON.stringify({
				rounds: [
					{ answers: "Answer 1" },
					{ answers: "Answer 2" },
				],
				earlyFinish: true,
			})
		);
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.fixture.discovery).not.toBeNull();
			expect(result.fixture.discovery?.rounds.length).toBe(2);
			expect(result.fixture.discovery?.earlyFinish).toBe(true);
		}
	});

	it("detects hidden-tests directory", () => {
		const fixturePath = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.mkdirSync(path.join(fixturePath, "hidden-tests"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({
				name: "Test",
				description: "Test",
				hiddenTestsTarget: "tests/hidden",
			})
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature");
		fs.writeFileSync(path.join(fixturePath, "hidden-tests", "test.spec.ts"), "test()");
		
		const result = loadFixture(fixturePath);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.fixture.hiddenTestsPath).not.toBeNull();
			expect(result.fixture.hiddenTestsPath).toContain("hidden-tests");
		}
	});
});

describe("loadAllFixtures", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-fixtures-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads multiple fixtures", () => {
		// Create fixture 1
		const fixture1 = path.join(tempDir, "fixture1");
		fs.mkdirSync(fixture1);
		fs.mkdirSync(path.join(fixture1, "project"));
		fs.writeFileSync(path.join(fixture1, "fixture.json"), JSON.stringify({
			name: "Fixture 1",
			description: "First fixture",
			hiddenTestsTarget: "tests",
		}));
		fs.writeFileSync(path.join(fixture1, "feature.md"), "# Feature 1");
		
		// Create fixture 2
		const fixture2 = path.join(tempDir, "fixture2");
		fs.mkdirSync(fixture2);
		fs.mkdirSync(path.join(fixture2, "project"));
		fs.writeFileSync(path.join(fixture2, "fixture.json"), JSON.stringify({
			name: "Fixture 2",
			description: "Second fixture",
			hiddenTestsTarget: "tests",
		}));
		fs.writeFileSync(path.join(fixture2, "feature.md"), "# Feature 2");
		
		const result = loadAllFixtures([
			{ path: fixture1 },
			{ path: fixture2 },
		], tempDir);
		
		expect(result.fixtures.length).toBe(2);
		expect(result.errors.length).toBe(0);
	});

	it("collects errors for invalid fixtures", () => {
		const validFixture = path.join(tempDir, "valid");
		fs.mkdirSync(validFixture);
		fs.mkdirSync(path.join(validFixture, "project"));
		fs.writeFileSync(path.join(validFixture, "fixture.json"), JSON.stringify({
			name: "Valid",
			description: "Valid fixture",
			hiddenTestsTarget: "tests",
		}));
		fs.writeFileSync(path.join(validFixture, "feature.md"), "# Feature");
		
		const result = loadAllFixtures([
			{ path: validFixture },
			{ path: path.join(tempDir, "missing") },
		], tempDir);
		
		expect(result.fixtures.length).toBe(1);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].path).toContain("missing");
	});

	it("resolves relative paths against base path", () => {
		const fixturesDir = path.join(tempDir, "fixtures");
		fs.mkdirSync(fixturesDir);
		const fixture1 = path.join(fixturesDir, "test");
		fs.mkdirSync(fixture1);
		fs.mkdirSync(path.join(fixture1, "project"));
		fs.writeFileSync(path.join(fixture1, "fixture.json"), JSON.stringify({
			name: "Test",
			description: "Test",
			hiddenTestsTarget: "tests",
		}));
		fs.writeFileSync(path.join(fixture1, "feature.md"), "# Feature");
		
		const result = loadAllFixtures([
			{ path: "./fixtures/test" },
		], tempDir);
		
		expect(result.fixtures.length).toBe(1);
		expect(result.errors.length).toBe(0);
	});
});
```

- **Verify**: Run `npm test` from project root

---

### Step 1.9: Create Barrel Export

- **Files**: `extensions/spec-bench/index.ts` (new)
- **Action**: Create barrel export for library usage

```typescript
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
```

- **Verify**: TypeScript compiles without errors

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-bench/package.json` | Package configuration | `extensions/spec-pipeline/package.json` |
| `extensions/spec-bench/types.ts` | TypeBox schemas for fixtures and config | `extensions/spec-pipeline/types.ts` |
| `extensions/spec-bench/config.ts` | Benchmark config loading and validation | `extensions/spec-pipeline/config.ts` |
| `extensions/spec-bench/fixture.ts` | Fixture loading and validation | New (follows config.ts patterns) |
| `extensions/spec-bench/isolation.ts` | Project cloning/copying utilities | New (standard Node.js patterns) |
| `extensions/spec-bench/cli.ts` | CLI entry point | New (standard CLI patterns) |
| `extensions/spec-bench/index.ts` | Barrel export | Standard TypeScript pattern |
| `extensions/spec-bench/config.test.ts` | Config validation tests | `extensions/spec-pipeline/config.test.ts` |
| `extensions/spec-bench/fixture.test.ts` | Fixture loading tests | New (follows config.test.ts patterns) |

### Modified Files
| File | Changes |
|------|---------|
| None | No existing files modified in this phase |

## Completion Checklist
- [ ] Step 1.1: Directory structure created
- [ ] Step 1.2: package.json configured and workspace recognized
- [ ] Step 1.3: TypeBox schemas defined for all config types
- [ ] Step 1.4: Config loading with validation working
- [ ] Step 1.5: Fixture loading with validation working
- [ ] Step 1.6: Project isolation utilities implemented
- [ ] Step 1.7: CLI entry point with help/version working
- [ ] Step 1.8: All unit tests passing
- [ ] Step 1.9: Barrel export created
- [ ] All tests pass (`npm test`)
- [ ] Code follows project conventions (TypeScript, vitest patterns)
- [ ] CLI validates config and fixtures successfully

## Verification Commands

```bash
# After completing all steps:

# Ensure workspace is set up
npm install

# Run all tests
npm test

# Test CLI help
npx tsx extensions/spec-bench/cli.ts --help

# Test CLI version
npx tsx extensions/spec-bench/cli.ts --version

# Test with a sample config (will fail at "not implemented" but validates successfully)
# Create a test fixture first:
mkdir -p /tmp/test-fixture/project
echo '{"name":"Test","description":"Test","hiddenTestsTarget":"tests"}' > /tmp/test-fixture/fixture.json
echo '# Test Feature' > /tmp/test-fixture/feature.md
echo '{"fixtures":[{"path":"/tmp/test-fixture"}],"permutations":[{"name":"default"}],"iterations":1,"outputDir":"./results"}' > /tmp/test-bench.json
npx tsx extensions/spec-bench/cli.ts /tmp/test-bench.json
```
