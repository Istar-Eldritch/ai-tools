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
