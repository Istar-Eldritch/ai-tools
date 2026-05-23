import type { HuginnConfig } from "./types.js";

const DEFAULTS: Required<HuginnConfig> = {
	databaseUrl: "",
	openaiApiKey: "",
	embeddingModel: "text-embedding-3-small",
	embeddingDim: 1536,
	nudgeInterval: 10,
	flushOnShutdown: true,
	flushMinTurns: 6,
	maxSnapshotEntries: 10,
	autoRetrievalMax: 5,
	minSimilarity: 0.3,
	correctionDetection: true,
};

export function resolveConfig(raw: HuginnConfig = {}): Required<HuginnConfig> {
	return {
		databaseUrl:
			raw.databaseUrl ||
			process.env.HUGINN_DATABASE_URL ||
			process.env.DATABASE_URL ||
			"",
		openaiApiKey: raw.openaiApiKey || process.env.OPENAI_API_KEY || "",
		embeddingModel: raw.embeddingModel ?? DEFAULTS.embeddingModel,
		embeddingDim: raw.embeddingDim ?? DEFAULTS.embeddingDim,
		nudgeInterval: raw.nudgeInterval ?? DEFAULTS.nudgeInterval,
		flushOnShutdown: raw.flushOnShutdown ?? DEFAULTS.flushOnShutdown,
		flushMinTurns: raw.flushMinTurns ?? DEFAULTS.flushMinTurns,
		maxSnapshotEntries: raw.maxSnapshotEntries ?? DEFAULTS.maxSnapshotEntries,
		autoRetrievalMax: raw.autoRetrievalMax ?? DEFAULTS.autoRetrievalMax,
		minSimilarity: raw.minSimilarity ?? DEFAULTS.minSimilarity,
		correctionDetection:
			raw.correctionDetection ?? DEFAULTS.correctionDetection,
	};
}
