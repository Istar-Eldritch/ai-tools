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

	it("builds stable keys from model alias, cwd, and session identity", () => {
		const key = buildClaudeProcessKey(model, { sessionId: "pi-session-a" } as any, "/repo");
		expect(key).toEqual({ modelAlias: "sonnet", cwd: "/repo", sessionIdentity: "pi-session-a" });
		expect(serializeClaudeProcessKey(key)).toBe(JSON.stringify(["sonnet", "/repo", "pi-session-a"]));
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

	it("resumes only the remembered Claude session for the same key", () => {
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
});
