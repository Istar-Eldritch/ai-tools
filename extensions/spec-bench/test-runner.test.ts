import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runTestCommand } from "./test-runner.ts";

describe("runTestCommand", () => {
	let tempDir: string;
	
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-test-runner-"));
	});
	
	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
	
	it("runs successful command", async () => {
		const result = await runTestCommand("echo hello", tempDir);
		
		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hello");
	});
	
	it("captures exit code from failed command", async () => {
		const result = await runTestCommand("exit 42", tempDir);
		
		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(42);
	});
	
	it("captures stderr", async () => {
		const result = await runTestCommand("echo error >&2", tempDir);
		
		expect(result.stderr).toContain("error");
	});
	
	it("respects timeout", async () => {
		const result = await runTestCommand("sleep 10", tempDir, 100);
		
		expect(result.success).toBe(false);
		expect(result.exitCode).toBe(-1);  // Killed
	});
	
	it("records duration", async () => {
		// Use node to sleep - more portable than fractional sleep
		const result = await runTestCommand('node -e "setTimeout(() => {}, 100)"', tempDir, 5000);
		
		expect(result.durationMs).toBeGreaterThan(50);
		expect(result.durationMs).toBeLessThan(2000);
	});
	
	it("handles abort signal", async () => {
		const controller = new AbortController();
		
		// Start command and abort quickly
		const resultPromise = runTestCommand("sleep 10", tempDir, 60000, controller.signal);
		
		setTimeout(() => controller.abort(), 50);
		
		const result = await resultPromise;
		
		expect(result.success).toBe(false);
	});
	
	it("runs in correct working directory", async () => {
		// Create a test file in the temp dir
		const testFile = path.join(tempDir, "testfile.txt");
		fs.writeFileSync(testFile, "content");
		
		const result = await runTestCommand("ls testfile.txt", tempDir);
		
		expect(result.success).toBe(true);
		expect(result.stdout).toContain("testfile.txt");
	});
});
