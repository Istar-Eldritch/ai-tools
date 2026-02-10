import { describe, it, expect } from "vitest";
import type { AgentOutputEvent, ToolEventData, TextEventData } from "./types.ts";

describe("AgentOutputEvent type narrowing", () => {
	it("should correctly identify tool events", () => {
		const toolEvent: AgentOutputEvent = {
			type: "tool",
			name: "read",
			arguments: { path: "test.ts" },
		};

		if (typeof toolEvent !== "string" && "type" in toolEvent && toolEvent.type === "tool") {
			expect(toolEvent.name).toBe("read");
			expect(toolEvent.arguments.path).toBe("test.ts");
		} else {
			throw new Error("Type narrowing failed for tool event");
		}
	});

	it("should correctly identify text string events", () => {
		const textEvent: AgentOutputEvent = "some text";

		if (typeof textEvent === "string") {
			expect(textEvent).toBe("some text");
		} else {
			throw new Error("Type narrowing failed for text string");
		}
	});

	it("should correctly identify text delta events", () => {
		const textEvent: AgentOutputEvent = {
			type: "text",
			delta: "delta text",
		};

		if (typeof textEvent !== "string" && "type" in textEvent && textEvent.type === "text") {
			expect(textEvent.delta).toBe("delta text");
		} else {
			throw new Error("Type narrowing failed for text delta event");
		}
	});
});

describe("ToolEventData structure", () => {
	it("should accept valid tool event with string arguments", () => {
		const toolEvent: ToolEventData = {
			type: "tool",
			name: "read",
			arguments: { path: "src/test.ts" },
		};

		expect(toolEvent.type).toBe("tool");
		expect(toolEvent.name).toBe("read");
		expect(toolEvent.arguments).toEqual({ path: "src/test.ts" });
	});

	it("should accept valid tool event with complex arguments", () => {
		const toolEvent: ToolEventData = {
			type: "tool",
			name: "edit",
			arguments: {
				path: "src/test.ts",
				oldText: "const x = 1;",
				newText: "const x = 2;",
			},
		};

		expect(toolEvent.type).toBe("tool");
		expect(toolEvent.name).toBe("edit");
		expect(toolEvent.arguments).toHaveProperty("path");
		expect(toolEvent.arguments).toHaveProperty("oldText");
		expect(toolEvent.arguments).toHaveProperty("newText");
	});

	it("should accept valid tool event with array arguments", () => {
		const toolEvent: ToolEventData = {
			type: "tool",
			name: "bash",
			arguments: {
				command: "npm test",
				timeout: 300,
			},
		};

		expect(toolEvent.type).toBe("tool");
		expect(toolEvent.name).toBe("bash");
		expect(toolEvent.arguments.command).toBe("npm test");
		expect(toolEvent.arguments.timeout).toBe(300);
	});
});

describe("TextEventData structure", () => {
	it("should accept valid text delta event", () => {
		const textEvent: TextEventData = {
			type: "text",
			delta: "some text content",
		};

		expect(textEvent.type).toBe("text");
		expect(textEvent.delta).toBe("some text content");
	});

	it("should accept empty delta", () => {
		const textEvent: TextEventData = {
			type: "text",
			delta: "",
		};

		expect(textEvent.type).toBe("text");
		expect(textEvent.delta).toBe("");
	});
});

describe("AgentOutputEvent union type", () => {
	it("should accept string (backward compatibility)", () => {
		const event: AgentOutputEvent = "legacy text";
		expect(typeof event).toBe("string");
	});

	it("should accept ToolEventData", () => {
		const event: AgentOutputEvent = {
			type: "tool",
			name: "write",
			arguments: { path: "test.ts", content: "code" },
		};
		expect(typeof event).toBe("object");
		if (typeof event !== "string") {
			expect(event.type).toBe("tool");
		}
	});

	it("should accept TextEventData", () => {
		const event: AgentOutputEvent = {
			type: "text",
			delta: "text content",
		};
		expect(typeof event).toBe("object");
		if (typeof event !== "string") {
			expect(event.type).toBe("text");
		}
	});
});

describe("Event type guards", () => {
	it("should distinguish between string and object events", () => {
		const events: AgentOutputEvent[] = [
			"string event",
			{ type: "tool", name: "read", arguments: { path: "test.ts" } },
			{ type: "text", delta: "text delta" },
		];

		const strings = events.filter((e) => typeof e === "string");
		const objects = events.filter((e) => typeof e !== "string");

		expect(strings.length).toBe(1);
		expect(objects.length).toBe(2);
	});

	it("should distinguish between tool and text events", () => {
		const events: AgentOutputEvent[] = [
			{ type: "tool", name: "read", arguments: { path: "test.ts" } },
			{ type: "text", delta: "text delta" },
			"string event",
		];

		const toolEvents = events.filter(
			(e): e is ToolEventData => typeof e !== "string" && "type" in e && e.type === "tool"
		);
		const textEvents = events.filter(
			(e): e is TextEventData => typeof e !== "string" && "type" in e && e.type === "text"
		);
		const stringEvents = events.filter((e): e is string => typeof e === "string");

		expect(toolEvents.length).toBe(1);
		expect(textEvents.length).toBe(1);
		expect(stringEvents.length).toBe(1);

		// Verify type narrowing works
		if (toolEvents[0]) {
			expect(toolEvents[0].name).toBe("read");
		}
		if (textEvents[0]) {
			expect(textEvents[0].delta).toBe("text delta");
		}
	});
});
