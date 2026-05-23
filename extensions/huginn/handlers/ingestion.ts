import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createHash } from "node:crypto";
import { chunkText } from "../chunker.ts";
import { ingestChunks } from "../store/chunk-store.ts";
import { getDatabase, isDatabaseReady } from "../store/db.ts";
import { extractTextFromMessage } from "../utils.ts";
import type { EmbeddingProvider } from "../embeddings.ts";
import type { HuginnConfig, Chunk } from "../types.ts";

export function registerIngestionHandler(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
	getProvider: () => EmbeddingProvider | null,
) {
	// message_end is available in runtime pi >= 0.70; cast to any for compatibility
	// with the project's older @mariozechner/pi-coding-agent type declarations.
	(
		pi as unknown as {
			on(
				event: "message_end",
				handler: (event: any, ctx: any) => void | Promise<void>,
			): void;
		}
	).on("message_end", async (event: any, ctx: any) => {
		const config = getConfig();
		if (!config.autoIngestion) return;
		if (!config.ingestRoles.includes(event.message?.role)) return;

		// Fire-and-forget
		(async () => {
			try {
				const text = extractTextFromMessage(event.message);
				if (!text || text.trim().length === 0) return;

				const db = getDatabase();
				const provider = getProvider();
				if (!db || !isDatabaseReady() || !provider || !provider.isReady()) {
					console.warn("[huginn] Ingestion skipped: DB or provider not ready");
					return;
				}

				const chunks = chunkText(text, {
					chunkSize: config.chunkSize,
					chunkOverlap: config.chunkOverlap,
					minChunkSize: config.minChunkSize,
				});

				if (chunks.length === 0) return;

				const sessionId = ctx.sessionManager?.getSessionFile?.() ?? "unknown";
				const role = event.message.role as "user" | "assistant" | "toolResult";

				const chunkData: Chunk[] = chunks.map((content, index) => {
					const hash = createHash("sha256").update(content).digest("hex");
					return {
						sourceType: "conversation" as const,
						sessionId,
						role,
						chunkIndex: index,
						content,
						contentHash: hash,
						modelName: provider.modelName,
						project: ctx.cwd,
						createdAt: new Date(),
					};
				});

				const embeddings = await provider.embed(
					chunkData.map((c) => c.content),
					config.reindexBatchSize,
					ctx.signal,
				);

				for (let i = 0; i < chunkData.length; i++) {
					chunkData[i].embedding = embeddings.embeddings[i];
				}

				await ingestChunks(db, chunkData);
			} catch (err) {
				console.error("[huginn] Ingestion error:", err);
			}
		})();
	});
}
