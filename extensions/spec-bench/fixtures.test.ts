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
