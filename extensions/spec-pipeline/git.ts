/**
 * Git operations for the spec pipeline
 */

import { spawn } from "node:child_process";
import type { SpecState, ImplementationState } from "./types.ts";

// Union type for any state that has git fields
type GitState = SpecState | ImplementationState;

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
 * 
 * @param prefix - Branch prefix: "spec" for spec creation, "implement" for implementation
 * @param name - Short name for the branch (e.g. "2602071030-feature-name")
 */
export async function createPipelineBranch(cwd: string, prefix: string, name: string): Promise<{ success: boolean; branchName?: string; error?: string }> {
	const baseName = `${prefix}/${name}`;
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
 * 
 * @param saveFn - Function to save the state after updating checkpoints
 */
export async function createCheckpointAndSave(
	cwd: string,
	state: GitState,
	role: string,
	saveFn: () => void,
	phase?: number,
	cycle?: number,
	notify?: (msg: string, type: "info" | "error" | "success" | "warning") => void
): Promise<boolean> {
	// Skip checkpoints for pipelines using agent commits (R11 - backward compatibility)
	if (state.useAgentCommits) {
		return true;  // New pipelines use agent commits instead
	}
	
	// Only create checkpoints if on a pipeline branch (old pipelines with branch isolation)
	if (!state.pipelineBranch) {
		return true;  // No branch isolation, skip checkpoint
	}
	
	const commitHash = await createCheckpoint(cwd, role, phase, cycle);
	if (commitHash) {
		if (!state.checkpoints) {
			state.checkpoints = [];
		}
		state.checkpoints.push(commitHash);
		saveFn();
		notify?.(`📍 Checkpoint created: ${commitHash.slice(0, 8)}`, "info");
	}
	// null means nothing to commit, which is fine
	return true;
}

// ============================================
// File Tracking Operations
// ============================================

/**
 * Capture the current git status (dirty state) before an agent runs
 * Returns the output of 'git status --porcelain' which shows:
 * - Modified files (M)
 * - Added files (A)
 * - Deleted files (D)
 * - Renamed files (R)
 * - Untracked files (??)
 */
export async function captureGitStatus(cwd: string): Promise<string> {
	const result = await execGit(cwd, ["status", "--porcelain"]);
	return result.stdout;
}

/**
 * Get the list of files modified since the last commit
 * This includes modifications, deletions, renames, and new untracked files
 * Returns an array of file paths
 */
export async function getModifiedFiles(cwd: string): Promise<string[]> {
	const files = new Set<string>();
	
	// Get tracked modified/deleted files
	const diffResult = await execGit(cwd, ["diff", "--name-only", "HEAD"]);
	if (diffResult.code === 0 && diffResult.stdout) {
		diffResult.stdout
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.forEach(file => files.add(file));
	}
	
	// Get untracked files (shows actual files, not just directories)
	const untrackedResult = await execGit(cwd, ["ls-files", "--others", "--exclude-standard"]);
	if (untrackedResult.code === 0 && untrackedResult.stdout) {
		untrackedResult.stdout
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.forEach(file => files.add(file));
	}
	
	return Array.from(files);
}

/**
 * Stage specific files (not all files)
 * Handles modifications, deletions, and renames
 * Returns true if staging was successful
 */
export async function stageFiles(cwd: string, files: string[]): Promise<boolean> {
	if (files.length === 0) {
		return true; // Nothing to stage
	}
	
	// Use 'git add --all <file>...' to handle modifications, deletions, and renames
	const result = await execGit(cwd, ["add", "--all", ...files]);
	return result.code === 0;
}

/**
 * Check if there are any staged changes ready to commit
 * Returns true if there are staged changes, false otherwise
 */
export async function hasChangesStaged(cwd: string): Promise<boolean> {
	// 'git diff --staged --quiet' exits with code 0 if no staged changes
	// and code 1 if there are staged changes
	const result = await execGit(cwd, ["diff", "--staged", "--quiet"]);
	return result.code !== 0;
}

// ============================================
// Stash Operations
// ============================================

/**
 * Stash any uncommitted changes with an identifiable message
 * Returns the stash reference or null if nothing to stash
 * 
 * NOTE: Stash references (stash@{N}) are positional and will change if new stashes
 * are created. Use the returned reference immediately or verify existence before use.
 */
export async function stashChanges(cwd: string, timestamp: string): Promise<string | null> {
	// Check if there are changes to stash
	const statusResult = await execGit(cwd, ["status", "--porcelain"]);
	if (statusResult.code !== 0) {
		return null; // Git command failed
	}
	if (statusResult.stdout.length === 0) {
		return null; // No changes to stash
	}
	
	// Create stash with message
	const message = `spec-pipeline-error-${timestamp}`;
	const result = await execGit(cwd, ["stash", "push", "-m", message, "--include-untracked"]);
	if (result.code !== 0) {
		return null;
	}
	
	// Get the stable stash reference from the stash list
	// The most recent stash is at the top of the list
	const listResult = await execGit(cwd, ["stash", "list"]);
	if (listResult.code !== 0) {
		return null;
	}
	
	const match = listResult.stdout.split('\n')[0]?.match(/^(stash@\{\d+\})/);
	return match ? match[1] : null;
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

/**
 * Reset working directory to HEAD (discard all uncommitted changes)
 * This is used for error recovery after stashing failed changes
 * Returns true if reset was successful, false otherwise
 * 
 * Note: This performs both:
 * 1. git reset --hard HEAD (resets tracked files)
 * 2. git clean -fd (removes untracked files and directories)
 */
export async function resetToHead(cwd: string): Promise<boolean> {
	// Reset tracked files to HEAD
	const resetResult = await execGit(cwd, ["reset", "--hard", "HEAD"]);
	if (resetResult.code !== 0) {
		return false;
	}
	
	// Remove untracked files and directories
	const cleanResult = await execGit(cwd, ["clean", "-fd"]);
	return cleanResult.code === 0;
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
// Agent Commit Operations
// ============================================

/**
 * Create a commit after an agent successfully modifies files (R1, R2, R3, R4, R8)
 * 
 * This function:
 * 1. Detects which files were modified by the agent
 * 2. Stages only those files (not all changes)
 * 3. Generates a commit message using the agentCommitMessageWriter
 * 4. Creates the commit
 * 5. Adds the commit hash to state.checkpoints[] for squash merge compatibility
 * 
 * @param cwd - Working directory
 * @param state - Pipeline state (SpecState or ImplementationState)
 * @param context - Context for commit message generation (role, model, phase, etc.)
 * @param agentConfig - Model configuration for the commit message writer
 * @param saveFn - Function to save the state after updating checkpoints
 * @param notify - UI notification callback
 * @returns { success: boolean; commitHash?: string; usedFallback?: boolean }
 */
export async function createAgentCommit(
	cwd: string,
	state: GitState,
	context: {
		role: string;
		modelConfig: { model: string; thinking: string };
		phase?: number;
		cycle?: number;
		reviewFeedback?: string;
	},
	agentConfig: { model: string; thinking: string },
	saveFn: () => void,
	notify?: (msg: string, type: "info" | "error" | "success" | "warning") => void
): Promise<{ success: boolean; commitHash?: string; usedFallback?: boolean }> {
	// Import generateCommitMessage dynamically to avoid circular dependencies
	const { generateCommitMessage } = await import("./commit-agent.ts");
	
	// Only create commits for new pipelines with agent commits enabled (R11 - backward compatibility)
	if (!state.useAgentCommits) {
		notify?.("Skipping agent commit (pipeline uses checkpoints)", "info");
		return { success: true };  // Old pipeline using checkpoints
	}
	
	// Only create commits if on a pipeline branch
	if (!state.pipelineBranch) {
		notify?.("Skipping agent commit (not on pipeline branch)", "info");
		return { success: true };  // No branch isolation, skip commit
	}
	
	// Step 1: Get modified files (R4, R8)
	const modifiedFiles = await getModifiedFiles(cwd);
	
	// Step 2: Check if any files were modified (R8)
	if (modifiedFiles.length === 0) {
		notify?.("No files modified by agent - skipping commit", "info");
		return { success: true };  // Nothing to commit
	}
	
	// Step 3: Stage the modified files (R8)
	const staged = await stageFiles(cwd, modifiedFiles);
	if (!staged) {
		notify?.("Failed to stage files", "error");
		return { success: false };
	}
	
	// Step 4: Check if there are actually staged changes (R8)
	const hasChanges = await hasChangesStaged(cwd);
	if (!hasChanges) {
		notify?.("No staged changes after staging - skipping commit", "info");
		return { success: true };  // No changes to commit
	}
	
	// Step 5: Generate commit message (R4, R7)
	notify?.(`Generating commit message for ${context.role}...`, "info");
	const messageResult = await generateCommitMessage(
		{
			role: context.role as any,
			modelConfig: context.modelConfig as any,
			files: modifiedFiles,
			phase: context.phase,
			cycle: context.cycle,
			reviewFeedback: context.reviewFeedback,
		},
		agentConfig as any,
		cwd
	);
	
	// Step 6: Handle fallback case (R7)
	if (messageResult.type === "fallback") {
		notify?.(`⚠️ Commit message generation failed - using fallback`, "warning");
		notify?.(`Fallback message: ${messageResult.message}`, "info");
		notify?.("Pipeline aborted - please review and resume with /spec-resume", "error");
		
		// Create the commit with fallback message
		const commitResult = await execGit(cwd, ["commit", "-m", messageResult.message]);
		if (commitResult.code !== 0) {
			notify?.("Failed to create commit with fallback message", "error");
			return { success: false, usedFallback: true };
		}
		
		// Get commit hash
		const hashResult = await execGit(cwd, ["rev-parse", "HEAD"]);
		const commitHash = hashResult.code === 0 ? hashResult.stdout : undefined;
		
		// Add to checkpoints array for squash merge (R12)
		if (commitHash) {
			if (!state.checkpoints) {
				state.checkpoints = [];
			}
			state.checkpoints.push(commitHash);
			saveFn();
			notify?.(`📍 Agent commit created (fallback): ${commitHash.slice(0, 8)}`, "info");
		}
		
		// Return success:false to abort pipeline (R7)
		return { success: false, commitHash, usedFallback: true };
	}
	
	// Step 7: Create the commit with generated message (R1, R2)
	const commitResult = await execGit(cwd, ["commit", "-m", messageResult.message]);
	if (commitResult.code !== 0) {
		notify?.("Failed to create commit", "error");
		return { success: false };
	}
	
	// Step 8: Get commit hash
	const hashResult = await execGit(cwd, ["rev-parse", "HEAD"]);
	if (hashResult.code !== 0) {
		notify?.("Failed to get commit hash", "error");
		return { success: false };
	}
	const commitHash = hashResult.stdout;
	
	// Step 9: Add to checkpoints array for squash merge (R12)
	if (!state.checkpoints) {
		state.checkpoints = [];
	}
	state.checkpoints.push(commitHash);
	saveFn();
	
	notify?.(`✅ Agent commit created: ${commitHash.slice(0, 8)}`, "success");
	
	return { success: true, commitHash };
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
