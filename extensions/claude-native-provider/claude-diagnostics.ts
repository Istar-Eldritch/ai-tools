export function isClaudeNativeDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env.CLAUDE_NATIVE_DEBUG ?? env.CLAUDE_NATIVE_DIAGNOSTICS;
	return raw === "1" || raw?.toLowerCase() === "true";
}

export function redactSessionId(sessionId: string | undefined): string | undefined {
	if (!sessionId) return undefined;
	if (sessionId.length <= 8) return "***";
	return `${sessionId.slice(0, 4)}…${sessionId.slice(-4)}`;
}

export function redactClaudeArgs(args: string[]): string[] {
	const redacted = [...args];
	for (let i = 0; i < redacted.length - 1; i++) {
		if (redacted[i] === "--resume") redacted[i + 1] = redactSessionId(redacted[i + 1]) ?? "***";
	}
	return redacted;
}

export function logClaudeNativeDiagnostic(
	event: string,
	details: Record<string, unknown> = {},
	env: NodeJS.ProcessEnv = process.env,
): void {
	if (!isClaudeNativeDebugEnabled(env)) return;
	const filtered = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
	try {
		const suffix = Object.keys(filtered).length ? ` ${JSON.stringify(filtered)}` : "";
		console.error(`[claude-native] ${event}${suffix}`);
	} catch {
		console.error(`[claude-native] ${event}`);
	}
}
