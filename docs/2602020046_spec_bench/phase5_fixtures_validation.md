# Phase 5: Sample Fixtures and Validation

**Estimated Effort**: 1 day

## Overview

This phase completes the spec-bench tool by providing:
- Sample fixtures demonstrating how to set up benchmarks for different project types
- A fixture validation command for verifying fixture configuration
- Documentation for creating custom fixtures
- End-to-end validation tests ensuring the full fixture system works correctly

These fixtures serve as both examples for users and integration tests for the benchmark tool.

## Prerequisites

- Phase 1 complete (types.ts, config.ts, fixture.ts, isolation.ts, cli.ts)
- Phase 2 complete (metrics.ts, runner.ts, results.ts)
- Phase 3 complete (mock-ui.ts, test-runner.ts, executor.ts, benchmark.ts)
- Phase 4 complete (report-types.ts, analysis.ts, report-formatter.ts, cli-report.ts)

## Steps

### Step 5.1: Create Sample Fixtures Directory Structure

- **Files**: `extensions/spec-bench/fixtures/` (new directory)
- **Pattern Reference**: Based on spec R6, R7, R8 fixture structure requirements
- **Action**: Create the fixtures directory with two example fixtures: a minimal TypeScript fixture and a complete fixture with all optional features

```bash
mkdir -p extensions/spec-bench/fixtures/minimal-ts
mkdir -p extensions/spec-bench/fixtures/complete-example
mkdir -p extensions/spec-bench/fixtures/complete-example/project
mkdir -p extensions/spec-bench/fixtures/complete-example/hidden-tests
```

**Expected structure:**
```
extensions/spec-bench/fixtures/
├── minimal-ts/
│   ├── fixture.json
│   ├── feature.md
│   └── project/
│       ├── package.json
│       ├── src/
│       │   └── index.ts
│       └── tests/
│           └── index.test.ts
└── complete-example/
    ├── fixture.json
    ├── feature.md
    ├── discovery.json
    ├── project/
    │   ├── package.json
    │   ├── src/
    │   │   └── lib.ts
    │   └── tests/
    │       └── lib.test.ts
    └── hidden-tests/
        └── hidden.test.ts
```

- **Verify**: Directory structure exists with `ls -la extensions/spec-bench/fixtures/`

---

### Step 5.2: Create Minimal TypeScript Fixture

- **Files**: Multiple files in `extensions/spec-bench/fixtures/minimal-ts/`
- **Pattern Reference**: Based on spec R6, R7 fixture requirements
- **Action**: Create a minimal fixture that demonstrates the basic structure

**File: `extensions/spec-bench/fixtures/minimal-ts/fixture.json`**

```json
{
  "name": "Minimal TypeScript",
  "description": "A minimal fixture for testing spec-bench with a simple TypeScript project. Implements a basic string utility function.",
  "hiddenTestsTarget": "tests/hidden",
  "testCommand": "npm test",
  "timeout": 1800
}
```

**File: `extensions/spec-bench/fixtures/minimal-ts/feature.md`**

```markdown
# Feature: String Reverse Utility

Implement a string utility module with the following function:

## Requirements

1. Create a function `reverseString(input: string): string` that:
   - Reverses the characters in a string
   - Handles empty strings (returns empty string)
   - Preserves Unicode characters correctly

2. Export the function from `src/utils.ts`

3. The function should be pure (no side effects)

## Example Usage

\`\`\`typescript
import { reverseString } from './utils';

reverseString('hello'); // Returns 'olleh'
reverseString(''); // Returns ''
reverseString('🎉🎊'); // Returns '🎊🎉'
\`\`\`

## Acceptance Criteria

- All existing tests continue to pass
- The new function is properly typed
- The function handles edge cases gracefully
```

**File: `extensions/spec-bench/fixtures/minimal-ts/project/package.json`**

```json
{
  "name": "minimal-ts-project",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --passWithNoTests"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.0"
  }
}
```

**File: `extensions/spec-bench/fixtures/minimal-ts/project/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**File: `extensions/spec-bench/fixtures/minimal-ts/project/jest.config.js`**

```javascript
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'],
};
```

**File: `extensions/spec-bench/fixtures/minimal-ts/project/src/index.ts`**

```typescript
/**
 * Minimal TypeScript project entry point
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

**File: `extensions/spec-bench/fixtures/minimal-ts/project/tests/index.test.ts`**

```typescript
import { greet } from '../src/index.js';

describe('greet', () => {
  it('returns greeting with name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });

  it('handles empty name', () => {
    expect(greet('')).toBe('Hello, !');
  });
});
```

- **Verify**: Run fixture validation (implemented in Step 5.5)

---

### Step 5.3: Create Complete Example Fixture with All Features

- **Files**: Multiple files in `extensions/spec-bench/fixtures/complete-example/`
- **Pattern Reference**: Based on spec R6, R7, R8 with all optional features
- **Action**: Create a fixture demonstrating discovery.json and hidden tests

**File: `extensions/spec-bench/fixtures/complete-example/fixture.json`**

```json
{
  "name": "Complete Example",
  "description": "A complete fixture demonstrating all spec-bench features including discovery responses and hidden tests. Implements a calculator module.",
  "hiddenTestsTarget": "tests/hidden",
  "testCommand": "npm test",
  "timeout": 3600
}
```

**File: `extensions/spec-bench/fixtures/complete-example/feature.md`**

```markdown
# Feature: Calculator Module

Implement a calculator module with basic arithmetic operations.

## Requirements

1. Create a `Calculator` class in `src/calculator.ts` with the following methods:
   - `add(a: number, b: number): number` - Addition
   - `subtract(a: number, b: number): number` - Subtraction
   - `multiply(a: number, b: number): number` - Multiplication
   - `divide(a: number, b: number): number` - Division

2. Division by zero should throw an `Error` with message "Division by zero"

3. All methods should handle:
   - Positive and negative numbers
   - Decimal numbers
   - Zero values

4. Export the `Calculator` class as the default export

## Example Usage

\`\`\`typescript
import Calculator from './calculator';

const calc = new Calculator();
calc.add(2, 3);      // Returns 5
calc.subtract(5, 3); // Returns 2
calc.multiply(4, 3); // Returns 12
calc.divide(10, 2);  // Returns 5
calc.divide(1, 0);   // Throws Error: Division by zero
\`\`\`

## Acceptance Criteria

- All existing tests pass
- New Calculator class is properly typed
- Division by zero is handled correctly
- Edge cases (negative numbers, decimals) work correctly
```

**File: `extensions/spec-bench/fixtures/complete-example/discovery.json`**

```json
{
  "rounds": [
    {
      "answers": "The calculator should be a class with instance methods, not static functions. This allows for future extensibility like adding memory features. Precision should use JavaScript's default number precision - no special handling needed. The class should be stateless for now, with each operation being independent."
    },
    {
      "answers": "For division by zero, throw a standard Error with the message 'Division by zero'. The error should be thrown synchronously. No need for custom error types at this stage. The method signature should remain `divide(a: number, b: number): number` and throw on invalid input."
    }
  ],
  "earlyFinish": true
}
```

**File: `extensions/spec-bench/fixtures/complete-example/project/package.json`**

```json
{
  "name": "complete-example-project",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.0"
  }
}
```

**File: `extensions/spec-bench/fixtures/complete-example/project/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**File: `extensions/spec-bench/fixtures/complete-example/project/jest.config.js`**

```javascript
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'],
};
```

**File: `extensions/spec-bench/fixtures/complete-example/project/src/lib.ts`**

```typescript
/**
 * Library module - placeholder for calculator implementation
 */

