import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Scenario {
	messages?: any[];
	stderr?: string[];
	statuses?: string[];
	malformed?: string[];
	reject?: string | Error | { message: string; code?: string; unsafeSession?: boolean };
	waitFor?: Promise<void>;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

class MockClaudeNativeProcess {
	static instances: MockClaudeNativeProcess[] = [];
	static scenarios: Scenario[] = [];

	static reset() {
		MockClaudeNativeProcess.instances = [];
		MockClaudeNativeProcess.scenarios = [];
	}

	readonly prompts: string[] = [];
	readonly turnOptions: any[] = [];
	readonly terminateReasons: string[] = [];
	live = true;

	constructor(readonly config: any) {
		MockClaudeNativeProcess.instances.push(this);
	}

	isLive() {
		return this.live;
	}

	terminate(reason: string) {
		this.live = false;
		this.terminateReasons.push(reason);
	}

	async runTurn(prompt: string, handlers: any, options: any = {}) {
		this.prompts.push(prompt);
		this.turnOptions.push(options);
		const scenario = MockClaudeNativeProcess.scenarios.shift() ?? {
			messages: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
		};

		if (scenario.reject) {
			if (typeof scenario.reject === "string" || scenario.reject instanceof Error) throw scenario.reject;
			const err = new Error(scenario.reject.message) as Error & { code?: string; unsafeSession?: boolean };
			err.code = scenario.reject.code;
			err.unsafeSession = scenario.reject.unsafeSession;
			throw err;
		}
		if (scenario.waitFor) await scenario.waitFor;
		for (const status of scenario.statuses ?? []) handlers.onStatus?.(status);
		for (const line of scenario.malformed ?? []) handlers.onMalformedJson?.(line);
		for (const text of scenario.stderr ?? []) handlers.onStderr?.(text);
		for (const message of scenario.messages ?? []) handlers.onMessage(message);
	}
}

async function loadModule() {
	vi.resetModules();
	vi.doMock("./claude-process.ts", () => ({ ClaudeNativeProcess: MockClaudeNativeProcess }));
	return import("./index.ts");
}

async function collectEvents(stream: AsyncIterable<any>) {
	const events: any[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function terminalEvents(events: any[]) {
	return events.filter((event) => event.type === "done" || event.type === "error");
}

function createModel(id = "sonnet") {
	return {
		id,
		api: "claude-native-cli",
		provider: "claude-native",
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	} as any;
}

function createContext(text = "hello from user") {
	return { messages: [{ role: "user", content: text }] } as any;
}

function createPi() {
	const providers = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any>();
	return {
		providers,
		commands,
		handlers,
		api: {
			registerProvider: (name: string, provider: any) => providers.set(name, provider),
			registerCommand: (name: string, command: any) => commands.set(name, command),
			on: (event: string, handler: any) => handlers.set(event, handler),
		},
	};
}

function eventFor(name: string): any {
	const signal = new AbortController().signal;
	const events: Record<string, any> = {
		session_before_tree: { type: "session_before_tree", preparation: { targetId: "target", oldLeafId: "old" }, signal },
		session_tree: { type: "session_tree", oldLeafId: "old", newLeafId: "new" },
		session_before_fork: { type: "session_before_fork", entryId: "entry-1" },
		session_fork: { type: "session_fork", previousSessionFile: "/tmp/old.jsonl" },
		session_before_switch: { type: "session_before_switch", reason: "resume", targetSessionFile: "/tmp/new.jsonl" },
		session_switch: { type: "session_switch", reason: "resume", previousSessionFile: "/tmp/old.jsonl" },
		session_before_compact: { type: "session_before_compact", preparation: {}, branchEntries: [], signal },
		session_compact: { type: "session_compact", compactionEntry: {}, fromExtension: false },
		session_shutdown: { type: "session_shutdown" },
	};
	return events[name];
}

describe("claude native provider integration", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		MockClaudeNativeProcess.reset();
	});

	afterEach(() => {
		process.env = originalEnv;
		MockClaudeNativeProcess.reset();
		vi.restoreAllMocks();
	});

	it("reuses the same process for repeated calls in the same model/cwd and preserves Pi stream events", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				statuses: ["booted"],
				messages: [
					{ type: "assistant", session_id: "session-1", message: { content: [{ type: "text", text: "First reply" }] } },
					{ type: "result", subtype: "success", is_error: false, stop_reason: "tool_use", result: "ignored" },
				],
			},
			{
				messages: [
					{ type: "streamlined_text", text: "Second reply" },
					{ type: "result", subtype: "success", is_error: false, result: "done" },
				],
			},
		);

		const { streamClaudeNative } = await loadModule();
		const firstEvents = await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("first prompt")));
		const secondEvents = await collectEvents(streamClaudeNative(createModel("claude-sonnet-4"), createContext("second prompt")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(1);
		expect(MockClaudeNativeProcess.instances[0].prompts).toEqual(["first prompt", "second prompt"]);
		expect(firstEvents[0].type).toBe("start");
		expect(firstEvents.some((event) => event.type === "text_delta" && event.delta === "First reply")).toBe(true);
		expect(firstEvents.at(-1)).toMatchObject({ type: "done", reason: "toolUse" });
		expect(secondEvents[0].type).toBe("start");
		expect(secondEvents.some((event) => event.type === "text_delta" && event.delta === "Second reply")).toBe(true);
		expect(secondEvents.at(-1)).toMatchObject({ type: "done", reason: "stop" });
	});

	it("isolates remembered session ids across model changes", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "session-sonnet", result: "one" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "two" }] },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "three" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("one")));
		await collectEvents(streamClaudeNative(createModel("haiku"), createContext("two")));
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("three")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[0].prompts).toEqual(["one", "three"]);
	});

	it("isolates remembered session ids across cwd changes", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "session-cwd-a", result: "one" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "two" }] },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "three" }] },
		);

		let cwd = "/tmp/a";
		vi.spyOn(process, "cwd").mockImplementation(() => cwd);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("one")));
		cwd = "/tmp/b";
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("two")));
		MockClaudeNativeProcess.instances[0].live = false;
		cwd = "/tmp/a";
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("three")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(3);
		expect(MockClaudeNativeProcess.instances[0].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[2].config.args).toEqual(expect.arrayContaining(["--resume", "session-cwd-a"]));
	});

	it("isolates processes and remembered Claude session ids across Pi session identities", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "claude-a", result: "one" },
				],
			},
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "claude-b", result: "two" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "three" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("one"), { sessionId: "pi-a" }));
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("two"), { sessionId: "pi-b" }));
		MockClaudeNativeProcess.instances[0].live = false;
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("three"), { sessionId: "pi-a" }));

		expect(MockClaudeNativeProcess.instances).toHaveLength(3);
		expect(MockClaudeNativeProcess.instances[0].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[2].config.args).toEqual(expect.arrayContaining(["--resume", "claude-a"]));
		expect(MockClaudeNativeProcess.instances[0].prompts).toEqual(["one"]);
		expect(MockClaudeNativeProcess.instances[1].prompts).toEqual(["two"]);
		expect(MockClaudeNativeProcess.instances[2].prompts).toEqual(["three"]);
	});

	it("does not terminate an in-flight turn when a different signature starts concurrently", async () => {
		const firstTurn = deferred();
		const secondTurn = deferred();
		MockClaudeNativeProcess.scenarios.push(
			{
				waitFor: firstTurn.promise,
				messages: [{ type: "result", subtype: "success", is_error: false, result: "one" }],
			},
			{
				waitFor: secondTurn.promise,
				messages: [{ type: "result", subtype: "success", is_error: false, result: "two" }],
			},
		);

		const { streamClaudeNative } = await loadModule();
		const firstEventsPromise = collectEvents(streamClaudeNative(createModel("sonnet"), createContext("one")));
		await Promise.resolve();
		const secondEventsPromise = collectEvents(streamClaudeNative(createModel("haiku"), createContext("two")));
		await Promise.resolve();

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons).toEqual([]);
		expect(MockClaudeNativeProcess.instances[1].terminateReasons).toEqual([]);

		secondTurn.resolve();
		firstTurn.resolve();

		const [firstEvents, secondEvents] = await Promise.all([firstEventsPromise, secondEventsPromise]);
		expect(firstEvents.at(-1)).toMatchObject({ type: "done", reason: "stop" });
		expect(secondEvents.at(-1)).toMatchObject({ type: "done", reason: "stop" });
	});

	it.each([
		"session_before_tree",
		"session_tree",
		"session_before_fork",
		"session_fork",
		"session_before_switch",
		"session_switch",
		"session_before_compact",
		"session_compact",
		"session_shutdown",
	])("hard-invalidates Claude session state on %s", async (eventName) => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "claude-before", result: "before" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const mod = await loadModule();
		const pi = createPi();
		mod.default(pi.api as any);

		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("before"), { sessionId: "pi-session" }));
		await pi.handlers.get(eventName)(eventFor(eventName));
		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("after"), { sessionId: "pi-session" }));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons[0]).toContain(eventName);
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("claude-before");
	});

	it("retires live processes on model_select but preserves remembered Claude sessions", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "claude-sonnet", result: "before" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const mod = await loadModule();
		const pi = createPi();
		mod.default(pi.api as any);

		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("before"), { sessionId: "pi-session" }));
		await pi.handlers.get("model_select")({
			type: "model_select",
			model: createModel("haiku"),
			previousModel: createModel("sonnet"),
			source: "set",
		});
		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("after"), { sessionId: "pi-session" }));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons[0]).toContain("model_select");
		expect(MockClaudeNativeProcess.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-sonnet"]));
	});

	it("reset command terminates the process and clears the remembered session id", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{
				messages: [
					{ type: "result", subtype: "success", is_error: false, session_id: "session-1", result: "ok" },
				],
			},
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after reset" }] },
		);

		const mod = await loadModule();
		const pi = createPi();
		mod.default(pi.api as any);

		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("before reset")));
		const notify = vi.fn();
		await pi.commands.get("claude-native-reset").handler([], { ui: { notify } });
		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("after reset")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons).toEqual(["reset command"]);
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(notify).toHaveBeenCalledWith(
			"Claude native process/session state reset: terminated 1 live process(es), cleared 1 remembered Claude session(s).",
			"info",
		);
	});

	it("emits start and reuse status updates for process diagnostics", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "one" }] },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "two" }] },
		);

		const { streamClaudeNative } = await loadModule();
		const firstEvents = await collectEvents(streamClaudeNative(createModel(), createContext("one")));
		const secondEvents = await collectEvents(streamClaudeNative(createModel(), createContext("two")));

		expect(firstEvents.some((event) => event.type === "thinking_delta" && event.delta.includes("process started"))).toBe(true);
		expect(secondEvents.some((event) => event.type === "thinking_delta" && event.delta.includes("process reused"))).toBe(true);
	});

	it("status command reports pool counts without exposing raw Claude session ids", async () => {
		MockClaudeNativeProcess.scenarios.push({
			messages: [{ type: "result", subtype: "success", is_error: false, session_id: "raw-claude-session-secret", result: "ok" }],
		});
		const mod = await loadModule();
		const pi = createPi();
		mod.default(pi.api as any);

		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("status"), { sessionId: "pi-a" }));
		const notify = vi.fn();
		await pi.commands.get("claude-native-status").handler("", { ui: { notify } });

		const message = notify.mock.calls[0][0] as string;
		expect(message).toContain("1 live process(es)");
		expect(message).toContain("1 remembered Claude session(s)");
		expect(message).toContain("model=sonnet");
		expect(message).toContain("piSession=pi-a");
		expect(message).toContain("claudeSession=remembered");
		expect(message).not.toContain("raw-claude-session-secret");
	});

	it("cleans up the active process on session shutdown", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "before shutdown" }] },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after shutdown" }] },
		);

		const mod = await loadModule();
		const pi = createPi();
		mod.default(pi.api as any);

		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("before shutdown")));
		await pi.handlers.get("session_shutdown")();
		await collectEvents(pi.providers.get("claude-native").streamSimple(createModel("sonnet"), createContext("after shutdown")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons).toEqual(["session_shutdown"]);
	});

	it("maps usage and costs from Claude result events", async () => {
		MockClaudeNativeProcess.scenarios.push({
			messages: [{
				type: "result",
				subtype: "success",
				is_error: false,
				result: "ok",
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_read_input_tokens: 2,
					cache_creation_input_tokens: 1,
				},
			}],
		});

		const { streamClaudeNative } = await loadModule();
		const events = await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("usage")));
		const done = events.at(-1);

		expect(done).toMatchObject({ type: "done", reason: "stop" });
		expect(done.message.usage).toMatchObject({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 });
		expect(done.message.usage.cost.total).toBeGreaterThan(0);
	});

	it("suppresses status/thinking events when CLAUDE_NATIVE_STATUS_UPDATES=0", async () => {
		process.env.CLAUDE_NATIVE_STATUS_UPDATES = "0";
		MockClaudeNativeProcess.scenarios.push({
			statuses: ["booted"],
			stderr: ["warning\n"],
			messages: [{ type: "result", subtype: "success", is_error: false, result: "ok" }],
		});

		const { streamClaudeNative } = await loadModule();
		const events = await collectEvents(streamClaudeNative(createModel(), createContext("quiet")));

		expect(events.some((event) => event.type.startsWith("thinking"))).toBe(false);
		expect(events.at(-1)).toMatchObject({ type: "done", reason: "stop" });
	});

	it("surfaces Claude Code tool summaries as user-visible text", async () => {
		MockClaudeNativeProcess.scenarios.push({
			messages: [
				{ type: "streamlined_tool_use_summary", tool_summary: "Read package.json" },
				{ type: "result", subtype: "success", is_error: false, result: "done" },
			],
		});

		const { streamClaudeNative } = await loadModule();
		const events = await collectEvents(streamClaudeNative(createModel(), createContext("tools")));

		expect(events.some((event) => event.type === "text_delta" && event.delta.includes("Read package.json"))).toBe(true);
	});

	it("surfaces malformed Claude output compatibly and still emits exactly one terminal Pi event", async () => {
		MockClaudeNativeProcess.scenarios.push({
			malformed: ["{not valid json"],
			messages: [
				{ type: "streamlined_text", text: "Recovered reply" },
				{ type: "result", subtype: "success", is_error: false, result: "done" },
			],
		});

		const { streamClaudeNative } = await loadModule();
		const events = await collectEvents(streamClaudeNative(createModel(), createContext("malformed")));

		expect(events.some((event) => event.type === "thinking_delta" && event.delta.includes("malformed JSON: {not valid json"))).toBe(true);
		expect(events.some((event) => event.type === "text_delta" && event.delta === "Recovered reply")).toBe(true);
		expect(terminalEvents(events)).toEqual([expect.objectContaining({ type: "done", reason: "stop" })]);
	});

	it("emits aborted Pi error events and clears unsafe session state", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, session_id: "claude-before", result: "before" }] },
			{ reject: { message: "Claude Code request aborted", code: "aborted", unsafeSession: true } },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel(), createContext("before"), { sessionId: "pi-a" }));
		const controller = new AbortController();
		controller.abort();
		const abortedEvents = await collectEvents(streamClaudeNative(createModel(), createContext("abort"), { sessionId: "pi-a", signal: controller.signal } as any));
		await collectEvents(streamClaudeNative(createModel(), createContext("after"), { sessionId: "pi-a" }));

		expect(terminalEvents(abortedEvents)).toEqual([expect.objectContaining({ type: "error", reason: "aborted" })]);
		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons[0]).toContain("request failed");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("claude-before");
	});

	it("emits timeout errors and clears unsafe session state", async () => {
		process.env.CLAUDE_NATIVE_TIMEOUT_MS = "50";
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, session_id: "claude-before", result: "before" }] },
			{ reject: { message: "Claude Code timed out after 50ms", code: "timeout", unsafeSession: true } },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel(), createContext("before"), { sessionId: "pi-a" }));
		const timeoutEvents = await collectEvents(streamClaudeNative(createModel(), createContext("timeout"), { sessionId: "pi-a" }));
		await collectEvents(streamClaudeNative(createModel(), createContext("after"), { sessionId: "pi-a" }));

		expect(MockClaudeNativeProcess.instances[0].turnOptions[1].timeoutMs).toBe(50);
		expect(terminalEvents(timeoutEvents)).toEqual([expect.objectContaining({ type: "error", reason: "error" })]);
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
	});

	it("emits stdin write failures as a single Pi error event and clears unsafe session state", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, session_id: "claude-before", result: "before" }] },
			{ reject: { message: "stdin exploded", code: "stdin_error", unsafeSession: true } },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel(), createContext("before"), { sessionId: "pi-a" }));
		const stdinErrorEvents = await collectEvents(streamClaudeNative(createModel(), createContext("stdin fail"), { sessionId: "pi-a" }));
		await collectEvents(streamClaudeNative(createModel(), createContext("after"), { sessionId: "pi-a" }));

		expect(terminalEvents(stdinErrorEvents)).toEqual([expect.objectContaining({ type: "error", reason: "error" })]);
		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons[0]).toContain("request failed: stdin exploded");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("claude-before");
	});

	it("emits process errors as a single Pi error event and clears unsafe session state", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, session_id: "claude-before", result: "before" }] },
			{ reject: { message: "spawn exploded", code: "process_error", unsafeSession: true } },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel(), createContext("before"), { sessionId: "pi-a" }));
		const processErrorEvents = await collectEvents(streamClaudeNative(createModel(), createContext("process fail"), { sessionId: "pi-a" }));
		await collectEvents(streamClaudeNative(createModel(), createContext("after"), { sessionId: "pi-a" }));

		expect(terminalEvents(processErrorEvents)).toEqual([expect.objectContaining({ type: "error", reason: "error" })]);
		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons[0]).toContain("request failed: spawn exploded");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("--resume");
		expect(MockClaudeNativeProcess.instances[1].config.args).not.toContain("claude-before");
	});

	it("restarts after a safe between-turn crash and resumes the remembered Claude session", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, session_id: "claude-safe", result: "before" }] },
			{ reject: { message: "Claude Code exited with code 0", code: "process_close", unsafeSession: false } },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "after" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel(), createContext("before"), { sessionId: "pi-a" }));
		const failedEvents = await collectEvents(streamClaudeNative(createModel(), createContext("failed"), { sessionId: "pi-a" }));
		await collectEvents(streamClaudeNative(createModel(), createContext("after"), { sessionId: "pi-a" }));

		expect(terminalEvents(failedEvents)).toEqual([expect.objectContaining({ type: "error", reason: "error" })]);
		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[1].config.args).toEqual(expect.arrayContaining(["--resume", "claude-safe"]));
	});

	it("emits an error event when Claude returns a failed result even with a stop_reason", async () => {
		MockClaudeNativeProcess.scenarios.push({
			messages: [
				{
					type: "result",
					subtype: "error_max_tokens",
					is_error: true,
					stop_reason: "max_tokens",
					result: "boom",
				},
			],
		});

		const { streamClaudeNative } = await loadModule();
		const events = await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("fail")));
		const finalEvent = events.at(-1);

		expect(finalEvent).toMatchObject({ type: "error", reason: "error" });
		expect(finalEvent.error.stopReason).toBe("error");
		expect(finalEvent.error.errorMessage).toContain("boom");
	});
});
