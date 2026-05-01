import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Scenario {
	messages?: any[];
	stderr?: string[];
	statuses?: string[];
	malformed?: string[];
	reject?: string;
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

		if (scenario.reject) throw new Error(scenario.reject);
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

function createModel(id = "sonnet") {
	return { id, api: "claude-native-cli", provider: "claude-native" } as any;
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

	it("creates a new process when the model signature changes", async () => {
		MockClaudeNativeProcess.scenarios.push(
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "one" }] },
			{ messages: [{ type: "result", subtype: "success", is_error: false, result: "two" }] },
		);

		const { streamClaudeNative } = await loadModule();
		await collectEvents(streamClaudeNative(createModel("sonnet"), createContext("one")));
		await collectEvents(streamClaudeNative(createModel("haiku"), createContext("two")));

		expect(MockClaudeNativeProcess.instances).toHaveLength(2);
		expect(MockClaudeNativeProcess.instances[0].terminateReasons).toEqual(["model or cwd changed"]);
		expect(MockClaudeNativeProcess.instances[1].prompts).toEqual(["two"]);
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
		expect(notify).toHaveBeenCalledWith("Claude native process and session state reset", "info");
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
		expect(MockClaudeNativeProcess.instances[0].terminateReasons).toEqual(["session shutdown"]);
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
