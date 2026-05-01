import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import {
	ClaudeNativeProcess,
	type ClaudeProcessConfig,
	type ClaudeProcessExitEvent,
} from "./claude-process.ts";
import { logClaudeNativeDiagnostic, redactSessionId } from "./claude-diagnostics.ts";
import { buildClaudeArgs, modelAlias, numberFromEnv } from "./claude-protocol.ts";

export const DEFAULT_SESSION_IDENTITY = "default";

export interface ClaudeProcessKey {
	modelAlias: string;
	cwd: string;
	sessionIdentity: string;
}

export interface ClaudeProcessPoolEntry {
	key: ClaudeProcessKey;
	keyId: string;
	process: ClaudeProcessRuntime;
	created: boolean;
	resumedClaudeSession: boolean;
}

export interface ClaudeProcessPoolSnapshot {
	key: ClaudeProcessKey;
	keyId: string;
	live: boolean;
	claudeSessionId?: string;
}

export interface ClaudeProcessPoolStats {
	totalKeys: number;
	liveProcesses: number;
	rememberedSessions: number;
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
	private lastObservedCwd?: string;

	constructor(private readonly config: ClaudeNativeProcessPoolConfig = {}) {}

	getOrCreate(model: Model<Api>, options?: SimpleStreamOptions): ClaudeProcessPoolEntry {
		const cwd = this.config.getCwd?.() ?? process.cwd();
		this.observeCwd(cwd);
		const env = this.config.env ?? process.env;
		const key = buildClaudeProcessKey(model, options, cwd);
		const keyId = serializeClaudeProcessKey(key);

		let runtime = this.processes.get(keyId);
		let created = false;
		let resumedClaudeSession = false;

		if (runtime && !runtime.isLive()) {
			logClaudeNativeDiagnostic("pool.drop_dead_runtime", { keyId }, env);
			this.processes.delete(keyId);
			runtime = undefined;
		}

		if (!runtime) {
			created = true;
			let createdRuntime: ClaudeProcessRuntime | undefined;
			const rememberedSessionId = this.claudeSessionIds.get(keyId);
			const args = buildClaudeArgs(model, rememberedSessionId);
			resumedClaudeSession = args.includes("--resume");
			const processConfig: ClaudeProcessConfig = {
				bin: env.CLAUDE_NATIVE_BIN || "claude",
				args,
				cwd,
				env,
				idleTimeoutMs: numberFromEnv("CLAUDE_NATIVE_IDLE_TIMEOUT_MS", 600_000) ?? 600_000,
				onExit: (event) => this.handleProcessExit(keyId, createdRuntime, event),
			};
			logClaudeNativeDiagnostic("pool.create_runtime", {
				modelAlias: key.modelAlias,
				cwd,
				sessionIdentity: key.sessionIdentity,
				resumedClaudeSession,
				claudeSessionId: redactSessionId(rememberedSessionId),
			}, env);
			createdRuntime = this.config.createProcess?.(processConfig) ?? new ClaudeNativeProcess(processConfig);
			runtime = createdRuntime;
			this.processes.set(keyId, runtime);
		} else {
			logClaudeNativeDiagnostic("pool.reuse_runtime", {
				modelAlias: key.modelAlias,
				cwd,
				sessionIdentity: key.sessionIdentity,
			}, env);
		}

		return { key, keyId, process: runtime, created, resumedClaudeSession };
	}

	rememberClaudeSessionId(key: ClaudeProcessKey, sessionId: string): void {
		this.claudeSessionIds.set(serializeClaudeProcessKey(key), sessionId);
		logClaudeNativeDiagnostic("pool.remember_session", {
			modelAlias: key.modelAlias,
			cwd: key.cwd,
			sessionIdentity: key.sessionIdentity,
			claudeSessionId: redactSessionId(sessionId),
		}, this.config.env ?? process.env);
	}

	terminateAll(reason: string, options: { clearSessions?: boolean } = {}): ClaudeProcessPoolStats {
		const before = this.stats();
		logClaudeNativeDiagnostic("pool.terminate_all", {
			reason,
			clearSessions: !!options.clearSessions,
			liveProcesses: before.liveProcesses,
			rememberedSessions: before.rememberedSessions,
		}, this.config.env ?? process.env);
		for (const runtime of this.processes.values()) runtime.terminate(reason);
		this.processes.clear();
		if (options.clearSessions) this.claudeSessionIds.clear();
		return before;
	}

	retireAll(reason: string): ClaudeProcessPoolStats {
		return this.terminateAll(reason, { clearSessions: false });
	}

	hardInvalidateAll(reason: string): ClaudeProcessPoolStats {
		return this.terminateAll(reason, { clearSessions: true });
	}

	reset(reason: string): ClaudeProcessPoolStats {
		const before = this.hardInvalidateAll(reason);
		this.lastObservedCwd = undefined;
		logClaudeNativeDiagnostic("pool.reset", before, this.config.env ?? process.env);
		return before;
	}

	private observeCwd(cwd: string): void {
		if (this.lastObservedCwd && this.lastObservedCwd !== cwd) {
			this.retireAll(`cwd changed from ${this.lastObservedCwd} to ${cwd}`);
		}
		this.lastObservedCwd = cwd;
	}

	private handleProcessExit(
		keyId: string,
		runtime: ClaudeProcessRuntime | undefined,
		event: ClaudeProcessExitEvent,
	): void {
		logClaudeNativeDiagnostic("pool.process_exit", {
			keyId,
			code: event.code,
			reason: event.reason,
			unsafeSession: event.unsafeSession,
		}, this.config.env ?? process.env);
		if (runtime && this.processes.get(keyId) === runtime) {
			this.processes.delete(keyId);
		}
		if (event.unsafeSession) {
			this.claudeSessionIds.delete(keyId);
		}
	}

	invalidateKey(key: ClaudeProcessKey, reason: string, options: { clearSession?: boolean } = {}): void {
		const keyId = serializeClaudeProcessKey(key);
		logClaudeNativeDiagnostic("pool.invalidate_key", {
			modelAlias: key.modelAlias,
			cwd: key.cwd,
			sessionIdentity: key.sessionIdentity,
			reason,
			clearSession: !!options.clearSession,
		}, this.config.env ?? process.env);
		const runtime = this.processes.get(keyId);
		if (runtime) runtime.terminate(reason);
		this.processes.delete(keyId);
		if (options.clearSession) this.claudeSessionIds.delete(keyId);
	}

	stats(): ClaudeProcessPoolStats {
		const keyIds = new Set([...this.processes.keys(), ...this.claudeSessionIds.keys()]);
		let liveProcesses = 0;
		for (const runtime of this.processes.values()) {
			if (runtime.isLive()) liveProcesses++;
		}
		return {
			totalKeys: keyIds.size,
			liveProcesses,
			rememberedSessions: this.claudeSessionIds.size,
		};
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
