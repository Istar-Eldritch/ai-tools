ALTER TABLE sources ADD COLUMN project TEXT;
CREATE INDEX idx_sources_project ON sources (project);
