import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCommitMessage } from "./commit-agent.ts";
import type { CommitMessageContext, CommitMessageResult } from "./commit-agent.ts";
import type { ModelConfig } from "./types.ts";
import * as agents from "./agents.ts";

// Mock the agents module
vi.mock("./agents.ts", () => ({
	runAgentWithConfig: vi.fn(),
}));

describe("generateCommitMessage", () => {
	const mockCwd = "/fake/project";
	const mockAgentConfig: ModelConfig = {
		model: "haiku",
		thinking: "off",
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("success path", () => {
		it("generates commit message on first attempt", async () => {
			const context: CommitMessageContext = {
				role: "specDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/specs/feature-spec.md"],
			};

			const mockOutput = `feat(spec): add feature specification

- Define user requirements
- Document API endpoints
- Include data models`;

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: mockOutput,
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("success");
			expect(result.message).toBe(mockOutput);
			expect(agents.runAgentWithConfig).toHaveBeenCalledTimes(1);
		});

		it("includes phase and cycle information in task", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts", "src/feature.test.ts"],
				phase: 1,
				cycle: 2,
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: "feat(api): implement user endpoint",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("success");
			
			// Verify the task includes phase and cycle
			const call = vi.mocked(agents.runAgentWithConfig).mock.calls[0];
			const task = call[1];
			expect(task).toContain("**Phase**: 1");
			expect(task).toContain("**Cycle**: 2");
		});

		it("includes review feedback in task when provided", async () => {
			const context: CommitMessageContext = {
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts"],
				phase: 2,
				cycle: 1,
				reviewFeedback: "Add error handling for null inputs",
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: "fix(api): add null input validation",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("success");
			
			// Verify the task includes review feedback
			const call = vi.mocked(agents.runAgentWithConfig).mock.calls[0];
			const task = call[1];
			expect(task).toContain("Review Feedback Addressed");
			expect(task).toContain("Add error handling for null inputs");
		});

		it("includes modified files in task", async () => {
			const files = ["src/auth.ts", "src/middleware.ts", "tests/auth.test.ts"];
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files,
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: "feat(auth): implement authentication system",
			});

			await generateCommitMessage(context, mockAgentConfig, mockCwd);

			const call = vi.mocked(agents.runAgentWithConfig).mock.calls[0];
			const task = call[1];
			expect(task).toContain("3 file(s) were modified");
			for (const file of files) {
				expect(task).toContain(`- ${file}`);
			}
		});
	});

	describe("retry behavior", () => {
		it("retries on agent failure", async () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan-phase1.md"],
			};

			// First attempt fails, second succeeds
			vi.mocked(agents.runAgentWithConfig)
				.mockResolvedValueOnce({
					exitCode: 1,
					output: "",
					error: "Rate limit exceeded",
				})
				.mockResolvedValueOnce({
					exitCode: 0,
					output: "docs(plan): add phase 1 implementation plan",
				});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("success");
			expect(result.message).toBe("docs(plan): add phase 1 implementation plan");
			expect(agents.runAgentWithConfig).toHaveBeenCalledTimes(2);
		});

		it("retries on empty output", async () => {
			const context: CommitMessageContext = {
				role: "specDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/spec.md"],
			};

			// First attempt returns empty, second succeeds
			vi.mocked(agents.runAgentWithConfig)
				.mockResolvedValueOnce({
					exitCode: 0,
					output: "   ", // whitespace only
				})
				.mockResolvedValueOnce({
					exitCode: 0,
					output: "docs(spec): create feature specification",
				});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("success");
			expect(agents.runAgentWithConfig).toHaveBeenCalledTimes(2);
		});

		it("retries up to 3 times before falling back", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
				phase: 1,
				cycle: 1,
			};

			// All attempts fail
			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
				error: "Network error",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(agents.runAgentWithConfig).toHaveBeenCalledTimes(3);
		});

		it("applies exponential backoff between retries", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
			};

			const startTime = Date.now();
			
			// All attempts fail
			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
			});

			await generateCommitMessage(context, mockAgentConfig, mockCwd);

			const duration = Date.now() - startTime;
			
			// Should have delays of ~1s and ~2s = ~3s total
			// Allow some tolerance for test execution overhead
			expect(duration).toBeGreaterThanOrEqual(2800);
			expect(duration).toBeLessThan(4000);
		});
	});

	describe("fallback message generation", () => {
		it("generates fallback without phase/cycle", async () => {
			const context: CommitMessageContext = {
				role: "specDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/spec.md", "docs/diagrams.md"],
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(result.message).toBe("[FALLBACK] After specDrafter - 2 files modified");
		});

		it("generates fallback with phase only", async () => {
			const context: CommitMessageContext = {
				role: "planDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/plan.md"],
				phase: 3,
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(result.message).toBe("[FALLBACK] After planDrafter - Phase 3 - 1 files modified");
		});

		it("generates fallback with phase and cycle", async () => {
			const context: CommitMessageContext = {
				role: "addressReview",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/api.ts", "src/utils.ts", "tests/api.test.ts"],
				phase: 2,
				cycle: 3,
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(result.message).toBe("[FALLBACK] After addressReview - Phase 2, Cycle 3 - 3 files modified");
		});

		it("handles zero files in fallback", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: [],
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValue({
				exitCode: 1,
				output: "",
			});

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(result.message).toBe("[FALLBACK] After implementer - 0 files modified");
		});
	});

	describe("agent configuration", () => {
		it("passes correct role for tool restrictions", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: "feat: implement feature",
			});

			await generateCommitMessage(context, mockAgentConfig, mockCwd);

			const call = vi.mocked(agents.runAgentWithConfig).mock.calls[0];
			// Role parameter should be "commitMessageWriter" for tool restrictions
			expect(call[6]).toBe("commitMessageWriter");
		});

		it("uses provided agent config", async () => {
			const customConfig: ModelConfig = {
				model: "sonnet",
				thinking: "medium",
			};

			const context: CommitMessageContext = {
				role: "specDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/spec.md"],
			};

			vi.mocked(agents.runAgentWithConfig).mockResolvedValueOnce({
				exitCode: 0,
				output: "docs: add spec",
			});

			await generateCommitMessage(context, customConfig, mockCwd);

			const call = vi.mocked(agents.runAgentWithConfig).mock.calls[0];
			// First parameter should be the agent config
			expect(call[0]).toEqual(customConfig);
		});
	});

	describe("error handling", () => {
		it("handles agent spawn failures", async () => {
			const context: CommitMessageContext = {
				role: "implementer",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["src/feature.ts"],
				phase: 1,
			};

			// Simulate spawn failure by rejecting
			vi.mocked(agents.runAgentWithConfig).mockRejectedValue(
				new Error("Failed to spawn process")
			);

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
			expect(result.message).toContain("[FALLBACK]");
		});

		it("handles unexpected errors gracefully", async () => {
			const context: CommitMessageContext = {
				role: "specDrafter",
				modelConfig: { model: "opus", thinking: "high" },
				files: ["docs/spec.md"],
			};

			// Throw non-Error object
			vi.mocked(agents.runAgentWithConfig).mockRejectedValue("String error");

			const result = await generateCommitMessage(context, mockAgentConfig, mockCwd);

			expect(result.type).toBe("fallback");
		});
	});
});
