import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { chunkCode } from "../chunker.ts";
import {
	ingestChunks,
	deleteFileChunks,
	getCodebaseFilePaths,
} from "../store/chunk-store.ts";
import { getDatabase, isDatabaseReady } from "../store/db.ts";
import type { EmbeddingProvider } from "../embeddings.ts";
import type { HuginnConfig, Chunk } from "../types.ts";
import { HARDCODED_EXCLUSIONS } from "../constants.ts";

const require = createRequire(import.meta.url);

const MB = 1024 * 1024;
const RESCAN_INTERVAL_MS = 30_000;
const scanIntervals = new Map<string, ReturnType<typeof setInterval>>();
const scanLocks = new Set<string>();

/**
 * Register session_start (initial scan + periodic re-scan) and
 * session_shutdown (cleanup) handlers for codebase indexing.
 */
export function registerCodebaseIndexer(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
	getProvider: () => EmbeddingProvider | null,
) {
	pi.on("session_start", async (_event, ctx) => {
		const config = getConfig();

		// Kick off an initial background scan.
		(async () => {
			try {
				await triggerScan(ctx.cwd, config, getProvider());
			} catch (err) {
				console.error("[huginn] Initial codebase scan error:", err);
			}
		})();

		// Periodic re-scan to detect new/changed/deleted files.
		const interval = setInterval(() => {
			(async () => {
				try {
					await triggerScan(ctx.cwd, getConfig(), getProvider());
				} catch (err) {
					console.error("[huginn] Periodic codebase scan error:", err);
				}
			})();
		}, RESCAN_INTERVAL_MS);

		scanIntervals.set(ctx.cwd, interval);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const interval = scanIntervals.get(ctx.cwd);
		if (interval) {
			clearInterval(interval);
			scanIntervals.delete(ctx.cwd);
		}
	});
}

/**
 * Main scan orchestrator.  Compares the current file list against the DB,
 * then chunks, embeds, and inserts changed/new files; deletes orphans.
 */
async function triggerScan(
	projectPath: string,
	config: HuginnConfig,
	provider: EmbeddingProvider | null,
): Promise<void> {
	if (scanLocks.has(projectPath)) return;
	scanLocks.add(projectPath);
	try {
		const db = getDatabase();
		if (!db || !isDatabaseReady() || !provider || !provider.isReady()) {
			console.warn("[huginn] Codebase scan skipped: DB or provider not ready");
			return;
		}

		// 1. List files on disk.
		const files = await listProjectFiles(projectPath, config);
		if (files.length === 0) return;

		// 2. Read DB state.
		const dbFiles = await getCodebaseFilePaths(db, projectPath);
		const dbMtimeMap = new Map(dbFiles.map((f) => [f.sourceFile, f.fileMtime]));

		// 3. Determine new / changed / deleted.
		const currentFiles = new Set(files);
		const changedFiles: string[] = [];
		for (const relPath of files) {
			const dbMtime = dbMtimeMap.get(relPath);
			if (!dbMtime) {
				changedFiles.push(relPath);
				continue;
			}
			const fullPath = path.join(projectPath, relPath);
			try {
				const stat = fs.statSync(fullPath);
				if (stat.mtime.getTime() > new Date(dbMtime).getTime()) {
					changedFiles.push(relPath);
				}
			} catch {
				// File may have vanished between listing and stat.
			}
		}
		const orphanFiles = dbFiles
			.filter((f) => !currentFiles.has(f.sourceFile))
			.map((f) => f.sourceFile);

		if (changedFiles.length === 0 && orphanFiles.length === 0) return;

		// 4. Delete orphans.
		for (const relPath of orphanFiles) {
			try {
				await deleteFileChunks(db, projectPath, relPath);
			} catch (err) {
				console.error(
					"[huginn] Failed to delete orphan chunks for",
					relPath,
					err,
				);
			}
		}

		// 5. Process changed / new files.
		const allChunks: Chunk[] = [];
		for (const relPath of changedFiles) {
			try {
				const chunks = await processFile(
					relPath,
					projectPath,
					config,
					provider,
				);
				// Delete old chunks before inserting new ones (delete-then-reinsert).
				await deleteFileChunks(db, projectPath, relPath);
				allChunks.push(...chunks);
			} catch (err) {
				console.error("[huginn] Failed to process file", relPath, err);
			}
		}

		if (allChunks.length === 0) return;

		// 6. Embed in batches via provider (which handles batching internally).
		const contents = allChunks.map((c) => c.content);
		try {
			const result = await provider.embed(contents, config.reindexBatchSize);
			for (let i = 0; i < allChunks.length; i++) {
				allChunks[i].embedding = result.embeddings[i];
			}
			await ingestChunks(db, allChunks);
		} catch (err) {
			console.error("[huginn] Failed to embed/ingest codebase chunks:", err);
		}
	} finally {
		scanLocks.delete(projectPath);
	}
}

