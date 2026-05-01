import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	calculateCost,
	createAssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ClaudeNativeProcess } from "./claude-process.ts";
import { buildClaudeArgs, modelAlias, numberFromEnv } from "./claude-protocol.ts";

/**
 * Pi provider that delegates inference + tool execution to the official Claude Code CLI.
 *
 * This intentionally does NOT call Anthropic's private CCR/session APIs. It shells out to
 * `claude -p`, so auth/subscription behavior stays inside the native client.
 *
 * Environment knobs:
 * - CLAUDE_NATIVE_BIN: path/name of Claude Code binary (default: claude)
 * - CLAUDE_NATIVE_ALLOWED_TOOLS: comma/space separated allowlist passed to --allowedTools
 * - CLAUDE_NATIVE_PERMISSION_MODE: auto | default | acceptEdits | dontAsk | plan | bypassPermissions | none (default: auto)
 * - CLAUDE_NATIVE_MAX_TURNS: passed to --max-turns (default unset)
 * - CLAUDE_NATIVE_NO_RESUME=1: do not reuse the Claude Code session id between turns
 * - CLAUDE_NATIVE_TIMEOUT_MS: terminate an active request after this many ms (default: no timeout)
 * - CLAUDE_NATIVE_IDLE_TIMEOUT_MS: terminate idle long-lived process after this many ms (default: 600000)
 */

const PROVIDER = "claude-native";
const API = "claude-native-cli";

let claudeSessionId: string | undefined;
let activeProcess: ClaudeNativeProcess | undefined;
let activeProcessSignature: string | undefined;

function processSignature(model: Model<Api>): string {
	return `${modelAlias(model.id)}\0${process.cwd()}`;
}

function getClaudeProcess(model: Model<Api>): ClaudeNativeProcess {
	const signature = processSignature(model);
	if (activeProcess && activeProcessSignature !== signature) {
		activeProcess.terminate("model or cwd changed");
		activeProcess = undefined;
	}
	if (!activeProcess || !activeProcess.isLive()) {
		const bin = process.env.CLAUDE_NATIVE_BIN || "claude";
		const args = buildClaudeArgs(model, claudeSessionId);
		activeProcess = new ClaudeNativeProcess({
			bin,
			args,
			cwd: process.cwd(),
			env: process.env,
			idleTimeoutMs: numberFromEnv("CLAUDE_NATIVE_IDLE_TIMEOUT_MS", 600_000) ?? 600_000,
		});
		activeProcessSignature = signature;
	}
	return activeProcess;
}

function terminateActiveProcess(reason: string): void {
	activeProcess?.terminate(reason);
	activeProcess = undefined;
	activeProcessSignature = undefined;
}

