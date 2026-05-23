import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDatabase, closeDatabase } from "./db.ts";
import {
	ingestChunks,
	searchChunks,
	deleteFileChunks,
	getCounts,
} from "./chunk-store.ts";
import type { Chunk } from "../types.ts";

function makeVector(dim: number, fill: number): number[] {
	return Array.from({ length: dim }, () => fill);
}

describe("chunk-store", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "huginn-chunk-test-"));
	});

	afterEach(async () => {
		await closeDatabase();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	async function getDb() {
		return openDatabase(path.join(tmpDir, "db"));
	}

	it("ingestChunks inserts rows retrievable via SELECT", async () => {
		const db = await getDb();
		const chunk: Chunk = {
			sourceType: "conversation",
			sessionId: "s1",
			role: "user",
			chunkIndex: 0,
			content: "hello world",
			contentHash: "abc123",
			modelName: "nomic-ai/nomic-embed-text-v1.5",
			embedding: makeVector(768, 0.1),
			project: "proj",
			createdAt: new Date(),
		};
		await ingestChunks(db, [chunk]);
		const result = await db.query(
			"SELECT content FROM huginn_chunks WHERE session_id = 's1'",
		);
		expect(result.rows.length).toBe(1);
		expect((result.rows[0] as { content: string }).content).toBe("hello world");
	});

	it("upsert updates content and embedding on conflict", async () => {
		const db = await getDb();
		const chunk: Chunk = {
			sourceType: "conversation",
			sessionId: "s1",
			role: "user",
			chunkIndex: 0,
			content: "old content",
			contentHash: "abc123",
			modelName: "nomic-ai/nomic-embed-text-v1.5",
			embedding: makeVector(768, 0.1),
			project: "proj",
			createdAt: new Date(),
		};
		await ingestChunks(db, [chunk]);
		const updated: Chunk = {
			...chunk,
			content: "new content",
			embedding: makeVector(768, 0.2),
		};
		await ingestChunks(db, [updated]);
		const result = await db.query(
			"SELECT content FROM huginn_chunks WHERE session_id = 's1'",
		);
		expect(result.rows.length).toBe(1);
		expect((result.rows[0] as { content: string }).content).toBe("new content");
	});

	it("searchChunks orders by similarity", async () => {
		const db = await getDb();
		// Use vectors with orthogonal-ish patterns to get predictable ordering.
		// PGlite vector extension requires float arrays.
		const v1 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
		const v2 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 0.9 : 0));
		const v3 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 0.5 : 0));

		await ingestChunks(db, [
			{
				sourceType: "conversation",
				sessionId: "s1",
				role: "user",
				chunkIndex: 0,
				content: "chunk-a",
				contentHash: "h1",
				modelName: "m",
				embedding: v1,
				project: "p",
				createdAt: new Date(),
			},
			{
				sourceType: "conversation",
				sessionId: "s2",
				role: "user",
				chunkIndex: 0,
				content: "chunk-b",
				contentHash: "h2",
				modelName: "m",
				embedding: v2,
				project: "p",
				createdAt: new Date(),
			},
			{
				sourceType: "conversation",
				sessionId: "s3",
				role: "user",
				chunkIndex: 0,
				content: "chunk-c",
				contentHash: "h3",
				modelName: "m",
				embedding: v3,
				project: "p",
				createdAt: new Date(),
			},
		]);

		const query = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
		const results = await searchChunks(db, "test", query, {
			limit: 3,
			minSimilarity: 0,
		});
		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
	});

	it("searchChunks respects limit", async () => {
		const db = await getDb();
		const chunks: Chunk[] = Array.from({ length: 10 }, (_, i) => ({
			sourceType: "conversation",
			sessionId: `s${i}`,
			role: "user",
			chunkIndex: 0,
			content: `chunk-${i}`,
			contentHash: `h${i}`,
			modelName: "m",
			embedding: makeVector(768, 0.1 + i * 0.01),
			project: "p",
			createdAt: new Date(),
		}));
		await ingestChunks(db, chunks);
		const query = makeVector(768, 0.15);
		const results = await searchChunks(db, "test", query, {
			limit: 3,
			minSimilarity: 0,
		});
		expect(results.length).toBeLessThanOrEqual(3);
	});

	it("searchChunks respects minSimilarity", async () => {
		const db = await getDb();
		const close = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
		const far = Array.from({ length: 768 }, (_, i) => (i === 0 ? -1 : 0));
		await ingestChunks(db, [
			{
				sourceType: "conversation",
				sessionId: "s1",
				role: "user",
				chunkIndex: 0,
				content: "close",
				contentHash: "hc",
				modelName: "m",
				embedding: close,
				project: "p",
				createdAt: new Date(),
			},
			{
				sourceType: "conversation",
				sessionId: "s2",
				role: "user",
				chunkIndex: 0,
				content: "far",
				contentHash: "hf",
				modelName: "m",
				embedding: far,
				project: "p",
				createdAt: new Date(),
			},
		]);

		const query = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
		const results = await searchChunks(db, "test", query, {
			limit: 5,
			minSimilarity: 0.5,
		});
		expect(results.every((r) => r.similarity >= 0.5)).toBe(true);
	});

	it("searchChunks default scope filters codebase to project", async () => {
		const db = await getDb();
		const v = makeVector(768, 0.2);
		await ingestChunks(db, [
			{
				sourceType: "codebase",
				sessionId: undefined,
				role: undefined,
				chunkIndex: 0,
				content: "code-a",
				contentHash: "hca",
				modelName: "m",
				embedding: v,
				project: "proj-a",
				createdAt: new Date(),
			},
			{
				sourceType: "codebase",
				sessionId: undefined,
				role: undefined,
				chunkIndex: 0,
				content: "code-b",
				contentHash: "hcb",
				modelName: "m",
				embedding: v,
				project: "proj-b",
				createdAt: new Date(),
			},
		]);

		const results = await searchChunks(db, "test", v, {
			limit: 5,
			project: "proj-a",
			minSimilarity: 0,
		});
		expect(
			results.every(
				(r) => r.sourceType !== "codebase" || r.project === "proj-a",
			),
		).toBe(true);
	});

	it("deleteFileChunks removes only matching rows", async () => {
		const db = await getDb();
		await ingestChunks(db, [
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "a",
				contentHash: "ha",
				modelName: "m",
				sourceFile: "f1.ts",
				project: "p1",
			},
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "b",
				contentHash: "hb",
				modelName: "m",
				sourceFile: "f2.ts",
				project: "p1",
			},
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "c",
				contentHash: "hc",
				modelName: "m",
				sourceFile: "f1.ts",
				project: "p2",
			},
		] as Chunk[]);
		const deleted = await deleteFileChunks(db, "p1", "f1.ts");
		expect(deleted).toBe(1);
		const rows = await db.query(
			"SELECT content FROM huginn_chunks WHERE project = 'p1'",
		);
		expect((rows.rows as { content: string }[]).map((r) => r.content)).toEqual([
			"b",
		]);
	});

	it("getCounts returns accurate counts after insertions and deletions", async () => {
		const db = await getDb();
		await ingestChunks(db, [
			{
				sourceType: "conversation",
				sessionId: "s1",
				role: "user",
				chunkIndex: 0,
				content: "conv",
				contentHash: "h1",
				modelName: "m",
			},
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "code",
				contentHash: "h2",
				modelName: "m",
				sourceFile: "f.ts",
				project: "p",
			},
		] as Chunk[]);
		let counts = await getCounts(db);
		expect(counts.conversations).toBe(1);
		expect(counts.codebase).toBe(1);
		expect(counts.total).toBe(2);

		await deleteFileChunks(db, "p", "f.ts");
		counts = await getCounts(db);
		expect(counts.codebase).toBe(0);
		expect(counts.total).toBe(1);
	});

	it("getCodebaseFilePaths returns distinct source files with latest mtime", async () => {
		const db = await getDb();
		const mtime1 = new Date("2025-01-01T10:00:00Z");
		const mtime2 = new Date("2025-01-02T10:00:00Z");
		await ingestChunks(db, [
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "a",
				contentHash: "ha",
				modelName: "m",
				sourceFile: "f1.ts",
				project: "p",
				fileMtime: mtime1,
			},
			{
				sourceType: "codebase",
				chunkIndex: 1,
				content: "a2",
				contentHash: "ha2",
				modelName: "m",
				sourceFile: "f1.ts",
				project: "p",
				fileMtime: mtime2,
			},
			{
				sourceType: "codebase",
				chunkIndex: 0,
				content: "b",
				contentHash: "hb",
				modelName: "m",
				sourceFile: "f2.ts",
				project: "p",
				fileMtime: mtime1,
			},
		] as Chunk[]);
		const { getCodebaseFilePaths }: any = await import("./chunk-store.ts");
		const files: any[] = await getCodebaseFilePaths(db, "p");
		const f1 = files.find((f: any) => f.sourceFile === "f1.ts");
		const f2 = files.find((f: any) => f.sourceFile === "f2.ts");
		expect(f1).toBeDefined();
		expect(f2).toBeDefined();
		expect(new Date(f1!.fileMtime!).getTime()).toBe(mtime2.getTime());
		expect(new Date(f2!.fileMtime!).getTime()).toBe(mtime1.getTime());
	});
});
