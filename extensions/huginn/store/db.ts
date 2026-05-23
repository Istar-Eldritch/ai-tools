import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildSchemaDDL } from "./schema.ts";
import type { DbState } from "../types.ts";

let dbState: DbState = { pglite: null, isReady: false };

export async function openDatabase(
	dataDir: string,
	embeddingDim = 768,
): Promise<PGlite> {
	if (dbState.pglite) return dbState.pglite;

	const resolvedDir = path.resolve(dataDir);
	fs.mkdirSync(resolvedDir, { recursive: true });

	const db = new PGlite(path.join(resolvedDir, "huginn.db"), {
		extensions: { vector },
	});

	await db.waitReady;
	await db.exec(buildSchemaDDL(embeddingDim));

	dbState = { pglite: db, isReady: true };
	return db;
}

export async function closeDatabase(): Promise<void> {
	if (!dbState.pglite) return;
	await dbState.pglite.close();
	dbState = { pglite: null, isReady: false };
}

export function getDatabase(): PGlite | null {
	return dbState.pglite;
}

export function isDatabaseReady(): boolean {
	return dbState.isReady;
}

export async function getConfigRow(
	db: PGlite,
): Promise<{ embedding_model: string; embedding_dim: number } | null> {
	const result = await db.query<{
		embedding_model: string;
		embedding_dim: number;
	}>("SELECT embedding_model, embedding_dim FROM huginn_config WHERE id = 1");
	return result.rows[0] ?? null;
}

export async function setConfigRow(
	db: PGlite,
	model: string,
	dim: number,
): Promise<void> {
	await db.query(
		`INSERT INTO huginn_config (id, embedding_model, embedding_dim, created_at, updated_at)
     VALUES (1, $1, $2, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       embedding_model = EXCLUDED.embedding_model,
       embedding_dim   = EXCLUDED.embedding_dim,
       updated_at      = now()`,
		[model, dim],
	);
}