function lastUserText(context: Context): string {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg.role !== "user") continue;
		if (typeof msg.content === "string") return msg.content;
		return msg.content
			.map((part) => {
				if (part.type === "text") return part.text;
				if (part.type === "image") return "[image omitted: claude-native provider currently supports text input only]";
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function makeEmptyMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function appendText(stream: AssistantMessageEventStream, output: AssistantMessage, text: string) {
	if (!text) return;
	const contentIndex = output.content.length;
	output.content.push({ type: "text", text: "" });
	stream.push({ type: "text_start", contentIndex, partial: output });
	(output.content[contentIndex] as { type: "text"; text: string }).text += text;
	stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
	stream.push({ type: "text_end", contentIndex, content: text, partial: output });
}

function appendStatus(stream: AssistantMessageEventStream, output: AssistantMessage, status: string) {
	if (!status || process.env.CLAUDE_NATIVE_STATUS_UPDATES === "0") return;
	const contentIndex = output.content.length;
	output.content.push({ type: "thinking", thinking: "" });
	stream.push({ type: "thinking_start", contentIndex, partial: output });
	(output.content[contentIndex] as { type: "thinking"; thinking: string }).thinking += status;
	stream.push({ type: "thinking_delta", contentIndex, delta: status, partial: output });
	stream.push({ type: "thinking_end", contentIndex, content: status, partial: output });
}

function extractAssistantText(message: any): string {
	const content = message?.message?.content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string") texts.push(block.text);
		if (block?.type === "thinking" && typeof block.thinking === "string") {
			// Pi can render thinking, but native stream-json usually emits final assistant
			// messages only. Keep thinking out of normal transcript for now.
		}
	}
	return texts.join("\n");
}

function updateUsageFromResult(model: Model<Api>, output: AssistantMessage, message: any) {
	const usage = message?.usage;
	if (!usage || typeof usage !== "object") return;

	output.usage.input = Number(usage.input_tokens ?? usage.input ?? 0);
	output.usage.output = Number(usage.output_tokens ?? usage.output ?? 0);
	output.usage.cacheRead = Number(usage.cache_read_input_tokens ?? usage.cacheRead ?? 0);
	output.usage.cacheWrite = Number(usage.cache_creation_input_tokens ?? usage.cacheWrite ?? 0);
	output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

export function streamClaudeNative(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output = makeEmptyMessage(model);
	stream.push({ type: "start", partial: output });

	const prompt = lastUserText(context);
	const runtime = getClaudeProcess(model);

	let stderr = "";
	let sawText = false;
	let finalResult = "";
	let finished = false;
	let lastActivity = Date.now();

	appendStatus(stream, output, "Claude Code process ready");
	const heartbeatMs = numberFromEnv("CLAUDE_NATIVE_HEARTBEAT_MS", 10_000) ?? 10_000;
	const heartbeatHandle = heartbeatMs > 0 ? setInterval(() => {
		if (finished) return;
		const idleSeconds = Math.max(1, Math.round((Date.now() - lastActivity) / 1000));
		appendStatus(stream, output, `Claude Code still running (${idleSeconds}s since last CLI event)`);
	}, heartbeatMs) : undefined;
	heartbeatHandle?.unref?.();

	const finishDone = () => {
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		if (finished) return;
		finished = true;
		if (output.stopReason === "error") {
			if (!output.errorMessage) output.errorMessage = stderr.trim() || "Claude Code returned an error";
			stream.push({ type: "error", reason: "error", error: output });
			stream.end();
			return;
		}
		if (!sawText && finalResult) appendText(stream, output, finalResult);
		stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
		stream.end();
	};

	const finishError = (errorMessage: string) => {
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		if (finished) return;
		finished = true;
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = errorMessage;
		stream.push({ type: "error", reason: output.stopReason, error: output });
		stream.end();
	};

	const configuredTimeoutMs = numberFromEnv("CLAUDE_NATIVE_TIMEOUT_MS");
	const timeoutMs = configuredTimeoutMs && configuredTimeoutMs > 0 ? configuredTimeoutMs : undefined;

	runtime.runTurn(prompt, {
		onMessage: (msg) => {
			lastActivity = Date.now();
			if (typeof msg.session_id === "string") claudeSessionId = msg.session_id;
			if (typeof msg.type === "string" && msg.type !== "assistant" && msg.type !== "result") {
				appendStatus(stream, output, `Claude Code event: ${msg.type}`);
			}

			if (msg.type === "assistant") {
				const text = extractAssistantText(msg);
				if (text) {
					sawText = true;
					appendText(stream, output, text);
				}
			} else if (msg.type === "streamlined_text" && typeof msg.text === "string") {
				sawText = true;
				appendText(stream, output, msg.text);
			} else if (msg.type === "streamlined_tool_use_summary" && typeof msg.tool_summary === "string") {
				// Surface tool activity as lightweight text for now. Later this can become a custom renderer/status update.
				appendText(stream, output, `\n[Claude Code: ${msg.tool_summary}]\n`);
			} else if (msg.type === "result") {
				if (typeof msg.result === "string") finalResult = msg.result;
				if (msg.is_error || msg.subtype !== "success") {
					output.stopReason = "error";
					output.errorMessage = Array.isArray(msg.errors) ? msg.errors.join("\n") : finalResult || "Claude Code returned an error";
				}
				if (msg.stop_reason === "max_tokens") output.stopReason = "length";
				else if (msg.stop_reason === "tool_use") output.stopReason = "toolUse";
				updateUsageFromResult(model, output, msg);
			}
		},
		onMalformedJson: (line) => appendStatus(stream, output, `Claude Code malformed JSON: ${line.slice(0, 200)}`),
		onStderr: (text) => {
			lastActivity = Date.now();
			stderr += text;
			const lines = text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
			for (const line of lines) appendStatus(stream, output, `Claude Code stderr: ${line}`);
		},
		onStatus: (status) => appendStatus(stream, output, status),
	}, {
		signal: options?.signal,
		timeoutMs,
	}).then(finishDone, (err) => finishError(err instanceof Error ? err.message : String(err)));

	return stream;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER, {
		name: "Claude Native (claude -p)",
		baseUrl: "process:claude",
		apiKey: "unused",
		api: API,
		models: [
			{
				id: "haiku",
				name: "Claude Native Haiku",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
				contextWindow: 200_000,
				maxTokens: 8_192,
			},
			{
				id: "sonnet",
				name: "Claude Native Sonnet",
				reasoning: true,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200_000,
				maxTokens: 16_384,
			},
			{
				id: "opus",
				name: "Claude Native Opus",
				reasoning: true,
				input: ["text"],
				cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		],
		streamSimple: streamClaudeNative,
	});

	pi.registerCommand("claude-native-reset", {
		description: "Reset Claude native process and remembered session state",
		handler: async (_args, ctx) => {
			terminateActiveProcess("reset command");
			claudeSessionId = undefined;
			ctx.ui.notify("Claude native process and session state reset", "info");
		},
	});

	pi.on("session_shutdown", async () => {
		terminateActiveProcess("session shutdown");
	});
}
