import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	generatePipelineId,
	generateSpecTimestamp,
	generateDiscoverySummary,
	createInitialDiscoveryState,
	createInitialState,
} from "./state.ts";

describe("generatePipelineId", () => {
	it("generates a non-empty string", () => {
		const id = generatePipelineId();
		expect(id).toBeTruthy();
		expect(typeof id).toBe("string");
	});

	it("generates unique IDs on subsequent calls", () => {
		const id1 = generatePipelineId();
		const id2 = generatePipelineId();
		expect(id1).not.toBe(id2);
	});

	it("contains date component", () => {
		const id = generatePipelineId();
		// Format: YYYYMMDD_HHMMSS_xxxx
		expect(id).toMatch(/^\d{8}_\d{6}_\w+$/);
	});

	it("generates IDs with correct format", () => {
		// Mock date for predictable testing
		const mockDate = new Date("2026-02-01T12:30:45.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(mockDate);

		const id = generatePipelineId();
		
		// Should start with 20260201_123045
		expect(id).toMatch(/^20260201_123045_\w{4}$/);

		vi.useRealTimers();
	});
});

describe("generateSpecTimestamp", () => {
	it("generates timestamp in YYMMDDhhmm format", () => {
		const ts = generateSpecTimestamp();
		expect(ts).toMatch(/^\d{10}$/);
	});

	it("generates correct timestamp for known date", () => {
		const mockDate = new Date("2026-02-01T14:35:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(mockDate);

		const ts = generateSpecTimestamp();
		expect(ts).toBe("2602011435");

		vi.useRealTimers();
	});

	it("pads single-digit months and days", () => {
		const mockDate = new Date("2026-01-05T08:05:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(mockDate);

		const ts = generateSpecTimestamp();
		expect(ts).toBe("2601050805");

		vi.useRealTimers();
	});
});

describe("createInitialDiscoveryState", () => {
	it("creates state with given maxRounds", () => {
		const state = createInitialDiscoveryState(10);
		expect(state.maxRounds).toBe(10);
	});

	it("creates non-skipped state by default", () => {
		const state = createInitialDiscoveryState(5);
		expect(state.skipped).toBe(false);
		expect(state.completed).toBe(false);
	});

	it("creates skipped state when requested", () => {
		const state = createInitialDiscoveryState(5, true);
		expect(state.skipped).toBe(true);
		expect(state.completed).toBe(true);
	});

	it("initializes with empty qaHistory", () => {
		const state = createInitialDiscoveryState(5);
		expect(state.qaHistory).toEqual([]);
	});

	it("initializes currentRound to 0", () => {
		const state = createInitialDiscoveryState(5);
		expect(state.currentRound).toBe(0);
	});

	it("initializes with empty discoverySummary", () => {
		const state = createInitialDiscoveryState(5);
		expect(state.discoverySummary).toBe("");
	});
});

describe("generateDiscoverySummary", () => {
	it("returns empty string for empty qaHistory", () => {
		expect(generateDiscoverySummary([])).toBe("");
	});

	it("includes discovery summary header", () => {
		const qaHistory = [
			{
				round: 1,
				questions: "What is the goal?",
				answers: "Build a CLI tool",
				timestamp: "2026-02-01T12:00:00Z",
			},
		];
		const summary = generateDiscoverySummary(qaHistory);
		expect(summary).toContain("## Discovery Summary");
	});

	it("includes round headers", () => {
		const qaHistory = [
			{
				round: 1,
				questions: "Q1",
				answers: "A1",
				timestamp: "2026-02-01T12:00:00Z",
			},
			{
				round: 2,
				questions: "Q2",
				answers: "A2",
				timestamp: "2026-02-01T12:05:00Z",
			},
		];
		const summary = generateDiscoverySummary(qaHistory);
		expect(summary).toContain("### Round 1");
		expect(summary).toContain("### Round 2");
	});

	it("includes questions and answers", () => {
		const qaHistory = [
			{
				round: 1,
				questions: "What language?",
				answers: "TypeScript",
				timestamp: "2026-02-01T12:00:00Z",
			},
		];
		const summary = generateDiscoverySummary(qaHistory);
		expect(summary).toContain("What language?");
		expect(summary).toContain("TypeScript");
		expect(summary).toContain("Questions Asked");
		expect(summary).toContain("User Responses");
	});
});

describe("createInitialState", () => {
	const defaultDiscoveryConfig = {
		enabled: true,
		maxRounds: 5,
		questionsPerRound: 4,
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates state with correct description", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.description).toBe("Build a feature");
	});

	it("creates state with correct spec filename", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.specFilename).toBe("2602011200_spec_feature.md");
	});

	it("creates state with correct spec path", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.specPath).toBe("docs/specs/2602011200_spec_feature.md");
	});

	it("starts in discovery stage when discovery enabled", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			{ ...defaultDiscoveryConfig, enabled: true },
			false // skipDiscovery
		);
		expect(state.stage).toBe("discovery");
	});

	it("starts in spec_drafting stage when discovery disabled", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			{ ...defaultDiscoveryConfig, enabled: false }
		);
		expect(state.stage).toBe("spec_drafting");
	});

	it("starts in spec_drafting stage when skipDiscovery is true", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig,
			true // skipDiscovery
		);
		expect(state.stage).toBe("spec_drafting");
		expect(state.discovery?.skipped).toBe(true);
	});

	it("initializes empty phases array", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.phases).toEqual([]);
		expect(state.phasesGenerated).toEqual([]);
	});

	it("initializes spec as not approved", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.specApproved).toBe(false);
		expect(state.specIteration).toBe(0);
	});

	it("initializes review cycle to 1", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.currentReviewCycle).toBe(1);
	});

	it("initializes commit tracking as false", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.specCommitted).toBe(false);
		expect(state.phaseCommits).toEqual([]);
	});

	it("sets timestamps", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.createdAt).toBe("2026-02-01T12:00:00.000Z");
		expect(state.updatedAt).toBe("2026-02-01T12:00:00.000Z");
	});

	it("generates unique ID", () => {
		const state1 = createInitialState(
			"Feature 1",
			"2602011200",
			"f1",
			"docs/specs",
			defaultDiscoveryConfig
		);
		const state2 = createInitialState(
			"Feature 2",
			"2602011201",
			"f2",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state1.id).not.toBe(state2.id);
	});

	it("sets useAgentCommits flag to true for new pipelines (Phase 5 - R11)", () => {
		const state = createInitialState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			defaultDiscoveryConfig
		);
		expect(state.useAgentCommits).toBe(true);
	});
});
