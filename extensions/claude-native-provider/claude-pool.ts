import { randomUUID } from "node:crypto";
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import {
	ClaudeNativeProcess,
	type ClaudeProcessConfig,
	type ClaudeProcessExitEvent,
} from "./claude-process.ts";
import { logClaudeNativeDiagnostic, redactSessionId } from "./claude-diagnostics.ts";
import { buildClaudeArgs, type ClaudeEffort, effortFromEnv, effortFromThinkingLevel, modelAlias, numberFromEnv } from "./claude-protocol.ts";

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
	/**
	 * True only after the Claude CLI has echoed this session id back via
	 * `rememberClaudeSessionId` (i.e. emitted any stream-json event carrying
	 * `session_id`). Until then the id is a ghost: we passed it via
	 * `--session-id` at spawn, but the CLI may have died before persisting
	 * the session to disk. Resuming a ghost session with `--resume` would
	 * fail or silently start fresh, so on process exit we drop unconfirmed
	 * sessions instead of leaving them remembered.
	 */
	confirmed: boolean;
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

/** Background-task event surfaced by the pool to consumers (the provider). */
export interface ClaudeBackgroundTaskEvent {
	/** Process key the event originated from. */
	key: ClaudeProcessKey;
	/** Whether the event arrived while a turn was in flight (true) or between turns (false). */
	inTurn: boolean;
	/** Subtype as emitted by the CLI: task_started, task_progress, task_updated, task_notification, task_summary, post_turn_summary. */
	subtype: string;
	/** Task id from the CLI, if present. */
	taskId?: string;
	/** For `task_notification`: completed | failed | stopped. */
	status?: string;
	/** Free-form summary text the CLI provides on terminal events. */
	summary?: string;
	/** The raw stdout message, in case the consumer needs more fields. */
	raw: any;
}

export type ClaudeBackgroundTaskListener = (event: ClaudeBackgroundTaskEvent) => void;

const TASK_EVENT_SUBTYPES = new Set([
	"task_started",
	"task_progress",
	"task_updated",
	"task_notification",
	"task_summary",
	"post_turn_summary",
]);

function isTaskEvent(message: any): boolean {
	return message?.type === "system" && typeof message?.subtype === "string" && TASK_EVENT_SUBTYPES.has(message.subtype);
}

interface LiveTaskEntry {
	taskId: string;
	startedAt: number;
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
	/** Last observed turn-level usage per process key. Used to detect cache drops. */
	private readonly lastUsage = new Map<string, { cacheRead: number; input: number }>();
	/** Live background tasks per process keyId. Populated by stream events; consulted to keep the process alive while tasks run. */
	private readonly liveTasks = new Map<string, Map<string, LiveTaskEntry>>();
	private readonly backgroundListeners: ClaudeBackgroundTaskListener[] = [];
	private lastObservedCwd?: string;

	constructor(private readonly config: ClaudeNativeProcessPoolConfig = {}) {}

	/**
	 * Register a listener for background-task events surfaced by any pooled
	 * process. The listener fires for both in-turn and out-of-turn events;
	 * use `event.inTurn` to distinguish. Terminal `task_notification` events
	 * also clear the task from the pool's live-task registry before firing.
	 */
	onBackgroundTaskEvent(listener: ClaudeBackgroundTaskListener): () => void {
		this.backgroundListeners.push(listener);
		return () => {
			const index = this.backgroundListeners.indexOf(listener);
			if (index >= 0) this.backgroundListeners.splice(index, 1);
		};
	}

	/**
	 * Forward an in-turn task event coming from the provider's `onMessage`
	 * stream. Mirrors what we do for out-of-turn events so the registry stays
	 * consistent regardless of whether the event arrived during or between
	 * turns.
	 */
	handleInTurnTaskEvent(key: ClaudeProcessKey, message: any): void {
		if (!isTaskEvent(message)) return;
		this.processTaskEvent(key, message, true);
	}

	private processTaskEvent(key: ClaudeProcessKey, message: any, inTurn: boolean): void {
		const keyId = serializeClaudeProcessKey(key);
		const subtype = message.subtype as string;
		const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
		const status = typeof message.status === "string" ? message.status : undefined;
		const summary = typeof message.summary === "string" ? message.summary : undefined;

		if (taskId) {
			let bucket = this.liveTasks.get(keyId);
			if (subtype === "task_started" || subtype === "task_progress" || subtype === "task_updated") {
				if (!bucket) {
					bucket = new Map();
					this.liveTasks.set(keyId, bucket);
				}
				if (!bucket.has(taskId)) bucket.set(taskId, { taskId, startedAt: Date.now() });
			} else if (subtype === "task_notification") {
				bucket?.delete(taskId);
				if (bucket && bucket.size === 0) this.liveTasks.delete(keyId);
			}
		}

		const event: ClaudeBackgroundTaskEvent = { key, inTurn, subtype, taskId, status, summary, raw: message };
		for (const listener of this.backgroundListeners) {
			try {
				listener(event);
			} catch (err) {
				logClaudeNativeDiagnostic("pool.background_listener_error", {
					subtype,
					taskId,
					reason: err instanceof Error ? err.message : String(err),
				}, this.config.env ?? process.env);
			}
		}
	}

