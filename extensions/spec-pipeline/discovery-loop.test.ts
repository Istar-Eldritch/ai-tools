import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	createInitialSpecState,
	saveSpecState,
	getLatestActiveSpecPipeline,
	loadSpecState,
} from "./state.ts";

const { mockRunAgentWithConfig, mockValidateGitRepo, mockLoadPipelineConfig } =
	vi.hoisted(() => ({
		mockRunAgentWithConfig: vi.fn(),
		mockValidateGitRepo: vi.fn(),
		mockLoadPipelineConfig: vi.fn(),
	}));

vi.mock("./agents.ts", async () => {
	const actual =
		await vi.importActual<typeof import("./agents.ts")>("./agents.ts");
	return {
		...actual,
		runAgentWithConfig: mockRunAgentWithConfig,
	};
});

vi.mock("./git.ts", async () => {
	const actual = await vi.importActual<typeof import("./git.ts")>("./git.ts");
	return {
		...actual,
		validateGitRepo: mockValidateGitRepo,
	};
});

vi.mock("./config.ts", async () => {
	const actual =
		await vi.importActual<typeof import("./config.ts")>("./config.ts");
	return {
		...actual,
		loadPipelineConfig: mockLoadPipelineConfig,
	};
});

const testProjectConfig = {
	specsDir: "docs/specs",
	testCommand: null,
	contextFiles: [],
	projectContext: "Project context",
	projectContextForReviewer: "Project context",
	projectContextForFixer: "Project context",
	specTemplate: null,
	specTemplatePath: null,
	specConventions: null,
	specConventionsPath: null,
	specFormat: "md",
	models: {
		planDrafter: { model: "gpt-5.5", thinking: "high" },
		implementer: { model: "gpt-5.5", thinking: "high" },
		codeReviewer: { model: "gpt-5.4", thinking: "medium" },
		addressReview: { model: "gpt-5.4", thinking: "medium" },
		agentCommitMessageWriter: { model: "gpt-5.4-mini", thinking: "off" },
	},
	reviewCycles: 2,
	skipPlanGeneration: false,
} as const;

type MockCommand = { handler: (args: string, ctx: any) => Promise<void> };
type MockEventHandler = (event: any, ctx: any) => Promise<any>;

function createMockPi() {
	const commands = new Map<string, MockCommand>();
	const events = new Map<string, MockEventHandler>();

	return {
		commands,
		events,
		sendUserMessage: vi.fn(),
		registerCommand: vi.fn((name: string, command: MockCommand) => {
			commands.set(name, command);
		}),
		on: vi.fn((name: string, handler: MockEventHandler) => {
			events.set(name, handler);
		}),
	};
}

function createMockCtx(cwd: string) {
	const notifications: Array<{ message: string; type: string }> = [];
	const ctx = {
		hasUI: true,
		cwd,
		ui: {
			notify: vi.fn((message: string, type: string) => {
				notifications.push({ message, type });
			}),
			confirm: vi.fn(async () => true),
			input: vi.fn(async (_title: string, placeholder?: string) => placeholder),
			setWidget: vi.fn(),
		},
	};
	return { ctx, notifications };
}

