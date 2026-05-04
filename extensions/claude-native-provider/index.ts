import {
	type Api,
	type AssistantMessage,
	AssistantMessageEventStream,
	calculateCost,
	type Context,
	type Message,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ClaudeTurnError } from "./claude-process.ts";
import { ClaudeNativeProcessPool } from "./claude-pool.ts";
import { type ClaudeUserBlock, numberFromEnv } from "./claude-protocol.ts";

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
 * - CLAUDE_NATIVE_EFFORT: low | medium | high | xhigh | max (global fallback; pi's thinking level takes precedence)
 * - CLAUDE_NATIVE_TIMEOUT_MS: terminate an active request after this many ms (default: no timeout)
 * - CLAUDE_NATIVE_IDLE_TIMEOUT_MS: terminate idle long-lived process after this many ms (default: 600000)
 * - CLAUDE_NATIVE_HEARTBEAT_MS: emit "still running" thinking ticks while the CLI is silent (default: 0/off)
 * - CLAUDE_NATIVE_HOST_COMPACTION=1: re-enable pi's host-side compaction while on a claude-native
 *   model (disabled by default because the Claude CLI manages its own session context, so pi's
 *   summary is never sent to Claude and only burns tokens)
 */

const PROVIDER = "claude-native";
const API = "claude-native-cli";

const processPool = new ClaudeNativeProcessPool();

function userBlocksFromContent(content: unknown): ClaudeUserBlock[] {
	const blocks: ClaudeUserBlock[] = [];
	if (typeof content === "string") {
		if (content) blocks.push({ type: "text", text: content });
		return blocks;
	}
	if (!Array.isArray(content)) return blocks;
	for (const part of content as any[]) {
		if (part?.type === "text" && typeof part.text === "string" && part.text) {
			blocks.push({ type: "text", text: part.text });
		} else if (part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
			blocks.push({
				type: "image",
				source: { type: "base64", media_type: part.mimeType, data: part.data },
			});
		}
	}
	return blocks;
}

function trailingUserStart(messages: Message[]): number {
	// pi-coding-agent's convertToLlm turns extension custom messages (e.g. spec-pipeline's
	// brainstorm/discovery context tag) into role:"user" entries appended after the real
	// user input, so taking only the very last user message would drop the human's actual
	// text and leave Claude with just the mode tag.
	let start = messages.length;
	while (start > 0 && messages[start - 1].role === "user") start--;
	return start;
}

function trailingUserContent(messages: Message[], start: number): ClaudeUserBlock[] {
	const blocks: ClaudeUserBlock[] = [];
	for (let i = start; i < messages.length; i++) {
		blocks.push(...userBlocksFromContent(messages[i].content));
	}
	return blocks;
}

function renderToolCall(call: any): string {
	const name = typeof call?.name === "string" ? call.name : "tool";
	const args = call?.arguments ?? call?.input;
	if (args && typeof args === "object" && !Array.isArray(args)) {
		const keys = Object.keys(args);
		if (keys.length === 0) return name;
		const preview = keys.slice(0, 2).map((key) => {
			const raw = args[key];
			const str = typeof raw === "string" ? raw : JSON.stringify(raw);
			const value = str ?? "";
			const truncated = value.length > 80 ? `${value.slice(0, 77)}...` : value;
			return `${key}=${truncated}`;
		}).join(", ");
		const suffix = keys.length > 2 ? `, +${keys.length - 2} more` : "";
		return `${name}(${preview}${suffix})`;
	}
	return name;
}

function renderAssistantTranscript(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content as any[]) {
		if (part?.type === "text" && typeof part.text === "string" && part.text) {
			parts.push(part.text);
		} else if (part?.type === "toolCall" || part?.type === "tool_use") {
			parts.push(`[tool: ${renderToolCall(part)}]`);
		}
	}
	return parts.join("\n");
}

function renderToolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content as any[]) {
		if (part?.type === "text" && typeof part.text === "string" && part.text) parts.push(part.text);
		else if (part?.type === "image") parts.push("[image]");
	}
	return parts.join("\n");
}

function escapeXmlAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function priorHistoryBlocks(messages: Message[], end: number): ClaudeUserBlock[] {
	if (end <= 0) return [];
	const pieces: ClaudeUserBlock[] = [];
	pieces.push({
		type: "text",
		text: "[Replayed conversation history follows. This is the prior dialogue that led to the user's next message; treat it as already-said context, not as new requests.]\n\n",
	});

	let sawAny = false;
	for (let i = 0; i < end; i++) {
		const msg = messages[i];
		if (msg.role === "user") {
			const userBlocks = userBlocksFromContent(msg.content);
			if (userBlocks.length === 0) continue;
			sawAny = true;
			pieces.push({ type: "text", text: "<user>\n" });
			for (const block of userBlocks) {
				if (block.type === "text") {
					pieces.push({ type: "text", text: block.text.endsWith("\n") ? block.text : `${block.text}\n` });
				} else {
					pieces.push(block);
				}
			}
			pieces.push({ type: "text", text: "</user>\n\n" });
		} else if (msg.role === "assistant") {
			const text = renderAssistantTranscript(msg.content);
			if (!text) continue;
			sawAny = true;
			pieces.push({ type: "text", text: `<assistant>\n${text}\n</assistant>\n\n` });
		} else if (msg.role === "toolResult") {
			const text = renderToolResultText(msg.content);
			if (!text) continue;
			sawAny = true;
			const errAttr = msg.isError ? ' error="true"' : "";
			const nameAttr = ` tool="${escapeXmlAttr(msg.toolName ?? "")}"`;
			pieces.push({ type: "text", text: `<tool_result${nameAttr}${errAttr}>\n${text}\n</tool_result>\n\n` });
		}
	}

	if (!sawAny) return [];
	pieces.push({ type: "text", text: "[End of replayed history. The user's next message follows.]\n\n" });

	const coalesced: ClaudeUserBlock[] = [];
	for (const block of pieces) {
		const prev = coalesced[coalesced.length - 1];
		if (block.type === "text" && prev && prev.type === "text") {
			prev.text += block.text;
		} else {
			coalesced.push(block);
		}
	}
	return coalesced;
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

function appendThinking(stream: AssistantMessageEventStream, output: AssistantMessage, thinking: string) {
	if (!thinking) return;
	const contentIndex = output.content.length;
	output.content.push({ type: "thinking", thinking: "" });
	stream.push({ type: "thinking_start", contentIndex, partial: output });
	(output.content[contentIndex] as { type: "thinking"; thinking: string }).thinking += thinking;
	stream.push({ type: "thinking_delta", contentIndex, delta: thinking, partial: output });
	stream.push({ type: "thinking_end", contentIndex, content: thinking, partial: output });
}

function appendStatus(stream: AssistantMessageEventStream, output: AssistantMessage, status: string, active = false) {
	if (!status || !active || process.env.CLAUDE_NATIVE_STATUS_UPDATES === "0") return;
	appendThinking(stream, output, status);
}

function formatToolUse(block: any): string {
	const name = typeof block.name === "string" ? block.name : "tool";
	const input = block.input;
	if (input && typeof input === "object" && !Array.isArray(input)) {
		const keys = Object.keys(input);
		if (keys.length === 0) return name;
		const preview = keys.slice(0, 2).map((key) => {
			const raw = input[key];
			const str = typeof raw === "string" ? raw : JSON.stringify(raw);
			const value = str ?? "";
			const truncated = value.length > 80 ? `${value.slice(0, 77)}...` : value;
			return `${key}=${truncated}`;
		}).join(", ");
		const suffix = keys.length > 2 ? `, +${keys.length - 2} more` : "";
		return `${name}(${preview}${suffix})`;
	}
	return name;
}

function appendAssistantBlocks(stream: AssistantMessageEventStream, output: AssistantMessage, message: any, showThinking: boolean): boolean {
	const content = message?.message?.content;
	if (!Array.isArray(content)) return false;
	let saw = false;
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string" && block.text) {
			appendText(stream, output, block.text);
			saw = true;
		} else if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
			if (showThinking) {
				appendThinking(stream, output, block.thinking);
				saw = true;
			}
		} else if (block?.type === "tool_use") {
			appendText(stream, output, `\n[Claude Code: ${formatToolUse(block)}]\n`);
			saw = true;
		}
	}
	return saw;
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

function turnErrorCode(err: unknown): string | undefined {
	return err instanceof ClaudeTurnError ? err.code : undefined;
}