export function placeholder(): string {
  return 'This will be replaced by the Calculator class';
}
```

**File: `extensions/spec-bench/fixtures/complete-example/project/tests/lib.test.ts`**

```typescript
import { placeholder } from '../src/lib.js';

describe('placeholder', () => {
  it('returns placeholder string', () => {
    expect(placeholder()).toBe('This will be replaced by the Calculator class');
  });
});
```

**File: `extensions/spec-bench/fixtures/complete-example/hidden-tests/calculator.test.ts`**

```typescript
/**
 * Hidden tests for Calculator class
 * These tests are copied after implementation to verify correctness
 */

import Calculator from '../src/calculator.js';

describe('Calculator hidden tests', () => {
  let calc: Calculator;

  beforeEach(() => {
    calc = new Calculator();
  });

  describe('add', () => {
    it('adds negative numbers', () => {
      expect(calc.add(-5, -3)).toBe(-8);
    });

    it('adds decimal numbers', () => {
      expect(calc.add(0.1, 0.2)).toBeCloseTo(0.3);
    });
  });

  describe('subtract', () => {
    it('subtracts resulting in negative', () => {
      expect(calc.subtract(3, 10)).toBe(-7);
    });
  });

  describe('multiply', () => {
    it('multiplies by zero', () => {
      expect(calc.multiply(100, 0)).toBe(0);
    });

    it('multiplies negative numbers', () => {
      expect(calc.multiply(-4, -5)).toBe(20);
    });
  });

  describe('divide', () => {
    it('throws on division by zero', () => {
      expect(() => calc.divide(10, 0)).toThrow('Division by zero');
    });

    it('handles negative division', () => {
      expect(calc.divide(-10, 2)).toBe(-5);
    });

    it('handles decimal results', () => {
      expect(calc.divide(10, 4)).toBe(2.5);
    });
  });
});
```

- **Verify**: All fixture files are created correctly

---

### Step 5.4: Create Fixture Validator Module

- **Files**: `extensions/spec-bench/validator.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-bench/fixture.ts` validation patterns
- **Action**: Create a comprehensive validator that checks fixtures for common issues and provides helpful diagnostics

```typescript
/**
 * Fixture validation utilities
 * 
 * Provides detailed validation of fixture configuration beyond basic schema checks.
 * Validates file existence, project structure, and configuration consistency.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { LoadedFixture, DiscoveryConfig } from "./types.ts";
import { loadFixture, type FixtureLoadResult } from "./fixture.ts";

// ============================================
// Validation Types
// ============================================

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
	severity: ValidationSeverity;
	code: string;
	message: string;
	path?: string;
	suggestion?: string;
}

export interface ValidationResult {
	valid: boolean;
	fixture?: LoadedFixture;
	issues: ValidationIssue[];
}

// ============================================
// Validation Codes
// ============================================

const CODES = {
	// Errors (prevent benchmark from running)
	FIXTURE_NOT_FOUND: "E001",
	FIXTURE_JSON_INVALID: "E002",
	FEATURE_MD_MISSING: "E003",
	FEATURE_MD_EMPTY: "E004",
	PROJECT_SOURCE_MISSING: "E005",
	HIDDEN_TESTS_TARGET_INVALID: "E006",
	TEST_COMMAND_INVALID: "E007",
	
	// Warnings (may cause issues)
	DISCOVERY_JSON_INVALID: "W001",
	DISCOVERY_ROUNDS_EMPTY: "W002",
	HIDDEN_TESTS_EMPTY: "W003",
	PROJECT_NO_PACKAGE_JSON: "W004",
	PROJECT_NO_TEST_SCRIPT: "W005",
	TIMEOUT_TOO_SHORT: "W006",
	TIMEOUT_TOO_LONG: "W007",
	
	// Info (suggestions)
	DISCOVERY_MISSING: "I001",
	HIDDEN_TESTS_MISSING: "I002",
	FEATURE_MD_SHORT: "I003",
} as const;

// ============================================
// Validation Functions
// ============================================

/**
 * Validate a fixture directory comprehensively
 */
