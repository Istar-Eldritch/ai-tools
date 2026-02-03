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
