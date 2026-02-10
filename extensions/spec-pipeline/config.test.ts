import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	validateConfig,
	formatValidationErrors,
	DEFAULT_MODEL_CONFIGS,
	DEFAULT_TIERED_CONFIGS,
	DEFAULT_REVIEW_CYCLES,
	discoverSpecTemplate,
	discoverSpecConventions,
	detectSpecFormat,
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
				models: {
					planDrafter: { model: "opus", thinking: "high" },
					implementer: { model: "opus", thinking: "high" },
					planReviewer: {
						cheap: { model: "sonnet", thinking: "medium" },
						expensive: { model: "opus", thinking: "high" },
					},
					codeReviewer: {
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
					implementer: { model: "gpt-4", thinking: "high" },
				},
			};
			const errors = validateConfig(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it("rejects invalid thinking level", () => {
			const config = {
				models: {
					implementer: { model: "opus", thinking: "extreme" },
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
			expect(DEFAULT_MODEL_CONFIGS.addressReview.model).toBe("sonnet");
		});

		it("has agentCommitMessageWriter config", () => {
			expect(DEFAULT_MODEL_CONFIGS.agentCommitMessageWriter).toBeDefined();
			expect(DEFAULT_MODEL_CONFIGS.agentCommitMessageWriter.model).toBe("haiku");
		});
	});

	describe("DEFAULT_TIERED_CONFIGS", () => {
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
			expect(DEFAULT_REVIEW_CYCLES.planReviewer).toBeDefined();
			expect(DEFAULT_REVIEW_CYCLES.codeReviewer).toBeDefined();
		});

		it("has cheap and expensive cycles for each reviewer", () => {
			expect(DEFAULT_REVIEW_CYCLES.planReviewer.cheap).toBe(2);
			expect(DEFAULT_REVIEW_CYCLES.planReviewer.expensive).toBe(2);
			expect(DEFAULT_REVIEW_CYCLES.codeReviewer.cheap).toBe(2);
			expect(DEFAULT_REVIEW_CYCLES.codeReviewer.expensive).toBe(2);
		});

		it("all reviewers have same default cycles", () => {
			expect(DEFAULT_REVIEW_CYCLES.planReviewer).toEqual(DEFAULT_REVIEW_CYCLES.codeReviewer);
		});
	});
});

describe("discoverSpecTemplate", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-template-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no template files exist", () => {
		fs.mkdirSync(path.join(tmpDir, "docs"));
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("discovers a TEMPLATE.md file in docs/", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.md"), "# Spec Template\n\nContent here");
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBe("docs/TEMPLATE.md");
		expect(result.content).toContain("Spec Template");
	});

	it("discovers a timestamped TEMPLATE file (e.g. 2601221403_TEMPLATE.typ)", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "2601221403_TEMPLATE.typ"), "// Typst template\n= Overview");
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBe("docs/2601221403_TEMPLATE.typ");
		expect(result.content).toContain("Typst template");
	});

	it("skips _template.typ layout files (underscore prefix)", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "_template.typ"), "// Layout template");
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("skips template_example files", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "_template_example.typ"), "// Example");
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("skips binary files (PDF)", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.pdf"), Buffer.from([0x25, 0x50, 0x44, 0x46]));
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("uses explicit path from config when provided", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "my_custom_template.md"), "# Custom Template");
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.md"), "# Default Template");
		const result = discoverSpecTemplate(tmpDir, "docs", "docs/my_custom_template.md");
		expect(result.path).toBe("docs/my_custom_template.md");
		expect(result.content).toContain("Custom Template");
	});

	it("returns null when explicitly set to null", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.md"), "# Template");
		const result = discoverSpecTemplate(tmpDir, "docs", null);
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("falls back to auto-discovery when explicit path doesn't exist", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.md"), "# Fallback Template");
		const result = discoverSpecTemplate(tmpDir, "docs", "nonexistent.md");
		expect(result.path).toBe("docs/TEMPLATE.md");
		expect(result.content).toContain("Fallback Template");
	});

	it("skips empty template files", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "TEMPLATE.md"), "");
		const result = discoverSpecTemplate(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});
});

