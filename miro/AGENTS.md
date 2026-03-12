# AI Agent Collaboration Guide

This document provides guidelines for AI agents collaborating on the `miro-cli` project.

## 1.0 Project Overview

The `miro-cli` is a command-line interface wrapping the Miro REST API (v2). It provides a fast, scriptable tool for interacting with Miro boards, items, connectors, and tags from the terminal.

**API Reference:** https://developers.miro.com/reference/api-reference

## 2.0 Architecture

The project follows the same architecture as `plane-cli`:

- `src/api/` — API models and HTTP client
- `src/commands/` — CLI command implementations
- `src/cli.rs` — Clap CLI definition
- `src/config.rs` — Configuration management (`~/.config/miro-cli/config.toml`)
- `src/error.rs` — Error types
- `src/main.rs` — Entry point

### Key Patterns

- **Auth:** Bearer token via `Authorization` header. Supports non-expiring access tokens.
- **Config:** TOML file + `MIRO_*` environment variables (e.g., `MIRO_ACCESS_TOKEN`)
- **Output:** JSON to stdout via `serde_json::to_string_pretty()`
- **API Base URL:** `https://api.miro.com/` (v2 endpoints)
- **Board ID:** Global `--board` flag or per-command `--board-id`

## 3.0 Code Style & Conventions

- Format with `cargo fmt`
- No clippy warnings: `cargo clippy -- -D warnings`
- Use `thiserror` for error handling, no `unwrap()`/`expect()` in app logic
- Follow the natural growth pattern: start simple, split when complex

## 4.0 Testing

- Integration tests in `tests/` using `httpmock`
- Tests must be independent and parallelizable
- Use `assert_cmd` for CLI integration tests