export function validateFixture(fixturePath: string): ValidationResult {
	const issues: ValidationIssue[] = [];
	const absolutePath = path.resolve(fixturePath);
	
	// Step 1: Load fixture using existing loader (catches basic schema errors)
	const loadResult = loadFixture(absolutePath);
	
	if (!loadResult.success) {
		issues.push({
			severity: "error",
			code: CODES.FIXTURE_NOT_FOUND,
			message: loadResult.error,
			path: absolutePath,
		});
		return { valid: false, issues };
	}
	
	const fixture = loadResult.fixture;
	
	// Step 2: Validate feature.md content quality
	if (fixture.featureDescription.trim().length < 50) {
		issues.push({
			severity: "info",
			code: CODES.FEATURE_MD_SHORT,
			message: "Feature description is very short (< 50 characters)",
			path: path.join(absolutePath, "feature.md"),
			suggestion: "Consider adding more detail about requirements, acceptance criteria, and examples",
		});
	}
	
	// Step 3: Validate discovery.json if present
	if (fixture.discovery) {
		validateDiscovery(fixture.discovery, absolutePath, issues);
	} else {
		issues.push({
			severity: "info",
			code: CODES.DISCOVERY_MISSING,
			message: "No discovery.json - benchmark will skip discovery phase or use empty answers",
			path: absolutePath,
			suggestion: "Add discovery.json with pre-scripted answers for consistent benchmarks",
		});
	}
	
	// Step 4: Validate hidden tests if present
	if (fixture.hiddenTestsPath) {
		validateHiddenTests(fixture.hiddenTestsPath, fixture.config.hiddenTestsTarget, issues);
	} else {
		issues.push({
			severity: "info",
			code: CODES.HIDDEN_TESTS_MISSING,
			message: "No hidden-tests directory - benchmark will only run original tests",
			path: absolutePath,
			suggestion: "Add hidden-tests/ directory with additional tests to validate implementation quality",
		});
	}
	
	// Step 5: Validate project source
	if (fixture.projectSource.type === "path") {
		validateLocalProject(fixture.projectSource.path, fixture.config.testCommand, issues);
	}
	
	// Step 6: Validate timeout
	const timeout = fixture.config.timeout;
	if (timeout !== undefined) {
		if (timeout < 300) {
			issues.push({
				severity: "warning",
				code: CODES.TIMEOUT_TOO_SHORT,
				message: `Timeout of ${timeout}s may be too short for complex features`,
				suggestion: "Consider increasing timeout to at least 600s (10 minutes)",
			});
		}
		if (timeout > 7200) {
			issues.push({
				severity: "warning",
				code: CODES.TIMEOUT_TOO_LONG,
				message: `Timeout of ${timeout}s is very long (> 2 hours)`,
				suggestion: "Consider if this timeout is necessary - long timeouts increase benchmark cost",
			});
		}
	}
	
	// Determine overall validity (no errors = valid)
	const valid = !issues.some(i => i.severity === "error");
	
	return { valid, fixture: valid ? fixture : undefined, issues };
}

/**
 * Validate discovery.json content
 */
function validateDiscovery(
	discovery: DiscoveryConfig,
	fixturePath: string,
	issues: ValidationIssue[]
): void {
	if (!discovery.rounds || discovery.rounds.length === 0) {
		issues.push({
			severity: "warning",
			code: CODES.DISCOVERY_ROUNDS_EMPTY,
			message: "discovery.json has no rounds defined",
			path: path.join(fixturePath, "discovery.json"),
			suggestion: "Add at least one round with answers to provide context for the agent",
		});
		return;
	}
	
	// Check for empty answers
	for (let i = 0; i < discovery.rounds.length; i++) {
		const round = discovery.rounds[i];
		if (!round.answers || round.answers.trim().length < 10) {
			issues.push({
				severity: "warning",
				code: CODES.DISCOVERY_JSON_INVALID,
				message: `Round ${i + 1} has very short or empty answers`,
				path: path.join(fixturePath, "discovery.json"),
				suggestion: "Provide detailed answers that address likely discovery questions",
			});
		}
	}
}

/**
 * Validate hidden tests directory
 */
function validateHiddenTests(
	hiddenTestsPath: string,
	hiddenTestsTarget: string,
	issues: ValidationIssue[]
): void {
	// Check if directory has test files
	try {
		const files = fs.readdirSync(hiddenTestsPath);
		const testFiles = files.filter(f => 
			f.endsWith(".test.ts") || 
			f.endsWith(".test.js") || 
			f.endsWith(".spec.ts") || 
			f.endsWith(".spec.js") ||
			f.endsWith("_test.go") ||
			f.endsWith("_test.rs")
		);
		
		if (testFiles.length === 0) {
			issues.push({
				severity: "warning",
				code: CODES.HIDDEN_TESTS_EMPTY,
				message: "hidden-tests directory exists but contains no recognized test files",
				path: hiddenTestsPath,
				suggestion: "Add test files with .test.ts, .spec.ts, or similar naming conventions",
			});
		}
	} catch (e) {
		issues.push({
			severity: "warning",
			code: CODES.HIDDEN_TESTS_EMPTY,
			message: `Could not read hidden-tests directory: ${e instanceof Error ? e.message : "Unknown error"}`,
			path: hiddenTestsPath,
		});
	}
	
	// Validate hiddenTestsTarget path format
	if (path.isAbsolute(hiddenTestsTarget)) {
		issues.push({
			severity: "error",
			code: CODES.HIDDEN_TESTS_TARGET_INVALID,
			message: "hiddenTestsTarget should be a relative path within the project",
			suggestion: "Use a relative path like 'tests/hidden' or 'src/__tests__/hidden'",
		});
	}
}

/**
 * Validate local project structure
 */
function validateLocalProject(
	projectPath: string,
	testCommand: string | undefined,
	issues: ValidationIssue[]
): void {
	// Check for package.json (Node.js projects)
	const packageJsonPath = path.join(projectPath, "package.json");
	if (fs.existsSync(packageJsonPath)) {
		try {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
			
			// Check for test script if no testCommand override
			if (!testCommand && (!packageJson.scripts || !packageJson.scripts.test)) {
				issues.push({
					severity: "warning",
					code: CODES.PROJECT_NO_TEST_SCRIPT,
					message: "package.json has no 'test' script and no testCommand override in fixture",
					path: packageJsonPath,
					suggestion: "Add a 'test' script to package.json or specify testCommand in fixture.json",
				});
			}
		} catch (e) {
			// Invalid package.json - loadFixture should have caught this, but warn anyway
			issues.push({
				severity: "warning",
				code: CODES.PROJECT_NO_PACKAGE_JSON,
				message: `Could not parse package.json: ${e instanceof Error ? e.message : "Unknown error"}`,
				path: packageJsonPath,
			});
		}
	} else {
		// Check for other project types
		const cargoToml = path.join(projectPath, "Cargo.toml");
		const goMod = path.join(projectPath, "go.mod");
		const pyprojectToml = path.join(projectPath, "pyproject.toml");
		
		if (!fs.existsSync(cargoToml) && !fs.existsSync(goMod) && !fs.existsSync(pyprojectToml)) {
			issues.push({
				severity: "warning",
				code: CODES.PROJECT_NO_PACKAGE_JSON,
				message: "No package.json, Cargo.toml, go.mod, or pyproject.toml found",
				path: projectPath,
				suggestion: "Ensure the project has a proper configuration file for its language/framework",
			});
		}
	}
}

// ============================================
// Formatting Functions
// ============================================

/**
 * Format validation result for console output
 */
