/**
 * Agent execution for the spec pipeline
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
	ModelConfig,
	AgentResult,
	AgentOutputEvent,
	ToolEventData,
	PipelineUIContext,
	ImplementationState,
	SpecState,
} from "./types.ts";
import { READ_ONLY_ROLES, WRITE_ROLES } from "./types.ts";
import { updateImplWidget, updateSpecWidget } from "./formatting.ts";

// ============================================
// Progress Display Constants
// ============================================

/**
 * Emoji mapping for tool operations (R6)
 * Used by progress callbacks to format user-friendly notifications
 */
const TOOL_EMOJI: Record<string, string> = {
	read: "📖",
	write: "✍️",
	edit: "✏️",
	bash: "⚙️",
	grep: "🔍",
	find: "🔎",
};

/**
 * Default emoji for unknown tool types
 */
const DEFAULT_TOOL_EMOJI = "🔧";

// ============================================
// Progress Callback Factory
// ============================================

/**
 * Create a progress callback for agent execution (R5-R21)
 * 
 * The callback formats tool invocations into user-friendly messages and
 * updates the pipeline widget in real-time. Also prints to terminal for permanent history.
 * 
 * @param ctx - UI context with notify and setWidget functions
 * @param state - Current implementation or spec state (for widget updates)
 * @param phaseInfo - Human-readable phase context (e.g., "Phase 2/3", "Review Cycle 1")
 * @param isImplPipeline - True for implementation widget, false for spec widget
 * @returns Callback function that handles AgentOutputEvent
 * 
 * @example
 * ```typescript
 * const callback = createProgressCallback(
 *   ctx,
 *   state,
 *   "Phase 2/3",
 *   true
 * );
 * await runAgentWithConfig(
 *   config, task, cwd, systemPrompt,
 *   undefined, callback, "implementer"
 * );
 * ```
 */
export function createProgressCallback(
	ctx: PipelineUIContext,
	state: ImplementationState | SpecState,
	phaseInfo: string,
	isImplPipeline: boolean = true
): (event: AgentOutputEvent) => void {
	return (event: AgentOutputEvent) => {
		// Handle legacy text deltas (ignore for progress display)
		if (typeof event === "string") {
			return;
		}
		
		// Handle structured text events (ignore for progress display)
		if (event.type === "text") {
			return;
		}
		
		// Handle tool invocation events (R2, R3, R4)
		if (event.type === "tool") {
			const emoji = TOOL_EMOJI[event.name] || DEFAULT_TOOL_EMOJI;
			let message = "";
			
			// Format message based on tool type (R7)
			if (event.name === "read" && event.arguments?.path) {
				// Read: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Reading ${path}`;
			} else if (event.name === "write" && event.arguments?.path) {
				// Write: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Creating ${path}`;
			} else if (event.name === "edit" && event.arguments?.path) {
				// Edit: show file path (R7)
				const path = formatPath(event.arguments.path);
				message = `${emoji} Editing ${path}`;
			} else if (event.name === "bash" && event.arguments?.command) {
				// Bash: show truncated command (R7, R9)
				const cmd = event.arguments.command;
				const truncated = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
				message = `${emoji} Running: ${truncated}`;
			} else if (event.name === "grep" && event.arguments?.pattern) {
				// Grep: show pattern and optional path (R7)
				const pattern = event.arguments.pattern;
				const pathPart = event.arguments.path ? ` in ${formatPath(event.arguments.path)}` : "";
				message = `${emoji} Searching ${pattern}${pathPart}`;
			} else if (event.name === "find" && event.arguments?.pattern) {
				// Find: show pattern (R7)
				const pattern = event.arguments.pattern;
				message = `${emoji} Finding ${pattern}`;
			}
			
			// If we successfully formatted a message, update the widget and print to history
			if (message) {
				// Add phase context (R21)
				const contextualMessage = `${message} [${phaseInfo}]`;
				
				// Update widget with current action (R13, R14, R15)
				if (isImplPipeline) {
					updateImplWidget(ctx, state as ImplementationState, contextualMessage);
				} else {
					updateSpecWidget(ctx, state as SpecState, contextualMessage);
				}
				
				// Notify UI and print to terminal for permanent history
				ctx.ui.notify(contextualMessage, "info");
				console.log(`  ${contextualMessage}`);
			}
		}
	};
}

/**
 * Format file path for display (R8)
 * Strips leading ./ and returns relative path
 */
function formatPath(path: string): string {
	if (path.startsWith("./")) {
		return path.slice(2);
	}
	return path;
}

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
	onOutput?: (event: AgentOutputEvent) => void,
	role?: string
): Promise<AgentResult> {
	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		modelConfig.model,
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
					
					// Handle text delta events (for output accumulation and legacy callbacks)
					if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
						const delta = event.assistantMessageEvent.delta;
						output += delta;
						
						// Call onOutput with text delta (backward compatibility)
						// Legacy callers expect strings, new callers can handle TextEventData
						if (onOutput) {
							onOutput(delta);
						}
					}
					
					// Handle tool call events (for progress visibility)
					if (event.type === "message_update" && event.assistantMessageEvent?.type === "toolcall_end") {
						const toolCall = event.assistantMessageEvent?.toolCall;
						
						// Gracefully handle missing fields
						if (toolCall && toolCall.name && toolCall.arguments) {
							const toolEvent: ToolEventData = {
								type: "tool",
								name: toolCall.name,
								arguments: toolCall.arguments,
							};
							
							// Call onOutput with structured tool data
							if (onOutput) {
								onOutput(toolEvent);
							}
						}
					}
				} catch {
					// Ignore parse errors (malformed JSON, incomplete events)
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