/**
 * Build an ignore-filter function from layered rules:
 * - .gitignore files encountered during traversal
 * - global gitignore (via `git config --global core.excludesfile`)
 * - hardcoded exclusions
 * - config.extraIgnore
 */
function buildIgnoreFilter(
	rootPath: string,
	config: HuginnConfig,
): (relativePath: string) => boolean {
	// biome-ignore lint/suspicious/noExplicitAny: ignore is a CJS package
	const ignorePkg: any = require("ignore");
	const ig = ignorePkg();

	// Root .gitignore
	try {
		const gitignorePath = path.join(rootPath, ".gitignore");
		if (fs.existsSync(gitignorePath)) {
			ig.add(fs.readFileSync(gitignorePath, "utf-8"));
		}
	} catch {
		// ignore read errors
	}

	// Global gitignore
	try {
		const globalIgnore = execSync("git config --global core.excludesfile", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		}).trim();
		if (globalIgnore && fs.existsSync(globalIgnore)) {
			ig.add(fs.readFileSync(globalIgnore, "utf-8"));
		}
	} catch {
		// git not available or no global ignore
	}

	// Hardcoded + user exclusions
	ig.add(HARDCODED_EXCLUSIONS);
	if (config.extraIgnore.length > 0) {
		ig.add(config.extraIgnore);
	}

	return (relativePath: string) => ig.ignores(relativePath);
}

/**
 * List files in the project, preferring `git ls-files` when available.
 */
async function listProjectFiles(
	projectPath: string,
	config: HuginnConfig,
): Promise<string[]> {
	const gitFiles = await scanWithGit(projectPath, config);
	if (gitFiles) return gitFiles;
	return scanManually(projectPath, config);
}

/**
 * Try `git ls-files`.  Returns null when git is unavailable or not a repo.
 */
async function scanWithGit(
	projectPath: string,
	config: HuginnConfig,
): Promise<string[] | null> {
	try {
		const stdout = execSync(
			"git ls-files --cached --others --exclude-standard",
			{
				cwd: projectPath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "ignore"],
				maxBuffer: 10 * 1024 * 1024,
			},
		);
		const lines = stdout
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		const shouldIgnore = buildIgnoreFilter(projectPath, config);

		const files: string[] = [];
		for (const rel of lines) {
			if (shouldIgnore(rel)) continue;
			const full = path.join(projectPath, rel);
			if (!fs.existsSync(full)) continue;
			const stat = fs.statSync(full);
			if (!stat.isFile() || stat.size > MB) continue;
			files.push(rel);
			if (files.length >= config.maxIndexedFiles) break;
		}
		return files;
	} catch {
		return null;
	}
}

/**
 * Manual recursive directory crawl when git is unavailable.
 */
function scanManually(projectPath: string, config: HuginnConfig): string[] {
	const shouldIgnore = buildIgnoreFilter(projectPath, config);
	const files: string[] = [];

	function walk(dir: string, prefix: string) {
		if (files.length >= config.maxIndexedFiles) return;

		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (files.length >= config.maxIndexedFiles) break;

			const rel = prefix ? `${prefix}/${entry}` : entry;
			if (shouldIgnore(rel)) continue;
			if (config.ignoreDotDirs && entry.startsWith(".")) {
				// It's a dot-dir or dot-file. Keep dot-files, skip dot-dirs.
				const full = path.join(dir, entry);
				try {
					if (fs.statSync(full).isDirectory()) continue;
				} catch {
					continue;
				}
			}

			const full = path.join(dir, entry);
			let stat: fs.Stats;
			try {
				stat = fs.statSync(full);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				walk(full, rel);
			} else if (stat.isFile() && stat.size <= MB) {
				files.push(rel);
			}
		}
	}

	walk(projectPath, "");
	return files;
}

/**
 * Read a single source file, chunk it, and prepare Chunk objects.
 */
async function processFile(
	relPath: string,
	projectPath: string,
	config: HuginnConfig,
	provider: EmbeddingProvider,
): Promise<Chunk[]> {
	const fullPath = path.join(projectPath, relPath);
	const raw = fs.readFileSync(fullPath, "utf-8");
	const stat = fs.statSync(fullPath);

	const codeChunks = await chunkCode(raw, relPath, {
		chunkSize: config.chunkSize,
		chunkOverlap: config.chunkOverlap,
		minChunkSize: config.minChunkSize,
	});

	return codeChunks.map((c, index) => ({
		sourceType: "codebase" as const,
		chunkIndex: index,
		content: c.content,
		contentHash: createHash("sha256").update(c.content).digest("hex"), // not used for codebase dedup (file-level delete-then-reinsert)
		sourceFile: relPath,
		startLine: c.startLine,
		endLine: c.endLine,
		fileMtime: stat.mtime,
		fileSize: stat.size,
		modelName: provider.modelName,
		project: projectPath,
		createdAt: new Date(),
	}));
}
