import type { Api, Model } from "@mariozechner/pi-ai";

export function modelAlias(id: string): string {
	if (id.includes("opus")) return "opus";
	if (id.includes("haiku")) return "haiku";
	return "sonnet";
}

export function numberFromEnv(name: string, fallback: number, env?: NodeJS.ProcessEnv): number;
export function numberFromEnv(name: string, fallback?: undefined, env?: NodeJS.ProcessEnv): number | undefined;
export function numberFromEnv(name: string, fallback?: number, env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"]);

export function parseEffort(value: string | undefined | null): ClaudeEffort | undefined {
	const raw = value?.trim().toLowerCase();
	return raw && CLAUDE_EFFORTS.has(raw as ClaudeEffort) ? raw as ClaudeEffort : undefined;
}

export function effortFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeEffort | undefined {
	return parseEffort(env.CLAUDE_NATIVE_EFFORT);
}

export function effortFromThinkingLevel(level: string | undefined | null): ClaudeEffort | undefined {
	switch (level?.trim().toLowerCase()) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "xhigh";
		default:
			return undefined;
	}
}

export interface ClaudeArgsOptions {
	sessionId?: string;
	isFirstSessionUse?: boolean;
	env?: NodeJS.ProcessEnv;
	effort?: ClaudeEffort;
	disableThinking?: boolean;
}

export function buildClaudeArgs(model: Model<Api>, sessionIdOrOptions?: string | ClaudeArgsOptions): string[] {
	const options: ClaudeArgsOptions = typeof sessionIdOrOptions === "string"
		? { sessionId: sessionIdOrOptions, isFirstSessionUse: false }
		: sessionIdOrOptions ?? {};
	const env = options.env ?? process.env;
	const args = [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--model",
		modelAlias(model.id),
	];

	const effort = options.effort ?? effortFromEnv(env);
	if (effort) args.push("--effort", effort);
	if (options.disableThinking) args.push("--thinking", "disabled");

	if (options.sessionId && env.CLAUDE_NATIVE_NO_RESUME !== "1") {
		args.push(options.isFirstSessionUse ? "--session-id" : "--resume", options.sessionId);
	}

	const permissionMode = env.CLAUDE_NATIVE_PERMISSION_MODE ?? "bypassPermissions";
	if (permissionMode && permissionMode !== "none") args.push("--permission-mode", permissionMode);

	const allowedTools = env.CLAUDE_NATIVE_ALLOWED_TOOLS;
	if (allowedTools) args.push("--allowedTools", allowedTools);

	const maxTurns = env.CLAUDE_NATIVE_MAX_TURNS;
	if (maxTurns) args.push("--max-turns", maxTurns);

	return args;
}

export type ClaudeUserBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ClaudeUserContent = string | ClaudeUserBlock[];

export function encodeUserInput(content: ClaudeUserContent): string {
	const blocks: ClaudeUserBlock[] = typeof content === "string"
		? [{ type: "text", text: content }]
		: content;
	return JSON.stringify({
		type: "user",
		message: {
			role: "user",
			content: blocks,
		},
	}) + "\n";
}

export function isClaudeResultEvent(message: any): boolean {
	return message?.type === "result";
}
