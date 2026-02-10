import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	generatePipelineId,
	generateSpecTimestamp,
	generateTimestamp,
	createInitialDiscoveryState,
	createInitialSpecState,
	createInitialImplState,
	createInitialRoadmapState,
	createInitialEpicState,
	extractChildItems,
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
	it("creates non-skipped state by default", () => {
		const state = createInitialDiscoveryState();
		expect(state.skipped).toBe(false);
		expect(state.completed).toBe(false);
	});

	it("creates skipped state when requested", () => {
		const state = createInitialDiscoveryState(true);
		expect(state.skipped).toBe(true);
		expect(state.completed).toBe(true);
	});

	it("initializes with empty conversationHistory", () => {
		const state = createInitialDiscoveryState();
		expect(state.conversationHistory).toEqual([]);
	});

	it("initializes with empty discoverySummary", () => {
		const state = createInitialDiscoveryState();
		expect(state.discoverySummary).toBe("");
	});
});

describe("createInitialSpecState", () => {
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
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs"
		);
		expect(state.description).toBe("Build a feature");
	});

	it("creates state with correct spec filename", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs"
		);
		expect(state.specFilename).toBe("2602011200_spec_feature.md");
	});

	it("creates state with correct spec path", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs"
		);
		expect(state.specPath).toBe("docs/specs/2602011200_spec_feature.md");
	});

	it("starts in discovery stage when discovery enabled", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			false // skipDiscovery
		);
		expect(state.stage).toBe("discovery");
	});

	it("starts in spec_drafting stage when discovery disabled", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			true // skipDiscovery
		);
		expect(state.stage).toBe("spec_drafting");
	});

	it("starts in spec_drafting stage when skipDiscovery is true", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs",
			true // skipDiscovery
		);
		expect(state.stage).toBe("spec_drafting");
		expect(state.discovery?.skipped).toBe(true);
	});

	it("initializes spec as not approved", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs"
		);
		expect(state.specApproved).toBe(false);
		expect(state.specIteration).toBe(0);
	});

	it("sets timestamps", () => {
		const state = createInitialSpecState(
			"Build a feature",
			"2602011200",
			"feature",
			"docs/specs"
		);
		expect(state.createdAt).toBe("2026-02-01T12:00:00.000Z");
		expect(state.updatedAt).toBe("2026-02-01T12:00:00.000Z");
	});

	it("generates unique ID", () => {
		const state1 = createInitialSpecState(
			"Feature 1",
			"2602011200",
			"f1",
			"docs/specs"
		);
		const state2 = createInitialSpecState(
			"Feature 2",
			"2602011201",
			"f2",
			"docs/specs"
		);
		expect(state1.id).not.toBe(state2.id);
	});

});

// ============================================
// Hierarchy State Tests
// ============================================

describe("createInitialRoadmapState", () => {
	const defaultDiscoveryConfig = {
		enabled: true,
		maxRounds: 5,
		questionsPerRound: 4,
	};

	it("creates state with correct level and defaults", () => {
		const state = createInitialRoadmapState(
			"Warm machine pools initiative",
			"2602071200",
			"warm_pools",
			"docs"
		);
		expect(state.level).toBe("roadmap");
		expect(state.description).toBe("Warm machine pools initiative");
		expect(state.stage).toBe("discovery");
		expect(state.docFilename).toBe("2602071200_roadmap_warm_pools.md");
		expect(state.docPath).toBe("docs/2602071200_roadmap_warm_pools.md");
		expect(state.children).toEqual([]);
		expect(state.docApproved).toBe(false);
	});

	it("skips discovery when flag is set", () => {
		const state = createInitialRoadmapState(
			"Quick roadmap",
			"2602071200",
			"quick",
			"docs",
			true
		);
		expect(state.stage).toBe("drafting");
		expect(state.discovery?.skipped).toBe(true);
	});
});

describe("createInitialEpicState", () => {
	const defaultDiscoveryConfig = {
		enabled: true,
		maxRounds: 5,
		questionsPerRound: 4,
	};

	it("creates state with correct level and defaults", () => {
		const state = createInitialEpicState(
			"Pool configuration",
			"2602071200",
			"pool_config",
			"docs"
		);
		expect(state.level).toBe("epic");
		expect(state.description).toBe("Pool configuration");
		expect(state.docFilename).toBe("2602071200_epic_pool_config.md");
		expect(state.children).toEqual([]);
	});

	it("stores parent reference when provided", () => {
		const state = createInitialEpicState(
			"Pool configuration",
			"2602071200",
			"pool_config",
			"docs",
			false,
			"md",
			"parent123",
			"roadmap"
		);
		expect(state.parentId).toBe("parent123");
		expect(state.parentType).toBe("roadmap");
	});
});

describe("extractChildItems", () => {
	it("extracts items from a standard child items table", () => {
		const doc = `# Warm Machine Pools Roadmap

## Child Items

| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
| 1 | Pool configuration | API and UI for warm pool settings | High | - |
| 2 | Provisioning engine | Background provisioning with retries | High | 1 |
| 3 | Billing integration | Track warm machine hours | Medium | 1 |
| 4 | Monitoring dashboard | Metrics and alerts | Low | 1, 2 |
`;
		const items = extractChildItems(doc);
		expect(items).toHaveLength(4);

		expect(items[0].number).toBe(1);
		expect(items[0].name).toBe("Pool configuration");
		expect(items[0].description).toBe("API and UI for warm pool settings");
		expect(items[0].priority).toBe("High");
		expect(items[0].dependencies).toEqual([]);

		expect(items[1].number).toBe(2);
		expect(items[1].dependencies).toEqual([1]);

		expect(items[2].priority).toBe("Medium");

		expect(items[3].number).toBe(4);
		expect(items[3].priority).toBe("Low");
		expect(items[3].dependencies).toEqual([1, 2]);
	});

	it("returns empty array when no child items table found", () => {
		const doc = `# Just a regular document

## Some Section

No child items here.
`;
		const items = extractChildItems(doc);
		expect(items).toHaveLength(0);
	});

	it("handles dependencies with 'None' keyword", () => {
		const doc = `| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
| 1 | First item | Desc | High | None |
`;
		const items = extractChildItems(doc);
		expect(items).toHaveLength(1);
		expect(items[0].dependencies).toEqual([]);
	});

	it("handles extra whitespace in cells", () => {
		const doc = `| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
|  1  |  Pool config  |  Some description  |  high  |  -  |
`;
		const items = extractChildItems(doc);
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("Pool config");
		expect(items[0].priority).toBe("High");
	});

	it("stops parsing at end of table", () => {
		const doc = `| # | Item | Description | Priority | Dependencies |
|---|------|-------------|----------|--------------|
| 1 | Item one | Desc one | High | - |

## Next Section

Some other content.
`;
		const items = extractChildItems(doc);
		expect(items).toHaveLength(1);
	});
});
