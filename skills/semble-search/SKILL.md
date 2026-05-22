---
name: "semble-search"
description: "Semantic code search with semble instead of grep. Use when searching a codebase by concept, behaviour, or symbol name."
version: 1
created: "2026-05-21"
updated: "2026-05-21"
---
## When to Use
Use semble instead of grep/find whenever you need to locate code by what it does, not by exact string. Examples: finding authentication logic, locating where a feature is implemented, discovering related code around a known location.

## Procedure
1. Run `semble search "<natural language query>" <path>` to find relevant chunks. Path defaults to current directory.
2. Inspect full files with read only when the returned chunk lacks enough context.
3. Use `semble find-related <file_path> <line> <path>` with a promising result's file_path and line to discover related implementations.
4. Use grep only for exhaustive literal/exact string matches or quick confirmation of a known string.
5. Add `--top-k 10` for broader results, `--include-text-files` to also search .md/.yaml/.json files.

## Pitfalls
- semble is not on MCP — subagents must call it via bash
- For exact string matches (e.g. confirming a variable name exists), grep is still faster and more precise
- Index is built on first search per session; subsequent searches on the same path are fast

## Verification
1. Run `semble search "test query" .` and confirm it returns file paths and line numbers