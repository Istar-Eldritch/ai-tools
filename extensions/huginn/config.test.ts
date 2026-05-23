import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveConfig } from "./config.ts";
import { DEFAULT_HUGINN_CONFIG } from "./constants.ts";

describe("resolveConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "huginn-config-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns all defaults when config file is missing", () => {
		const config = resolveConfig(tmpDir);
		expect(config.dataDir).toBe(DEFAULT_HUGINN_CONFIG.dataDir);
		expect(config.embeddingModel).toBe(DEFAULT_HUGINN_CONFIG.embeddingModel);
		expect(config.embeddingDim).toBe(DEFAULT_HUGINN_CONFIG.embeddingDim);
		expect(config.chunkSize).toBe(DEFAULT_HUGINN_CONFIG.chunkSize);
		expect(config.chunkOverlap).toBe(DEFAULT_HUGINN_CONFIG.chunkOverlap);
		expect(config.minChunkSize).toBe(DEFAULT_HUGINN_CONFIG.minChunkSize);
		expect(config.autoIngestion).toBe(DEFAULT_HUGINN_CONFIG.autoIngestion);
		expect(config.ingestRoles).toEqual(DEFAULT_HUGINN_CONFIG.ingestRoles);
		expect(config.autoRetrieval).toBe(DEFAULT_HUGINN_CONFIG.autoRetrieval);
		expect(config.autoRetrievalMax).toBe(
			DEFAULT_HUGINN_CONFIG.autoRetrievalMax,
		);
		expect(config.minSimilarity).toBe(DEFAULT_HUGINN_CONFIG.minSimilarity);
		expect(config.reindexBatchSize).toBe(
			DEFAULT_HUGINN_CONFIG.reindexBatchSize,
		);
		expect(config.extraIgnore).toEqual(DEFAULT_HUGINN_CONFIG.extraIgnore);
		expect(config.ignoreDotDirs).toBe(DEFAULT_HUGINN_CONFIG.ignoreDotDirs);
		expect(config.maxIndexedFiles).toBe(DEFAULT_HUGINN_CONFIG.maxIndexedFiles);
	});

	it("overrides individual fields and preserves others", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "huginn.json"),
			JSON.stringify({ embeddingDim: 384, chunkSize: 256 }),
		);
		const config = resolveConfig(tmpDir);
		expect(config.embeddingDim).toBe(384);
		expect(config.chunkSize).toBe(256);
		expect(config.embeddingModel).toBe(DEFAULT_HUGINN_CONFIG.embeddingModel);
		expect(config.dataDir).toBe(DEFAULT_HUGINN_CONFIG.dataDir);
	});

	it("gracefully handles malformed JSON", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, ".pi", "huginn.json"), "not json");
		const config = resolveConfig(tmpDir);
		expect(config.embeddingModel).toBe(DEFAULT_HUGINN_CONFIG.embeddingModel);
	});

	it("returns a deep copy so callers cannot mutate defaults", () => {
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "huginn.json"),
			JSON.stringify({ ingestRoles: ["user"], extraIgnore: ["tmp"] }),
		);
		const config1 = resolveConfig(tmpDir);
		config1.ingestRoles.push("extra");
		config1.extraIgnore.push("other");
		const config2 = resolveConfig(tmpDir);
		expect(config2.ingestRoles).toEqual(["user"]);
		expect(config2.extraIgnore).toEqual(["tmp"]);
	});
});
