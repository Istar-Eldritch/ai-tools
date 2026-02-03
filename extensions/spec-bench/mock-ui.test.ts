import { describe, it, expect } from "vitest";
import {
	createMockUIContext,
	createFreshMockUIContext,
} from "./mock-ui.ts";
import type { DiscoveryConfig } from "./types.ts";

describe("createMockUIContext", () => {
	describe("notify", () => {
		it("calls progress callback", () => {
			const messages: Array<{ msg: string; type: string }> = [];
			const ctx = createMockUIContext(null, {
				onNotify: (msg, type) => messages.push({ msg, type }),
			});
			
			ctx.ui.notify("Test message", "info");
			
			expect(messages.length).toBe(1);
			expect(messages[0].msg).toBe("Test message");
			expect(messages[0].type).toBe("info");
		});
		
		it("detects stage changes from banners", () => {
			const stages: string[] = [];
			const ctx = createMockUIContext(null, {
				onStageChange: (stage) => stages.push(stage),
			});
			
			ctx.ui.notify("DISCOVERY PHASE starting...", "info");
			ctx.ui.notify("SPEC DRAFTING PHASE starting...", "info");
			ctx.ui.notify("PLAN GENERATION PHASE starting...", "info");
			ctx.ui.notify("IMPLEMENTATION PHASE starting...", "info");
			
			expect(stages).toEqual(["discovery", "spec_drafting", "plan_generation", "implementation"]);
		});
	});
	
	describe("confirm", () => {
		it("always returns true (auto-approve)", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.confirm("Approve?", "Do you approve this?");
			
			expect(result).toBe(true);
		});
	});
	
	describe("editor", () => {
		it("returns scripted discovery answers", async () => {
			const discovery: DiscoveryConfig = {
				rounds: [
					{ answers: "Answer for round 1" },
					{ answers: "Answer for round 2" },
				],
			};
			const ctx = createMockUIContext(discovery);
			
			const answer1 = await ctx.ui.editor("Discovery Round 1", "");
			const answer2 = await ctx.ui.editor("Discovery Round 2", "");
			
			expect(answer1).toBe("Answer for round 1");
			expect(answer2).toBe("Answer for round 2");
		});
		
		it("returns 'done' when earlyFinish is true and no more answers", async () => {
			const discovery: DiscoveryConfig = {
				rounds: [{ answers: "Single answer" }],
				earlyFinish: true,
			};
			const ctx = createMockUIContext(discovery);
			
			await ctx.ui.editor("Discovery Round 1", "");  // Consume first answer
			const answer2 = await ctx.ui.editor("Discovery Round 2", "");
			
			expect(answer2).toBe("done");
		});
		
		it("returns empty string for non-discovery prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.editor("Spec Feedback", "");
			
			expect(result).toBe("");
		});
		
		it("calls progress callback on discovery round", async () => {
			const rounds: Array<{ round: number; max: number }> = [];
			const discovery: DiscoveryConfig = {
				rounds: [{ answers: "Answer 1" }, { answers: "Answer 2" }],
			};
			const ctx = createMockUIContext(discovery, {
				onDiscoveryRound: (round, max) => rounds.push({ round, max }),
			});
			
			await ctx.ui.editor("Discovery Round 1", "");
			await ctx.ui.editor("Discovery Round 2", "");
			
			expect(rounds.length).toBe(2);
			expect(rounds[0]).toEqual({ round: 1, max: 2 });
			expect(rounds[1]).toEqual({ round: 2, max: 2 });
		});
	});
	
	describe("select", () => {
		it("returns approve for approval prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("Choose action", [
				{ label: "Reject", value: "reject" },
				{ label: "Approve", value: "approve" },
			]);
			
			expect(result).toBe("approve");
		});
		
		it("returns done for no-answers prompts", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("No answers provided. What would you like to do?", [
				{ label: "Done", value: "done" },
				{ label: "Skip", value: "skip" },
			]);
			
			expect(result).toBe("done");
		});
		
		it("returns first option as fallback", async () => {
			const ctx = createMockUIContext(null);
			
			const result = await ctx.ui.select("Choose", [
				{ label: "First", value: "first" },
				{ label: "Second", value: "second" },
			]);
			
			expect(result).toBe("first");
		});
	});
	
	describe("setWidget", () => {
		it("is a no-op", () => {
			const ctx = createMockUIContext(null);
			
			// Should not throw
			ctx.ui.setWidget("test", ["content"]);
			ctx.ui.setWidget("test", undefined);
		});
	});
});

describe("createFreshMockUIContext", () => {
	it("resets discovery round counter", async () => {
		const discovery: DiscoveryConfig = {
			rounds: [{ answers: "Answer 1" }],
		};
		
		// First context
		const ctx1 = createFreshMockUIContext(discovery);
		await ctx1.ui.editor("Discovery Round 1", "");
		
		// Second fresh context should reset counter
		const ctx2 = createFreshMockUIContext(discovery);
		const answer = await ctx2.ui.editor("Discovery Round 1", "");
		
		expect(answer).toBe("Answer 1");  // Counter was reset
	});
});
