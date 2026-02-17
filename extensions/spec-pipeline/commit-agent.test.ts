import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCommitMessage, extractPhaseName, extractDocName } from "./commit-agent.ts";
import type { CommitMessageContext } from "./commit-agent.ts";

// Track mock session behavior
let mockOutput = "";
let mockShouldThrow = false;

// Mock the pi SDK
vi.mock("@mariozechner/pi-coding-agent", () => {
	return {
		createAgentSession: vi.fn(async () => {
			const listeners: ((event: any) => void)[] = [];
			const session = {
				subscribe: (fn: (event: any) => void) => { listeners.push(fn); return () => {}; },
				prompt: vi.fn(async () => {
					if (mockShouldThrow) throw new Error("SDK error");
					// Simulate text_delta events
					for (const listener of listeners) {
						listener({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: mockOutput },
						});
					}
				}),
				dispose: vi.fn(),
			};
			return { session };
		}),
		DefaultResourceLoader: vi.fn().mockImplementation(() => ({
			reload: vi.fn(),
		})),
		SessionManager: { inMemory: vi.fn() },
		SettingsManager: { inMemory: vi.fn() },
	};
});

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn(() => ({ id: "claude-haiku-4-5", provider: "anthropic" })),
}));

describe("generateCommitMessage (Haiku-based)", () => {
	beforeEach(() => {
		mockOutput = "";
		mockShouldThrow = false;
	});

	describe("successful Haiku generation", () => {
		it("generates message from Haiku for planDrafter", async () => {
			mockOutput = "docs(phase-1): add implementation plan for user authentication";

			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan-phase1.md"],
				phase: 1,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toBe("docs(phase-1): add implementation plan for user authentication");
		});

		it("handles Haiku output with code blocks", async () => {
			mockOutput = "```\nfeat(phase-2): add user authentication endpoints\n```";

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/auth.ts"],
				phase: 2,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toBe("feat(phase-2): add user authentication endpoints");
		});

		it("takes only first line from multi-line output", async () => {
			mockOutput = "feat(phase-1): add auth middleware\n\nImplements session management and JWT validation.";

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
				phase: 1,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toBe("feat(phase-1): add auth middleware");
		});

		it("generates message from Haiku for brainstormAgent", async () => {
			mockOutput = "docs(billing redesign): capture brainstorm session on billing system";

			const context: CommitMessageContext = {
				role: "brainstormAgent" as any,
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/specs/2602171119_brainstorm_billing_redesign.md"],
				docName: "billing redesign",
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toBe("docs(billing redesign): capture brainstorm session on billing system");
		});
	});

	describe("fallback on errors", () => {
		it("falls back when Haiku output is invalid format", async () => {
			mockOutput = "This is not a conventional commit message";

			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan.md"],
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("docs(pipeline): create implementation plan");
		});

		it("falls back when SDK throws error", async () => {
			mockShouldThrow = true;

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 2,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("feat(phase-2): implement phase changes");
		});

		it("falls back when Haiku output is empty", async () => {
			mockOutput = "";

			const context: CommitMessageContext = {
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/fix.ts"],
				phase: 1,
				cycle: 2,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("fix(phase-1): address review feedback (cycle 2)");
		});

		it("falls back with file list in body", async () => {
			mockOutput = "";

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/a.ts", "src/b.ts", "tests/a.test.ts"],
				phase: 1,
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("feat(phase-1): implement phase changes");
			expect(result.message).toContain("- src/a.ts");
			expect(result.message).toContain("- src/b.ts");
			expect(result.message).toContain("- tests/a.test.ts");
		});
	});

	describe("fallback role-based templates", () => {
		it("generates planDrafter fallback", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan.md"],
				phase: 3,
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("docs(phase-3): create implementation plan");
		});

		it("generates implementer fallback", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/code.ts"],
				phase: 2,
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("feat(phase-2): implement phase changes");
		});

		it("generates addressReview fallback with cycle", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 1,
				cycle: 3,
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("fix(phase-1): address review feedback (cycle 3)");
		});

		it("generates planReviewer fallback", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "planReviewer",
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["docs/plan.md"],
				phase: 3,
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("docs(phase-3): revise plan after review");
		});

		it("generates codeReviewer fallback", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "codeReviewer",
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["src/code.ts"],
				phase: 1,
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("refactor(phase-1): apply code review changes");
		});

		it("generates chore fallback for unknown roles", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "unknownRole" as any,
				modelConfig: { model: "sonnet", thinking: "medium" },
				files: ["notes.md"],
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("chore(pipeline): unknownRole changes");
		});

		it("generates brainstormAgent fallback", async () => {
			mockShouldThrow = true;
			const result = await generateCommitMessage({
				role: "brainstormAgent" as any,
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/specs/2602171119_brainstorm_billing_redesign.md"],
			});
			expect(result.type).toBe("fallback");
			expect(result.message).toContain("docs(pipeline): capture brainstorm session");
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

		it("includes phase name in fallback scope", async () => {
			mockShouldThrow = true;

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 1,
				phaseName: "backend api",
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("feat(phase-1/backend api): implement phase changes");
		});

		it("truncates long phase names in fallback", async () => {
			mockShouldThrow = true;

			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["plan.md"],
				phase: 2,
				phaseName: "very long phase name that exceeds the maximum length",
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("docs(phase-2/very long phase name that e...): create implementation plan");
		});

		it("includes phase name in Haiku-generated message", async () => {
			mockOutput = "feat(phase-1/backend api): add database models and migration scripts";

			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/models.ts"],
				phase: 1,
				phaseName: "backend api",
			};

			const result = await generateCommitMessage(context);

			expect(result.type).toBe("success");
			expect(result.message).toBe("feat(phase-1/backend api): add database models and migration scripts");
		});
	});

	describe("document name extraction", () => {
		it("extracts doc name from spec filename", () => {
			expect(extractDocName("20250209_spec_user_auth.md")).toBe("user auth");
		});

		it("extracts doc name from roadmap filename", () => {
			expect(extractDocName("2602071200_roadmap_warm_pools.md")).toBe("warm pools");
		});

		it("extracts doc name from epic filename", () => {
			expect(extractDocName("2602071200_epic_payment_system.md")).toBe("payment system");
		});

		it("handles .typ extension", () => {
			expect(extractDocName("20250209_spec_api_design.typ")).toBe("api design");
		});

		it("returns undefined for invalid filenames", () => {
			expect(extractDocName("invalid.md")).toBeUndefined();
			expect(extractDocName("spec_no_timestamp.md")).toBeUndefined();
			expect(extractDocName("")).toBeUndefined();
		});

		it("extracts name from brainstorm filename", () => {
			expect(extractDocName("2602171000_brainstorm_billing_redesign.md")).toBe("billing redesign");
		});
	});
});
