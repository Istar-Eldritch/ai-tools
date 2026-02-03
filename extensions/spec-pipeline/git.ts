/**
 * Git operations for the spec pipeline
 */

import { spawn } from "node:child_process";
import type { PipelineState } from "./types.ts";
import { saveState } from "./state.ts";

// ============================================
// Git Command Execution
// ============================================

/**
 * Execute a git command and return the result
 */
export async function execGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		const proc = spawn("git", args, { cwd });
		proc.stdout?.on("data", (data) => { stdout += data.toString(); });
		proc.stderr?.on("data", (data) => { stderr += data.toString(); });
		proc.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
		proc.on("error", () => resolve({ code: 1, stdout: "", stderr: "Failed to execute git" }));
	});
}

// ============================================
// Git Repository Validation
// ============================================

/**
 * Validate that we're in a git repository
 * Returns true if git is available and we're in a repo
 */
export async function validateGitRepo(cwd: string): Promise<{ valid: boolean; error?: string }> {
	const result = await execGit(cwd, ["rev-parse", "--git-dir"]);
	if (result.code !== 0) {
		return { 
			valid: false, 
			error: "Not a git repository. Please initialize git with 'git init' before starting the pipeline." 
		};
	}
	return { valid: true };
}

/**
 * Check if the working directory is clean (no uncommitted changes)
 */
export async function checkGitClean(cwd: string): Promise<{ clean: boolean; status?: string }> {
	const result = await execGit(cwd, ["status", "--porcelain"]);
	if (result.code !== 0) {
		return { clean: false, status: result.stderr };
	}
	if (result.stdout.length > 0) {
		return { clean: false, status: result.stdout };
	}
	return { clean: true };
}

// ============================================
// Branch Operations
// ============================================

/**
 * Get the current git branch name
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
	const result = await execGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (result.code !== 0) {
		return null;
	}
	return result.stdout || null;
}

/**
 * Check if a branch exists
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
	const result = await execGit(cwd, ["rev-parse", "--verify", branchName]);
	return result.code === 0;
}

/**
 * Create a new branch and switch to it
 * If branch exists, appends -N suffix
 * Returns the actual branch name created
 */
export async function createPipelineBranch(cwd: string, pipelineId: string): Promise<{ success: boolean; branchName?: string; error?: string }> {
	const baseName = `spec-pipeline/${pipelineId}`;
	let branchName = baseName;
	let suffix = 1;
	
	// Find unique branch name if base already exists
	while (await branchExists(cwd, branchName)) {
		branchName = `${baseName}-${suffix}`;
		suffix++;
		if (suffix > 100) {
			return { success: false, error: "Too many branch name collisions" };
		}
	}
	
	// Create and switch to the new branch
	const result = await execGit(cwd, ["checkout", "-b", branchName]);
	if (result.code !== 0) {
		return { success: false, error: result.stderr || "Failed to create branch" };
	}
	
	return { success: true, branchName };
}

/**
 * Switch to an existing branch
 */
export async function switchToBranch(cwd: string, branchName: string): Promise<{ success: boolean; error?: string }> {
	const result = await execGit(cwd, ["checkout", branchName]);
	if (result.code !== 0) {
		return { success: false, error: result.stderr || "Failed to switch branch" };
	}
	return { success: true };
}

/**
 * Delete a branch
 */
export async function deleteBranch(cwd: string, branchName: string): Promise<boolean> {
	const result = await execGit(cwd, ["branch", "-D", branchName]);
	return result.code === 0;
}

// ============================================
// Checkpoint Operations
// ============================================

/**
 * Create a checkpoint commit with all current changes
 * Returns the commit hash or null if nothing to commit
 */
export async function createCheckpoint(
	cwd: string, 
	role: string, 
	phase?: number, 
	cycle?: number
): Promise<string | null> {
	// Stage all changes
	const addResult = await execGit(cwd, ["add", "-A"]);
	if (addResult.code !== 0) {
		return null;
	}
	
	// Check if there are changes to commit
	const statusResult = await execGit(cwd, ["diff", "--staged", "--quiet"]);
	if (statusResult.code === 0) {
		// No staged changes, nothing to commit
		return null;
	}
	
	// Build commit message
	let message = `[CHECKPOINT] Before ${role}`;
	if (phase !== undefined) {
		message += ` - Phase ${phase}`;
		if (cycle !== undefined) {
			message += `, Cycle ${cycle}`;
		}
	}
	
	// Create commit
	const commitResult = await execGit(cwd, ["commit", "-m", message]);
	if (commitResult.code !== 0) {
		return null;
	}
	
	// Get commit hash
	const hashResult = await execGit(cwd, ["rev-parse", "HEAD"]);
	if (hashResult.code !== 0) {
		return null;
	}
	
	return hashResult.stdout;
}

/**
 * Create a checkpoint before a write operation and update state
 * Returns true if checkpoint was created (or not needed), false on error
 */
export async function createCheckpointAndSave(
	cwd: string,
	state: PipelineState,
	role: string,
	phase?: number,
	cycle?: number,
	notify?: (msg: string, type: "info" | "error" | "success" | "warning") => void
): Promise<boolean> {
	// Only create checkpoints if on a pipeline branch
	if (!state.pipelineBranch) {
		return true;  // No branch isolation, skip checkpoint
	}
	
	const commitHash = await createCheckpoint(cwd, role, phase, cycle);
	if (commitHash) {
		if (!state.checkpoints) {
			state.checkpoints = [];
		}
		state.checkpoints.push(commitHash);
		saveState(cwd, state);
		notify?.(`📍 Checkpoint created: ${commitHash.slice(0, 8)}`, "info");
	}
	// null means nothing to commit, which is fine
	return true;
}

