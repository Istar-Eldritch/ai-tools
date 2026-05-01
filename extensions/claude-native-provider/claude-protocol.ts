import type { Api, Model } from "@mariozechner/pi-ai";

export function modelAlias(id: string): string {
	if (id.includes("opus")) return "opus";
	if (id.includes("haiku")) return "haiku";
	return "sonnet";
}

export function numberFromEnv(name: string, fallback?: number): number | undefined {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

export function buildClaudeArgs(model: Model<Api>, sessionId?: string): string[] {
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

	if (sessionId && process.env.CLAUDE_NATIVE_NO_RESUME !== "1") {
		args.push("--resume", sessionId);
	}

	const permissionMode = process.env.CLAUDE_NATIVE_PERMISSION_MODE ?? "auto";
	if (permissionMode && permissionMode !== "none") args.push("--permission-mode", permissionMode);

	const allowedTools = process.env.CLAUDE_NATIVE_ALLOWED_TOOLS;
	if (allowedTools) args.push("--allowedTools", allowedTools);

	const maxTurns = process.env.CLAUDE_NATIVE_MAX_TURNS;
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
