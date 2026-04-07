CREATE TABLE IF NOT EXISTS chunks (
    id          UUID    PRIMARY KEY,
    source_id   UUID    NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    chunk_index INT     NOT NULL,
    content     TEXT    NOT NULL,
    embedding   vector(768) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
