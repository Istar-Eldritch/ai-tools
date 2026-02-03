import { describe, it, expect } from "vitest";
import {
	formatBox,
	formatDivider,
	formatKeyValue,
	formatStage,
	formatModelConfig,
	formatTieredConfig,
	summarizeAgentOutput,
} from "./formatting.ts";

describe("formatDivider", () => {
	it("creates divider of default width", () => {
		const divider = formatDivider();
		expect(divider).toBe("─".repeat(60));
	});

	it("creates divider of specified width", () => {
		const divider = formatDivider(40);
		expect(divider).toBe("─".repeat(40));
	});

	it("creates divider of width 1", () => {
		const divider = formatDivider(1);
		expect(divider).toBe("─");
	});
});

describe("formatKeyValue", () => {
	it("formats key-value with default width", () => {
		const result = formatKeyValue("Status", "Running");
		expect(result).toBe("Status        : Running");
	});

	it("formats key-value with custom width", () => {
		const result = formatKeyValue("Key", "Value", 10);
		expect(result).toBe("Key       : Value");
	});

	it("handles long keys", () => {
		const result = formatKeyValue("VeryLongKeyName", "Value", 10);
		expect(result).toBe("VeryLongKeyName: Value");
	});

	it("handles empty value", () => {
		const result = formatKeyValue("Key", "");
		expect(result).toBe("Key           : ");
	});
});

describe("formatBox", () => {
	it("creates a box with title and content", () => {
		const box = formatBox("Test", ["Line 1", "Line 2"], 30);
		const lines = box.split("\n");
		
		// Should have top border, content lines, bottom border
		expect(lines.length).toBe(4);
		expect(lines[0]).toContain("Test");
		expect(lines[0]).toContain("┌");
		expect(lines[0]).toContain("┐");
		expect(lines[1]).toContain("Line 1");
		expect(lines[2]).toContain("Line 2");
		expect(lines[3]).toContain("└");
		expect(lines[3]).toContain("┘");
	});

	it("wraps long lines", () => {
		const longLine = "This is a very long line that should be wrapped to fit within the box width";
		const box = formatBox("Wrap Test", [longLine], 40);
		const lines = box.split("\n");
		
		// Should have more than 3 lines (top, wrapped content, bottom)
		expect(lines.length).toBeGreaterThan(3);
	});

	it("handles empty content", () => {
		const box = formatBox("Empty", [], 30);
		const lines = box.split("\n");
		
		// Should have just top and bottom borders
		expect(lines.length).toBe(2);
	});

	it("uses default width", () => {
		const box = formatBox("Default Width", ["Content"]);
		const lines = box.split("\n");
		
		// Default width is 60
		expect(lines[0].length).toBe(60);
	});
});

describe("formatStage", () => {
	it("formats discovery stage", () => {
		expect(formatStage("discovery")).toBe("🔍 Discovery");
	});

	it("formats spec_drafting stage", () => {
		expect(formatStage("spec_drafting")).toBe("📝 Spec Drafting");
	});

	it("formats spec_review stage", () => {
		expect(formatStage("spec_review")).toBe("🔍 Spec Review");
	});

	it("formats user_approval stage", () => {
		expect(formatStage("user_approval")).toBe("👤 Awaiting User Approval");
	});

	it("formats plan_generation stage", () => {
		expect(formatStage("plan_generation")).toBe("📋 Plan Generation");
	});

	it("formats spec_commit stage", () => {
		expect(formatStage("spec_commit")).toBe("💾 Spec Commit");
	});

	it("formats implementation stage", () => {
		expect(formatStage("implementation")).toBe("🚀 Implementation");
	});

	it("formats completed stage", () => {
		expect(formatStage("completed")).toBe("✅ Completed");
	});

	it("formats cancelled stage", () => {
		expect(formatStage("cancelled")).toBe("❌ Cancelled");
	});
});

describe("formatModelConfig", () => {
	it("formats model with thinking level", () => {
		expect(formatModelConfig({ model: "opus", thinking: "high" })).toBe("opus/high");
	});

	it("formats sonnet with medium thinking", () => {
		expect(formatModelConfig({ model: "sonnet", thinking: "medium" })).toBe("sonnet/medium");
	});

	it("formats haiku with off thinking", () => {
		expect(formatModelConfig({ model: "haiku", thinking: "off" })).toBe("haiku/off");
	});
});

describe("formatTieredConfig", () => {
	it("formats tiered config with cheap and expensive", () => {
		const config = {
			cheap: { model: "sonnet" as const, thinking: "medium" as const },
			expensive: { model: "opus" as const, thinking: "high" as const },
		};
		expect(formatTieredConfig(config)).toBe(
			"cheap=sonnet/medium, expensive=opus/high"
		);
	});
});

describe("summarizeAgentOutput", () => {
	it("returns short output as-is", () => {
		const output = "Short output";
		expect(summarizeAgentOutput(output)).toBe("Short output");
	});

	it("returns '(no output)' for empty string", () => {
		expect(summarizeAgentOutput("")).toBe("(no output)");
	});

	it("returns '(no output)' for whitespace only", () => {
		expect(summarizeAgentOutput("   \n\t  ")).toBe("(no output)");
	});

	it("truncates long output by lines", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
		const output = lines.join("\n");
		const summary = summarizeAgentOutput(output, 10);
		
		// Should contain indicator of omitted lines
		expect(summary).toContain("omitted");
		// Should have fewer lines than original
		expect(summary.split("\n").length).toBeLessThan(20);
	});

	it("truncates long output by characters", () => {
		const longLine = "x".repeat(1000);
		const summary = summarizeAgentOutput(longLine, 10, 100);
		
		expect(summary.length).toBeLessThanOrEqual(100);
		expect(summary).toContain("truncated");
	});

	it("preserves beginning and end of output", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
		const output = lines.join("\n");
		const summary = summarizeAgentOutput(output, 10);
		
		// Should have first lines
		expect(summary).toContain("Line 1");
		// Should have last lines
		expect(summary).toContain("Line 20");
	});

	it("respects custom maxLines parameter", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
		const output = lines.join("\n");
		
		// With maxLines=5, should truncate
		const summary5 = summarizeAgentOutput(output, 5);
		expect(summary5).toContain("omitted");
		
		// With maxLines=15, should not truncate
		const summary15 = summarizeAgentOutput(output, 15);
		expect(summary15).not.toContain("omitted");
	});
});
