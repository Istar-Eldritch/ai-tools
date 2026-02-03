/**
 * Agent execution for the spec pipeline
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
	ModelConfig,
	AgentName,
	AgentResult,
} from "./types.ts";
import { AGENTS, MODEL_IDENTIFIERS, READ_ONLY_ROLES, WRITE_ROLES } from "./types.ts";

// Re-export the AGENTS constant for legacy usage
export { AGENTS };

/**
 * Run a pi subprocess with explicit model configuration
 * This is the core agent runner that accepts ModelConfig directly.
 */
export async function runAgentWithConfig(
	modelConfig: ModelConfig,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (text: string) => void,
	role?: string
): Promise<AgentResult> {
	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		MODEL_IDENTIFIERS[modelConfig.model],
		"--thinking",
		modelConfig.thinking,
	];

	// Restrict tools based on role
	if (role && READ_ONLY_ROLES.has(role)) {
		args.push("--tools", "read,bash,grep,find,ls");
	} else if (role && WRITE_ROLES.has(role)) {
		args.push("--tools", "read,bash,edit,write,grep,find,ls");
	}

	// Write system prompt to temp file
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-pipeline-"));
	const promptPath = path.join(tmpDir, "system.md");
	fs.writeFileSync(promptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	args.push("--append-system-prompt", promptPath);

	args.push(task);

	let output = "";
	let error = "";
	let proc: ChildProcess | null = null;

	try {
		const exitCode = await new Promise<number>((resolve) => {
			proc = spawn("pi", args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line);
					if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
						output += event.assistantMessageEvent.delta;
						onOutput?.(event.assistantMessageEvent.delta);
					}
				} catch {
					// Ignore parse errors
				}
			};

			proc.stdout?.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr?.on("data", (data) => {
				error += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => resolve(1));

			if (signal) {
				const killProc = () => {
					proc?.kill("SIGTERM");
					setTimeout(() => {
						if (proc && !proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		return { output: output.trim(), exitCode, error: error || undefined };
	} finally {
		try {
			fs.unlinkSync(promptPath);
			fs.rmdirSync(tmpDir);
		} catch {
			/* ignore */
		}
	}
}

/**
 * Run a pi subprocess with specific agent configuration (legacy wrapper)
 * 
 * This is a convenience wrapper around runAgentWithConfig that looks up
 * the model configuration from the AGENTS constant by agent name.
 */
export async function runAgent(
	agentName: AgentName,
	task: string,
	cwd: string,
	systemPrompt: string,
	signal?: AbortSignal,
	onOutput?: (text: string) => void,
	role?: string
): Promise<AgentResult> {
	const config = AGENTS[agentName];
	// Create ModelConfig from AGENTS entry
	// agentName is "opus" | "sonnet" | "haiku" which matches ModelConfig.model
	const modelConfig: ModelConfig = {
		model: agentName,
		thinking: config.thinking as ModelConfig["thinking"],
	};
	return runAgentWithConfig(modelConfig, task, cwd, systemPrompt, signal, onOutput, role);
}
