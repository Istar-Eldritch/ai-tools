# Spec: Docker Compose Dev Environment

**Parent Epic**: [RAG MCP Server](2604071423_epic_postgres_rag_mcp.md) — Feature #2

## Overview

Docker Compose setup for local development with PostgreSQL+pgvector and MinIO (S3-compatible storage).

## Requirements

- **R1**: `docker-compose.yml` with PostgreSQL 16 + pgvector extension and MinIO services
- **R2**: Health checks on both services so `docker compose up -d --wait` works
- **R3**: Init SQL script that creates the pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector`)
- **R4**: MinIO configured with a default bucket (`rag-documents`) created on startup
- **R5**: Volume mounts for data persistence across restarts
- **R6**: Update `.env.example` if needed to match compose service defaults

## Success Criteria

- [ ] `docker compose up -d --wait` starts both services healthy
- [ ] Can connect to PostgreSQL and run `SELECT * FROM pg_extension WHERE extname = 'vector'`
- [ ] Can access MinIO console at http://localhost:9001
- [ ] The `rag-documents` bucket exists in MinIO after startup
- [ ] `docker compose down` cleanly stops everything

## Technical Notes

- Use `pgvector/pgvector:pg16` image
- Use `minio/minio` image with `server /data --console-address ":9001"`
- Use MinIO client (`mc`) init container or entrypoint script to create the default bucket
- Postgres credentials: `rag`/`rag`, database: `rag` (matching .env.example)
- MinIO credentials: `minioadmin`/`minioadmin` (matching .env.example defaults)

## Out of Scope

- Database schema/migrations (Feature #3)
- Production deployment configuration
