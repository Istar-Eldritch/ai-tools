/**
 * Project isolation utilities - cloning and copying for benchmark isolation (R3)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import type { LoadedFixture } from "./types.ts";

// ============================================
// Types
// ============================================

export interface IsolationResult {
	success: boolean;
	workDir?: string;  // Temp directory containing the cloned/copied project
	error?: string;
}

export interface CleanupHandle {
	workDir: string;
	cleanup: () => Promise<void>;
}

// ============================================
// Git Operations
// ============================================

/**
 * Clone a git repository to a temp directory (R3a)
 */
async function gitClone(
	url: string,
	targetDir: string,
	ref?: string
): Promise<{ success: boolean; error?: string }> {
	return new Promise((resolve) => {
		const args = ["clone", "--depth", "1"];
		if (ref) {
			args.push("--branch", ref);
		}
		args.push(url, targetDir);
		
		const proc = spawn("git", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		
		let stderr = "";
		proc.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		
		proc.on("close", (code) => {
			if (code === 0) {
				resolve({ success: true });
			} else {
				resolve({ success: false, error: stderr || `git clone exited with code ${code}` });
			}
		});
		
		proc.on("error", (err) => {
			resolve({ success: false, error: err.message });
		});
	});
}

// ============================================
// Filesystem Operations
// ============================================

/**
 * Recursively copy a directory (R3b)
 * Excludes common development artifacts for efficiency
 */
function copyDir(src: string, dest: string): void {
	// Directories to skip during copy
	const skipDirs = new Set([
		"node_modules",
		".git",
		"target",          // Rust
		"dist",
		"build",
		".next",
		"__pycache__",
		".venv",
		"venv",
		".tox",
		".pytest_cache",
		".mypy_cache",
	]);
	
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}
	
	const entries = fs.readdirSync(src, { withFileTypes: true });
	
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		
		if (entry.isDirectory()) {
			if (!skipDirs.has(entry.name)) {
				copyDir(srcPath, destPath);
			}
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, destPath);
		} else if (entry.isSymbolicLink()) {
			// Preserve symlinks
			const linkTarget = fs.readlinkSync(srcPath);
			fs.symlinkSync(linkTarget, destPath);
		}
	}
}

/**
 * Recursively remove a directory
 */
async function removeDir(dir: string): Promise<void> {
	if (fs.existsSync(dir)) {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

// ============================================
// Isolation Functions
// ============================================

/**
 * Create an isolated copy of the fixture's project (R3)
 * Returns a temp directory path and cleanup function
 */
export async function createIsolatedProject(
	fixture: LoadedFixture,
	sessionId: string,
	iterationId: number
): Promise<IsolationResult & { cleanup?: () => Promise<void> }> {
	// Create temp directory for this iteration
	const tempBase = path.join(os.tmpdir(), "spec-bench");
	const workDir = path.join(tempBase, `${sessionId}_iter${iterationId}_${Date.now()}`);
	
	try {
		fs.mkdirSync(workDir, { recursive: true });
		
		if (fixture.projectSource.type === "git") {
			// Git clone (R3a)
			const cloneResult = await gitClone(
				fixture.projectSource.url,
				workDir,
				fixture.projectSource.ref
			);
			
			if (!cloneResult.success) {
				await removeDir(workDir);
				return {
					success: false,
					error: `Git clone failed: ${cloneResult.error}`,
				};
			}
		} else {
			// Local copy (R3b)
			copyDir(fixture.projectSource.path, workDir);
		}
		
		return {
			success: true,
			workDir,
			cleanup: async () => {
				await removeDir(workDir);
			},
		};
	} catch (e) {
		// Clean up on error
		await removeDir(workDir);
		const errorMsg = e instanceof Error ? e.message : "Unknown error";
		return {
			success: false,
			error: `Failed to create isolated project: ${errorMsg}`,
		};
	}
}

/**
 * Copy hidden tests to the target directory (R9, R15)
 */
export function copyHiddenTests(
	hiddenTestsPath: string,
	targetDir: string,
	hiddenTestsTarget: string
): { success: boolean; error?: string } {
	const destDir = path.join(targetDir, hiddenTestsTarget);
	
	try {
		// Create target directory if it doesn't exist
		fs.mkdirSync(destDir, { recursive: true });
		
		// Copy all files from hidden-tests to target
		copyDir(hiddenTestsPath, destDir);
		
		return { success: true };
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : "Unknown error";
		return {
			success: false,
			error: `Failed to copy hidden tests: ${errorMsg}`,
		};
	}
}
