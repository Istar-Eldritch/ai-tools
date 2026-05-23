export function buildSchemaSql(dim: number): string {
	return `
    CREATE EXTENSION IF NOT EXISTS vchord;

    CREATE TABLE IF NOT EXISTS huginn_memories (
      id            BIGSERIAL PRIMARY KEY,
      project       TEXT,
      target        TEXT NOT NULL CHECK (target IN ('memory', 'user', 'failure')),
      category      TEXT CHECK (category IN ('failure', 'correction', 'insight', 'preference', 'convention', 'tool-quirk')),
      content       TEXT NOT NULL,
      failure_reason TEXT,
      embedding     vector(${dim}),
      created       DATE NOT NULL DEFAULT CURRENT_DATE,
      last_referenced DATE NOT NULL DEFAULT CURRENT_DATE,
      reference_count INTEGER NOT NULL DEFAULT 1,
      pinned        BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (target, project, content)
    );

    CREATE INDEX IF NOT EXISTS huginn_memories_embedding_idx
      ON huginn_memories
      USING vchordrq (embedding vector_cosine_ops);

    CREATE INDEX IF NOT EXISTS huginn_memories_project_idx
      ON huginn_memories (project);

    CREATE INDEX IF NOT EXISTS huginn_memories_target_idx
      ON huginn_memories (target);
  `;
}