describe("spec discovery loop", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spec-pipeline-loop-test-"));
		vi.clearAllMocks();
		mockValidateGitRepo.mockResolvedValue({ valid: true });
		mockLoadPipelineConfig.mockReturnValue({
			success: true,
			config: testProjectConfig,
			fromFile: false,
		});
	});

	afterEach(() => {
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("closes the active topic on plain user input and syncs topics into conversationHistory on READY_TO_DRAFT", async () => {
		const { default: specPipeline } = await import("./index.ts");
		const pi = createMockPi();
		specPipeline(pi as any);
		const { ctx } = createMockCtx(cwd);

		let resolveReady: ((value: { output: string }) => void) | null = null;
		mockRunAgentWithConfig
			.mockResolvedValueOnce({ output: "Should we support SSO from day one?" })
			.mockImplementationOnce(
				() =>
					new Promise<{ output: string }>(
						(resolve: (value: { output: string }) => void) => {
							resolveReady = resolve;
						},
					),
			);

		await pi.commands.get("spec")!.handler("Add authentication", ctx);

		await vi.waitFor(() => {
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(1);
		});

		let state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.discovery?.activeTopic?.question).toContain("SSO");
		expect(state.discovery?.topics).toEqual([]);

		const inputResult = await pi.events.get("input")!(
			{ text: "No, email/password first.", source: "user" },
			ctx,
		);
		expect(inputResult).toEqual({ action: "handled" });

		await vi.waitFor(() => {
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(2);
		});
		expect(mockRunAgentWithConfig.mock.calls[0][0]).toBe(
			testProjectConfig.models.planDrafter,
		);
		expect(mockRunAgentWithConfig.mock.calls[1][0]).toBe(
			testProjectConfig.models.planDrafter,
		);

		state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.discovery?.activeTopic).toBeNull();
		expect(state.discovery?.topics).toHaveLength(1);
		expect(state.discovery?.topics?.[0].decision).toBe(
			"No, email/password first.",
		);

		(resolveReady as unknown as (value: { output: string }) => void)({
			output: "READY_TO_DRAFT",
		});

		await vi.waitFor(() => {
			expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		});

		state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.stage).toBe("spec_drafting");
		expect(state.discovery?.completed).toBe(true);
		expect(state.discovery?.topics).toHaveLength(1);
		expect(state.discovery?.activeTopic).toBeNull();
		expect(state.discovery?.conversationHistory).toEqual([
			{
				userMessage: "No, email/password first.",
				assistantResponse: "Should we support SSO from day one?",
				timestamp: state.discovery!.topics![0].timestamp,
			},
		]);
	});

	it("classifies question-shaped replies as follow-ups and keeps the active topic open", async () => {
		const { default: specPipeline } = await import("./index.ts");
		const pi = createMockPi();
		specPipeline(pi as any);
		const { ctx, notifications } = createMockCtx(cwd);

		mockRunAgentWithConfig
			.mockResolvedValueOnce({
				output: "Should enterprise tenants require SSO?",
			})
			.mockResolvedValueOnce({ output: "FOLLOWUP" });

		await pi.commands.get("spec")!.handler("Add authentication", ctx);

		await vi.waitFor(() => {
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(1);
		});

		const inputResult = await pi.events.get("input")!(
			{
				text: "What would optional SSO mean for local accounts?",
				source: "user",
			},
			ctx,
		);

		expect(inputResult).toEqual({ action: "handled" });
		expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(2);
		expect(mockRunAgentWithConfig.mock.calls[1][0]).toBe(
			testProjectConfig.models.agentCommitMessageWriter,
		);
		expect(mockRunAgentWithConfig.mock.calls[1][6]).toBe("commitMessageWriter");

		const state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.discovery?.topics).toEqual([]);
		expect(state.discovery?.activeTopic).toMatchObject({
			question: "Should enterprise tenants require SSO?",
			decision: null,
		});
		expect(
			notifications.some((entry) =>
				entry.message.includes("Follow-up detected"),
			),
		).toBe(true);
	});

	it("falls back to decision when the classifier fails", async () => {
		const { default: specPipeline } = await import("./index.ts");
		const pi = createMockPi();
		specPipeline(pi as any);
		const { ctx } = createMockCtx(cwd);

		mockRunAgentWithConfig
			.mockResolvedValueOnce({ output: "Should we support local auth?" })
			.mockRejectedValueOnce(new Error("classifier unavailable"))
			.mockResolvedValueOnce({ output: "READY_TO_DRAFT" });

		await pi.commands.get("spec")!.handler("Add authentication", ctx);
		await vi.waitFor(() =>
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(1),
		);

		const inputResult = await pi.events.get("input")!(
			{ text: "local auth only for launch", source: "user" },
			ctx,
		);

		expect(inputResult).toEqual({ action: "handled" });
		await vi.waitFor(() =>
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(3),
		);

		const state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.discovery?.topics).toHaveLength(1);
		expect(state.discovery?.topics?.[0]).toMatchObject({
			question: "Should we support local auth?",
			decision: "local auth only for launch",
		});
		expect(state.discovery?.activeTopic).toBeNull();
	});

	it("preserves an open topic with decision null when /discovery-done is used", async () => {
		const { default: specPipeline } = await import("./index.ts");
		const pi = createMockPi();
		specPipeline(pi as any);
		const { ctx } = createMockCtx(cwd);

		mockRunAgentWithConfig.mockResolvedValueOnce({
			output: "Should tenant admins manage user invites?",
		});

		await pi.commands.get("spec")!.handler("Add team invitations", ctx);

		await vi.waitFor(() => {
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(1);
		});

		await pi.commands.get("discovery-done")!.handler("", ctx);

		await vi.waitFor(() => {
			expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		});

		const state = getLatestActiveSpecPipeline(cwd)!;
		expect(state.stage).toBe("spec_drafting");
		expect(state.discovery?.completed).toBe(true);
		expect(state.discovery?.topics).toHaveLength(1);
		expect(state.discovery?.topics?.[0]).toMatchObject({
			question: "Should tenant admins manage user invites?",
			decision: null,
		});
		expect(state.discovery?.activeTopic).toBeNull();
		expect(state.discovery?.conversationHistory?.[0]).toMatchObject({
			userMessage: "(No final decision recorded)",
			assistantResponse: "Should tenant admins manage user invites?",
		});
	});

	it("restores persisted discovery loop state on /spec-resume", async () => {
		const { default: specPipeline } = await import("./index.ts");
		const pi = createMockPi();
		specPipeline(pi as any);
		const { ctx, notifications } = createMockCtx(cwd);

		const state = createInitialSpecState(
			"Add authentication",
			"2605231200",
			"auth",
			"docs/specs",
			false,
			"md",
		);
		state.discovery!.topics = [
			{
				question: "Should local auth remain supported?",
				followUps: [],
				decision: "Yes, keep both local auth and SSO.",
				timestamp: "2026-05-23T12:00:00.000Z",
			},
		];
		state.discovery!.activeTopic = {
			question: "Should SSO be mandatory for enterprise tenants?",
			followUps: [],
			decision: null,
			timestamp: "2026-05-23T12:05:00.000Z",
		};
		saveSpecState(cwd, state);

		let continueDiscovery!: (value: { output: string }) => void;
		mockRunAgentWithConfig.mockImplementationOnce(
			() =>
				new Promise<{ output: string }>(
					(resolve: (value: { output: string }) => void) => {
						continueDiscovery = resolve;
					},
				),
		);

		await pi.commands.get("spec-resume")!.handler(state.id, ctx);

		expect(mockRunAgentWithConfig).not.toHaveBeenCalled();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
		expect(
			notifications.some((entry) =>
				entry.message.includes(
					"Should SSO be mandatory for enterprise tenants?",
				),
			),
		).toBe(true);

		const inputResult = await pi.events.get("input")!(
			{ text: "No, make it optional.", source: "user" },
			ctx,
		);
		expect(inputResult).toEqual({ action: "handled" });

		await vi.waitFor(() => {
			expect(mockRunAgentWithConfig).toHaveBeenCalledTimes(1);
		});

		const resumedState = loadSpecState(cwd, state.id)!;
		expect(resumedState.discovery?.topics).toHaveLength(2);
		expect(resumedState.discovery?.topics?.[1]).toMatchObject({
			question: "Should SSO be mandatory for enterprise tenants?",
			decision: "No, make it optional.",
		});
		expect(resumedState.discovery?.activeTopic).toBeNull();

		continueDiscovery({ output: "READY_TO_DRAFT" });
	});
});
