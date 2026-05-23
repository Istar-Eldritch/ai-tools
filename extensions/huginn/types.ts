export interface HuginnConfig {
	dataDir: string;
	embeddingModel: string;
	embeddingDim: number;
	chunkSize: number;
	chunkOverlap: number;
	minChunkSize: number;
	autoIngestion: boolean;
	ingestRoles: string[];
	autoRetrieval: boolean;
	autoRetrievalMax: number;
	minSimilarity: number;
	reindexBatchSize: number;
	extraIgnore: string[];
	ignoreDotDirs: boolean;
	maxIndexedFiles: number;
}

export interface Chunk {
	sourceType: "conversation" | "codebase";
	sessionId?: string;
	role?: "user" | "assistant" | "toolResult";
	chunkIndex: number;
	content: string;
	contentHash: string;
	sourceFile?: string;
	startLine?: number;
	endLine?: number;
	fileMtime?: Date;
	fileSize?: number;
	modelName: string;
	embedding?: number[]; // 768 floats for nomic-embed-text-v1.5
	project?: string;
	metadata?: Record<string, unknown>;
	createdAt?: Date;
}

export interface SearchResult {
	id: number;
	sourceType: "conversation" | "codebase";
	sessionId?: string;
	role?: "user" | "assistant" | "toolResult";
	content: string;
	contentHash: string;
	sourceFile?: string;
	startLine?: number;
	endLine?: number;
	modelName: string;
	similarity: number;
	project?: string;
	metadata?: Record<string, unknown>;
	createdAt: Date;
}

export interface EmbeddingResult {
	embeddings: number[][];
	modelName: string;
	dim: number;
}

// Runtime DB state held by the extension
export interface DbState {
	pglite: import("@electric-sql/pglite").PGlite | null;
	isReady: boolean;
}
