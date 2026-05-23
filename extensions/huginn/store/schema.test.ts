import { describe, it, expect } from "vitest";
import { SCHEMA_DDL } from "./schema.ts";

describe("SCHEMA_DDL", () => {
	it("contains CREATE EXTENSION for vector", () => {
		expect(SCHEMA_DDL).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
	});

	it("contains huginn_config table", () => {
		expect(SCHEMA_DDL).toMatch(/CREATE TABLE IF NOT EXISTS huginn_config/i);
	});

	it("contains huginn_chunks table", () => {
		expect(SCHEMA_DDL).toMatch(/CREATE TABLE IF NOT EXISTS huginn_chunks/i);
	});

	it("contains hnsw embedding index", () => {
		expect(SCHEMA_DDL).toMatch(
			/CREATE INDEX IF NOT EXISTS huginn_chunks_embedding_idx/i,
		);
		expect(SCHEMA_DDL).toMatch(/hnsw.*embedding.*vector_cosine_ops/i);
	});

	it("contains project index", () => {
		expect(SCHEMA_DDL).toMatch(
			/CREATE INDEX IF NOT EXISTS huginn_chunks_project_idx/i,
		);
	});

	it("uses vector(768) for embedding column", () => {
		expect(SCHEMA_DDL).toMatch(/embedding\s+vector\(768\)/i);
	});
});
