CREATE TABLE IF NOT EXISTS sources (
    id           UUID        PRIMARY KEY,
    s3_key       TEXT        UNIQUE NOT NULL,
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
