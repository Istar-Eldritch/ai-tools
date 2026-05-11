import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClaudeNativeProcess } from "./claude-process.ts";

class FakeClaudeChild extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	killed = false;
	writes: string[] = [];
	kill = vi.fn((_signal?: NodeJS.Signals) => {
		if (this.killed) return true;
		this.killed = true;
		this.emit("close", 143);
		return true;
	});

	constructor() {
		super();
		this.stdin.on("data", (chunk) => this.writes.push(chunk.toString()));
	}
}

function createProcess(child: FakeClaudeChild, idleTimeoutMs = 1_000) {
	const spawnFn = vi.fn(() => child as any);
	const exits: any[] = [];
	const proc = new ClaudeNativeProcess({
		bin: "claude",
		args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json"],
		cwd: process.cwd(),
		env: process.env,
		idleTimeoutMs,
		spawnFn: spawnFn as any,
		onExit: (event) => exits.push(event),
	});
	return { proc, spawnFn, exits };
}

function writeJson(child: FakeClaudeChild, message: any) {
	child.stdout.write(JSON.stringify(message) + "\n");
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ClaudeNativeProcess", () => {
	it("starts lazily on first turn", () => {
		const child = new FakeClaudeChild();
		const { proc, spawnFn } = createProcess(child);

		expect(spawnFn).not.toHaveBeenCalled();
		const turn = proc.runTurn("hello", { onMessage: () => {} });
		turn.catch(() => undefined);

		expect(spawnFn).toHaveBeenCalledTimes(1);
		expect(proc.isLive()).toBe(true);
		proc.terminate("test cleanup");
	});

	it("keeps stdin open and resolves a turn on result", async () => {
		const child = new FakeClaudeChild();
		const { proc } = createProcess(child);
		const messages: any[] = [];

		const turn = proc.runTurn("hello", { onMessage: (msg) => messages.push(msg) });
		expect(child.writes).toHaveLength(1);
		expect(JSON.parse(child.writes[0]).message.content[0].text).toBe("hello");
		expect(child.stdin.writableEnded).toBe(false);

		writeJson(child, { type: "assistant", message: { content: [] } });
		writeJson(child, { type: "result", subtype: "success", is_error: false });
		await expect(turn).resolves.toBeUndefined();
		expect(proc.isLive()).toBe(true);
		expect(messages.map((m) => m.type)).toEqual(["assistant", "result"]);
	});

	it("accepts a second turn on the same child process", async () => {
		const child = new FakeClaudeChild();
		const { proc, spawnFn } = createProcess(child);

		const first = proc.runTurn("one", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await first;

		const second = proc.runTurn("two", { onMessage: () => {} });
		await Promise.resolve();
		expect(spawnFn).toHaveBeenCalledTimes(1);
		expect(child.writes).toHaveLength(2);
		expect(JSON.parse(child.writes[1]).message.content[0].text).toBe("two");
		writeJson(child, { type: "result", subtype: "success" });
		await expect(second).resolves.toBeUndefined();
	});

	it("queues concurrent turns for the same process", async () => {
		const child = new FakeClaudeChild();
		const { proc, spawnFn } = createProcess(child);

		const first = proc.runTurn("one", { onMessage: () => {} });
		const second = proc.runTurn("two", { onMessage: () => {} });

		expect(child.writes).toHaveLength(1);
		writeJson(child, { type: "result", subtype: "success" });
		await first;
		await Promise.resolve();

		expect(spawnFn).toHaveBeenCalledTimes(1);
		expect(child.writes).toHaveLength(2);
		expect(JSON.parse(child.writes[1]).message.content[0].text).toBe("two");
		writeJson(child, { type: "result", subtype: "success" });
		await expect(second).resolves.toBeUndefined();
	});

	it("calls onMalformedJson for bad JSON and continues", async () => {
		const child = new FakeClaudeChild();
		const { proc } = createProcess(child);
		const malformed: string[] = [];
		const messages: any[] = [];

		const turn = proc.runTurn("hello", {
			onMessage: (msg) => messages.push(msg),
			onMalformedJson: (line) => malformed.push(line),
		});

		child.stdout.write("not json\n");
		writeJson(child, { type: "result", subtype: "success" });
		await expect(turn).resolves.toBeUndefined();
		expect(malformed).toEqual(["not json"]);
		expect(messages.map((m) => m.type)).toEqual(["result"]);
	});

	it("forwards stderr to onStderr", async () => {
		const child = new FakeClaudeChild();
		const { proc } = createProcess(child);
		const stderr: string[] = [];

		const turn = proc.runTurn("hello", { onMessage: () => {}, onStderr: (text) => stderr.push(text) });
		child.stderr.write("warning\n");
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		expect(stderr).toEqual(["warning\n"]);
	});

	it("idle timer terminates the process after configured milliseconds", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const { proc } = createProcess(child, 1_000);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		expect(child.killed).toBe(false);
		vi.advanceTimersByTime(999);
		expect(child.killed).toBe(false);
		vi.advanceTimersByTime(1);
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(proc.isLive()).toBe(false);
	});

	it("reports idle exit as safe for session resume", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child, 1_000);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		vi.advanceTimersByTime(1_000);

		expect(exits).toEqual([expect.objectContaining({ code: "idle", unsafeSession: false })]);
		expect(proc.isLive()).toBe(false);
	});

	it("logs idle reap diagnostics when enabled", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const spawnFn = vi.fn(() => child as any);
		const proc = new ClaudeNativeProcess({
			bin: "claude",
			args: ["-p"],
			cwd: process.cwd(),
			env: { ...process.env, CLAUDE_NATIVE_DEBUG: "1" },
			idleTimeoutMs: 1_000,
			spawnFn: spawnFn as any,
		});

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;
		vi.advanceTimersByTime(1_000);

		expect(err.mock.calls.flat().join("\n")).toContain("process.idle_reap");
	});

	it("timeout terminates and rejects the active turn", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} }, { timeoutMs: 100 });
		vi.advanceTimersByTime(100);

		await expect(turn).rejects.toThrow(/timed out/);
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(exits).toEqual([expect.objectContaining({ code: "timeout", unsafeSession: true })]);
		expect(proc.isLive()).toBe(false);
	});

	it("reports timeout as an unsafe exit", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} }, { timeoutMs: 100 });
		vi.advanceTimersByTime(100);

		await expect(turn).rejects.toMatchObject({ code: "timeout", unsafeSession: true });
		expect(exits).toEqual([expect.objectContaining({ code: "timeout", unsafeSession: true })]);
		expect(exits).toHaveLength(1);
		expect(proc.isLive()).toBe(false);
	});

	it("abort signal terminates and rejects", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);
		const controller = new AbortController();

		const turn = proc.runTurn("hello", { onMessage: () => {} }, { signal: controller.signal });
		controller.abort();

		await expect(turn).rejects.toThrow(/aborted/);
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(exits).toEqual([expect.objectContaining({ code: "aborted", unsafeSession: true })]);
		expect(proc.isLive()).toBe(false);
	});

	it("reports abort as an unsafe exit", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);
		const controller = new AbortController();

		const turn = proc.runTurn("hello", { onMessage: () => {} }, { signal: controller.signal });
		controller.abort();

		await expect(turn).rejects.toMatchObject({ code: "aborted", unsafeSession: true });
		expect(exits).toEqual([expect.objectContaining({ code: "aborted", unsafeSession: true })]);
		expect(exits).toHaveLength(1);
	});

	it("stdin write failures reject with stdin_error and clear unsafe session state", async () => {
		const child = new FakeClaudeChild();
		vi.spyOn(child.stdin, "write").mockImplementation(((chunk: any, cb?: any) => {
			if (typeof cb === "function") cb(new Error("stdin exploded"));
			return true;
		}) as any);
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });

		await expect(turn).rejects.toMatchObject({ code: "stdin_error", unsafeSession: true, message: "stdin exploded" });
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(exits).toEqual([expect.objectContaining({ code: "stdin_error", unsafeSession: true, reason: "stdin exploded" })]);
		expect(proc.isLive()).toBe(false);
	});

	it("child error rejects the active turn with process_error and marks session unsafe", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		child.emit("error", new Error("spawn exploded"));

		await expect(turn).rejects.toMatchObject({ code: "process_error", unsafeSession: true, message: "spawn exploded" });
		expect(exits).toEqual([expect.objectContaining({ code: "process_error", unsafeSession: true, reason: "spawn exploded" })]);
		expect(proc.isLive()).toBe(false);
	});

	it("between-turn child error is reported as safe for session resume", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		child.emit("error", new Error("background crash"));
		expect(exits.at(-1)).toEqual(expect.objectContaining({ code: "process_error", unsafeSession: false, reason: "background crash" }));
		expect(proc.isLive()).toBe(false);
	});

	it("unexpected child close rejects the active turn and does not hang", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		child.emit("close", 1);

		await expect(turn).rejects.toThrow(/exited with code 1/);
		expect(exits).toEqual([expect.objectContaining({ code: "process_close", unsafeSession: true })]);
		expect(proc.isLive()).toBe(false);
	});

	it("reports between-turn child close as safe for session resume", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		child.emit("close", 0);
		expect(exits.at(-1)).toEqual(expect.objectContaining({ code: "process_close", unsafeSession: false }));
		expect(proc.isLive()).toBe(false);
	});

	it("reports in-flight child close as unsafe and rejects without hanging", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		child.emit("close", 1);

		await expect(turn).rejects.toMatchObject({ code: "process_close", unsafeSession: true });
		expect(exits).toEqual([expect.objectContaining({ code: "process_close", unsafeSession: true })]);
	});

	it("queued same-process turn starts only after the first turn fails", async () => {
		const child = new FakeClaudeChild();
		const { proc } = createProcess(child);

		const first = proc.runTurn("one", { onMessage: () => {} });
		const second = proc.runTurn("two", { onMessage: () => {} });

		expect(child.writes).toHaveLength(1);
		child.emit("close", 1);
		await expect(first).rejects.toMatchObject({ code: "process_close" });

		await Promise.resolve();
		expect(child.writes).toHaveLength(1);
		await expect(second).rejects.toBeInstanceOf(Error);
	});

	it("terminate rejects in-flight work and sends SIGTERM once", async () => {
		const child = new FakeClaudeChild();
		const { proc, exits } = createProcess(child);

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		proc.terminate("test cleanup");
		proc.terminate("test cleanup again");

		await expect(turn).rejects.toThrow(/test cleanup/);
		expect(child.kill).toHaveBeenCalledTimes(1);
		expect(exits).toHaveLength(1);
		expect(proc.isLive()).toBe(false);
	});

	it("logs process diagnostics with redacted resume args when enabled", async () => {
		const child = new FakeClaudeChild();
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const spawnFn = vi.fn(() => child as any);
		const proc = new ClaudeNativeProcess({
			bin: "claude",
			args: ["-p", "--resume", "claude-secret-session"],
			cwd: process.cwd(),
			env: { ...process.env, CLAUDE_NATIVE_DEBUG: "1" },
			idleTimeoutMs: 1_000,
			spawnFn: spawnFn as any,
		});

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;
		proc.terminate("test cleanup");

		const logs = err.mock.calls.flat().join("\n");
		expect(logs).toContain("process.spawn");
		expect(logs).toContain("process.terminate");
		expect(logs).not.toContain("claude-secret-session");
	});

	it("dispatches stdout lines to onOutOfTurnMessage when no turn is in flight", async () => {
		const child = new FakeClaudeChild();
		const spawnFn = vi.fn(() => child as any);
		const outOfTurn: any[] = [];
		const proc = new ClaudeNativeProcess({
			bin: "claude",
			args: ["-p"],
			cwd: process.cwd(),
			env: process.env,
			idleTimeoutMs: 60_000,
			spawnFn: spawnFn as any,
			onOutOfTurnMessage: (msg) => outOfTurn.push(msg),
		});

		const inTurn: any[] = [];
		const turn = proc.runTurn("hello", { onMessage: (msg) => inTurn.push(msg) });
		writeJson(child, { type: "assistant", message: { content: [] } });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		// Out-of-turn line after the result event resolves the turn.
		writeJson(child, {
			type: "system",
			subtype: "task_notification",
			task_id: "bash_1",
			status: "completed",
		});
		await new Promise((resolve) => setImmediate(resolve));

		expect(outOfTurn).toEqual([
			expect.objectContaining({ type: "system", subtype: "task_notification", task_id: "bash_1" }),
		]);
		// The same message should NOT have been delivered to the (already-finished) turn handler.
		expect(inTurn.map((m) => m.type)).toEqual(["assistant", "result"]);
		proc.terminate("test cleanup");
	});

	it("defers idle reap when shouldDeferIdleReap returns true", async () => {
		vi.useFakeTimers();
		const child = new FakeClaudeChild();
		const spawnFn = vi.fn(() => child as any);
		let live = true;
		const proc = new ClaudeNativeProcess({
			bin: "claude",
			args: ["-p"],
			cwd: process.cwd(),
			env: process.env,
			idleTimeoutMs: 1_000,
			spawnFn: spawnFn as any,
			shouldDeferIdleReap: () => live,
		});

		const turn = proc.runTurn("hello", { onMessage: () => {} });
		writeJson(child, { type: "result", subtype: "success" });
		await turn;

		// First idle window — deferred.
		vi.advanceTimersByTime(1_000);
		expect(child.killed).toBe(false);
		expect(proc.isLive()).toBe(true);

		// Drop the live flag, next idle window reaps.
		live = false;
		vi.advanceTimersByTime(1_000);
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(proc.isLive()).toBe(false);
	});
});