	/**
	 * Whether the process for the given key should defer idle-reap because it
	 * still has live background bash tasks. Returns false once tasks have
	 * exceeded their max age (configurable via CLAUDE_NATIVE_MAX_BG_TASK_AGE_MS,
	 * default 1h) so a runaway bg shell can't pin a process forever.
	 */
	hasLiveTasks(keyId: string, now = Date.now()): boolean {
		const bucket = this.liveTasks.get(keyId);
		if (!bucket || bucket.size === 0) return false;
		const env = this.config.env ?? process.env;
		const maxAge = numberFromEnv("CLAUDE_NATIVE_MAX_BG_TASK_AGE_MS", 3_600_000, env);
		if (!maxAge || maxAge <= 0) return true;
		for (const entry of bucket.values()) {
			if (now - entry.startedAt < maxAge) return true;
		}
		// All tasks are past the max age — give up on them so idle reap can proceed.
		logClaudeNativeDiagnostic("pool.bg_tasks_expired", {
			keyId,
			liveTaskCount: bucket.size,
			maxAgeMs: maxAge,
		}, env);
		this.liveTasks.delete(keyId);
		return false;
	}

	getOrCreate(model: Model<Api>, options?: SimpleStreamOptions): ClaudeProcessPoolEntry {
		const cwd = this.config.getCwd?.() ?? process.cwd();
		this.observeCwd(cwd);
		const env = this.config.env ?? process.env;
		const effort = effortFromThinkingLevel(options?.reasoning) ?? effortFromEnv(env);
		const disableThinking = options !== undefined && !options.reasoning;
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
					rememberedSession = { id: randomUUID(), confirmed: false };
					this.claudeSessions.set(conversationKeyId, rememberedSession);
				}
				sessionId = rememberedSession.id;
				// Pass --session-id (not --resume) while the id is unconfirmed:
				// either it was just minted, or a prior spawn died before the
				// CLI ever echoed it back. The flag flips to confirmed only
				// when `rememberClaudeSessionId` fires from a real CLI event.
				isFirstSessionUse = !rememberedSession.confirmed;
			}
			const args = buildClaudeArgs(model, { sessionId, isFirstSessionUse, env, effort, disableThinking });
			resumedClaudeSession = args.includes("--resume");
			const processConfig: ClaudeProcessConfig = {
				bin: env.CLAUDE_NATIVE_BIN || "claude",
				args,
				cwd,
				env,
				idleTimeoutMs: numberFromEnv("CLAUDE_NATIVE_IDLE_TIMEOUT_MS", 600_000, env),
				onExit: (event) => this.handleProcessExit(key, keyId, createdRuntime, event),
				onOutOfTurnMessage: (message) => {
					if (isTaskEvent(message)) this.processTaskEvent(key, message, false);
				},
				shouldDeferIdleReap: () => this.hasLiveTasks(keyId),
			};
			logClaudeNativeDiagnostic("pool.create_runtime", {
				modelAlias: key.modelAlias,
				effort: key.effort,
				cwd,
				sessionIdentity: key.sessionIdentity,
				resumedClaudeSession,
				claudeSessionId: redactSessionId(sessionId),
				// Presence (not values) of network/auth env vars the Claude CLI
				// will honor since we forward the full env. Lets users verify
				// proxy/custom-header config is actually flowing through.
				envHasHttpsProxy: !!env.HTTPS_PROXY || !!env.https_proxy,
				envHasHttpProxy: !!env.HTTP_PROXY || !!env.http_proxy,
				envHasNoProxy: !!env.NO_PROXY || !!env.no_proxy,
				envHasAnthropicCustomHeaders: !!env.ANTHROPIC_CUSTOM_HEADERS,
				envHasAnthropicBaseUrl: !!env.ANTHROPIC_BASE_URL,
				envHasNodeExtraCaCerts: !!env.NODE_EXTRA_CA_CERTS,
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
		const previous = this.claudeSessions.get(conversationKeyId);
		this.claudeSessions.set(conversationKeyId, { id: sessionId, confirmed: true });
		if (previous && previous.id !== sessionId) {
			// Session-id change for the same conversation key. The next turn's
			// cache hit will reset because we're now resuming a different Claude
			// session — explicit log so cache_drop is attributable.
			logClaudeNativeDiagnostic("pool.session_rotated", {
				modelAlias: key.modelAlias,
				effort: key.effort,
				cwd: key.cwd,
				sessionIdentity: key.sessionIdentity,
				previousClaudeSessionId: redactSessionId(previous.id),
				claudeSessionId: redactSessionId(sessionId),
			}, this.config.env ?? process.env);
		}
		logClaudeNativeDiagnostic("pool.remember_session", {
			modelAlias: key.modelAlias,
			effort: key.effort,
			cwd: key.cwd,
			sessionIdentity: key.sessionIdentity,
			claudeSessionId: redactSessionId(sessionId),
		}, this.config.env ?? process.env);
	}

	/**
	 * Record per-turn usage and emit a `pool.cache_drop` diagnostic when
	 * `cache_read_input_tokens` for the same process key collapses
	 * turn-over-turn (>5% AND >2K tokens drop). Per subagent-caching
	 * techniques #7 phase 2 — cheap silent-regression detector.
	 */
	recordTurnUsage(key: ClaudeProcessKey, usage: { cacheRead: number; input: number }): void {
		const keyId = serializeClaudeProcessKey(key);
		const previous = this.lastUsage.get(keyId);
		this.lastUsage.set(keyId, { cacheRead: usage.cacheRead, input: usage.input });
		if (!previous) return;
		const drop = previous.cacheRead - usage.cacheRead;
		const relative = previous.cacheRead > 0 ? drop / previous.cacheRead : 0;
		if (drop > 2_000 && relative > 0.05) {
			logClaudeNativeDiagnostic("pool.cache_drop", {
				modelAlias: key.modelAlias,
				effort: key.effort,
				cwd: key.cwd,
				sessionIdentity: key.sessionIdentity,
				previousCacheRead: previous.cacheRead,
				cacheRead: usage.cacheRead,
				dropTokens: drop,
				dropFraction: Math.round(relative * 100) / 100,
				input: usage.input,
			}, this.config.env ?? process.env);
		}
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
		this.liveTasks.clear();
		if (options.clearSessions) {
			this.claudeSessions.clear();
		} else {
			// retireAll: drop unconfirmed ghost sessions. With every process now
			// dead, any still-unconfirmed id has zero chance of being made real
			// by a future event from the old runtime — keeping it would force
			// the next spawn to `--resume` a non-existent session.
			for (const [conversationKeyId, session] of [...this.claudeSessions.entries()]) {
				if (!session.confirmed) {
					this.claudeSessions.delete(conversationKeyId);
					logClaudeNativeDiagnostic("pool.drop_unconfirmed_session", {
						conversationKeyId,
						sessionId: redactSessionId(session.id),
						reason: `terminate_all: ${reason}`,
					}, this.config.env ?? process.env);
				}
			}
		}
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
		this.liveTasks.delete(keyId);
		const conversationKeyId = serializeClaudeConversationKey(conversationKeyFromProcessKey(key));
		if (event.unsafeSession) {
			this.claudeSessions.delete(conversationKeyId);
			return;
		}
		this.dropUnconfirmedSessionIfOrphaned(conversationKeyId, "process_exit");
	}

	/**
	 * Drop the remembered session for `conversationKeyId` iff it was never
	 * confirmed by the CLI (no stream event ever echoed its session_id back)
	 * AND no other live process still holds it. An unconfirmed id is a ghost:
	 * the CLI may have died before persisting it, so resuming with `--resume`
	 * would either error or silently reset. Leaving a ghost remembered is
	 * exactly what produced the "fresh session keeps respawning" loop in
	 * pi-session-2026-05-12T01-37-34-527Z (idx 6→8→10).
	 */
	private dropUnconfirmedSessionIfOrphaned(conversationKeyId: string, reason: string): void {
		const session = this.claudeSessions.get(conversationKeyId);
		if (!session || session.confirmed) return;
		for (const [processKeyId, runtime] of this.processes.entries()) {
			const [, , cwd, sessionIdentity] = JSON.parse(processKeyId) as [string, string, string, string];
			if (serializeClaudeConversationKey({ cwd, sessionIdentity }) !== conversationKeyId) continue;
			if (runtime.isLive()) return;
		}
		this.claudeSessions.delete(conversationKeyId);
		logClaudeNativeDiagnostic("pool.drop_unconfirmed_session", {
			conversationKeyId,
			sessionId: redactSessionId(session.id),
			reason,
		}, this.config.env ?? process.env);
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
		this.liveTasks.delete(keyId);
		const conversationKeyId = serializeClaudeConversationKey(conversationKeyFromProcessKey(key));
		if (options.clearSession) {
			this.claudeSessions.delete(conversationKeyId);
			return;
		}
		this.dropUnconfirmedSessionIfOrphaned(conversationKeyId, `invalidate_key: ${reason}`);
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
