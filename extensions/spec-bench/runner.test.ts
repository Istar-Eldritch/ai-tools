import { describe, it, expect } from "vitest";
import { checkPiAvailable } from "./runner.ts";

// Note: Full runner tests require pi to be installed and would be slow.
// These tests verify the module structure and basic functionality.

describe("runner", () => {
	describe("checkPiAvailable", () => {
		it("returns boolean", async () => {
			const result = await checkPiAvailable();
			expect(typeof result).toBe("boolean");
		});
	});
	
	// Integration tests for runPiWithMetrics would go here but require:
	// 1. Pi to be installed and configured
	// 2. Valid API credentials
	// 3. Would be slow due to actual API calls
	// 
	// These should be run manually or in a dedicated integration test suite:
	// 
	// describe.skip("runPiWithMetrics integration", () => {
	//   it("captures metrics from simple task", async () => { ... });
	//   it("handles abort signal", async () => { ... });
	//   it("respects timeout", async () => { ... });
	// });
});
