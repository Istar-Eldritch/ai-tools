import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildClaudeArgs, encodeUserInput, isClaudeResultEvent, modelAlias, numberFromEnv } from "./claude-protocol.ts";

const model: any = { id: "sonnet", api: "claude-native-cli", provider: "claude-native" };

describe("claude protocol helpers", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("builds long-lived stream-json args", () => {
		const args = buildClaudeArgs(model, undefined);
		expect(args).toContain("--input-format");
		expect(args).toContain("stream-json");
		expect(args).toContain("--output-format");
		expect(args).toContain("--model");
		expect(args).toContain("sonnet");
	});

	it("does not pass local permission sentinel none", () => {
		process.env.CLAUDE_NATIVE_PERMISSION_MODE = "none";
		expect(buildClaudeArgs(model, undefined)).not.toContain("--permission-mode");
	});

	it("passes resume session unless disabled", () => {
		expect(buildClaudeArgs(model, "session-1")).toEqual(expect.arrayContaining(["--resume", "session-1"]));
		process.env.CLAUDE_NATIVE_NO_RESUME = "1";
		expect(buildClaudeArgs(model, "session-1")).not.toContain("--resume");
	});

	it("passes explicit session ids and configured effort", () => {
		process.env.CLAUDE_NATIVE_EFFORT = "high";
		expect(buildClaudeArgs(model, { sessionId: "session-1", isFirstSessionUse: true })).toEqual(expect.arrayContaining(["--effort", "high", "--session-id", "session-1"]));
		expect(buildClaudeArgs(model, { sessionId: "session-1", isFirstSessionUse: false })).toEqual(expect.arrayContaining(["--effort", "high", "--resume", "session-1"]));
		process.env.CLAUDE_NATIVE_EFFORT = "invalid";
		expect(buildClaudeArgs(model, undefined)).not.toContain("--effort");
	});

	it("passes configured tool and turn options", () => {
		process.env.CLAUDE_NATIVE_ALLOWED_TOOLS = "read,write";
		process.env.CLAUDE_NATIVE_MAX_TURNS = "2";
		const args = buildClaudeArgs(model, undefined);
		expect(args).toEqual(expect.arrayContaining(["--allowedTools", "read,write", "--max-turns", "2"]));
	});

	it("encodes one user input JSON line", () => {
		const line = encodeUserInput("hello");
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line).message.content[0].text).toBe("hello");
	});

	it("encodes mixed text and image content blocks", () => {
		const line = encodeUserInput([
			{ type: "text", text: "look" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "DATA" } },
		]);
		const parsed = JSON.parse(line);
		expect(parsed.message.content).toEqual([
			{ type: "text", text: "look" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "DATA" } },
		]);
	});

	it("maps model ids to aliases", () => {
		expect(modelAlias("claude-opus-4")).toBe("opus");
		expect(modelAlias("claude-3-5-haiku")).toBe("haiku");
		expect(modelAlias("claude-sonnet-4")).toBe("sonnet");
		expect(modelAlias("unknown")).toBe("sonnet");
	});

	it("reads finite numbers from env with fallback", () => {
		process.env.TEST_NUMBER = "42";
		expect(numberFromEnv("TEST_NUMBER", 1)).toBe(42);
		process.env.TEST_NUMBER = "wat";
		expect(numberFromEnv("TEST_NUMBER", 1)).toBe(1);
		delete process.env.TEST_NUMBER;
		expect(numberFromEnv("TEST_NUMBER", 1)).toBe(1);
	});

	it("detects result events", () => {
		expect(isClaudeResultEvent({ type: "result" })).toBe(true);
		expect(isClaudeResultEvent({ type: "assistant" })).toBe(false);
		expect(isClaudeResultEvent(null)).toBe(false);
	});
});
