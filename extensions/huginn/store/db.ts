import postgres from "postgres";
import { buildSchemaSql } from "./schema.js";

export class DbManager {
	private _sql: ReturnType<typeof postgres> | null = null;
	private readonly url: string;
	private readonly dim: number;

	constructor(url: string, dim: number) {
		this.url = url;
		this.dim = dim;
	}

	get sql(): ReturnType<typeof postgres> {
		if (!this._sql) {
			if (!this.url)
				throw new Error(
					"Huginn: no database URL configured (set HUGINN_DATABASE_URL or DATABASE_URL)",
				);
			this._sql = postgres(this.url, { max: 5 });
		}
		return this._sql;
	}

	async ensureSchema(): Promise<void> {
		const ddl = buildSchemaSql(this.dim);
		await this.sql.unsafe(ddl);
	}

	async close(): Promise<void> {
		if (this._sql) {
			await this._sql.end();
			this._sql = null;
		}
	}
}
