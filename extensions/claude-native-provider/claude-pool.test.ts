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