export function formatValidationResult(result: ValidationResult, fixturePath: string): string {
	const lines: string[] = [];
	
	// Header
	lines.push(`Validating fixture: ${fixturePath}`);
	lines.push("─".repeat(60));
	
	if (result.valid) {
		lines.push("✅ Fixture is valid");
	} else {
		lines.push("❌ Fixture has errors");
	}
	lines.push("");
	
	// Group issues by severity
	const errors = result.issues.filter(i => i.severity === "error");
	const warnings = result.issues.filter(i => i.severity === "warning");
	const infos = result.issues.filter(i => i.severity === "info");
	
	if (errors.length > 0) {
		lines.push("ERRORS:");
		for (const issue of errors) {
			lines.push(`  ❌ [${issue.code}] ${issue.message}`);
			if (issue.path) lines.push(`     Path: ${issue.path}`);
			if (issue.suggestion) lines.push(`     Fix: ${issue.suggestion}`);
		}
		lines.push("");
	}
	
	if (warnings.length > 0) {
		lines.push("WARNINGS:");
		for (const issue of warnings) {
			lines.push(`  ⚠️ [${issue.code}] ${issue.message}`);
			if (issue.path) lines.push(`     Path: ${issue.path}`);
			if (issue.suggestion) lines.push(`     Suggestion: ${issue.suggestion}`);
		}
		lines.push("");
	}
	
	if (infos.length > 0) {
		lines.push("INFO:");
		for (const issue of infos) {
			lines.push(`  ℹ️ [${issue.code}] ${issue.message}`);
			if (issue.suggestion) lines.push(`     Suggestion: ${issue.suggestion}`);
		}
		lines.push("");
	}
	
	if (result.issues.length === 0) {
		lines.push("No issues found.");
	}
	
	// Summary
	lines.push("─".repeat(60));
	lines.push(`Summary: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`);
	
	return lines.join("\n");
}

/**
 * Validate all fixtures in a benchmark config and return combined results
 */