// ============================================
// Stash Operations
// ============================================

/**
 * Stash any uncommitted changes with an identifiable message
 * Returns the stash reference or null if nothing to stash
 */
export async function stashChanges(cwd: string, timestamp: string): Promise<string | null> {
	// Check if there are changes to stash
	const statusResult = await execGit(cwd, ["status", "--porcelain"]);
	if (statusResult.code !== 0 || statusResult.stdout.length === 0) {
		return null;
	}
	
	// Create stash with message
	const message = `spec-pipeline-error-${timestamp}`;
	const result = await execGit(cwd, ["stash", "push", "-m", message, "--include-untracked"]);
	if (result.code !== 0) {
		return null;
	}
	
	// Get stash reference (stash@{0} after push)
	return `stash@{0}`;
}

/**
 * Drop a specific stash by reference
 */
export async function dropStash(cwd: string, stashRef: string): Promise<boolean> {
	const result = await execGit(cwd, ["stash", "drop", stashRef]);
	return result.code === 0;
}

/**
 * Check if a stash reference still exists
 */
export async function stashExists(cwd: string, stashRef: string): Promise<boolean> {
	// Try to show the stash - if it fails, stash doesn't exist
	const showResult = await execGit(cwd, ["stash", "show", stashRef]);
	return showResult.code === 0;
}

// ============================================
// Commit Operations
// ============================================

/**
 * Create a git commit with the given message
 */
export async function createCommit(cwd: string, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("git", ["add", "-A"], { cwd });
		proc.on("close", (code) => {
			if (code !== 0) {
				resolve(false);
				return;
			}
			const commitProc = spawn("git", ["commit", "-m", message], { cwd });
			commitProc.on("close", (code) => resolve(code === 0));
		});
	});
}

/**
 * Extract commit message from agent output.
 */
export function extractCommitMessage(output: string): string {
	// Try to extract from code block first
	const codeBlockMatch = output.match(/```(?:\w*\n)?([\s\S]*?)```/);
	if (codeBlockMatch) {
		return codeBlockMatch[1].trim();
	}
	
	// Look for conventional commit format
	const conventionalMatch = output.match(/((?:feat|fix|docs|refactor|test|chore)\([^)]+\):[^\n]+(?:\n\n[\s\S]*)?)/);
	if (conventionalMatch) {
		return conventionalMatch[1].trim();
	}
	
	return output.trim();
}

// ============================================
// Branch Merge Operations
// ============================================

/**
 * Squash all commits on the pipeline branch into meaningful phase commits
 * This creates a clean history with one commit per phase
 */
export async function squashCheckpointCommits(
	cwd: string, 
	originalBranch: string,
	phaseCount: number
): Promise<{ success: boolean; error?: string }> {
	// Get the merge-base with the original branch
	const baseResult = await execGit(cwd, ["merge-base", originalBranch, "HEAD"]);
	if (baseResult.code !== 0) {
		return { success: false, error: "Failed to find merge-base" };
	}
	const mergeBase = baseResult.stdout;
	
	// Soft reset to merge-base, keeping all changes staged
	const resetResult = await execGit(cwd, ["reset", "--soft", mergeBase]);
	if (resetResult.code !== 0) {
		return { success: false, error: "Failed to reset for squash" };
	}
	
	// Create a single squashed commit
	const commitResult = await execGit(cwd, [
		"commit", 
		"-m", 
		`feat: complete spec pipeline implementation (${phaseCount} phases)`
	]);
	if (commitResult.code !== 0) {
		// If nothing to commit, that's OK (no changes were made)
		const statusResult = await execGit(cwd, ["status", "--porcelain"]);
		if (statusResult.stdout.length === 0) {
			return { success: true };
		}
		return { success: false, error: "Failed to create squashed commit" };
	}
	
	return { success: true };
}

/**
 * Merge pipeline branch to original branch
 * Uses fast-forward if possible, otherwise creates merge commit
 */
export async function mergePipelineBranch(
	cwd: string, 
	originalBranch: string,
	pipelineBranch: string
): Promise<{ success: boolean; error?: string; conflicted?: boolean }> {
	// Switch to original branch
	const switchResult = await switchToBranch(cwd, originalBranch);
	if (!switchResult.success) {
		return { success: false, error: `Failed to switch to ${originalBranch}: ${switchResult.error}` };
	}
	
	// Try to merge with fast-forward
	const mergeResult = await execGit(cwd, ["merge", "--ff-only", pipelineBranch]);
	if (mergeResult.code === 0) {
		return { success: true };
	}
	
	// Try regular merge if fast-forward fails
	const regularMergeResult = await execGit(cwd, ["merge", pipelineBranch, "-m", `Merge ${pipelineBranch}`]);
	if (regularMergeResult.code !== 0) {
		// Check if it's a conflict
		if (regularMergeResult.stderr.includes("CONFLICT") || regularMergeResult.stdout.includes("CONFLICT")) {
			// Abort the merge
			await execGit(cwd, ["merge", "--abort"]);
			return { success: false, conflicted: true, error: "Merge conflict detected. Please resolve manually." };
		}
		return { success: false, error: regularMergeResult.stderr || "Merge failed" };
	}
	
	return { success: true };
}
