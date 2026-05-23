import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_HUGINN_CONFIG } from "./constants.ts";
import type { HuginnConfig } from "./types.ts";

export function resolveConfig(cwd: string): HuginnConfig {
	const configPath = path.join(cwd, ".pi", "huginn.json");
	let userConfig: Partial<HuginnConfig> = {};

	if (fs.existsSync(configPath)) {
		try {
			const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			if (raw && typeof raw === "object") {
				userConfig = raw as Partial<HuginnConfig>;
			}
		} catch (e) {
			console.warn(
				"[huginn] Failed to parse .pi/huginn.json, using defaults:",
				e,
			);
		}
	}

	const rawDataDir = userConfig.dataDir ?? DEFAULT_HUGINN_CONFIG.dataDir;

	return {
		dataDir: path.isAbsolute(rawDataDir)
			? rawDataDir
			: path.resolve(cwd, rawDataDir),
		embeddingModel:
			userConfig.embeddingModel ?? DEFAULT_HUGINN_CONFIG.embeddingModel,
		embeddingDim: userConfig.embeddingDim ?? DEFAULT_HUGINN_CONFIG.embeddingDim,
		chunkSize: userConfig.chunkSize ?? DEFAULT_HUGINN_CONFIG.chunkSize,
		chunkOverlap: userConfig.chunkOverlap ?? DEFAULT_HUGINN_CONFIG.chunkOverlap,
		minChunkSize: userConfig.minChunkSize ?? DEFAULT_HUGINN_CONFIG.minChunkSize,
		autoIngestion:
			userConfig.autoIngestion ?? DEFAULT_HUGINN_CONFIG.autoIngestion,
		ingestRoles: userConfig.ingestRoles ?? [
			...DEFAULT_HUGINN_CONFIG.ingestRoles,
		],
		autoRetrieval:
			userConfig.autoRetrieval ?? DEFAULT_HUGINN_CONFIG.autoRetrieval,
		autoRetrievalMax:
			userConfig.autoRetrievalMax ?? DEFAULT_HUGINN_CONFIG.autoRetrievalMax,
		minSimilarity:
			userConfig.minSimilarity ?? DEFAULT_HUGINN_CONFIG.minSimilarity,
		reindexBatchSize:
			userConfig.reindexBatchSize ?? DEFAULT_HUGINN_CONFIG.reindexBatchSize,
		extraIgnore: userConfig.extraIgnore ?? [
			...DEFAULT_HUGINN_CONFIG.extraIgnore,
		],
		ignoreDotDirs:
			userConfig.ignoreDotDirs ?? DEFAULT_HUGINN_CONFIG.ignoreDotDirs,
		maxIndexedFiles:
			userConfig.maxIndexedFiles ?? DEFAULT_HUGINN_CONFIG.maxIndexedFiles,
	};
}
