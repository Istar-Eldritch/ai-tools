/**
 * Pi subprocess runner with metrics capture
 * 
 * Spawns pi directly with --mode json to capture full output
 * including usage_stats events for token counting (R12a)
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MetricsAccumulator } from "./metrics.ts";
import type { AgentMetrics, ModelConfig } from "./types.ts";

// ============================================
// Types
// ============================================

/** Model identifier mapping (same as spec-pipeline) */
const MODEL_IDENTIFIERS: Record<string, string> = {
	opus: "claude-opus-4-5",
	sonnet: "claude-sonnet-4-5",
	haiku: "claude-haiku-4-5",
} as const;

/** Roles that only need read access */
const READ_ONLY_ROLES = new Set([
	"specReviewer",
	"planReviewer",
	"codeReviewer",
	"commitMessageWriter",
	"discoveryAgent",
]);

/** Result from running pi subprocess */
export interface PiRunResult {
	/** Exit code from subprocess */
	exitCode: number;
	/** Captured metrics */
	metrics: AgentMetrics;
	/** Accumulated output text */
	output: string;
	/** Stderr output (if any) */
	stderr: string;
	/** Whether the run was aborted */
	aborted: boolean;
}

export interface PiRunOptions {
	/** Model configuration */
	modelConfig: ModelConfig;
	/** Task prompt */
	task: string;
	/** Working directory */
	cwd: string;
	/** System prompt content */
	systemPrompt: string;
	/** Role name (for tool restrictions and metrics) */
	role: string;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
	/** Callback for output text as it streams */
	onOutput?: (text: string) => void;
	/** Timeout in milliseconds */
	timeoutMs?: number;
}

// ============================================
// Pi Runner
// ============================================

/**
 * Run pi subprocess and capture metrics from JSON output
 */
export async function runPiWithMetrics(options: PiRunOptions): Promise<PiRunResult> {
	const {
		modelConfig,
		task,
		cwd,
		systemPrompt,
		role,
		signal,
		onOutput,
		timeoutMs,
	} = options;
	
	// Build arguments
	const args: string[] = [
		"--mode", "json",
		"-p",
		"--no-session",
		"--model", MODEL_IDENTIFIERS[modelConfig.model] || modelConfig.model,
		"--thinking", modelConfig.thinking,
	];
	
	// Restrict tools based on role
	if (READ_ONLY_ROLES.has(role)) {
		args.push("--tools", "read,bash,grep,find,ls");
	} else {
		args.push("--tools", "read,bash,edit,write,grep,find,ls");
	}
	
	// Write system prompt to temp file
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-bench-"));
	const promptPath = path.join(tmpDir, "system.md");
	fs.writeFileSync(promptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	args.push("--append-system-prompt", promptPath);
	
	// Add task
	args.push(task);
	
	// Initialize metrics accumulator
	const accumulator = new MetricsAccumulator();
	let stderr = "";
	let proc: ChildProcess | null = null;
	let aborted = false;
	let timeoutHandle: NodeJS.Timeout | null = null;
	
	try {
		const exitCode = await new Promise<number>((resolve) => {
			proc = spawn("pi", args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			
			let buffer = "";
			
			const processLine = (line: string) => {
				const delta = accumulator.processLine(line);
				if (delta && onOutput) {
					onOutput(delta);
				}
			};
			
			proc.stdout?.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					processLine(line);
				}
			});
			
			proc.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			
			proc.on("close", (code) => {
				// Process any remaining buffer
				if (buffer.trim()) {
					processLine(buffer);
				}
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				resolve(code ?? 0);
			});
			
			proc.on("error", (err) => {
				stderr += `Process error: ${err.message}`;
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				resolve(1);
			});
			
			// Handle abort signal
			if (signal) {
				const killProc = () => {
					aborted = true;
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 5000);
				};
				
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", killProc, { once: true });
				}
			}
			
			// Handle timeout
			if (timeoutMs && timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					aborted = true;
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 5000);
				}, timeoutMs);
			}
		});
		
		// Finalize metrics
		const metrics = accumulator.finalize(role, modelConfig.model, modelConfig.thinking);
		
		return {
			exitCode,
			metrics,
			output: accumulator.getOutput(),
			stderr,
			aborted,
		};
	} finally {
		// Cleanup temp files
		try {
			fs.unlinkSync(promptPath);
			fs.rmdirSync(tmpDir);
		} catch {
			/* ignore cleanup errors */
		}
	}
}

/**
 * Check if pi is available in PATH
 */
export async function checkPiAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("pi", ["--version"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
}
