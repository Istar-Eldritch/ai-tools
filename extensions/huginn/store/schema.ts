export function buildSchemaDDL(embeddingDim: number): string {
	return `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS huginn_config (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  embedding_model  TEXT NOT NULL,
  embedding_dim    INT  NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huginn_chunks (
  id            BIGSERIAL PRIMARY KEY,
  source_type   TEXT NOT NULL CHECK (source_type IN ('conversation', 'codebase')),
  session_id    TEXT,
  role          TEXT CHECK (role IN ('user', 'assistant', 'toolResult')),
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  source_file   TEXT,
  start_line    INT,
  end_line      INT,
  file_mtime    TIMESTAMPTZ,
  file_size     INT,
  model_name    TEXT NOT NULL,
  embedding     vector(${embeddingDim}),
  project       TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (session_id, content_hash, chunk_index),

  CHECK (
    (source_type = 'conversation' AND role IS NOT NULL)
    OR (source_type = 'codebase' AND role IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS huginn_chunks_embedding_idx
  ON huginn_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS huginn_chunks_project_idx
  ON huginn_chunks (project, source_type);
`;
}
