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
import { spawn } from "node:child_process";
import readline from "node:readline";

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
 * - CLAUDE_NATIVE_TIMEOUT_MS: kill subprocess after this many ms (default: no timeout)
 */

const PROVIDER = "claude-native";
const API = "claude-native-cli";

let claudeSessionId: string | undefined;

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

function modelAlias(id: string): string {
	if (id.includes("opus")) return "opus";
	if (id.includes("haiku")) return "haiku";
	return "sonnet";
}

function buildArgs(model: Model<Api>): string[] {
	const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", modelAlias(model.id)];

	if (claudeSessionId && process.env.CLAUDE_NATIVE_NO_RESUME !== "1") {
		args.push("--resume", claudeSessionId);
	}

	const permissionMode = process.env.CLAUDE_NATIVE_PERMISSION_MODE ?? "auto";
	if (permissionMode && permissionMode !== "none") args.push("--permission-mode", permissionMode);

	const allowedTools = process.env.CLAUDE_NATIVE_ALLOWED_TOOLS;
	if (allowedTools) args.push("--allowedTools", allowedTools);

	const maxTurns = process.env.CLAUDE_NATIVE_MAX_TURNS;
	if (maxTurns) args.push("--max-turns", maxTurns);

	return args;
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
	const bin = process.env.CLAUDE_NATIVE_BIN || "claude";
	const args = buildArgs(model);

	const child = spawn(bin, args, {
		cwd: process.cwd(),
		stdio: ["pipe", "pipe", "pipe"],
		env: process.env,
	});

	let stderr = "";
	let sawText = false;
	let finalResult = "";
	let finished = false;
	let lastActivity = Date.now();

	const timeoutMs = process.env.CLAUDE_NATIVE_TIMEOUT_MS ? Number(process.env.CLAUDE_NATIVE_TIMEOUT_MS) : undefined;
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	if (timeoutMs && timeoutMs > 0) {
		timeoutHandle = setTimeout(() => {
			try { child.kill("SIGTERM"); } catch { /* ignore */ }
			finishError(`Claude Code timed out after ${timeoutMs}ms`);
		}, timeoutMs);
		timeoutHandle.unref?.();
	}

	appendStatus(stream, output, `Claude Code started (${bin} ${args.join(" ")})`);
	const heartbeatMs = process.env.CLAUDE_NATIVE_HEARTBEAT_MS ? Number(process.env.CLAUDE_NATIVE_HEARTBEAT_MS) : 10_000;
	const heartbeatHandle = heartbeatMs > 0 ? setInterval(() => {
		if (finished) return;
		const idleSeconds = Math.max(1, Math.round((Date.now() - lastActivity) / 1000));
		appendStatus(stream, output, `Claude Code still running (${idleSeconds}s since last CLI event)`);
	}, heartbeatMs) : undefined;
	heartbeatHandle?.unref?.();

	const finishError = (errorMessage: string) => {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		if (finished) return;
		finished = true;
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = errorMessage;
		stream.push({ type: "error", reason: output.stopReason, error: output });
		stream.end();
	};

	options?.signal?.addEventListener("abort", () => {
		try {
			child.kill("SIGINT");
			setTimeout(() => child.kill("SIGTERM"), 1500).unref?.();
		} catch {
			// ignore
		}
	});

	child.on("error", (err) => finishError(`Failed to spawn ${bin}: ${err.message}`));

	child.stderr.on("data", (chunk) => {
		lastActivity = Date.now();
		const text = chunk.toString();
		stderr += text;
		const lines = text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
		for (const line of lines) appendStatus(stream, output, `Claude Code stderr: ${line}`);
	});

	const rl = readline.createInterface({ input: child.stdout });
	rl.on("line", (line) => {
		if (!line.trim()) return;
		lastActivity = Date.now();
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

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
	});

	child.on("close", (code) => {
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		if (finished) return;
		finished = true;

		if (output.stopReason === "error" || code !== 0) {
			if (!output.errorMessage) output.errorMessage = stderr.trim() || `Claude Code exited with code ${code}`;
			stream.push({ type: "error", reason: output.stopReason === "aborted" ? "aborted" : "error", error: output });
			stream.end();
			return;
		}

		if (!sawText && finalResult) appendText(stream, output, finalResult);
		stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
		stream.end();
	});

	child.stdin.end(prompt);
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
		description: "Forget the remembered Claude Code --resume session id",
		handler: async (_args, ctx) => {
			claudeSessionId = undefined;
			ctx.ui.notify("Claude native session id cleared", "info");
		},
	});
}