export function validateAllFixtures(
	fixturePaths: string[]
): { allValid: boolean; results: Map<string, ValidationResult> } {
	const results = new Map<string, ValidationResult>();
	let allValid = true;
	
	for (const fixturePath of fixturePaths) {
		const result = validateFixture(fixturePath);
		results.set(fixturePath, result);
		if (!result.valid) {
			allValid = false;
		}
	}
	
	return { allValid, results };
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 5.5: Create Validator CLI Command

- **Files**: `extensions/spec-bench/cli-validate.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-bench/cli-report.ts` CLI patterns
- **Action**: Create CLI subcommand for validating fixtures

```typescript
/**
 * CLI command for validating benchmark fixtures
 * 
 * Usage:
 *   spec-bench validate <fixture-path>           Validate single fixture
 *   spec-bench validate <config.json>            Validate all fixtures in config
 *   spec-bench validate <fixture-path> --strict  Treat warnings as errors
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	validateFixture,
	validateAllFixtures,
	formatValidationResult,
	type ValidationResult,
} from "./validator.ts";
import { loadBenchmarkConfig } from "./config.ts";

// ============================================
// CLI Helpers
// ============================================

function printError(message: string): void {
	console.error(`\x1b[31mError:\x1b[0m ${message}`);
}

function printSuccess(message: string): void {
	console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

// ============================================
// Validate Command
// ============================================

export interface ValidateOptions {
	target: string;  // Path to fixture or config file
	strict?: boolean;  // Treat warnings as errors
}

/**
 * Run fixture validation
 */
export async function runValidateCommand(options: ValidateOptions): Promise<boolean> {
	const { target, strict } = options;
	const resolvedPath = path.resolve(target);
	
	// Determine if target is a config file or fixture directory
	if (target.endsWith(".json") && fs.existsSync(resolvedPath)) {
		// Try to load as benchmark config
		const configResult = loadBenchmarkConfig(resolvedPath);
		
		if (configResult.success) {
			return validateConfigFixtures(configResult.config, resolvedPath, strict);
		}
		
		// Not a valid config - might be a fixture directory with a .json file
	}
	
	// Validate as single fixture
	if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
		return validateSingleFixture(resolvedPath, strict);
	}
	
	// Check if it's a path to fixture.json
	if (resolvedPath.endsWith("fixture.json")) {
		const fixtureDir = path.dirname(resolvedPath);
		return validateSingleFixture(fixtureDir, strict);
	}
	
	printError(`Not a valid fixture directory or config file: ${target}`);
	return false;
}

/**
 * Validate a single fixture directory
 */
function validateSingleFixture(fixturePath: string, strict?: boolean): boolean {
	const result = validateFixture(fixturePath);
	console.log(formatValidationResult(result, fixturePath));
	
	if (strict) {
		// In strict mode, warnings also cause failure
		const hasWarningsOrErrors = result.issues.some(
			i => i.severity === "error" || i.severity === "warning"
		);
		return !hasWarningsOrErrors;
	}
	
	return result.valid;
}

/**
 * Validate all fixtures referenced in a benchmark config
 */
function validateConfigFixtures(
	config: { fixtures: Array<{ path: string }> },
	configPath: string,
	strict?: boolean
): boolean {
	const basePath = path.dirname(configPath);
	const fixturePaths = config.fixtures.map(f => 
		path.isAbsolute(f.path) ? f.path : path.resolve(basePath, f.path)
	);
	
	console.log(`Validating ${fixturePaths.length} fixture(s) from config...\n`);
	
	const { allValid, results } = validateAllFixtures(fixturePaths);
	
	// Print results for each fixture
	for (const [fixturePath, result] of results) {
		console.log(formatValidationResult(result, fixturePath));
		console.log("");
	}
	
	// Summary
	const validCount = Array.from(results.values()).filter(r => r.valid).length;
	const invalidCount = results.size - validCount;
	
	console.log("═".repeat(60));
	console.log(`Overall: ${validCount} valid, ${invalidCount} invalid`);
	
	if (strict) {
		// Count warnings as failures in strict mode
		let warningCount = 0;
		for (const result of results.values()) {
			warningCount += result.issues.filter(i => i.severity === "warning").length;
		}
		if (warningCount > 0) {
			console.log(`Strict mode: ${warningCount} warning(s) treated as errors`);
			return false;
		}
	}
	
	return allValid;
}

// ============================================
// Command Parser
// ============================================

/**
 * Parse validate command from CLI args
 */
export function parseValidateArgs(args: string[]): { options: ValidateOptions } | null {
	if (args.length < 2 || args[0] !== "validate") {
		return null;
	}
	
	const target = args[1];
	let strict = false;
	
	for (let i = 2; i < args.length; i++) {
		if (args[i] === "--strict") {
			strict = true;
		}
	}
	
	return { options: { target, strict } };
}
```

- **Verify**: TypeScript compiles without errors

---

### Step 5.6: Update Main CLI with Validate Command

- **Files**: `extensions/spec-bench/cli.ts` (modify)
- **Action**: Add validate subcommand to the main CLI

Update the HELP_TEXT constant to include validate command:

```typescript
// Find this section in HELP_TEXT and add validate command:

// Before (partial):
const HELP_TEXT = `
spec-bench - Benchmark tool for spec-pipeline configurations

USAGE:
  spec-bench <config.json>              Run benchmarks with the specified config
  spec-bench report <session.json>      Generate report from results
  spec-bench compare <session.json>     Compare permutations in results
  ...
`;
```

```typescript
// After (add validate command):
const HELP_TEXT = `
spec-bench - Benchmark tool for spec-pipeline configurations

USAGE:
  spec-bench <config.json>              Run benchmarks with the specified config
  spec-bench report <session.json>      Generate report from results
  spec-bench compare <session.json>     Compare permutations in results
  spec-bench validate <path>            Validate fixture(s)
  spec-bench --help                     Show this help message
  spec-bench --version                  Show version information

COMMANDS:
  <config.json>                         Run benchmarks using configuration file
  
  report <session.json> [options]       Generate detailed report
    --format <format>                   Output format: markdown, csv, json (default: markdown)
    --output <path>                     Write to file instead of stdout
    --detailed                          Include per-iteration data (CSV only)
  
  compare <session.json> [options]      Compare permutations
    --baseline <name>                   Baseline permutation for comparisons
  
  validate <path> [options]             Validate fixture or config
    <fixture-dir>                       Validate single fixture directory
    <config.json>                       Validate all fixtures in benchmark config
    --strict                            Treat warnings as errors

...
`.trim();
```

Add validate command handling after the report/compare handling. Find the section that handles subcommands and add:

```typescript
// After the existing report/compare handling block, add:

	// Handle validate subcommand
	if (args[0] === "validate") {
		const { parseValidateArgs, runValidateCommand } = await import("./cli-validate.ts");
		
		const parsed = parseValidateArgs(args);
		if (!parsed) {
			printError("Invalid validate command. Usage: spec-bench validate <path> [--strict]");
			process.exit(1);
		}
		
		const success = await runValidateCommand(parsed.options);
		process.exit(success ? 0 : 1);
	}
```

- **Verify**: Run `npx tsx extensions/spec-bench/cli.ts --help` shows validate command

---

### Step 5.7: Update Index Exports

- **Files**: `extensions/spec-bench/index.ts` (modify)
- **Action**: Add exports for validator module

Add to the existing index.ts:

```typescript
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
```

- **Verify**: TypeScript compiles without errors

---

### Step 5.8: Create Validator Tests

- **Files**: `extensions/spec-bench/validator.test.ts` (new)
- **Pattern Reference**: Based on `extensions/spec-pipeline/config.test.ts` test patterns
- **Action**: Create comprehensive tests for fixture validation

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	validateFixture,
	validateAllFixtures,
	formatValidationResult,
} from "./validator.ts";

describe("validateFixture", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-validator-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("valid fixtures", () => {
		it("validates minimal valid fixture", () => {
			const fixturePath = path.join(tempDir, "valid-fixture");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({
					name: "Test Fixture",
					description: "A valid test fixture",
					hiddenTestsTarget: "tests/hidden",
				})
			);
			
			fs.writeFileSync(
				path.join(fixturePath, "feature.md"),
				"# Feature Description\n\nThis is a detailed feature description with enough content to pass validation."
			);
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.fixture).toBeDefined();
		});

		it("validates fixture with all optional features", () => {
			const fixturePath = path.join(tempDir, "complete-fixture");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			fs.mkdirSync(path.join(fixturePath, "hidden-tests"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({
					name: "Complete Fixture",
					description: "A fixture with all features",
					hiddenTestsTarget: "tests/hidden",
					testCommand: "npm test",
					timeout: 1800,
				})
			);
			
			fs.writeFileSync(
				path.join(fixturePath, "feature.md"),
				"# Feature\n\nDetailed description with requirements and examples."
			);
			
			fs.writeFileSync(
				path.join(fixturePath, "discovery.json"),
				JSON.stringify({
					rounds: [
						{ answers: "This is a detailed answer for round 1 with enough content." },
					],
					earlyFinish: true,
				})
			);
			
			fs.writeFileSync(
				path.join(fixturePath, "hidden-tests", "hidden.test.ts"),
				"// Hidden test file"
			);
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
		});
	});

	describe("error cases", () => {
		it("returns error for non-existent fixture", () => {
			const result = validateFixture(path.join(tempDir, "nonexistent"));
			
			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.severity === "error")).toBe(true);
		});

		it("returns error for missing fixture.json", () => {
			const fixturePath = path.join(tempDir, "no-fixture-json");
			fs.mkdirSync(fixturePath);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.code === "E001")).toBe(true);
		});

		it("returns error for missing feature.md", () => {
			const fixturePath = path.join(tempDir, "no-feature-md");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(false);
		});

		it("returns error for absolute hiddenTestsTarget path", () => {
			const fixturePath = path.join(tempDir, "absolute-target");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			fs.mkdirSync(path.join(fixturePath, "hidden-tests"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({
					name: "Test",
					description: "Test",
					hiddenTestsTarget: "/absolute/path/tests",  // Invalid!
				})
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			fs.writeFileSync(path.join(fixturePath, "hidden-tests", "test.test.ts"), "// test");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(false);
			expect(result.issues.some(i => i.code === "E006")).toBe(true);
		});
	});

	describe("warning cases", () => {
		it("warns on empty discovery rounds", () => {
			const fixturePath = path.join(tempDir, "empty-discovery");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			fs.writeFileSync(
				path.join(fixturePath, "discovery.json"),
				JSON.stringify({ rounds: [] })  // Empty rounds
			);
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);  // Warnings don't invalidate
			expect(result.issues.some(i => i.code === "W002")).toBe(true);
		});

		it("warns on empty hidden-tests directory", () => {
			const fixturePath = path.join(tempDir, "empty-hidden-tests");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			fs.mkdirSync(path.join(fixturePath, "hidden-tests"));  // Empty directory
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "W003")).toBe(true);
		});

		it("warns on timeout too short", () => {
			const fixturePath = path.join(tempDir, "short-timeout");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({
					name: "Test",
					description: "Test",
					hiddenTestsTarget: "tests",
					timeout: 60,  // Too short!
				})
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "W006")).toBe(true);
		});

		it("warns on timeout too long", () => {
			const fixturePath = path.join(tempDir, "long-timeout");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({
					name: "Test",
					description: "Test",
					hiddenTestsTarget: "tests",
					timeout: 14400,  // 4 hours - too long!
				})
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "W007")).toBe(true);
		});
	});

	describe("info cases", () => {
		it("provides info when discovery.json is missing", () => {
			const fixturePath = path.join(tempDir, "no-discovery");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "I001")).toBe(true);
		});

		it("provides info when hidden-tests directory is missing", () => {
			const fixturePath = path.join(tempDir, "no-hidden-tests");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature with enough detail.");
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "I002")).toBe(true);
		});

		it("provides info when feature.md is very short", () => {
			const fixturePath = path.join(tempDir, "short-feature");
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Short");  // < 50 chars
			
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.issues.some(i => i.code === "I003")).toBe(true);
		});
	});
});

