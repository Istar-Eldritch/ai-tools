import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	openDatabase,
	closeDatabase,
	getDatabase,
	isDatabaseReady,
	getConfigRow,
	setConfigRow,
} from "./db.ts";

describe("db", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "huginn-db-test-"));
	});

	afterEach(async () => {
		await closeDatabase();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("openDatabase creates the DB file and returns a ready instance", async () => {
		const db = await openDatabase(path.join(tmpDir, "db"));
		expect(db).toBeDefined();
		expect(isDatabaseReady()).toBe(true);
		const dbFile = path.join(tmpDir, "db", "huginn.db");
		expect(fs.existsSync(dbFile)).toBe(true);
	});

	it("openDatabase is idempotent", async () => {
		const db1 = await openDatabase(path.join(tmpDir, "db"));
		const db2 = await openDatabase(path.join(tmpDir, "db"));
		expect(db1).toBe(db2);
	});

	it("closeDatabase closes connection and resets state", async () => {
		await openDatabase(path.join(tmpDir, "db"));
		expect(isDatabaseReady()).toBe(true);
		await closeDatabase();
		expect(isDatabaseReady()).toBe(false);
		expect(getDatabase()).toBeNull();
	});

	it("getConfigRow returns null when the table is empty", async () => {
		const db = await openDatabase(path.join(tmpDir, "db"));
		const row = await getConfigRow(db);
		expect(row).toBeNull();
	});

	it("setConfigRow inserts and updates on conflict", async () => {
		const db = await openDatabase(path.join(tmpDir, "db"));
		await setConfigRow(db, "model-a", 768);
		let row = await getConfigRow(db);
		expect(row).toEqual({ embedding_model: "model-a", embedding_dim: 768 });

		await setConfigRow(db, "model-b", 384);
		row = await getConfigRow(db);
		expect(row).toEqual({ embedding_model: "model-b", embedding_dim: 384 });
	});

	it("schema is applied: querying huginn_chunks does not throw", async () => {
		const db = await openDatabase(path.join(tmpDir, "db"));
		const result = await db.query("SELECT * FROM huginn_chunks LIMIT 1");
		expect(result.rows).toEqual([]);
	});

	it("schema is applied: querying huginn_config does not throw", async () => {
		const db = await openDatabase(path.join(tmpDir, "db"));
		const result = await db.query("SELECT * FROM huginn_config LIMIT 1");
		expect(result.rows).toEqual([]);
	});
});
