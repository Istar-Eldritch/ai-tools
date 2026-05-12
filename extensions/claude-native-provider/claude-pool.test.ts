import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeNativeProcessPool, buildClaudeProcessKey, serializeClaudeProcessKey } from "./claude-pool.ts";

class FakeRuntime {
	static instances: FakeRuntime[] = [];
	live = true;
	terminateReasons: string[] = [];

	constructor(readonly config: any) {
		FakeRuntime.instances.push(this);
	}

	isLive() {
		return this.live;
	}

	terminate(reason: string) {
		this.live = false;
		this.terminateReasons.push(reason);
	}

	emitExit(event: any) {
		this.live = false;
		this.config.onExit?.(event);
	}

	async runTurn() {}
}

const model: any = { id: "sonnet", api: "claude-native-cli", provider: "claude-native" };

function createPool(cwd = "/repo") {
	return new ClaudeNativeProcessPool({
		getCwd: () => cwd,
		createProcess: (config) => new FakeRuntime(config) as any,
	});
}

describe("ClaudeNativeProcessPool", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		FakeRuntime.instances = [];
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	it("builds stable keys from model alias, effort, cwd, and session identity", () => {
		const key = buildClaudeProcessKey(model, { sessionId: "pi-session-a" } as any, "/repo");
		expect(key).toEqual({ modelAlias: "sonnet", effort: "none", cwd: "/repo", sessionIdentity: "pi-session-a" });
		expect(serializeClaudeProcessKey(key)).toBe(JSON.stringify(["sonnet", "none", "/repo", "pi-session-a"]));
	});

	it("creates separate runtimes for different session identities", () => {
		const pool = createPool();
		const first = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const second = pool.getOrCreate(model, { sessionId: "pi-b" } as any);
		const firstAgain = pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(firstAgain.process).toBe(first.process);
		expect(second.process).not.toBe(first.process);
	});

	it("creates separate runtimes for different effort levels while sharing the Claude conversation", () => {
		const pool = createPool();
		process.env.CLAUDE_NATIVE_EFFORT = "low";
		const low = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(low.key, "claude-a");
		process.env.CLAUDE_NATIVE_EFFORT = "high";
		const high = pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(high.process).not.toBe(low.process);
		expect(FakeRuntime.instances[0].config.args).toEqual(expect.arrayContaining(["--effort", "low"]));
		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--effort", "high", "--resume", "claude-a"]));
	});

	it("derives effort from options.reasoning, taking precedence over env var", () => {
		const pool = createPool();
		process.env.CLAUDE_NATIVE_EFFORT = "max";
		const low = pool.getOrCreate(model, { sessionId: "pi-a", reasoning: "low" } as any);
		pool.rememberClaudeSessionId(low.key, "claude-a");
		const high = pool.getOrCreate(model, { sessionId: "pi-a", reasoning: "high" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(FakeRuntime.instances[0].config.args).toEqual(expect.arrayContaining(["--effort", "low"]));
		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--effort", "high", "--resume", "claude-a"]));
	});

	it("maps 'minimal' reasoning to 'low' effort", () => {
		const pool = createPool();
		pool.getOrCreate(model, { sessionId: "pi-a", reasoning: "minimal" } as any);
		expect(FakeRuntime.instances[0].config.args).toEqual(expect.arrayContaining(["--effort", "low"]));
	});

	it("falls back to env var effort when options.reasoning is not set", () => {
		const pool = createPool();
		process.env.CLAUDE_NATIVE_EFFORT = "medium";
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		expect(FakeRuntime.instances[0].config.args).toEqual(expect.arrayContaining(["--effort", "medium"]));
	});

	it("resumes the remembered Claude session for the same Pi conversation", () => {
		const pool = createPool();

		const first = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(first.key, "claude-a");
		const second = pool.getOrCreate(model, { sessionId: "pi-b" } as any);
		pool.rememberClaudeSessionId(second.key, "claude-b");

		(first.process as any).live = false;
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(3);
		expect(FakeRuntime.instances[1].config.args).not.toContain("claude-a");
		expect(FakeRuntime.instances[2].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
	});

	it("retires live processes when cwd changes but preserves remembered sessions", () => {
		let cwd = "/repo-a";
		const pool = new ClaudeNativeProcessPool({
			getCwd: () => cwd,
			createProcess: (config) => new FakeRuntime(config) as any,
		});

		const first = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(first.key, "claude-a");

		cwd = "/repo-b";
		pool.getOrCreate(model, { sessionId: "pi-b" } as any);

		expect(FakeRuntime.instances[0].terminateReasons).toEqual([expect.stringContaining("cwd changed")]);

		cwd = "/repo-a";
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(3);
		expect(FakeRuntime.instances[2].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
	});

	it("terminateAll kills live processes but preserves remembered sessions", () => {
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-a");

		pool.terminateAll("test reap");
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances[0].terminateReasons).toEqual(["test reap"]);
		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
	});

	it("removes a safely exited runtime and resumes with the remembered Claude session", () => {
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-a");

		FakeRuntime.instances[0].emitExit({ code: "process_close", reason: "closed", unsafeSession: false });
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
	});

	it("preserves remembered Claude session after idle reaping", () => {
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-a");

		FakeRuntime.instances[0].emitExit({ code: "idle", reason: "idle timeout", unsafeSession: false });
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
	});

	it("clears remembered Claude session after an unsafe in-flight exit", () => {
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-a");

		FakeRuntime.instances[0].emitExit({ code: "timeout", reason: "timed out", unsafeSession: true });
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		expect(FakeRuntime.instances[1].config.args).not.toContain("--resume");
		expect(FakeRuntime.instances[1].config.args).not.toContain("claude-a");
	});

	it("drops an unconfirmed session when a safe exit happens before the CLI ever echoed session_id back", () => {
		// Repro of pi-session-2026-05-12T01-37-34-527Z idx 6→8: the first spawn
		// died before rememberClaudeSessionId fired, so the minted UUID never
		// landed on disk. The previous behavior left it remembered, and the
		// next turn tried `--resume <ghost>` which silently started fresh —
		// looking to the user like Claude "forgot" the conversation.
		const pool = createPool();
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const firstArgs = FakeRuntime.instances[0].config.args;
		const firstUuidIdx = firstArgs.indexOf("--session-id");
		expect(firstUuidIdx).toBeGreaterThanOrEqual(0);
		const firstUuid = firstArgs[firstUuidIdx + 1];

		FakeRuntime.instances[0].emitExit({ code: "process_close", reason: "closed", unsafeSession: false });
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances).toHaveLength(2);
		// Second spawn must NOT try to resume the ghost id, and must mint a fresh one.
		expect(FakeRuntime.instances[1].config.args).not.toContain("--resume");
		expect(FakeRuntime.instances[1].config.args).toContain("--session-id");
		const secondUuid = FakeRuntime.instances[1].config.args[FakeRuntime.instances[1].config.args.indexOf("--session-id") + 1];
		expect(secondUuid).not.toBe(firstUuid);
	});

	it("keeps an unconfirmed session id stable across spawns until the CLI confirms it", () => {
		// While a process is still alive (or about to be respawned) but hasn't
		// yet echoed back any session_id, we keep passing the same `--session-id`
		// to avoid splitting the conversation across two on-disk session files
		// if the CLI does manage to write the first one.
		const pool = createPool();
		const first = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const firstArgs = first.process ? FakeRuntime.instances[0].config.args : [];
		const firstUuid = firstArgs[firstArgs.indexOf("--session-id") + 1];

		// Same conversation, different effort → second runtime spawned, same conversation key.
		process.env.CLAUDE_NATIVE_EFFORT = "high";
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const secondArgs = FakeRuntime.instances[1].config.args;
		expect(secondArgs).toContain("--session-id");
		expect(secondArgs).not.toContain("--resume");
		expect(secondArgs[secondArgs.indexOf("--session-id") + 1]).toBe(firstUuid);
	});

	it("keeps the unconfirmed session id when one of several live processes for the conversation exits cleanly", () => {
		// Two processes (different effort) share one conversation. One exits
		// before the CLI confirms — but the other is still live, so we keep
		// the id around in case the live one confirms it.
		const pool = createPool();
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const firstUuid = FakeRuntime.instances[0].config.args[
			FakeRuntime.instances[0].config.args.indexOf("--session-id") + 1
		];

		process.env.CLAUDE_NATIVE_EFFORT = "high";
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		FakeRuntime.instances[0].emitExit({ code: "process_close", reason: "closed", unsafeSession: false });

		// Reusing the same effort=high process should not have re-spawned anything.
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		expect(FakeRuntime.instances).toHaveLength(2);

		// Now a third spawn for a different effort — still unconfirmed but
		// live process exists for this conversation, so id is preserved.
		delete process.env.CLAUDE_NATIVE_EFFORT;
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		const thirdArgs = FakeRuntime.instances[2].config.args;
		expect(thirdArgs[thirdArgs.indexOf("--session-id") + 1]).toBe(firstUuid);
	});

	it("once the CLI confirms a session, even a safe exit preserves it for --resume", () => {
		// This is the existing happy path, kept as a regression guard against
		// over-eager dropping in `dropUnconfirmedSessionIfOrphaned`.
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-confirmed");

		FakeRuntime.instances[0].emitExit({ code: "process_close", reason: "closed", unsafeSession: false });
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-confirmed"]));
	});

	it("retireAll drops unconfirmed orphans but keeps confirmed sessions", () => {
		// retireAll (used by cwd-change) must distinguish: a confirmed session
		// belongs on disk and is safe to --resume after cwd-flip-flop; an
		// unconfirmed one is a ghost and would only sabotage the next turn.
		const pool = createPool();
		const confirmedEntry = pool.getOrCreate(model, { sessionId: "pi-confirmed" } as any);
		pool.rememberClaudeSessionId(confirmedEntry.key, "claude-real");
		pool.getOrCreate(model, { sessionId: "pi-ghost" } as any);

		pool.retireAll("cwd change");

		expect(pool.stats().rememberedSessions).toBe(1);
		pool.getOrCreate(model, { sessionId: "pi-confirmed" } as any);
		const lastInstance = FakeRuntime.instances[FakeRuntime.instances.length - 1];
		expect(lastInstance.config.args).toEqual(expect.arrayContaining(["--resume", "claude-real"]));

		pool.getOrCreate(model, { sessionId: "pi-ghost" } as any);
		const ghostInstance = FakeRuntime.instances[FakeRuntime.instances.length - 1];
		expect(ghostInstance.config.args).not.toContain("--resume");
	});

	it("reset kills processes and clears remembered sessions", () => {
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-a");

		pool.reset("reset command");
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);

		expect(FakeRuntime.instances[0].terminateReasons).toEqual(["reset command"]);
		expect(FakeRuntime.instances[1].config.args).not.toContain("--resume");
		expect(FakeRuntime.instances[1].config.args).not.toContain("claude-a");
	});

	it("reset returns counts for killed processes and cleared sessions", () => {
		const pool = createPool();
		const first = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(first.key, "claude-a");
		const second = pool.getOrCreate(model, { sessionId: "pi-b" } as any);
		pool.rememberClaudeSessionId(second.key, "claude-b");

		const before = pool.reset("reset command");

		expect(before).toEqual({ totalKeys: 2, liveProcesses: 2, rememberedSessions: 2 });
		expect(FakeRuntime.instances[0].terminateReasons).toEqual(["reset command"]);
		expect(FakeRuntime.instances[1].terminateReasons).toEqual(["reset command"]);
		expect(pool.stats()).toEqual({ totalKeys: 0, liveProcesses: 0, rememberedSessions: 0 });
	});

	it("logs pool lifecycle diagnostics when enabled", () => {
		process.env.CLAUDE_NATIVE_DEBUG = "1";
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const pool = createPool();
		const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.rememberClaudeSessionId(entry.key, "claude-secret-session");
		pool.getOrCreate(model, { sessionId: "pi-a" } as any);
		pool.reset("reset command");

		expect(err).toHaveBeenCalledWith(expect.stringContaining("pool.create_runtime"));
		expect(err).toHaveBeenCalledWith(expect.stringContaining("pool.remember_session"));
		expect(err).toHaveBeenCalledWith(expect.stringContaining("pool.reuse_runtime"));
		expect(err).toHaveBeenCalledWith(expect.stringContaining("pool.reset"));
		expect(err.mock.calls.flat().join("\n")).not.toContain("claude-secret-session");
	});

	describe("background task events", () => {
		it("forwards out-of-turn task_notification events to listeners with inTurn=false", () => {
			const pool = createPool();
			const events: any[] = [];
			pool.onBackgroundTaskEvent((event) => events.push(event));

			pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			runtime.config.onOutOfTurnMessage({
				type: "system",
				subtype: "task_notification",
				task_id: "bash_1",
				status: "failed",
				summary: "exit code 1",
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ inTurn: false, subtype: "task_notification", taskId: "bash_1", status: "failed", summary: "exit code 1" });
		});

		it("forwards in-turn events with inTurn=true via handleInTurnTaskEvent", () => {
			const pool = createPool();
			const events: any[] = [];
			pool.onBackgroundTaskEvent((event) => events.push(event));

			const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			pool.handleInTurnTaskEvent(entry.key, {
				type: "system",
				subtype: "task_started",
				task_id: "bash_1",
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ inTurn: true, subtype: "task_started", taskId: "bash_1" });
		});

		it("ignores non-task system messages", () => {
			const pool = createPool();
			const events: any[] = [];
			pool.onBackgroundTaskEvent((event) => events.push(event));

			pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "init" });
			runtime.config.onOutOfTurnMessage({ type: "rate_limit_event" });
			pool.handleInTurnTaskEvent({ modelAlias: "sonnet", effort: "none", cwd: "/repo", sessionIdentity: "pi-a" }, { type: "assistant" });

			expect(events).toEqual([]);
		});

		it("defers idle reap while a task is live, allows it once the notification arrives", () => {
			const pool = createPool();
			pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "task_started", task_id: "bash_1" });
			expect(runtime.config.shouldDeferIdleReap()).toBe(true);

			runtime.config.onOutOfTurnMessage({
				type: "system",
				subtype: "task_notification",
				task_id: "bash_1",
				status: "completed",
			});
			expect(runtime.config.shouldDeferIdleReap()).toBe(false);
		});

		it("expires stale tasks past CLAUDE_NATIVE_MAX_BG_TASK_AGE_MS and allows idle reap", () => {
			process.env.CLAUDE_NATIVE_MAX_BG_TASK_AGE_MS = "1000";
			const pool = createPool();
			pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			const t0 = 1_000_000;
			vi.spyOn(Date, "now").mockReturnValue(t0);
			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "task_started", task_id: "bash_1" });
			expect(runtime.config.shouldDeferIdleReap()).toBe(true);

			vi.spyOn(Date, "now").mockReturnValue(t0 + 5_000);
			expect(runtime.config.shouldDeferIdleReap()).toBe(false);
		});

		it("clears live-task registry when a process exits", () => {
			const pool = createPool();
			const entry = pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "task_started", task_id: "bash_1" });
			const keyId = serializeClaudeProcessKey(entry.key);
			expect(pool.hasLiveTasks(keyId)).toBe(true);

			runtime.emitExit({ code: "process_close", reason: "child exit", unsafeSession: false });
			expect(pool.hasLiveTasks(keyId)).toBe(false);
		});

		it("unsubscribe stops a listener from receiving further events", () => {
			const pool = createPool();
			const events: any[] = [];
			const unsubscribe = pool.onBackgroundTaskEvent((event) => events.push(event));

			pool.getOrCreate(model, { sessionId: "pi-a" } as any);
			const runtime = FakeRuntime.instances[0];

			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "task_started", task_id: "bash_1" });
			unsubscribe();
			runtime.config.onOutOfTurnMessage({ type: "system", subtype: "task_notification", task_id: "bash_1", status: "completed" });

			expect(events).toHaveLength(1);
		});
	});
});
