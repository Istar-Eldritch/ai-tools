import { describe, it, expect } from "vitest";
import { DEFAULT_HUGINN_CONFIG, HARDCODED_EXCLUSIONS } from "./constants.ts";

describe("DEFAULT_HUGINN_CONFIG", () => {
	it("has expected default values", () => {
		expect(DEFAULT_HUGINN_CONFIG.dataDir).toBe(".pi/agent/huginn/db");
		expect(DEFAULT_HUGINN_CONFIG.embeddingModel).toBe(
			"nomic-ai/nomic-embed-text-v1.5",
		);
		expect(DEFAULT_HUGINN_CONFIG.embeddingDim).toBe(768);
		expect(DEFAULT_HUGINN_CONFIG.chunkSize).toBe(512);
		expect(DEFAULT_HUGINN_CONFIG.chunkOverlap).toBe(64);
		expect(DEFAULT_HUGINN_CONFIG.minChunkSize).toBe(32);
		expect(DEFAULT_HUGINN_CONFIG.autoIngestion).toBe(true);
		expect(DEFAULT_HUGINN_CONFIG.ingestRoles).toEqual([
			"user",
			"assistant",
			"toolResult",
		]);
		expect(DEFAULT_HUGINN_CONFIG.autoRetrieval).toBe(true);
		expect(DEFAULT_HUGINN_CONFIG.autoRetrievalMax).toBe(5);
		expect(DEFAULT_HUGINN_CONFIG.minSimilarity).toBe(0.6);
		expect(DEFAULT_HUGINN_CONFIG.reindexBatchSize).toBe(32);
		expect(DEFAULT_HUGINN_CONFIG.extraIgnore).toEqual([]);
		expect(DEFAULT_HUGINN_CONFIG.ignoreDotDirs).toBe(true);
		expect(DEFAULT_HUGINN_CONFIG.maxIndexedFiles).toBe(200);
	});

	it("is readonly (shallow)", () => {
		expect(() => {
			// @ts-expect-error — testing immutability at runtime
			DEFAULT_HUGINN_CONFIG.dataDir = "foo";
		}).toThrow();
	});
});

describe("HARDCODED_EXCLUSIONS", () => {
	it("contains expected entries", () => {
		expect(HARDCODED_EXCLUSIONS).toContain(".git");
		expect(HARDCODED_EXCLUSIONS).toContain("node_modules");
		expect(HARDCODED_EXCLUSIONS).toContain("target");
		expect(HARDCODED_EXCLUSIONS).toContain("dist");
		expect(HARDCODED_EXCLUSIONS).toContain("package-lock.json");
		expect(HARDCODED_EXCLUSIONS).toContain("yarn.lock");
		expect(HARDCODED_EXCLUSIONS).toContain("pnpm-lock.yaml");
		expect(HARDCODED_EXCLUSIONS).toContain("Cargo.lock");
		expect(HARDCODED_EXCLUSIONS).toContain("poetry.lock");
		expect(HARDCODED_EXCLUSIONS).toContain("Gemfile.lock");
	});
});
