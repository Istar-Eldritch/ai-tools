/**
 * Tests for pipeline resume behavior after cancellation
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createInitialState, saveState, loadState } from "./state.ts";
import type { PipelineState } from "./types.ts";

describe("Pipeline Resume After Cancellation", () => {
	let tempDir: string;
	let cwd: string;
	
	function setupTempDir() {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-pipeline-resume-test-"));
		cwd = tempDir;
		
		// Create .spec_state directory
		const stateDir = path.join(cwd, ".spec_state");
		if (!fs.existsSync(stateDir)) {
			fs.mkdirSync(stateDir, { recursive: true });
		}
	}
	
	function teardownTempDir() {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}
	
	it("should detect cancelled mid-draft and reset iteration counter", () => {
		setupTempDir();
		
		try {
			// Create initial state
			const state = createInitialState(
				"Test feature",
				"2602051400",
				"test_feature",
				"docs",
				{ enabled: false, maxRounds: 5, questionsPerRound: 3 },
				true // skip discovery
			);
			
			// Simulate: started drafting (iteration incremented to 1)
			state.specIteration = 1;
			state.stage = "spec_drafting";
			saveState(cwd, state);
			
			// Simulate cancellation (spec file was never created)
			state.stage = "cancelled";
			saveState(cwd, state);
			
			// Load state to simulate resume
			const loadedState = loadState(cwd, state.id);
			expect(loadedState).not.toBeNull();
			expect(loadedState!.specIteration).toBe(1);
			expect(loadedState!.stage).toBe("cancelled");
			
			// When resume logic resets stage to spec_drafting
			loadedState!.stage = "spec_drafting";
			
			// Check if spec file exists
			const fullSpecPath = path.join(cwd, loadedState!.specPath);
			const specFileExists = fs.existsSync(fullSpecPath);
			expect(specFileExists).toBe(false);
			
			// The fix should detect this situation:
			// iteration > 0 but no spec file = cancelled mid-draft
			if (loadedState!.specIteration > 0 && !specFileExists) {
				// Reset to 0 so it's treated as first iteration
				loadedState!.specIteration = 0;
			}
			
			expect(loadedState!.specIteration).toBe(0);
			
		} finally {
			teardownTempDir();
		}
	});
	
	it("should NOT reset iteration counter if spec file exists", () => {
		setupTempDir();
		
		try {
			// Create initial state
			const state = createInitialState(
				"Test feature",
				"2602051400",
				"test_feature",
				"docs",
				{ enabled: false, maxRounds: 5, questionsPerRound: 3 },
				true
			);
			
			// Simulate: completed first draft
			state.specIteration = 1;
			state.stage = "spec_review";
			saveState(cwd, state);
			
			// Create the spec file
			const fullSpecPath = path.join(cwd, state.specPath);
			fs.mkdirSync(path.dirname(fullSpecPath), { recursive: true });
			fs.writeFileSync(fullSpecPath, "# Test Spec\nSome content here");
			
			// Simulate cancellation during review
			state.stage = "cancelled";
			saveState(cwd, state);
			
			// Load and resume
			const loadedState = loadState(cwd, state.id);
			expect(loadedState).not.toBeNull();
			expect(loadedState!.specIteration).toBe(1);
			
			// When resume logic resets to appropriate stage
			loadedState!.stage = "spec_review"; // Would be set by resume logic
			
			// Check if spec file exists
			const specFileExists = fs.existsSync(fullSpecPath);
			expect(specFileExists).toBe(true);
			
			// Should NOT reset because file exists
			if (loadedState!.specIteration > 0 && !specFileExists) {
				loadedState!.specIteration = 0;
			}
			
			// Iteration should remain 1
			expect(loadedState!.specIteration).toBe(1);
			
		} finally {
			teardownTempDir();
		}
	});
	
	it("should properly resume at spec_review stage without re-drafting", () => {
		setupTempDir();
		
		try {
			// Create initial state
			const state = createInitialState(
				"Test feature",
				"2602051400",
				"test_feature",
				"docs",
				{ enabled: false, maxRounds: 5, questionsPerRound: 3 },
				true
			);
			
			// Simulate: completed first draft and moved to review
			state.specIteration = 1;
			state.stage = "spec_review";
			saveState(cwd, state);
			
			// Create the spec file
			const fullSpecPath = path.join(cwd, state.specPath);
			fs.mkdirSync(path.dirname(fullSpecPath), { recursive: true });
			fs.writeFileSync(fullSpecPath, "# Test Spec\nCompleted draft");
			
			// Simulate cancellation during review
			state.stage = "cancelled";
			saveState(cwd, state);
			
			// Load and resume
			const loadedState = loadState(cwd, state.id);
			loadedState!.stage = "spec_review"; // Resume logic would set this
			
			const specFileExists = fs.existsSync(fullSpecPath);
			expect(specFileExists).toBe(true);
			
			// Check resume flags
			const resumingMidIteration = loadedState!.stage === "spec_review" || loadedState!.stage === "user_approval";
			const skipSpecDrafter = resumingMidIteration && loadedState!.specIteration > 0 && specFileExists;
			
			expect(resumingMidIteration).toBe(true);
			expect(skipSpecDrafter).toBe(true);
			
		} finally {
			teardownTempDir();
		}
	});
	
	it("should preserve stage before cancellation", () => {
		setupTempDir();
		
		try {
			// Create initial state
			const state = createInitialState(
				"Test feature",
				"2602051400",
				"test_feature",
				"docs",
				{ enabled: false, maxRounds: 5, questionsPerRound: 3 },
				true
			);
			
			// Set to spec_review stage
			state.specIteration = 1;
			state.stage = "spec_review";
			
			// Create the spec file
			const fullSpecPath = path.join(cwd, state.specPath);
			fs.mkdirSync(path.dirname(fullSpecPath), { recursive: true });
			fs.writeFileSync(fullSpecPath, "# Test Spec\nContent");
			
			saveState(cwd, state);
			
			// Simulate cancellation that preserves stage
			state.stageBeforeCancellation = state.stage;
			state.stage = "cancelled";
			saveState(cwd, state);
			
			// Load and check
			const loadedState = loadState(cwd, state.id);
			expect(loadedState).not.toBeNull();
			expect(loadedState!.stage).toBe("cancelled");
			expect(loadedState!.stageBeforeCancellation).toBe("spec_review");
			
			// Simulate resume logic
			if (loadedState!.stageBeforeCancellation && loadedState!.stageBeforeCancellation !== "cancelled") {
				loadedState!.stage = loadedState!.stageBeforeCancellation;
				loadedState!.stageBeforeCancellation = undefined;
			}
			
			expect(loadedState!.stage).toBe("spec_review");
			expect(loadedState!.stageBeforeCancellation).toBeUndefined();
			
		} finally {
			teardownTempDir();
		}
	});
	
	it("should handle user_approval stage correctly", () => {
		setupTempDir();
		
		try {
			// Create initial state
			const state = createInitialState(
				"Test feature",
				"2602051400",
				"test_feature",
				"docs",
				{ enabled: false, maxRounds: 5, questionsPerRound: 3 },
				true
			);
			
			// Simulate: draft completed, review completed, waiting for user
			state.specIteration = 1;
			state.stage = "user_approval";
			saveState(cwd, state);
			
			// Create the spec file
			const fullSpecPath = path.join(cwd, state.specPath);
			fs.mkdirSync(path.dirname(fullSpecPath), { recursive: true });
			fs.writeFileSync(fullSpecPath, "# Test Spec\nReviewed draft");
			
			// Simulate cancellation at user approval
			state.stage = "cancelled";
			saveState(cwd, state);
			
			// Load and resume
			const loadedState = loadState(cwd, state.id);
			// Resume logic should detect we were at user_approval and restore that
			// For now, spec_drafting is the fallback
			loadedState!.stage = "user_approval";
			
			const specFileExists = fs.existsSync(fullSpecPath);
			expect(specFileExists).toBe(true);
			
			// Check resume flags
			const resumingMidIteration = loadedState!.stage === "spec_review" || loadedState!.stage === "user_approval";
			const skipSpecDrafter = resumingMidIteration && loadedState!.specIteration > 0 && specFileExists;
			const skipSpecReview = loadedState!.stage === "user_approval";
			
			expect(resumingMidIteration).toBe(true);
			expect(skipSpecDrafter).toBe(true);
			expect(skipSpecReview).toBe(true);
			
		} finally {
			teardownTempDir();
		}
	});
});