describe("validateAllFixtures", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-validate-all-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("validates multiple fixtures", () => {
		// Create two valid fixtures
		for (const name of ["fixture1", "fixture2"]) {
			const fixturePath = path.join(tempDir, name);
			fs.mkdirSync(fixturePath);
			fs.mkdirSync(path.join(fixturePath, "project"));
			fs.writeFileSync(
				path.join(fixturePath, "fixture.json"),
				JSON.stringify({ name, description: name, hiddenTestsTarget: "tests" })
			);
			fs.writeFileSync(
				path.join(fixturePath, "feature.md"),
				`# Feature for ${name}\n\nDetailed description here.`
			);
		}
		
		const { allValid, results } = validateAllFixtures([
			path.join(tempDir, "fixture1"),
			path.join(tempDir, "fixture2"),
		]);
		
		expect(allValid).toBe(true);
		expect(results.size).toBe(2);
	});

	it("returns allValid false if any fixture is invalid", () => {
		// Create one valid and one invalid fixture
		const validPath = path.join(tempDir, "valid");
		fs.mkdirSync(validPath);
		fs.mkdirSync(path.join(validPath, "project"));
		fs.writeFileSync(
			path.join(validPath, "fixture.json"),
			JSON.stringify({ name: "Valid", description: "Valid", hiddenTestsTarget: "tests" })
		);
		fs.writeFileSync(path.join(validPath, "feature.md"), "# Valid fixture description.");
		
		const invalidPath = path.join(tempDir, "invalid");
		fs.mkdirSync(invalidPath);
		// No fixture.json - invalid
		
		const { allValid, results } = validateAllFixtures([validPath, invalidPath]);
		
		expect(allValid).toBe(false);
		expect(results.get(validPath)?.valid).toBe(true);
		expect(results.get(invalidPath)?.valid).toBe(false);
	});
});

