import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { ClaudeNativeProcess, type ClaudeProcessConfig } from "./claude-process.ts";
import { buildClaudeArgs, modelAlias, numberFromEnv } from "./claude-protocol.ts";

export const DEFAULT_SESSION_IDENTITY = "default";

export interface ClaudeProcessKey {
	modelAlias: string;
	cwd: string;
	sessionIdentity: string;
}

export interface ClaudeProcessPoolEntry {
	key: ClaudeProcessKey;
	process: ClaudeProcessRuntime;
}

export interface ClaudeProcessPoolSnapshot {
	key: ClaudeProcessKey;
	keyId: string;
	live: boolean;
	claudeSessionId?: string;
}

export type ClaudeProcessRuntime = Pick<ClaudeNativeProcess, "isLive" | "runTurn" | "terminate">;

export interface ClaudeNativeProcessPoolConfig {
	getCwd?: () => string;
	env?: NodeJS.ProcessEnv;
	createProcess?: (config: ClaudeProcessConfig) => ClaudeProcessRuntime;
}

export function buildClaudeProcessKey(
	model: Model<Api>,
	options?: SimpleStreamOptions,
	cwd = process.cwd(),
): ClaudeProcessKey {
	return {
		modelAlias: modelAlias(model.id),
		cwd,
		sessionIdentity: options?.sessionId || DEFAULT_SESSION_IDENTITY,
	};
}

export function serializeClaudeProcessKey(key: ClaudeProcessKey): string {
	return JSON.stringify([key.modelAlias, key.cwd, key.sessionIdentity]);
}

export class ClaudeNativeProcessPool {
	private readonly processes = new Map<string, ClaudeProcessRuntime>();
	private readonly claudeSessionIds = new Map<string, string>();

	constructor(private readonly config: ClaudeNativeProcessPoolConfig = {}) {}

	getOrCreate(model: Model<Api>, options?: SimpleStreamOptions): ClaudeProcessPoolEntry {
		const cwd = this.config.getCwd?.() ?? process.cwd();
		const env = this.config.env ?? process.env;
		const key = buildClaudeProcessKey(model, options, cwd);
		const keyId = serializeClaudeProcessKey(key);

		let runtime = this.processes.get(keyId);
		if (runtime && !runtime.isLive()) {
			this.processes.delete(keyId);
			runtime = undefined;
		}

		if (!runtime) {
			const processConfig: ClaudeProcessConfig = {
				bin: env.CLAUDE_NATIVE_BIN || "claude",
				args: buildClaudeArgs(model, this.claudeSessionIds.get(keyId)),
				cwd,
				env,
				idleTimeoutMs: numberFromEnv("CLAUDE_NATIVE_IDLE_TIMEOUT_MS", 600_000) ?? 600_000,
			};
			runtime = this.config.createProcess?.(processConfig) ?? new ClaudeNativeProcess(processConfig);
			this.processes.set(keyId, runtime);
		}

		return { key, process: runtime };
	}

	rememberClaudeSessionId(key: ClaudeProcessKey, sessionId: string): void {
		this.claudeSessionIds.set(serializeClaudeProcessKey(key), sessionId);
	}

	terminateAll(reason: string, options: { clearSessions?: boolean } = {}): void {
		for (const runtime of this.processes.values()) runtime.terminate(reason);
		this.processes.clear();
		if (options.clearSessions) this.claudeSessionIds.clear();
	}

	reset(reason: string): void {
		this.terminateAll(reason, { clearSessions: true });
	}

	invalidateKey(key: ClaudeProcessKey, reason: string, options: { clearSession?: boolean } = {}): void {
		const keyId = serializeClaudeProcessKey(key);
		const runtime = this.processes.get(keyId);
		if (runtime) runtime.terminate(reason);
		this.processes.delete(keyId);
		if (options.clearSession) this.claudeSessionIds.delete(keyId);
	}

	snapshots(): ClaudeProcessPoolSnapshot[] {
		const keyIds = new Set([...this.processes.keys(), ...this.claudeSessionIds.keys()]);
		return [...keyIds].map((keyId) => {
			const [alias, cwd, sessionIdentity] = JSON.parse(keyId) as [string, string, string];
			const runtime = this.processes.get(keyId);
			return {
				key: { modelAlias: alias, cwd, sessionIdentity },
				keyId,
				live: !!runtime?.isLive(),
				claudeSessionId: this.claudeSessionIds.get(keyId),
			};
		});
	}
}
