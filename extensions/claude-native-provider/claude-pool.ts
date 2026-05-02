import { randomUUID } from "node:crypto";
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import {
	ClaudeNativeProcess,
	type ClaudeProcessConfig,
	type ClaudeProcessExitEvent,
} from "./claude-process.ts";
import { logClaudeNativeDiagnostic, redactSessionId } from "./claude-diagnostics.ts";
import { buildClaudeArgs, type ClaudeEffort, effortFromEnv, modelAlias, numberFromEnv } from "./claude-protocol.ts";

export const DEFAULT_SESSION_IDENTITY = "default";

export interface ClaudeProcessKey {
	modelAlias: string;
	effort: string;
	cwd: string;
	sessionIdentity: string;
}

export interface ClaudeConversationKey {
	cwd: string;
	sessionIdentity: string;
}

interface RememberedClaudeSession {
	id: string;
	initialized: boolean;
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
	effort: string;
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
	env: NodeJS.ProcessEnv = process.env,
	effort?: ClaudeEffort,
): ClaudeProcessKey {
	return {
		modelAlias: modelAlias(model.id),
		effort: (effort ?? effortFromEnv(env)) ?? "none",
		cwd,
		sessionIdentity: options?.sessionId || DEFAULT_SESSION_IDENTITY,
	};
}

export function buildClaudeConversationKey(
	options?: SimpleStreamOptions,
	cwd = process.cwd(),
): ClaudeConversationKey {
	return {
		cwd,
		sessionIdentity: options?.sessionId || DEFAULT_SESSION_IDENTITY,
	};
}

export function serializeClaudeProcessKey(key: ClaudeProcessKey): string {
	return JSON.stringify([key.modelAlias, key.effort, key.cwd, key.sessionIdentity]);
}

export function serializeClaudeConversationKey(key: ClaudeConversationKey): string {
	return JSON.stringify([key.cwd, key.sessionIdentity]);
}

function conversationKeyFromProcessKey(key: ClaudeProcessKey): ClaudeConversationKey {
	return { cwd: key.cwd, sessionIdentity: key.sessionIdentity };
}

export class ClaudeNativeProcessPool {
	private readonly processes = new Map<string, ClaudeProcessRuntime>();
	private readonly claudeSessions = new Map<string, RememberedClaudeSession>();
	private readonly sessionEffortOverrides = new Map<string, ClaudeEffort>();
	private lastObservedCwd?: string;

	constructor(private readonly config: ClaudeNativeProcessPoolConfig = {}) {}

	setSessionEffort(sessionIdentity: string, effort: ClaudeEffort | undefined): void {
		const id = sessionIdentity || DEFAULT_SESSION_IDENTITY;
		if (effort) this.sessionEffortOverrides.set(id, effort);
		else this.sessionEffortOverrides.delete(id);
	}

	getSessionEffort(sessionIdentity: string): ClaudeEffort | undefined {
		return this.sessionEffortOverrides.get(sessionIdentity || DEFAULT_SESSION_IDENTITY);
	}

	resolveEffort(sessionIdentity: string, env: NodeJS.ProcessEnv = this.config.env ?? process.env): ClaudeEffort | undefined {
		return this.getSessionEffort(sessionIdentity) ?? effortFromEnv(env);
	}

	getOrCreate(model: Model<Api>, options?: SimpleStreamOptions): ClaudeProcessPoolEntry {
		const cwd = this.config.getCwd?.() ?? process.cwd();
		this.observeCwd(cwd);
		const env = this.config.env ?? process.env;
		const sessionIdentity = options?.sessionId || DEFAULT_SESSION_IDENTITY;
		const effort = this.resolveEffort(sessionIdentity, env);
		const key = buildClaudeProcessKey(model, options, cwd, env, effort);
		const keyId = serializeClaudeProcessKey(key);
		const conversationKeyId = serializeClaudeConversationKey(conversationKeyFromProcessKey(key));

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
			const sessionContinuityEnabled = env.CLAUDE_NATIVE_NO_RESUME !== "1";
			let sessionId: string | undefined;
			let isFirstSessionUse = false;
			if (sessionContinuityEnabled) {
				let rememberedSession = this.claudeSessions.get(conversationKeyId);
				if (!rememberedSession) {
					rememberedSession = { id: randomUUID(), initialized: false };
					this.claudeSessions.set(conversationKeyId, rememberedSession);
				}
				sessionId = rememberedSession.id;
				isFirstSessionUse = !rememberedSession.initialized;
				rememberedSession.initialized = true;
			}
			const args = buildClaudeArgs(model, { sessionId, isFirstSessionUse, env, effort });
			resumedClaudeSession = args.includes("--resume");
			const processConfig: ClaudeProcessConfig = {
				bin: env.CLAUDE_NATIVE_BIN || "claude",
				args,
				cwd,
				env,
				idleTimeoutMs: numberFromEnv("CLAUDE_NATIVE_IDLE_TIMEOUT_MS", 600_000, env),
				onExit: (event) => this.handleProcessExit(key, keyId, createdRuntime, event),
			};
			logClaudeNativeDiagnostic("pool.create_runtime", {
				modelAlias: key.modelAlias,
				effort: key.effort,
				cwd,
				sessionIdentity: key.sessionIdentity,
				resumedClaudeSession,
				claudeSessionId: redactSessionId(sessionId),
			}, env);
			createdRuntime = this.config.createProcess?.(processConfig) ?? new ClaudeNativeProcess(processConfig);
			runtime = createdRuntime;
			this.processes.set(keyId, runtime);
		} else {
			logClaudeNativeDiagnostic("pool.reuse_runtime", {
				modelAlias: key.modelAlias,
				effort: key.effort,
				cwd,
				sessionIdentity: key.sessionIdentity,
			}, env);
		}

