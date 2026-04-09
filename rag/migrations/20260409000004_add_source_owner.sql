ALTER TABLE sources ADD COLUMN owner_user_id UUID REFERENCES users(id);
CREATE INDEX idx_sources_owner ON sources (owner_user_id);
