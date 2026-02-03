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