		return { key, keyId, process: runtime, created, resumedClaudeSession };
	}

	rememberClaudeSessionId(key: ClaudeProcessKey, sessionId: string): void {
		if ((this.config.env ?? process.env).CLAUDE_NATIVE_NO_RESUME === "1") return;
		const conversationKeyId = serializeClaudeConversationKey(conversationKeyFromProcessKey(key));
		this.claudeSessions.set(conversationKeyId, { id: sessionId, initialized: true });
		logClaudeNativeDiagnostic("pool.remember_session", {
			modelAlias: key.modelAlias,
			effort: key.effort,
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
		if (options.clearSessions) this.claudeSessions.clear();
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
		key: ClaudeProcessKey,
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
			this.claudeSessions.delete(serializeClaudeConversationKey(conversationKeyFromProcessKey(key)));
		}
	}

	invalidateKey(key: ClaudeProcessKey, reason: string, options: { clearSession?: boolean } = {}): void {
		const keyId = serializeClaudeProcessKey(key);
		logClaudeNativeDiagnostic("pool.invalidate_key", {
			modelAlias: key.modelAlias,
			effort: key.effort,
			cwd: key.cwd,
			sessionIdentity: key.sessionIdentity,
			reason,
			clearSession: !!options.clearSession,
		}, this.config.env ?? process.env);
		const runtime = this.processes.get(keyId);
		if (runtime) runtime.terminate(reason);
		this.processes.delete(keyId);
		if (options.clearSession) this.claudeSessions.delete(serializeClaudeConversationKey(conversationKeyFromProcessKey(key)));
	}

	stats(): ClaudeProcessPoolStats {
		const ids = new Set(this.processes.keys());
		const conversationIdsFromProcesses = new Set<string>();
		let liveProcesses = 0;
		for (const [processKeyId, runtime] of this.processes.entries()) {
			const [, , cwd, sessionIdentity] = JSON.parse(processKeyId) as [string, string, string, string];
			conversationIdsFromProcesses.add(serializeClaudeConversationKey({ cwd, sessionIdentity }));
			if (runtime.isLive()) liveProcesses++;
		}
		for (const conversationKeyId of this.claudeSessions.keys()) {
			if (!conversationIdsFromProcesses.has(conversationKeyId)) ids.add(conversationKeyId);
		}
		return {
			totalKeys: ids.size,
			liveProcesses,
			rememberedSessions: this.claudeSessions.size,
		};
	}

	snapshots(): ClaudeProcessPoolSnapshot[] {
		const snapshots: ClaudeProcessPoolSnapshot[] = [];
		const seenConversationIds = new Set<string>();
		for (const [keyId, runtime] of this.processes.entries()) {
			const [alias, effort, cwd, sessionIdentity] = JSON.parse(keyId) as [string, string, string, string];
			const conversationKeyId = serializeClaudeConversationKey({ cwd, sessionIdentity });
			seenConversationIds.add(conversationKeyId);
			snapshots.push({
				key: { modelAlias: alias, effort, cwd, sessionIdentity },
				keyId,
				live: !!runtime?.isLive(),
				claudeSessionId: this.claudeSessions.get(conversationKeyId)?.id,
				effort,
			});
		}
		for (const [conversationKeyId, session] of this.claudeSessions.entries()) {
			if (seenConversationIds.has(conversationKeyId)) continue;
			const [cwd, sessionIdentity] = JSON.parse(conversationKeyId) as [string, string];
			snapshots.push({
				key: { modelAlias: "none", effort: "none", cwd, sessionIdentity },
				keyId: conversationKeyId,
				live: false,
				claudeSessionId: session.id,
				effort: "none",
			});
		}
		return snapshots;
	}
}
