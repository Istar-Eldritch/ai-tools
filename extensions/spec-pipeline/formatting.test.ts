import { describe, it, expect } from "vitest";
import {
	formatBox,
	formatDivider,
	formatKeyValue,
	formatStage,
	formatModelConfig,
	formatTieredConfig,
	summarizeAgentOutput,
	formatState,
	updatePipelineWidget,
} from "./formatting.ts";
import type { PipelineState } from "./types.ts";

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

describe("formatState", () => {
	// Helper to create a minimal valid state
	function createMinimalState(overrides: Partial<PipelineState> = {}): PipelineState {
		return {
			id: "test-id-123",
			description: "Test description",
			stage: "spec_drafting",
			createdAt: "2026-02-06T12:00:00.000Z",
			updatedAt: "2026-02-06T12:00:00.000Z",
			specTimestamp: "2602061200",
			specFilename: "test_spec.md",
			specPath: "docs/test_spec.md",
			specDraft: "",
			specApproved: false,
			specIteration: 0,
			phases: [],
			phasesGenerated: [],
			currentPhaseIndex: 0,
			currentReviewCycle: 1,
			previousReview: "",
			specCommitted: false,
			phaseCommits: [],
			...overrides,
		};
	}

	it("handles state with all fields defined", () => {
		const state = createMinimalState({
			description: "A complete test state",
			phases: ["phase1.md", "phase2.md"],
			phasesGenerated: [true, false],
		});
		
		const result = formatState(state);
		expect(result).toContain("test-id-123");
		expect(result).toContain("A complete test state");
		expect(result).not.toThrow;
	});

	it("handles state with undefined description", () => {
		const state = createMinimalState();
		// Force undefined description to simulate corrupted state
		(state as any).description = undefined;
		
		// Should not throw
		expect(() => formatState(state)).not.toThrow();
		const result = formatState(state);
		expect(result).toContain("(no description)");
	});

	it("handles state with undefined id", () => {
		const state = createMinimalState();
		(state as any).id = undefined;
		
		expect(() => formatState(state)).not.toThrow();
		const result = formatState(state);
		expect(result).toContain("unknown");
	});

	it("handles state with undefined phases array", () => {
		const state = createMinimalState();
		(state as any).phases = undefined;
		
		expect(() => formatState(state)).not.toThrow();
	});

	it("handles state with undefined phasesGenerated array", () => {
		const state = createMinimalState();
		(state as any).phasesGenerated = undefined;
		
		expect(() => formatState(state)).not.toThrow();
	});

	it("handles state with phases containing undefined elements", () => {
		const state = createMinimalState({
			stage: "implementation",
			phases: ["phase1.md", undefined as any, "phase3.md"],
			phasesGenerated: [true, false, false],
			currentPhaseIndex: 0,
		});
		
		expect(() => formatState(state)).not.toThrow();
		const result = formatState(state);
		expect(result).toContain("(unnamed phase)");
	});

	it("handles state with undefined discovery", () => {
		const state = createMinimalState();
		(state as any).discovery = undefined;
		
		expect(() => formatState(state)).not.toThrow();
	});

	it("handles state with discovery but undefined qaHistory", () => {
		const state = createMinimalState({
			stage: "discovery",
			discovery: {
				skipped: false,
				currentRound: 1,
				maxRounds: 5,
				qaHistory: undefined as any,
				discoverySummary: "",
				completed: false,
			},
		});
		
		expect(() => formatState(state)).not.toThrow();
	});

	it("handles state with lastError containing undefined phases reference", () => {
		const state = createMinimalState({
			lastError: {
				timestamp: "2026-02-06T12:00:00.000Z",
				agent: "opus" as const,
				role: "implementer",
				phase: 1,
				cycle: 1,
				exitCode: 1,
				errorType: "UNKNOWN",
				agentTask: "test task",
			},
		});
		// Force phases to be undefined
		(state as any).phases = undefined;
		
		expect(() => formatState(state)).not.toThrow();
		const result = formatState(state);
		// Should show "?" for unknown total phases
		expect(result).toContain("?");
	});

	it("handles completely empty/corrupted state object", () => {
		// Simulate a very corrupted state with minimal fields
		const corruptedState = {
			id: undefined,
			description: undefined,
			stage: "spec_drafting",
			createdAt: "",
			updatedAt: "",
			specTimestamp: "",
			specFilename: "",
			specPath: "",
			specDraft: undefined,
			specApproved: false,
			specIteration: 0,
			phases: undefined,
			phasesGenerated: undefined,
			currentPhaseIndex: 0,
			currentReviewCycle: 1,
			previousReview: "",
			specCommitted: false,
			phaseCommits: [],
		} as unknown as PipelineState;
		
		expect(() => formatState(corruptedState)).not.toThrow();
	});
});

describe("updatePipelineWidget", () => {
	it("handles state with undefined phases", () => {
		const state = {
			id: "test-id",
			stage: "implementation" as const,
			phases: undefined,
			currentPhaseIndex: 0,
		} as unknown as PipelineState;
		
		let widgetContent: string[] | undefined;
		const mockCtx = {
			ui: {
				setWidget: (_id: string, content: string[] | undefined) => {
					widgetContent = content;
				},
			},
		};
		
		expect(() => updatePipelineWidget(mockCtx, state)).not.toThrow();
		expect(widgetContent).toBeDefined();
	});

	it("handles state with undefined id", () => {
		const state = {
			id: undefined,
			stage: "spec_drafting" as const,
			phases: [],
		} as unknown as PipelineState;
		
		let widgetContent: string[] | undefined;
		const mockCtx = {
			ui: {
				setWidget: (_id: string, content: string[] | undefined) => {
					widgetContent = content;
				},
			},
		};
		
		expect(() => updatePipelineWidget(mockCtx, state)).not.toThrow();
		expect(widgetContent).toBeDefined();
	});
});
