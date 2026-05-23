import type { DbManager } from "./db.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type {
	MemoryEntry,
	MemoryTarget,
	MemoryCategory,
	SearchOptions,
} from "../types.js";

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
	return {
		id: row.id as number,
		project: row.project as string | null,
		target: row.target as MemoryTarget,
		category: (row.category as MemoryCategory | null) ?? null,
		content: row.content as string,
		failureReason: (row.failure_reason as string | null) ?? null,
		created: row.created as string,
		lastReferenced: row.last_referenced as string,
		referenceCount: row.reference_count as number,
		pinned: row.pinned as boolean,
	};
}

export async function upsertMemory(
	db: DbManager,
	embedder: EmbeddingProvider,
	opts: {
		content: string;
		target: MemoryTarget;
		project?: string | null;
		category?: MemoryCategory | null;
		failureReason?: string | null;
	},
): Promise<{ action: "inserted" | "existing"; entry: MemoryEntry }> {
	const embedding = await embedder.embed(opts.content);
	const vecLiteral = `[${embedding.join(",")}]`;

	const rows = await db.sql`
    INSERT INTO huginn_memories
      (content, target, project, category, failure_reason, embedding)
    VALUES
      (${opts.content}, ${opts.target}, ${opts.project ?? null}, ${opts.category ?? null}, ${opts.failureReason ?? null}, ${vecLiteral}::vector)
    ON CONFLICT (target, project, content) DO NOTHING
    RETURNING *
  `;

	if (rows.length > 0)
		return { action: "inserted", entry: rowToEntry(rows[0]) };

	const existing = await db.sql`
    SELECT * FROM huginn_memories
    WHERE target = ${opts.target}
      AND content = ${opts.content}
      AND (project IS NOT DISTINCT FROM ${opts.project ?? null})
    LIMIT 1
  `;
	return { action: "existing", entry: rowToEntry(existing[0]) };
}

export async function replaceMemory(
	db: DbManager,
	embedder: EmbeddingProvider,
	opts: {
		oldText: string;
		newContent: string;
		target: MemoryTarget;
		project?: string | null;
	},
): Promise<{ matched: number; updated: number }> {
	const embedding = await embedder.embed(opts.newContent);
	const vecLiteral = `[${embedding.join(",")}]`;

	const rows = await db.sql`
    UPDATE huginn_memories
    SET content = ${opts.newContent}, embedding = ${vecLiteral}::vector, last_referenced = CURRENT_DATE
    WHERE target = ${opts.target}
      AND (project IS NOT DISTINCT FROM ${opts.project ?? null})
      AND content ILIKE ${"%" + opts.oldText + "%"}
    RETURNING id
  `;
	return { matched: rows.length, updated: rows.length };
}

export async function removeMemory(
	db: DbManager,
	opts: {
		oldText: string;
		target: MemoryTarget;
		project?: string | null;
	},
): Promise<{ matched: number; removed: number }> {
	const rows = await db.sql`
    DELETE FROM huginn_memories
    WHERE target = ${opts.target}
      AND (project IS NOT DISTINCT FROM ${opts.project ?? null})
      AND content ILIKE ${"%" + opts.oldText + "%"}
    RETURNING id
  `;
	return { matched: rows.length, removed: rows.length };
}

export async function searchMemories(
	db: DbManager,
	embedder: EmbeddingProvider,
	query: string,
	opts: SearchOptions = {},
): Promise<(MemoryEntry & { similarity: number })[]> {
	const limit = Math.min(opts.limit ?? 10, 50);
	const minSim = opts.minSimilarity ?? 0.3;

	const embedding = await embedder.embed(query);
	const vecLiteral = `[${embedding.join(",")}]`;

	const rows = await db.sql`
    SELECT *,
      1 - (embedding <=> ${vecLiteral}::vector) AS similarity
    FROM huginn_memories
    WHERE
      (${opts.target ?? null}::text IS NULL OR target = ${opts.target ?? null})
      AND (${opts.project ?? null}::text IS NULL OR project = ${opts.project ?? null})
      AND (${opts.category ?? null}::text IS NULL OR category = ${opts.category ?? null})
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${vecLiteral}::vector) >= ${minSim}
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `;

	return rows.map((r) => ({
		...rowToEntry(r),
		similarity: r.similarity as number,
	}));
}

export async function touchMemories(
	db: DbManager,
	ids: number[],
): Promise<void> {
	if (ids.length === 0) return;
	await db.sql`
    UPDATE huginn_memories
    SET reference_count = reference_count + 1, last_referenced = CURRENT_DATE
    WHERE id = ANY(${ids}::bigint[])
  `;
}

export async function getSnapshot(
	db: DbManager,
	opts: { maxEntries?: number; project?: string | null } = {},
): Promise<MemoryEntry[]> {
	const limit = opts.maxEntries ?? 10;
	const rows = await db.sql`
    SELECT * FROM huginn_memories
    WHERE (${opts.project ?? null}::text IS NULL OR project = ${opts.project ?? null} OR project IS NULL)
    ORDER BY pinned DESC, reference_count DESC, last_referenced DESC
    LIMIT ${limit}
  `;
	return rows.map(rowToEntry);
}

export async function getStats(db: DbManager): Promise<{ total: number }> {
	const rows = await db.sql`SELECT COUNT(*)::int AS total FROM huginn_memories`;
	return { total: rows[0].total as number };
}
