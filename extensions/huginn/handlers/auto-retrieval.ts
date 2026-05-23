import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getDatabase, isDatabaseReady } from "../store/db.ts";
import { searchChunks } from "../store/chunk-store.ts";
import { extractTextFromMessage } from "../utils.ts";
import type { EmbeddingProvider } from "../embeddings.ts";
import type { HuginnConfig, SearchResult } from "../types.ts";

let prefetchedBlock: string | null = null;

function formatResults(results: SearchResult[]): string {
	const lines = ["Relevant memories:"];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const provenance =
			r.sourceType === "conversation"
				? `[conversation, similarity: ${r.similarity.toFixed(3)}]`
				: `[codebase: ${r.sourceFile ?? "unknown"}, lines ${r.startLine ?? "?"}-${r.endLine ?? "?"}, similarity: ${r.similarity.toFixed(3)}]`;
		lines.push(`${i + 1}. ${provenance}\n${r.content}`);
	}
	return lines.join("\n\n");
}

export function registerAutoRetrievalHandlers(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
	getProvider: () => EmbeddingProvider | null,
) {
	// Prefetch on user message_end (runtime pi >= 0.70)
	(
		pi as unknown as {
			on(
				event: "message_end",
				handler: (event: any, ctx: any) => void | Promise<void>,
			): void;
		}
	).on("message_end", async (event: any, ctx: any) => {
		const config = getConfig();
		if (!config.autoRetrieval) return;
		if (event.message?.role !== "user") return;

		// Fire-and-forget prefetch
		(async () => {
			try {
				const query = extractTextFromMessage(event.message);
				if (!query || query.trim().length === 0) return;

				ctx.ui?.setWidget?.("huginn-memory", ["Searching memory..."]);

				const db = getDatabase();
				const provider = getProvider();
				if (!db || !isDatabaseReady() || !provider || !provider.isReady()) {
					ctx.ui?.setWidget?.("huginn-memory", undefined);
					return;
				}

				const queryEmbedding = await provider.embed(
					[query],
					undefined,
					ctx.signal,
				);
				const results = await searchChunks(
					db,
					query,
					queryEmbedding.embeddings[0],
					{
						project: ctx.cwd,
						limit: config.autoRetrievalMax,
						sourceType: "all",
						minSimilarity: config.minSimilarity,
					},
				);

				prefetchedBlock = results.length > 0 ? formatResults(results) : null;
				ctx.ui?.setWidget?.("huginn-memory", undefined);
			} catch (err) {
				console.error("[huginn] Auto-retrieval prefetch error:", err);
				ctx.ui?.setWidget?.("huginn-memory", undefined);
			}
		})();
	});

	// Inject prefetched block on context event before each LLM call
	pi.on("context", async (event: any) => {
		if (!prefetchedBlock) return;

		const messages = event.messages;
		let lastUserIndex = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				lastUserIndex = i;
				break;
			}
		}
		if (lastUserIndex === -1) return;

		const blockText = `\n\n<huginn-context\u003e\n${prefetchedBlock}\n</huginn-context\u003e`;
		const userMessage = messages[lastUserIndex];

		if (typeof userMessage.content === "string") {
			userMessage.content += blockText;
		} else if (Array.isArray(userMessage.content)) {
			const lastBlock = userMessage.content[userMessage.content.length - 1];
			if (
				lastBlock &&
				typeof lastBlock === "object" &&
				"type" in lastBlock &&
				lastBlock.type === "text" &&
				"text" in lastBlock &&
				typeof lastBlock.text === "string"
			) {
				lastBlock.text += blockText;
			} else {
				userMessage.content.push({
					type: "text",
					text: blockText.trimStart(),
				});
			}
		}

		prefetchedBlock = null; // clear so it is not injected again
		return { messages };
	});

	pi.on("session_shutdown", async () => {
		prefetchedBlock = null;
	});
}
