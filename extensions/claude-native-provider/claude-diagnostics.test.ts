import { afterEach, describe, expect, it, vi } from "vitest";
import { isClaudeNativeDebugEnabled, logClaudeNativeDiagnostic, redactClaudeArgs, redactSessionId } from "./claude-diagnostics.ts";

describe("claude native diagnostics", () => {
	afterEach(() => vi.restoreAllMocks());

	it("enables debug logging only through explicit env values", () => {
		expect(isClaudeNativeDebugEnabled({} as any)).toBe(false);
		expect(isClaudeNativeDebugEnabled({ CLAUDE_NATIVE_DEBUG: "1" } as any)).toBe(true);
		expect(isClaudeNativeDebugEnabled({ CLAUDE_NATIVE_DIAGNOSTICS: "true" } as any)).toBe(true);
	});

	it("redacts session ids and resume args", () => {
		expect(redactSessionId("session-abcdef123456")).toBe("sess…3456");
		expect(redactClaudeArgs(["-p", "--resume", "session-abcdef123456"])).toEqual(["-p", "--resume", "sess…3456"]);
	});

	it("does not log unless diagnostics are enabled", () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
		logClaudeNativeDiagnostic("test", { a: 1 }, {} as any);
		expect(err).not.toHaveBeenCalled();
		logClaudeNativeDiagnostic("test", { a: 1 }, { CLAUDE_NATIVE_DEBUG: "1" } as any);
		expect(err).toHaveBeenCalledWith('[claude-native] test {"a":1}');
	});
});
