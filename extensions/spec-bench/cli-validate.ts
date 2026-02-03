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
