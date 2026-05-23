import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getDatabase, isDatabaseReady } from "../store/db.ts";
import { searchChunks } from "../store/chunk-store.ts";
import type { EmbeddingProvider } from "../embeddings.ts";
import type { HuginnConfig } from "../types.ts";

export function registerMemorySearchTool(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
	getProvider: () => EmbeddingProvider | null,
) {
	pi.registerTool({
		name: "huginn_memory_search",
		label: "Huginn Memory Search",
		description:
			"Search across conversation history and codebase using semantic similarity. Returns relevant chunks with provenance and similarity scores.",
		parameters: Type.Object({
			query: Type.String({ description: "The search query" }),
			project: Type.Optional(
				Type.String({
					description:
						"Project filter for codebase chunks. Defaults to current project.",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum number of results",
					default: 5,
				}),
			),
			source_type: Type.Optional(
				Type.Union([
					Type.Literal("conversation"),
					Type.Literal("codebase"),
					Type.Literal("all"),
				]),
			),
		}),
		async execute(
			_toolCallId: any,
			params: any,
			signal: any,
			_onUpdate: any,
			ctx: any,
		) {
			const config = getConfig();
			const db = getDatabase();
			const provider = getProvider();

			if (!db || !isDatabaseReady() || !provider || !provider.isReady()) {
				return {
					content: [
						{
							type: "text",
							text: "[huginn] Memory search unavailable: database or embeddings not initialized.",
						},
					],
					details: { error: "not_ready" },
				};
			}

			const query = params.query;
			const limit = params.limit ?? config.autoRetrievalMax;
			const sourceType =
				(params.source_type as "conversation" | "codebase" | "all") ?? "all";
			const project = params.project ?? ctx.cwd;

			const queryEmbedding = await provider.embed([query], undefined, signal);
			const results = await searchChunks(
				db,
				query,
				queryEmbedding.embeddings[0],
				{
					project,
					limit,
					sourceType,
					minSimilarity: config.minSimilarity,
				},
			);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No relevant memories found." }],
					details: { count: 0, query },
				};
			}

			const lines = ["Relevant memories:"];
			for (let i = 0; i < results.length; i++) {
				const r = results[i];
				const provenance =
					r.sourceType === "conversation"
						? `[conversation, similarity: ${r.similarity.toFixed(3)}]`
						: `[codebase: ${r.sourceFile ?? "unknown"}, lines ${r.startLine ?? "?"}-${r.endLine ?? "?"}, similarity: ${r.similarity.toFixed(3)}]`;
				lines.push(`${i + 1}. ${provenance}\n${r.content}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n\n") }],
				details: { count: results.length, query },
			};
		},
	} as any);
}
