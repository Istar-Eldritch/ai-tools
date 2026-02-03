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
