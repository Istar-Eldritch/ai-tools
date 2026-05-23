import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
	getDatabase,
	isDatabaseReady,
	setConfigRow,
	getConfigRow,
} from "../store/db.ts";
import {
	getTotalChunkCount,
	getChunkBatch,
	updateChunkEmbedding,
} from "../store/chunk-store.ts";
import type { EmbeddingProvider } from "../embeddings.ts";
import type { HuginnConfig } from "../types.ts";

function parseArgs(args: string): { model?: string } {
	const tokens = args.trim().split(/\s+/);
	const result: { model?: string } = {};
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "--model" && tokens[i + 1]) {
			result.model = tokens[i + 1];
			i++;
		}
	}
	return result;
}

export function registerReindexCommand(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
	getProvider: () => EmbeddingProvider | null,
) {
	pi.registerCommand("huginn-reindex", {
		description: "Re-embed all chunks with the current or specified model",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const config = getConfig();
			const db = getDatabase();
			const provider = getProvider();

			if (!db || !isDatabaseReady() || !provider || !provider.isReady()) {
				ctx.ui.notify(
					"[huginn] Reindex unavailable: database or embeddings not initialized.",
					"warning",
				);
				return;
			}

			const parsed = parseArgs(args);

			const targetModel = parsed.model ?? config.embeddingModel;
			const targetDim = config.embeddingDim;

			// Check for dimension mismatch with stored config
			const stored = await getConfigRow(db);
			if (
				stored &&
				(stored.embedding_model !== targetModel ||
					stored.embedding_dim !== targetDim)
			) {
				ctx.ui.notify(
					`[huginn] Model change detected. Dropping old embedding index and recreating...`,
					"info",
				);
				try {
					await db.query("DROP INDEX IF EXISTS huginn_chunks_embedding_idx");
					await db.query(
						"ALTER TABLE huginn_chunks DROP COLUMN IF EXISTS embedding",
					);
					await db.query(
						`ALTER TABLE huginn_chunks ADD COLUMN embedding vector(${targetDim})`,
					);
					await db.query(
						"CREATE INDEX huginn_chunks_embedding_idx ON huginn_chunks USING hnsw (embedding vector_cosine_ops)",
					);
					await setConfigRow(db, targetModel, targetDim);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ctx.ui.notify(
						`[huginn] Failed to migrate vector dimension: ${msg}`,
						"error",
					);
					return;
				}
			}

			const total = await getTotalChunkCount(db);
			if (total === 0) {
				ctx.ui.notify("[huginn] No chunks to reindex.", "info");
				return;
			}

			ctx.ui.notify(`[huginn] Reindexing ${total} chunks...`, "info");

			const batchSize = config.reindexBatchSize;
			let processed = 0;

			while (processed < total) {
				const rows = await getChunkBatch(db, processed, batchSize);
				if (rows.length === 0) break;

				const embeddings = await provider.embed(
					rows.map((r) => r.content),
					batchSize,
				);

				for (let i = 0; i < rows.length; i++) {
					await updateChunkEmbedding(
						db,
						rows[i].id,
						embeddings.embeddings[i],
						targetModel,
					);
				}

				processed += rows.length;
				ctx.ui.setStatus(
					"huginn-reindex",
					`Reindexing... ${processed}/${total}`,
				);
			}

			ctx.ui.setStatus("huginn-reindex", undefined);
			ctx.ui.notify(
				`[huginn] Reindex complete — ${processed} chunks re-embedded with ${targetModel}.`,
				"info",
			);
		},
	});
}
