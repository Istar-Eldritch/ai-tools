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