describe("formatValidationResult", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-format-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("formats valid result", () => {
		const fixturePath = path.join(tempDir, "valid");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature description.");
		
		const result = validateFixture(fixturePath);
		const formatted = formatValidationResult(result, fixturePath);
		
		expect(formatted).toContain("valid");
		expect(formatted).toContain(fixturePath);
	});

	it("formats errors prominently", () => {
		const result = validateFixture(path.join(tempDir, "nonexistent"));
		const formatted = formatValidationResult(result, path.join(tempDir, "nonexistent"));
		
		expect(formatted).toContain("ERRORS");
		expect(formatted).toContain("❌");
	});

	it("includes suggestions when available", () => {
		const fixturePath = path.join(tempDir, "no-discovery");
		fs.mkdirSync(fixturePath);
		fs.mkdirSync(path.join(fixturePath, "project"));
		fs.writeFileSync(
			path.join(fixturePath, "fixture.json"),
			JSON.stringify({ name: "Test", description: "Test", hiddenTestsTarget: "tests" })
		);
		fs.writeFileSync(path.join(fixturePath, "feature.md"), "# Feature description.");
		
		const result = validateFixture(fixturePath);
		const formatted = formatValidationResult(result, fixturePath);
		
		expect(formatted).toContain("Suggestion");
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

### Step 5.9: Create Example Benchmark Config

- **Files**: `extensions/spec-bench/fixtures/example-config.json` (new)
- **Pattern Reference**: Based on spec R2, R23 configuration format
- **Action**: Create an example benchmark configuration that uses the sample fixtures

```json
{
  "fixtures": [
    { "path": "./minimal-ts" },
    { "path": "./complete-example" }
  ],
  "permutations": [
    {
      "name": "default",
      "models": {}
    },
    {
      "name": "all-sonnet",
      "models": {
        "specDrafter": { "model": "sonnet", "thinking": "high" },
        "specReviewer": {
          "cheap": { "model": "haiku", "thinking": "off" },
          "expensive": { "model": "sonnet", "thinking": "medium" }
        },
        "planDrafter": { "model": "sonnet", "thinking": "high" },
        "planReviewer": {
          "cheap": { "model": "haiku", "thinking": "off" },
          "expensive": { "model": "sonnet", "thinking": "medium" }
        },
        "implementer": { "model": "sonnet", "thinking": "high" },
        "codeReviewer": {
          "cheap": { "model": "haiku", "thinking": "off" },
          "expensive": { "model": "sonnet", "thinking": "medium" }
        },
        "addressReview": { "model": "sonnet", "thinking": "high" }
      },
      "reviewCycles": { "cheap": 2, "expensive": 1 }
    }
  ],
  "iterations": 1,
  "outputDir": "./benchmark-results",
  "parallelism": 1
}
```

- **Verify**: Run `npx tsx extensions/spec-bench/cli.ts validate extensions/spec-bench/fixtures/example-config.json`

---

### Step 5.10: Create Fixtures Documentation

- **Files**: `extensions/spec-bench/fixtures/README.md` (new)
- **Action**: Create documentation for the fixture format and how to create custom fixtures

```markdown
# Spec-Bench Fixtures

This directory contains sample fixtures demonstrating how to set up benchmarks for the spec-pipeline tool.

## Fixture Structure

Each fixture is a directory containing:

```
fixture_name/
├── fixture.json           # Required: Fixture metadata
├── feature.md             # Required: Feature description (fed to pipeline)
├── discovery.json         # Optional: Pre-scripted Q&A responses
├── hidden-tests/          # Optional: Tests added post-implementation
│   └── ... (test files)
└── project/               # Project source (or specify external path/URL)
    └── ... (project files)
```

## Configuration Files

### fixture.json (Required)

```json
{
  "name": "Feature Name",
  "description": "What this fixture tests",
  "project": "/path/to/project",  // Optional: external project path or git URL
  "projectRef": "branch-or-tag",  // Optional: git ref to checkout
  "testCommand": "npm test",      // Optional: override test command
  "hiddenTestsTarget": "tests/hidden/",  // Required: where to copy hidden tests
  "timeout": 3600                 // Optional: max seconds per run (default: 3600)
}
```

**Project Source Options:**

1. **Inline `project/` subdirectory**: Place project files directly in the fixture
2. **Local path**: Set `"project": "/absolute/or/relative/path"`
3. **Git URL**: Set `"project": "git@github.com:org/repo.git"` with optional `"projectRef": "main"`

### feature.md (Required)

The feature description is the input to the spec-pipeline. Write it as if you were describing a feature request to a developer.

Include:
- Clear requirements
- Expected behavior
- Example usage
- Acceptance criteria

### discovery.json (Optional)

Pre-scripted responses for the discovery phase:

```json
{
  "rounds": [
    {
      "answers": "Response to round 1 questions..."
    },
    {
      "answers": "Response to round 2 questions..."
    }
  ],
  "earlyFinish": true  // Stop discovery after provided rounds
}
```

**Tips:**
- Provide comprehensive answers that address likely questions
- Include design decisions, edge cases, and implementation preferences
- Use `earlyFinish: true` to proceed after your scripted answers

### hidden-tests/ (Optional)

Tests that are copied into the project AFTER implementation completes but BEFORE final verification. These test the quality of the implementation without being visible during development.

The tests are copied to the path specified in `hiddenTestsTarget`.

## Sample Fixtures

### minimal-ts

A minimal TypeScript fixture demonstrating basic structure. Implements a simple string utility function.

### complete-example

A complete fixture demonstrating all features:
- Discovery responses
- Hidden tests
- Calculator module implementation

## Creating Your Own Fixtures

1. Create a new directory in `fixtures/`
2. Add `fixture.json` with required fields
3. Write `feature.md` with detailed requirements
4. Either:
   - Create a `project/` subdirectory with your starter project
   - Set `project` in fixture.json to point to an external project
5. Optionally add `discovery.json` for consistent discovery responses
6. Optionally add `hidden-tests/` with additional test files

## Validating Fixtures

Use the `validate` command to check your fixture:

```bash
# Validate single fixture
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/my-fixture

# Validate all fixtures in a config
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/example-config.json

# Strict mode (warnings as errors)
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/my-fixture --strict
```

## Best Practices

1. **Feature descriptions**: Be specific about requirements and acceptance criteria
2. **Discovery answers**: Provide comprehensive answers that address edge cases
3. **Hidden tests**: Focus on edge cases and behaviors not covered by original tests
4. **Timeouts**: Start with 30-60 minutes; increase if needed for complex features
5. **Test commands**: Use `--passWithNoTests` if the project may not have tests initially
```

- **Verify**: Documentation is clear and complete

---

### Step 5.11: Create End-to-End Validation Test

- **Files**: `extensions/spec-bench/fixtures.test.ts` (new)
- **Pattern Reference**: Based on existing test patterns
- **Action**: Create end-to-end tests that validate the sample fixtures work correctly

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateFixture, validateAllFixtures } from "./validator.ts";
import { loadBenchmarkConfig } from "./config.ts";
import { loadAllFixtures } from "./fixture.ts";

// Get the fixtures directory relative to this test file
const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

describe("sample fixtures", () => {
	describe("minimal-ts fixture", () => {
		const fixturePath = path.join(FIXTURES_DIR, "minimal-ts");
		
		it("exists and has required structure", () => {
			expect(fs.existsSync(fixturePath)).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "fixture.json"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "feature.md"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "project"))).toBe(true);
		});
		
		it("passes validation", () => {
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.fixture).toBeDefined();
			expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
		});
		
		it("has valid fixture.json", () => {
			const content = fs.readFileSync(path.join(fixturePath, "fixture.json"), "utf-8");
			const config = JSON.parse(content);
			
			expect(config.name).toBeDefined();
			expect(config.description).toBeDefined();
			expect(config.hiddenTestsTarget).toBeDefined();
		});
		
		it("has meaningful feature.md", () => {
			const content = fs.readFileSync(path.join(fixturePath, "feature.md"), "utf-8");
			
			expect(content.length).toBeGreaterThan(100);
			expect(content).toContain("#");  // Has markdown headers
		});
		
		it("has valid project structure", () => {
			const projectPath = path.join(fixturePath, "project");
			
			expect(fs.existsSync(path.join(projectPath, "package.json"))).toBe(true);
			expect(fs.existsSync(path.join(projectPath, "tsconfig.json"))).toBe(true);
			expect(fs.existsSync(path.join(projectPath, "src"))).toBe(true);
		});
	});
	
	describe("complete-example fixture", () => {
		const fixturePath = path.join(FIXTURES_DIR, "complete-example");
		
		it("exists and has required structure", () => {
			expect(fs.existsSync(fixturePath)).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "fixture.json"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "feature.md"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "discovery.json"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "hidden-tests"))).toBe(true);
			expect(fs.existsSync(path.join(fixturePath, "project"))).toBe(true);
		});
		
		it("passes validation", () => {
			const result = validateFixture(fixturePath);
			
			expect(result.valid).toBe(true);
			expect(result.fixture).toBeDefined();
			expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
		});
		
		it("has valid discovery.json", () => {
			const content = fs.readFileSync(path.join(fixturePath, "discovery.json"), "utf-8");
			const discovery = JSON.parse(content);
			
			expect(discovery.rounds).toBeDefined();
			expect(Array.isArray(discovery.rounds)).toBe(true);
			expect(discovery.rounds.length).toBeGreaterThan(0);
			
			for (const round of discovery.rounds) {
				expect(round.answers).toBeDefined();
				expect(round.answers.length).toBeGreaterThan(10);
			}
		});
		
		it("has hidden test files", () => {
			const hiddenTestsPath = path.join(fixturePath, "hidden-tests");
			const files = fs.readdirSync(hiddenTestsPath);
			const testFiles = files.filter(f => f.includes(".test."));
			
			expect(testFiles.length).toBeGreaterThan(0);
		});
	});
	
	describe("example-config.json", () => {
		const configPath = path.join(FIXTURES_DIR, "example-config.json");
		
		it("exists", () => {
			expect(fs.existsSync(configPath)).toBe(true);
		});
		
		it("is valid benchmark config", () => {
			const result = loadBenchmarkConfig(configPath);
			
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.config.fixtures.length).toBeGreaterThan(0);
				expect(result.config.permutations.length).toBeGreaterThan(0);
			}
		});
		
		it("references existing fixtures", () => {
			const result = loadBenchmarkConfig(configPath);
			
			if (result.success) {
				const basePath = path.dirname(configPath);
				const { fixtures, errors } = loadAllFixtures(result.config.fixtures, basePath);
				
				expect(errors).toHaveLength(0);
				expect(fixtures.length).toBe(result.config.fixtures.length);
			}
		});
		
		it("all referenced fixtures pass validation", () => {
			const result = loadBenchmarkConfig(configPath);
			
			if (result.success) {
				const basePath = path.dirname(configPath);
				const fixturePaths = result.config.fixtures.map(f => 
					path.isAbsolute(f.path) ? f.path : path.resolve(basePath, f.path)
				);
				
				const { allValid, results } = validateAllFixtures(fixturePaths);
				
				expect(allValid).toBe(true);
				
				// No errors in any fixture
				for (const [fixPath, validationResult] of results) {
					const errors = validationResult.issues.filter(i => i.severity === "error");
					expect(errors).toHaveLength(0);
				}
			}
		});
	});
});

