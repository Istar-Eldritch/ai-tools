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
