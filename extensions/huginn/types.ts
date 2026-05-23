export type MemoryTarget = "memory" | "user" | "failure";
export type MemoryCategory =
	| "failure"
	| "correction"
	| "insight"
	| "preference"
	| "convention"
	| "tool-quirk";

export interface MemoryEntry {
	id: number;
	project: string | null;
	target: MemoryTarget;
	category: MemoryCategory | null;
	content: string;
	failureReason: string | null;
	created: string;
	lastReferenced: string;
	referenceCount: number;
	pinned: boolean;
}

export interface HuginnConfig {
	/** Postgres connection string. Default: env HUGINN_DATABASE_URL or DATABASE_URL */
	databaseUrl?: string;
	/** OpenAI API key for embeddings. Default: env OPENAI_API_KEY */
	openaiApiKey?: string;
	/** Embedding model. Default: text-embedding-3-small */
	embeddingModel?: string;
	/** Vector dimensions (must match model). Default: 1536 */
	embeddingDim?: number;
	/** Turns between background review. Default: 10 */
	nudgeInterval?: number;
	/** Flush on shutdown. Default: true */
	flushOnShutdown?: boolean;
	/** Min user turns before flush. Default: 6 */
	flushMinTurns?: number;
	/** Max memories injected into system prompt. Default: 5 */
	maxSnapshotEntries?: number;
	/** Max memories returned by auto-retrieval. Default: 5 */
	autoRetrievalMax?: number;
	/** Min similarity score (0-1) for auto-retrieval. Default: 0.3 */
	minSimilarity?: number;
	/** Detect corrections and save immediately. Default: true */
	correctionDetection?: boolean;
}

export interface SearchOptions {
	project?: string | null;
	target?: MemoryTarget;
	category?: MemoryCategory;
	limit?: number;
	minSimilarity?: number;
}