describe("fixtures README", () => {
	const readmePath = path.join(FIXTURES_DIR, "README.md");
	
	it("exists", () => {
		expect(fs.existsSync(readmePath)).toBe(true);
	});
	
	it("documents fixture structure", () => {
		const content = fs.readFileSync(readmePath, "utf-8");
		
		expect(content).toContain("fixture.json");
		expect(content).toContain("feature.md");
		expect(content).toContain("discovery.json");
		expect(content).toContain("hidden-tests");
	});
	
	it("includes validation instructions", () => {
		const content = fs.readFileSync(readmePath, "utf-8");
		
		expect(content).toContain("validate");
		expect(content).toContain("--strict");
	});
});
```

- **Verify**: Run `npm test` and ensure all tests pass

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `extensions/spec-bench/fixtures/minimal-ts/fixture.json` | Minimal fixture config | Spec R7 |
| `extensions/spec-bench/fixtures/minimal-ts/feature.md` | Feature description | Spec R6 |
| `extensions/spec-bench/fixtures/minimal-ts/project/*` | Sample TypeScript project | Standard Node.js/TS |
| `extensions/spec-bench/fixtures/complete-example/fixture.json` | Complete fixture config | Spec R7 |
| `extensions/spec-bench/fixtures/complete-example/feature.md` | Feature description | Spec R6 |
| `extensions/spec-bench/fixtures/complete-example/discovery.json` | Discovery responses | Spec R8 |
| `extensions/spec-bench/fixtures/complete-example/project/*` | Sample project | Standard Node.js/TS |
| `extensions/spec-bench/fixtures/complete-example/hidden-tests/*` | Hidden test files | Spec R9, R15 |
| `extensions/spec-bench/fixtures/example-config.json` | Example benchmark config | Spec R23 |
| `extensions/spec-bench/fixtures/README.md` | Fixtures documentation | Standard docs |
| `extensions/spec-bench/validator.ts` | Fixture validation logic | `fixture.ts` patterns |
| `extensions/spec-bench/cli-validate.ts` | Validate CLI command | `cli-report.ts` patterns |
| `extensions/spec-bench/validator.test.ts` | Validator tests | `config.test.ts` patterns |
| `extensions/spec-bench/fixtures.test.ts` | E2E fixture tests | Integration test pattern |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-bench/cli.ts` | Add validate subcommand, update help text |
| `extensions/spec-bench/index.ts` | Add validator and cli-validate exports |

## Completion Checklist

- [ ] Step 5.1: Fixtures directory structure created
- [ ] Step 5.2: Minimal TypeScript fixture created with all files
- [ ] Step 5.3: Complete example fixture created with discovery.json and hidden tests
- [ ] Step 5.4: Validator module implemented
- [ ] Step 5.5: Validate CLI command implemented
- [ ] Step 5.6: Main CLI updated with validate command
- [ ] Step 5.7: Index exports updated
- [ ] Step 5.8: Validator tests passing
- [ ] Step 5.9: Example benchmark config created
- [ ] Step 5.10: Fixtures README documentation created
- [ ] Step 5.11: End-to-end fixture tests passing
- [ ] All tests pass (`npm test`)
- [ ] Code follows project conventions (TypeScript, vitest patterns)
- [ ] Sample fixtures validate successfully

## Verification Commands

```bash
# After completing all steps:

# Run all tests
npm test

# Type check
npx tsc --noEmit

# Validate sample fixtures
npx tsx extensions/spec-bench/cli.ts validate extensions/spec-bench/fixtures/minimal-ts
npx tsx extensions/spec-bench/cli.ts validate extensions/spec-bench/fixtures/complete-example
npx tsx extensions/spec-bench/cli.ts validate extensions/spec-bench/fixtures/example-config.json

# Validate with strict mode
npx tsx extensions/spec-bench/cli.ts validate extensions/spec-bench/fixtures/minimal-ts --strict

# Check help includes validate command
npx tsx extensions/spec-bench/cli.ts --help

# List fixture files to verify structure
find extensions/spec-bench/fixtures -type f | head -30
```

## Technical Notes

### Fixture Validation Strategy

The validator performs multi-level validation:

1. **Schema validation**: Uses the existing `loadFixture()` function to validate against TypeBox schemas
2. **Content validation**: Checks feature.md length, discovery answers, hidden test files
3. **Project validation**: Verifies project structure (package.json, test scripts, etc.)
4. **Consistency validation**: Checks that paths are valid and configurations are consistent

### Validation Severity Levels

- **Error**: Prevents benchmark from running (missing required files, invalid schema)
- **Warning**: May cause issues during benchmark (empty discovery, short timeout)
- **Info**: Suggestions for improvement (missing optional features)

### Sample Fixture Design

The sample fixtures are designed to:

1. **Be self-contained**: Include all necessary project files inline
2. **Be realistic**: Demonstrate real-world use cases (TypeScript, testing)
3. **Be instructive**: Show best practices for fixture creation
4. **Be testable**: Can be validated without actually running the full benchmark

### Hidden Tests Strategy

Hidden tests should:
- Focus on edge cases not covered by original tests
- Test behaviors that indicate proper implementation
- Be copied to a predictable location (`hiddenTestsTarget`)
- Use the same test framework as the project