describe("discoverSpecConventions", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-conventions-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no convention files exist", () => {
		fs.mkdirSync(path.join(tmpDir, "docs"));
		const result = discoverSpecConventions(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("discovers a guide_specs file", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "guide_specs.md"), "# Spec Guide\n\nConventions here");
		const result = discoverSpecConventions(tmpDir, "docs");
		expect(result.path).toBe("docs/guide_specs.md");
		expect(result.content).toContain("Spec Guide");
	});

	it("discovers a timestamped guide_specs file", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "2601221403_guide_specs.typ"), "// Spec Conventions");
		const result = discoverSpecConventions(tmpDir, "docs");
		expect(result.path).toBe("docs/2601221403_guide_specs.typ");
		expect(result.content).toContain("Spec Conventions");
	});

	it("discovers spec_conventions file", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "spec_conventions.md"), "# Conventions");
		const result = discoverSpecConventions(tmpDir, "docs");
		expect(result.path).toBe("docs/spec_conventions.md");
		expect(result.content).toContain("Conventions");
	});

	it("uses explicit path from config when provided", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "my_conventions.md"), "# My Conventions");
		const result = discoverSpecConventions(tmpDir, "docs", "docs/my_conventions.md");
		expect(result.path).toBe("docs/my_conventions.md");
		expect(result.content).toContain("My Conventions");
	});

	it("returns null when explicitly set to null", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "guide_specs.md"), "# Guide");
		const result = discoverSpecConventions(tmpDir, "docs", null);
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});

	it("does not discover non-spec guide files", () => {
		const docsDir = path.join(tmpDir, "docs");
		fs.mkdirSync(docsDir);
		fs.writeFileSync(path.join(docsDir, "guide_testing.md"), "# Testing Guide");
		fs.writeFileSync(path.join(docsDir, "guide_deployment.md"), "# Deployment Guide");
		const result = discoverSpecConventions(tmpDir, "docs");
		expect(result.path).toBeNull();
		expect(result.content).toBeNull();
	});
});

describe("validateConfig with template fields", () => {
	it("accepts specTemplatePath as string", () => {
		const config = { specTemplatePath: "docs/TEMPLATE.md" };
		expect(validateConfig(config)).toEqual([]);
	});

	it("accepts specTemplatePath as null (disabled)", () => {
		const config = { specTemplatePath: null };
		expect(validateConfig(config)).toEqual([]);
	});

	it("accepts specConventionsPath as string", () => {
		const config = { specConventionsPath: "docs/guide_specs.md" };
		expect(validateConfig(config)).toEqual([]);
	});

	it("accepts specConventionsPath as null (disabled)", () => {
		const config = { specConventionsPath: null };
		expect(validateConfig(config)).toEqual([]);
	});

	it("accepts both template and conventions paths", () => {
		const config = {
			specTemplatePath: "docs/TEMPLATE.typ",
			specConventionsPath: "docs/guide_specs.typ",
		};
		expect(validateConfig(config)).toEqual([]);
	});

	it("accepts specFormat as string", () => {
		const config = { specFormat: "typ" };
		expect(validateConfig(config)).toEqual([]);
	});
});

describe("detectSpecFormat", () => {
	it("defaults to md when no template and no explicit format", () => {
		expect(detectSpecFormat(undefined, null)).toBe("md");
	});

	it("derives format from template path extension", () => {
		expect(detectSpecFormat(undefined, "docs/2601221403_TEMPLATE.typ")).toBe("typ");
	});

	it("derives md from a .md template path", () => {
		expect(detectSpecFormat(undefined, "docs/TEMPLATE.md")).toBe("md");
	});

	it("explicit format overrides template path", () => {
		expect(detectSpecFormat("md", "docs/2601221403_TEMPLATE.typ")).toBe("md");
	});

	it("strips leading dot from explicit format", () => {
		expect(detectSpecFormat(".typ", null)).toBe("typ");
	});
});
