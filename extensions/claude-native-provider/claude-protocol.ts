import type { Api, Model } from "@mariozechner/pi-ai";

export function modelAlias(id: string): string {
	if (id.includes("opus")) return "opus";
	if (id.includes("haiku")) return "haiku";
	return "sonnet";
}

export function numberFromEnv(name: string, fallback?: number, env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "xhigh", "max"]);

export function effortFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeEffort | undefined {
	const raw = env.CLAUDE_NATIVE_EFFORT?.trim().toLowerCase();
	return raw && CLAUDE_EFFORTS.has(raw as ClaudeEffort) ? raw as ClaudeEffort : undefined;
}

export interface ClaudeArgsOptions {
	sessionId?: string;
	isFirstSessionUse?: boolean;
	env?: NodeJS.ProcessEnv;
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

	const effort = effortFromEnv(env);
	if (effort) args.push("--effort", effort);

	if (options.sessionId && env.CLAUDE_NATIVE_NO_RESUME !== "1") {
		args.push(options.isFirstSessionUse ? "--session-id" : "--resume", options.sessionId);
	}

	const permissionMode = env.CLAUDE_NATIVE_PERMISSION_MODE ?? "auto";
	if (permissionMode && permissionMode !== "none") args.push("--permission-mode", permissionMode);

	const allowedTools = env.CLAUDE_NATIVE_ALLOWED_TOOLS;
	if (allowedTools) args.push("--allowedTools", allowedTools);

	const maxTurns = env.CLAUDE_NATIVE_MAX_TURNS;
	if (maxTurns) args.push("--max-turns", maxTurns);

	return args;
}

export function encodeUserInput(text: string): string {
	return JSON.stringify({
		type: "user",
		message: {
			role: "user",
			content: [{ type: "text", text }],
		},
	}) + "\n";
}

export function isClaudeResultEvent(message: any): boolean {
	return message?.type === "result";
}