function turnErrorUnsafeSession(err: unknown): boolean {
	return err instanceof ClaudeTurnError && err.unsafeSession;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function streamClaudeNative(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const output = makeEmptyMessage(model);
	stream.push({ type: "start", partial: output });

	const start = trailingUserStart(context.messages);
	const userContent = trailingUserContent(context.messages, start);
	const poolEntry = processPool.getOrCreate(model, options);
	const { key, process: runtime, created, resumedClaudeSession } = poolEntry;

	// On a brand-new Claude session (not a --resume), prepend the pi system prompt and any
	// prior conversation history to the first user message. The system prompt carries
	// mode-specific instructions (e.g. discovery mode injected by spec-pipeline via
	// before_agent_start). The history replay is what restores chat context after pi
	// invalidates the Claude session — e.g. /tree, /fork, /switch, or compaction — so
	// Claude doesn't see only the user's newest message divorced from what came before.
	// Once present in turn 1, the Claude CLI's own session history carries them forward.
	const isFreshSession = created && !resumedClaudeSession;
	const preamble: ClaudeUserBlock[] = [];
	if (isFreshSession && context.systemPrompt?.trim()) {
		preamble.push({ type: "text", text: context.systemPrompt.trim() + "\n\n" });
	}
	if (isFreshSession) {
		preamble.push(...priorHistoryBlocks(context.messages, start));
	}
	const prompt = preamble.length ? [...preamble, ...userContent] : userContent;

	let stderr = "";
	let sawText = false;
	let finalResult = "";
	let finished = false;
	let lastActivity = Date.now();
	const thinkingActive = !!options?.reasoning;

	appendStatus(
		stream,
		output,
		poolEntry.created
			? `Claude Code process started (${poolEntry.resumedClaudeSession ? "resuming prior Claude session" : "fresh session"}; model=${key.modelAlias})`
			: `Claude Code process reused (model=${key.modelAlias})`,
		thinkingActive,
	);
	const heartbeatMs = numberFromEnv("CLAUDE_NATIVE_HEARTBEAT_MS", 0);
	let heartbeatIndex: number | undefined;
	let heartbeatText = "";
	const tickHeartbeat = () => {
		if (finished) return;
		if (!thinkingActive || process.env.CLAUDE_NATIVE_STATUS_UPDATES === "0") return;
		const idleSeconds = Math.max(1, Math.round((Date.now() - lastActivity) / 1000));
		if (heartbeatIndex === undefined) {
			heartbeatText = `Claude Code still running (${idleSeconds}s since last CLI event)`;
			heartbeatIndex = output.content.length;
			output.content.push({ type: "thinking", thinking: "" });
			stream.push({ type: "thinking_start", contentIndex: heartbeatIndex, partial: output });
			(output.content[heartbeatIndex] as { type: "thinking"; thinking: string }).thinking = heartbeatText;
			stream.push({ type: "thinking_delta", contentIndex: heartbeatIndex, delta: heartbeatText, partial: output });
			return;
		}
		const delta = ` · ${idleSeconds}s`;
		(output.content[heartbeatIndex] as { type: "thinking"; thinking: string }).thinking += delta;
		heartbeatText += delta;
		stream.push({ type: "thinking_delta", contentIndex: heartbeatIndex, delta, partial: output });
	};
	const closeHeartbeat = () => {
		if (heartbeatIndex === undefined) return;
		stream.push({ type: "thinking_end", contentIndex: heartbeatIndex, content: heartbeatText, partial: output });
		heartbeatIndex = undefined;
	};
	const heartbeatHandle = heartbeatMs > 0 ? setInterval(tickHeartbeat, heartbeatMs) : undefined;
	heartbeatHandle?.unref?.();

	const finishDone = () => {
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		closeHeartbeat();
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

	const finishError = (message: string, reason: "aborted" | "error" = "error") => {
		if (heartbeatHandle) clearInterval(heartbeatHandle);
		closeHeartbeat();
		if (finished) return;
		finished = true;
		output.stopReason = reason;
		output.errorMessage = message;
		stream.push({ type: "error", reason, error: output });
		stream.end();
	};

	const configuredTimeoutMs = numberFromEnv("CLAUDE_NATIVE_TIMEOUT_MS");
	const timeoutMs = configuredTimeoutMs && configuredTimeoutMs > 0 ? configuredTimeoutMs : undefined;

	runtime.runTurn(prompt, {
		onMessage: (msg) => {
			lastActivity = Date.now();
			if (typeof msg.session_id === "string") processPool.rememberClaudeSessionId(key, msg.session_id);
			if (msg.type === "rate_limit_event") {
				const resumeAt = msg.rate_limit_resets_at ?? msg.retry_after_ms ?? msg.retry_after;
				const detail = resumeAt ? ` (resets at ${resumeAt})` : "";
				appendStatus(stream, output, `Claude Code rate limited${detail}`, thinkingActive);
			} else if (typeof msg.type === "string" && msg.type !== "assistant" && msg.type !== "result" && msg.type !== "system" && msg.type !== "init" && msg.type !== "user") {
				appendStatus(stream, output, `Claude Code event: ${msg.type}`, thinkingActive);
			}

			if (msg.type === "assistant") {
				if (appendAssistantBlocks(stream, output, msg, thinkingActive)) sawText = true;
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
				if (output.stopReason !== "error") {
					if (msg.stop_reason === "max_tokens") output.stopReason = "length";
					else if (msg.stop_reason === "tool_use") output.stopReason = "toolUse";
				}
				updateUsageFromResult(model, output, msg);
			}
		},
		onMalformedJson: (line) => appendStatus(stream, output, `Claude Code malformed JSON: ${line.slice(0, 200)}`, thinkingActive),
		onStderr: (text) => {
			lastActivity = Date.now();
			stderr += text;
			const lines = text.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
			for (const line of lines) appendStatus(stream, output, `Claude Code stderr: ${line}`, thinkingActive);
		},
		onStatus: (status) => appendStatus(stream, output, status, thinkingActive),
	}, {
		signal: options?.signal,
		timeoutMs,
	}).then(finishDone, (err) => {
		const message = errorMessage(err);
		processPool.invalidateKey(key, `request failed: ${message}`, { clearSession: turnErrorUnsafeSession(err) });
		const reason = options?.signal?.aborted || turnErrorCode(err) === "aborted" ? "aborted" : "error";
		finishError(message, reason);
	});

	return stream;
}

function firstCommandArg(args: unknown): string | undefined {
	if (Array.isArray(args)) return args.length ? String(args[0]) : undefined;
	if (typeof args === "string") return args.trim().split(/\s+/).filter(Boolean)[0];
	return undefined;
}

function formatPoolStatus(): string {
	const stats = processPool.stats();
	const snapshots = processPool.snapshots();
	const lines = [
		`Claude native pool: ${stats.liveProcesses} live process(es), ${stats.rememberedSessions} remembered Claude session(s), ${stats.totalKeys} key(s).`,
	];
	if (!snapshots.length) {
		lines.push("No Claude native process/session state is currently remembered.");
		return lines.join("\n");
	}
	for (const snapshot of snapshots) {
		lines.push(
			`- model=${snapshot.key.modelAlias} effort=${snapshot.key.effort} live=${snapshot.live ? "yes" : "no"} `
			+ `piSession=${snapshot.key.sessionIdentity} claudeSession=${snapshot.claudeSessionId ? "remembered" : "none"} `
			+ `cwd=${snapshot.key.cwd}`,
		);
	}
	return lines.join("\n");
}

function registerLifecycleInvalidationHandlers(pi: ExtensionAPI): void {
	const hardInvalidate = (reason: string) => processPool.hardInvalidateAll(reason);

	pi.on("session_before_tree", async (event) => {
		hardInvalidate(`session_before_tree target=${event.preparation.targetId}`);
	});
	pi.on("session_tree", async (event) => {
		hardInvalidate(`session_tree ${event.oldLeafId ?? "root"} -> ${event.newLeafId ?? "root"}`);
	});

	pi.on("session_before_fork", async (event) => {
		hardInvalidate(`session_before_fork entry=${event.entryId}`);
	});
	pi.on("session_fork", async () => {
		hardInvalidate("session_fork");
	});

	pi.on("session_before_switch", async (event) => {
		hardInvalidate(`session_before_switch reason=${event.reason}`);
	});
	pi.on("session_switch", async (event) => {
		hardInvalidate(`session_switch reason=${event.reason}`);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		if (ctx?.model?.provider === PROVIDER && process.env.CLAUDE_NATIVE_HOST_COMPACTION !== "1") {
			return { cancel: true };
		}
		hardInvalidate("session_before_compact");
	});
	pi.on("session_compact", async () => {
		hardInvalidate("session_compact");
	});

	pi.on("model_select", async (event) => {
		// Model is part of the process key, not the Claude conversation key.
		// Keep existing model processes warm; the next turn on the selected model
		// will create/reuse its own process while resuming the same Claude session.
		void event;
	});

	pi.on("session_shutdown", async () => {
		hardInvalidate("session_shutdown");
	});
}

export default function (pi: ExtensionAPI) {
	(pi as any).registerProvider(PROVIDER, {
		name: "Claude Native (claude -p)",
		baseUrl: "process:claude",
		apiKey: "unused",
		api: API,
		models: [
			{
				id: "haiku",
				name: "Claude Native Haiku",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
				contextWindow: 200_000,
				maxTokens: 8_192,
			},
			{
				id: "sonnet",
				name: "Claude Native Sonnet",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200_000,
				maxTokens: 16_384,
			},
			{
				id: "opus",
				name: "Claude Native Opus",
				reasoning: true,
				input: ["text", "image"],
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
			const before = processPool.reset("reset command");
			ctx.ui.notify(
				`Claude native process/session state reset: terminated ${before.liveProcesses} live process(es), cleared ${before.rememberedSessions} remembered Claude session(s).`,
				"info",
			);
		},
	});

	pi.registerCommand("claude-native-status", {
		description: "Show Claude native process pool diagnostics",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatPoolStatus(), "info");
		},
	});

	registerLifecycleInvalidationHandlers(pi);
}
