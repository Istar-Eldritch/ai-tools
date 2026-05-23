import { describe, it, expect } from "vitest";
import { buildSchemaDDL } from "./schema.ts";

describe("buildSchemaDDL", () => {
	it("contains CREATE EXTENSION for vector", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
	});

	it("contains huginn_config table", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS huginn_config/i);
	});

	it("contains huginn_chunks table", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS huginn_chunks/i);
	});

	it("contains hnsw embedding index", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(
			/CREATE INDEX IF NOT EXISTS huginn_chunks_embedding_idx/i,
		);
		expect(ddl).toMatch(/hnsw.*embedding.*vector_cosine_ops/i);
	});

	it("contains project index", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(
			/CREATE INDEX IF NOT EXISTS huginn_chunks_project_idx/i,
		);
	});

	it("uses vector(768) for embedding column when dim is 768", () => {
		const ddl = buildSchemaDDL(768);
		expect(ddl).toMatch(/embedding\s+vector\(768\)/i);
	});

	it("uses vector(384) for embedding column when dim is 384", () => {
		const ddl = buildSchemaDDL(384);
		expect(ddl).toMatch(/embedding\s+vector\(384\)/i);
	});
});
