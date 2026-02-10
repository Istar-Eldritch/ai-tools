import { describe, it, expect } from "vitest";
import { generateCommitMessage, extractPhaseName, extractDocName } from "./commit-agent.ts";
import type { CommitMessageContext } from "./commit-agent.ts";

describe("generateCommitMessage (deterministic)", () => {
	describe("role-based templates", () => {
		it("generates planDrafter message with phase", () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan-phase1.md"],
				phase: 1,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("docs(phase-1): create implementation plan");
			expect(result.message).toContain("- docs/plan-phase1.md");
		});

		it("generates planDrafter message without phase", () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan.md"],
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("docs(pipeline): create implementation plan");
		});

		it("generates implementer message with phase", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts", "src/feature.test.ts"],
				phase: 2,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("feat(phase-2): implement phase changes");
			expect(result.message).toContain("- src/feature.ts");
			expect(result.message).toContain("- src/feature.test.ts");
		});

		it("generates addressReview message with cycle", () => {
			const context: CommitMessageContext = {
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 1,
				cycle: 3,
				reviewFeedback: "Fix null check",
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("fix(phase-1): address review feedback (cycle 3)");
		});

		it("generates addressReview message without cycle", () => {
			const context: CommitMessageContext = {
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 2,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("fix(phase-2): address review feedback");
			expect(result.message).not.toContain("cycle");
		});

		it("generates planReviewer message", () => {
			const context: CommitMessageContext = {
				role: "planReviewer",
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["docs/plan.md"],
				phase: 3,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("docs(phase-3): revise plan after review");
		});

		it("generates codeReviewer message", () => {
			const context: CommitMessageContext = {
				role: "codeReviewer",
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["src/code.ts"],
				phase: 1,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("refactor(phase-1): apply code review changes");
		});

		it("generates fallback chore message for unknown roles", () => {
			const context: CommitMessageContext = {
				role: "unknownRole" as any,
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["notes.md"],
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("chore(pipeline): unknownRole changes");
		});
	});

	describe("file list in body", () => {
		it("includes file list in body", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/a.ts", "src/b.ts", "tests/a.test.ts"],
				phase: 1,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("- src/a.ts");
			expect(result.message).toContain("- src/b.ts");
			expect(result.message).toContain("- tests/a.test.ts");
		});

		it("omits body when no files", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: [],
				phase: 1,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			// Should be just the subject, no newlines
			expect(result.message).toBe("feat(phase-1): implement phase changes");
		});

		it("truncates long file list with count", () => {
			const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files,
				phase: 1,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			// Should list first 20 files then show truncation
			expect(result.message).toContain("- src/file0.ts");
			expect(result.message).toContain("- src/file19.ts");
			expect(result.message).toContain("... and 5 more files");
			expect(result.message).not.toContain("- src/file20.ts");
		});
	});

	describe("always succeeds (deterministic)", () => {
		it("always returns type success", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
		});

		it("never returns type fallback", () => {
			// Even with unusual input, should always succeed
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: [],
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
		});
	});

	describe("backward compatibility", () => {
		it("accepts but ignores agentConfig parameter", () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan.md"],
			};

			// These extra params should be accepted but ignored
			const result = generateCommitMessage(
				context,
				{ model: "haiku", thinking: "off" },
				"/fake/cwd"
			);

			expect(result.type).toBe("success");
			expect(result.message).toContain("docs(pipeline): create implementation plan");
		});
	});

	describe("phase name extraction and usage", () => {
		it("extracts phase name from phase path", () => {
			expect(extractPhaseName("20250209_myproject/phase1_backend_api.md")).toBe("backend api");
			expect(extractPhaseName("20250209_myproject/phase2_frontend_components.md")).toBe("frontend components");
			expect(extractPhaseName("specs/phase10_database_migrations.md")).toBe("database migrations");
		});

		it("handles underscore-separated names", () => {
			expect(extractPhaseName("20250209_project/phase1_user_auth_system.md")).toBe("user auth system");
		});

		it("returns undefined for invalid paths", () => {
			expect(extractPhaseName("invalid.md")).toBeUndefined();
			expect(extractPhaseName("phase1.md")).toBeUndefined();
			expect(extractPhaseName("")).toBeUndefined();
			expect(extractPhaseName("no-phase-here.md")).toBeUndefined();
		});

		it("includes phase name in commit message scope", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 1,
				phaseName: "backend api",
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("feat(phase-1/backend api): implement phase changes");
		});

		it("truncates long phase names", () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["plan.md"],
				phase: 2,
				phaseName: "very long phase name that exceeds the maximum length",
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("docs(phase-2/very long phase name that e...): create implementation plan");
		});

		it("uses plain phase number when phaseName is undefined", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/code.ts"],
				phase: 3,
				phaseName: undefined,
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("feat(phase-3): implement phase changes");
		});

		it("uses pipeline scope when no phase number", () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/code.ts"],
				phaseName: "some name",
			};

			const result = generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toContain("feat(pipeline): implement phase changes");
		});
	});


});
