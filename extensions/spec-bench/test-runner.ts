/**
 * Test runner for benchmark verification
 * 
 * Handles running test commands and reporting results (R14, R15b)
 */

import { spawn } from "node:child_process";

// ============================================
// Types
// ============================================

export interface TestResult {
	success: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
}

// ============================================
// Test Execution
// ============================================

/**
 * Run a test command and capture results
 * 
 * @param command Test command to run (e.g., "npm test")
 * @param cwd Working directory
 * @param timeoutMs Timeout in milliseconds (default: 5 minutes)
 * @param signal Optional abort signal for cancellation
 * @returns Test result with exit code and output
 */
export async function runTestCommand(
	command: string,
	cwd: string,
	timeoutMs: number = 300_000,
	signal?: AbortSignal
): Promise<TestResult> {
	const startTime = Date.now();
	
	return new Promise((resolve) => {
		// Parse command into executable and args
		// Handle common patterns: "npm test", "cargo test", etc.
		const parts = command.split(/\s+/);
		const executable = parts[0];
		const args = parts.slice(1);
		
		const proc = spawn(executable, args, {
			cwd,
			shell: true,  // Use shell for complex commands
			stdio: ["ignore", "pipe", "pipe"],
		});
		
		let stdout = "";
		let stderr = "";
		let killed = false;
		
		proc.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		
		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		
		// Timeout handling
		const timeout = setTimeout(() => {
			killed = true;
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) {
					proc.kill("SIGKILL");
				}
			}, 5000);
		}, timeoutMs);
		
		// Abort signal handling
		if (signal) {
			const handleAbort = () => {
				killed = true;
				proc.kill("SIGTERM");
			};
			if (signal.aborted) {
				handleAbort();
			} else {
				signal.addEventListener("abort", handleAbort, { once: true });
			}
		}
		
		proc.on("close", (code) => {
			clearTimeout(timeout);
			const durationMs = Date.now() - startTime;
			
			resolve({
				success: code === 0 && !killed,
				exitCode: killed ? -1 : (code ?? 1),
				stdout,
				stderr,
				durationMs,
			});
		});
		
		proc.on("error", (err) => {
			clearTimeout(timeout);
			const durationMs = Date.now() - startTime;
			
			resolve({
				success: false,
				exitCode: 1,
				stdout,
				stderr: stderr + `\nProcess error: ${err.message}`,
				durationMs,
			});
		});
	});
}

/**
 * Run original test suite
 */
export async function runOriginalTests(
	testCommand: string,
	cwd: string,
	signal?: AbortSignal
): Promise<TestResult> {
	return runTestCommand(testCommand, cwd, 300_000, signal);
}

/**
 * Run test suite including hidden tests (R15b)
 */
export async function runAllTests(
	testCommand: string,
	cwd: string,
	signal?: AbortSignal
): Promise<TestResult> {
	// Same as original tests - hidden tests have already been copied
	return runTestCommand(testCommand, cwd, 300_000, signal);
}
