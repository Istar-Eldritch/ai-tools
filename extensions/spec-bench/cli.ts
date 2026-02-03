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
import { getResultsPath } from "./results.ts";
import type { BenchmarkConfig, LoadedFixture } from "./types.ts";

// ============================================
// Constants
// ============================================

const VERSION = "0.1.0";
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
	
	// Handle subcommands
	if (args[0] === "report" || args[0] === "compare") {
		const { parseReportArgs, runReportCommand, runCompareCommand } = await import("./cli-report.ts");
		
		const parsed = parseReportArgs(args);
		if (!parsed) {
			printError("Invalid command. Run 'spec-bench --help' for usage.");
			process.exit(1);
		}
		
		let success: boolean;
		if (parsed.command === "report") {
			success = await runReportCommand(parsed.options as Parameters<typeof runReportCommand>[0]);
		} else {
			success = await runCompareCommand(parsed.options as Parameters<typeof runCompareCommand>[0]);
		}
		
		process.exit(success ? 0 : 1);
	}
	
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
	
	// Require config file argument for benchmark run
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
	
	// Run benchmark
	const abortController = new AbortController();
	
	// Import benchmark modules
	const { runBenchmark, createConsoleProgress, formatBenchmarkSummary } = await import("./benchmark.ts");
	
	console.log("\n🚀 Starting benchmark...\n");
	
	const result = await runBenchmark({
		config,
		fixtures,
		outputDir,
		abortController,
		onProgress: createConsoleProgress(),
	});
	
	// Print summary
	console.log(formatBenchmarkSummary(result));
	
	// Print results file location
	const resultsPath = getResultsPath(outputDir, result.session.sessionId);
	printSuccess(`Results saved to: ${resultsPath}`);
	
	if (result.aborted) {
		process.exit(130);  // Standard exit code for SIGINT
	}
}

// Run main
main().catch((e) => {
	printError(e instanceof Error ? e.message : String(e));
	process.exit(1);
});
