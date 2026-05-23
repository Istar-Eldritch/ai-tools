import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveConfig } from "./config.ts";
import {
	openDatabase,
	closeDatabase,
	getConfigRow,
	setConfigRow,
} from "./store/db.ts";
import { EmbeddingProvider } from "./embeddings.ts";
import { registerIngestionHandler } from "./handlers/ingestion.ts";
import { registerAutoRetrievalHandlers } from "./handlers/auto-retrieval.ts";
import { registerMemorySearchTool } from "./tools/memory-search-tool.ts";
import { registerReindexCommand } from "./commands/reindex.ts";
import { registerStatusCommand } from "./commands/status.ts";
import { registerCodebaseIndexer } from "./handlers/codebase-indexer.ts";

export default function (pi: ExtensionAPI) {
	let provider: EmbeddingProvider | null = null;
	let config = resolveConfig(process.cwd());

	const getConfig = () => config;
	const getProvider = () => provider;

	const initialize = async (cwd: string): Promise<void> => {
		config = resolveConfig(cwd);
		const db = await openDatabase(config.dataDir);
		provider = new EmbeddingProvider(
			config.embeddingModel,
			config.embeddingDim,
		);
		await provider.init();
		const stored = await getConfigRow(db);
		if (stored) {
			if (
				stored.embedding_model !== config.embeddingModel ||
				stored.embedding_dim !== config.embeddingDim
			) {
				console.warn(
					`[huginn] Model mismatch: stored ${stored.embedding_model} (${stored.embedding_dim}d) vs config ${config.embeddingModel} (${config.embeddingDim}d). Run /huginn-reindex.`,
				);
			}
		} else {
			await setConfigRow(db, config.embeddingModel, config.embeddingDim);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		config = resolveConfig(ctx.cwd);
		if (!config.autoIngestion && !config.autoRetrieval) {
			return;
		}
		initialize(ctx.cwd).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("[huginn] background init failed:", msg);
		});
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		try {
			provider = null;
			await closeDatabase();
		} catch (err) {
			console.error("[huginn] session_shutdown error:", err);
		}
	});

	registerIngestionHandler(pi, getConfig, getProvider);
	registerAutoRetrievalHandlers(pi, getConfig, getProvider);
	registerMemorySearchTool(pi, getConfig, getProvider);
	registerReindexCommand(pi, getConfig, getProvider);
	registerStatusCommand(pi, getConfig);
	registerCodebaseIndexer(pi, getConfig, getProvider);
}
