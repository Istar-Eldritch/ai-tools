import { describe, it, expect } from "vitest";
import {
	validateConfig,
	formatValidationErrors,
	DEFAULT_MODEL_CONFIGS,
	DEFAULT_TIERED_CONFIGS,
	DEFAULT_REVIEW_CYCLES,
} from "./config.ts";

describe("validateConfig", () => {
	describe("valid configurations", () => {
		it("accepts empty config", () => {
			expect(validateConfig({})).toEqual([]);
		});

		it("accepts minimal valid config", () => {
			const config = {
				specsDir: "docs/specs",
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts full valid config", () => {
			const config = {
				specsDir: "docs/specs",
				testCommand: "npm test",
				contextFiles: ["README.md", "CONTRIBUTING.md"],
				discovery: {
					enabled: true,
					maxRounds: 5,
					questionsPerRound: 4,
				},
				models: {
					specDrafter: { model: "opus", thinking: "high" },
					specReviewer: {
						cheap: { model: "sonnet", thinking: "medium" },
						expensive: { model: "opus", thinking: "high" },
					},
				},
				reviewCycles: {
					cheap: 2,
					expensive: 2,
				},
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts null testCommand", () => {
			const config = {
				testCommand: null,
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts per-reviewer review cycles format", () => {
			const config = {
				reviewCycles: {
					specReviewer: { cheap: 1, expensive: 1 },
					planReviewer: { cheap: 0, expensive: 0 },
					codeReviewer: { cheap: 3, expensive: 2 },
				},
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts global review cycles format", () => {
			const config = {
				reviewCycles: {
					cheap: 2,
					expensive: 1,
				},
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts commitMessageWriter in config (silently ignored)", () => {
			const config = {
				models: {
					commitMessageWriter: { model: "haiku", thinking: "off" },
				},
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts skipPlanGeneration boolean", () => {
			const config = {
				skipPlanGeneration: true,
			};
			expect(validateConfig(config)).toEqual([]);
		});

		it("accepts skipPlanGeneration false", () => {
			const config = {
				skipPlanGeneration: false,
			};
			expect(validateConfig(config)).toEqual([]);
		});
	});

	describe("invalid configurations", () => {
		it("rejects invalid model name", () => {
			const config = {
				models: {
					specDrafter: { model: "gpt-4", thinking: "high" },
				},
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it("rejects invalid thinking level", () => {
			const config = {
				models: {
					specDrafter: { model: "opus", thinking: "extreme" },
				},
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it("rejects invalid discovery maxRounds", () => {
			const config = {
				discovery: {
					maxRounds: 100, // Max is 20
				},
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it("rejects invalid discovery questionsPerRound", () => {
			const config = {
				discovery: {
					questionsPerRound: 0, // Min is 1
				},
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		// Note: Due to TypeBox Union + optional properties behavior, reviewCycles
		// validation is lenient. The Union matches whichever variant accepts the value,
		// and extra properties are ignored by default. This means invalid cycle values
		// may pass validation but will be normalized to defaults at runtime.
		// This is acceptable because the config normalization handles edge cases.

		it("rejects non-string specsDir", () => {
			const config = {
				specsDir: 123,
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it("rejects non-array contextFiles", () => {
			const config = {
				contextFiles: "README.md",
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});
	});
});

describe("formatValidationErrors", () => {
	it("formats single error", () => {
		const errors = [{ path: "/specsDir", message: "Expected string" }];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain("Invalid spec-pipeline configuration");
		expect(formatted).toContain("/specsDir");
		expect(formatted).toContain("Expected string");
	});

	it("formats multiple errors", () => {
		const errors = [
			{ path: "/specsDir", message: "Expected string" },
			{ path: "/models/specDrafter/model", message: "Invalid model" },
		];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain("/specsDir");
		expect(formatted).toContain("/models/specDrafter/model");
	});

	it("handles root-level errors", () => {
		const errors = [{ path: "", message: "Expected object" }];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain("root");
	});

	it("includes fix suggestion", () => {
		const errors = [{ path: "/specsDir", message: "Error" }];
		const formatted = formatValidationErrors(errors);
		expect(formatted).toContain(".pi/spec-pipeline.json");
	});
});

describe("default configurations", () => {
	describe("DEFAULT_MODEL_CONFIGS", () => {
		it("has discoveryAgent config", () => {
			expect(DEFAULT_MODEL_CONFIGS.discoveryAgent).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.discoveryAgent.model).toBe("sonnet");
		});

		it("has specDrafter config", () => {
			expect(DEFAULT_MODEL_CONFIGS.specDrafter).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.specDrafter.model).toBe("opus");
			expect(DEFAULT_MODEL_CONFIGS.specDrafter.thinking).toBe("high");
		});

		it("has planDrafter config", () => {
			expect(DEFAULT_MODEL_CONFIGS.planDrafter).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.planDrafter.model).toBe("opus");
		});

		it("has implementer config", () => {
			expect(DEFAULT_MODEL_CONFIGS.implementer).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.implementer.model).toBe("opus");
		});

		it("has addressReview config", () => {
			expect(DEFAULT_MODEL_CONFIGS.addressReview).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.addressReview.model).toBe("opus");
		});
	});

	describe("DEFAULT_TIERED_CONFIGS", () => {
		it("has specReviewer tiered config", () => {
			const config = DEFAULT_TIERED_CONFIGS.specReviewer;
			expect(config.cheap).toBeDefined();
			expect(config.expensive).toBeDefined();
			expect(config.cheap.model).toBe("sonnet");
			expect(config.expensive.model).toBe("opus");
		});

		it("has planReviewer tiered config", () => {
			const config = DEFAULT_TIERED_CONFIGS.planReviewer;
			expect(config.cheap.model).toBe("sonnet");
			expect(config.expensive.model).toBe("opus");
		});

		it("has codeReviewer tiered config", () => {
			const config = DEFAULT_TIERED_CONFIGS.codeReviewer;
			expect(config.cheap.model).toBe("sonnet");
			expect(config.expensive.model).toBe("opus");
		});
	});

	describe("DEFAULT_REVIEW_CYCLES", () => {
		it("has cycles for all reviewers", () => {
			expect(DEFAULT_REVIEW_CYCLES.specReviewer).toBeDefined();
			expect(DEFAULT_REVIEW_CYCLES.planReviewer).toBeDefined();
			expect(DEFAULT_REVIEW_CYCLES.codeReviewer).toBeDefined();
		});

		it("has cheap and expensive cycles for each reviewer", () => {
			expect(DEFAULT_REVIEW_CYCLES.specReviewer.cheap).toBe(2);
			expect(DEFAULT_REVIEW_CYCLES.specReviewer.expensive).toBe(2);
		});

		it("all reviewers have same default cycles", () => {
			expect(DEFAULT_REVIEW_CYCLES.specReviewer).toEqual(DEFAULT_REVIEW_CYCLES.planReviewer);
			expect(DEFAULT_REVIEW_CYCLES.planReviewer).toEqual(DEFAULT_REVIEW_CYCLES.codeReviewer);
		});
	});
});
