import type { PGlite } from "@electric-sql/pglite";
import type { Chunk, SearchResult } from "../types.ts";

export async function ingestChunks(db: PGlite, chunks: Chunk[]): Promise<void> {
	if (chunks.length === 0) return;
	for (const chunk of chunks) {
		await db.query(
			`INSERT INTO huginn_chunks
       (source_type, session_id, role, chunk_index, content, content_hash,
        source_file, start_line, end_line, file_mtime, file_size,
        model_name, embedding, project, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector,$14,$15,$16)
       ON CONFLICT (session_id, content_hash, chunk_index) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         model_name = EXCLUDED.model_name,
         updated_at = now()`,
			[
				chunk.sourceType,
				chunk.sessionId ?? null,
				chunk.role ?? null,
				chunk.chunkIndex,
				chunk.content,
				chunk.contentHash,
				chunk.sourceFile ?? null,
				chunk.startLine ?? null,
				chunk.endLine ?? null,
				chunk.fileMtime ?? null,
				chunk.fileSize ?? null,
				chunk.modelName,
				chunk.embedding ? `[${chunk.embedding.join(",")}]` : null,
				chunk.project ?? null,
				JSON.stringify(chunk.metadata ?? {}),
				chunk.createdAt ?? new Date(),
			],
		);
	}
}

export async function searchChunks(
	db: PGlite,
	_query: string,
	queryEmbedding: number[],
	options: {
		project?: string;
		limit?: number;
		sourceType?: "conversation" | "codebase" | "all";
		minSimilarity?: number;
	},
): Promise<SearchResult[]> {
	const limit = options.limit ?? 5;
	const minSim = options.minSimilarity ?? 0.6;
	const sourceFilter =
		options.sourceType && options.sourceType !== "all"
			? "AND source_type = $3"
			: "";

	const scopeWhere =
		!options.sourceType || options.sourceType === "all"
			? `AND (
           source_type = 'conversation'
           OR (source_type = 'codebase' AND project = $3)
         )`
			: "";

	const params: (string | number | Date)[] = [
		`[${queryEmbedding.join(",")}]`,
		limit * 2,
	];
	if (sourceFilter) params.push(options.sourceType!);
	if (!options.sourceType || options.sourceType === "all") {
		params.push(options.project ?? "");
	}

	const queryText = `
    SELECT id, source_type, session_id, role, content, content_hash,
           source_file, start_line, end_line, model_name, project,
           metadata, created_at,
           1 - (embedding <=> $1::vector) AS similarity
    FROM huginn_chunks
    WHERE embedding IS NOT NULL
      ${sourceFilter}
      ${scopeWhere}
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

	const result = await db.query<{
		id: number;
		source_type: string;
		session_id: string | null;
		role: string | null;
		content: string;
		content_hash: string;
		source_file: string | null;
		start_line: number | null;
		end_line: number | null;
		model_name: string;
		project: string | null;
		metadata: string | Record<string, unknown>;
		created_at: Date;
		similarity: number;
	}>(queryText, params);

	return result.rows
		.filter((r) => r.similarity >= minSim)
		.slice(0, limit)
		.map((r) => ({
			id: r.id,
			sourceType: r.source_type as "conversation" | "codebase",
			sessionId: r.session_id ?? undefined,
			role: (r.role as "user" | "assistant" | "toolResult") ?? undefined,
			content: r.content,
			contentHash: r.content_hash,
			sourceFile: r.source_file ?? undefined,
			startLine: r.start_line ?? undefined,
			endLine: r.end_line ?? undefined,
			modelName: r.model_name,
			similarity: r.similarity,
			project: r.project ?? undefined,
			metadata:
				typeof r.metadata === "string"
					? (JSON.parse(r.metadata) as Record<string, unknown>)
					: ((r.metadata ?? {}) as Record<string, unknown>),
			createdAt: r.created_at,
		}));
}

export async function deleteFileChunks(
	db: PGlite,
	project: string,
	sourceFile: string,
): Promise<number> {
	const result = await db.query(
		"DELETE FROM huginn_chunks WHERE project = $1 AND source_file = $2",
		[project, sourceFile],
	);
	return result.affectedRows ?? 0;
}

export async function getTotalChunkCount(db: PGlite): Promise<number> {
	const result = await db.query<{ count: number }>(
		"SELECT COUNT(*) as count FROM huginn_chunks",
	);
	return Number(result.rows[0].count);
}

export async function getChunkBatch(
	db: PGlite,
	offset: number,
	limit: number,
): Promise<Array<{ id: number; content: string }>> {
	const result = await db.query<{ id: number; content: string }>(
		"SELECT id, content FROM huginn_chunks ORDER BY id LIMIT $1 OFFSET $2",
		[limit, offset],
	);
	return result.rows;
}

export async function updateChunkEmbedding(
	db: PGlite,
	id: number,
	embedding: number[],
	modelName: string,
): Promise<void> {
	await db.query(
		"UPDATE huginn_chunks SET embedding = $1::vector, model_name = $2, updated_at = now() WHERE id = $3",
		[`[${embedding.join(",")}]`, modelName, id],
	);
}

export async function getCounts(db: PGlite): Promise<{
	conversations: number;
	codebase: number;
	total: number;
}> {
	const conv = await db.query<{ count: number }>(
		"SELECT COUNT(*) as count FROM huginn_chunks WHERE source_type = 'conversation'",
	);
	const code = await db.query<{ count: number }>(
		"SELECT COUNT(*) as count FROM huginn_chunks WHERE source_type = 'codebase'",
	);
	const total = await db.query<{ count: number }>(
		"SELECT COUNT(*) as count FROM huginn_chunks",
	);
	return {
		conversations: Number(conv.rows[0].count),
		codebase: Number(code.rows[0].count),
		total: Number(total.rows[0].count),
	};
}
