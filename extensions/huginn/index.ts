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

	pi.on("session_start", async (_event, ctx) => {
		config = resolveConfig(ctx.cwd);

		try {
			const db = await openDatabase(config.dataDir);

			// Initialize embedding provider
			provider = new EmbeddingProvider(
				config.embeddingModel,
				config.embeddingDim,
			);
			await provider.init();

			// Check stored config for model mismatch (R9)
			const stored = await getConfigRow(db);
			if (stored) {
				if (
					stored.embedding_model !== config.embeddingModel ||
					stored.embedding_dim !== config.embeddingDim
				) {
					ctx.ui.notify(
						`[huginn] Model mismatch detected: stored ${stored.embedding_model} (${stored.embedding_dim}d) vs config ${config.embeddingModel} (${config.embeddingDim}d). ` +
							`Run /huginn-reindex to rebuild the index. Auto-retrieval is disabled until reindex.`,
						"warning",
					);
				}
			} else {
				// First run — seed the config row
				await setConfigRow(db, config.embeddingModel, config.embeddingDim);
			}

			ctx.ui.notify(
				`[huginn] Ready — ${config.embeddingModel} (${config.embeddingDim}d) on PGlite`,
				"info",
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("[huginn] session_start failed:", msg);
			ctx.ui.notify(`[huginn] Initialization failed: ${msg}`, "error");
		}
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
