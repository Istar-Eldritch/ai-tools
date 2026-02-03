# Phase 4: User Experience and Error Display

**Estimated Effort**: 1 day

## Overview

This phase focuses on enhancing the user experience when errors occur. It builds on the structured error handling from Phases 1-3 to provide:

1. Visually formatted error display with Unicode box drawing
2. Error type-specific emoji indicators and color-coded messages
3. A dedicated `/spec-error` command to view full error details
4. Enhanced `/spec-status` output with visual sections
5. Clear recovery guidance with step-by-step instructions

## Prerequisites

- **Phase 1 MUST be complete** - Provides `ErrorDetails` type, `handleAgentError()`, `classifyError()`, `appendErrorLog()`, `truncateString()`, `getErrorSuggestion()`
- **Phase 2 MUST be complete** - Provides git branch fields, checkpoint tracking, `formatState()` branch display
- **Phase 3 MUST be complete** - Provides `formatErrorForRetry()`, retry logic in `/spec-resume`

### Dependencies from Previous Phases

| Phase | Item | Used By Phase 4 |
|-------|------|-----------------|
| Phase 1 | `ErrorDetails` type | Error display formatting |
| Phase 1 | `ErrorType` type | Type-specific emoji selection |
| Phase 1 | `getErrorSuggestion()` | Recovery guidance display |
| Phase 1 | `truncateString()` | Error message truncation |
| Phase 2 | `state.pipelineBranch` | Branch display in status |
| Phase 2 | `state.checkpoints` | Checkpoint count display |
| Phase 2 | `state.errorStash` | Stash status display |
| Phase 3 | `formatErrorForRetry()` | Enhanced for visual formatting |

## Important Notes

- **Line numbers are approximate**: Always use pattern matching to find the correct location
- **Unicode characters**: Uses box-drawing characters (─, │, ┌, ┐, └, ┘) for visual formatting
- **Emoji indicators**: Adds visual cues (❌, ⚠️, ⏱️, 🌐, ❓) based on error type
- **Backward compatibility**: All enhancements gracefully handle missing data from legacy states
- **Terminal width**: Assumes minimum 80-character terminal width for box formatting

## Steps

### Step 4.1: Create Visual Formatting Helper Functions

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function formatState` and add the new helpers BEFORE it
- **Pattern Reference**: Follow pattern of existing helper functions like `formatStage()`
- **Action**: Add helper functions for visual formatting with box-drawing characters

```typescript
// Add BEFORE the existing formatState() function:

/**
 * Get emoji indicator for error type
 */
function getErrorEmoji(errorType: ErrorType): string {
	switch (errorType) {
		case "RATE_LIMIT":
			return "⏱️";  // Clock for rate limiting
		case "TIMEOUT":
			return "⌛";  // Hourglass for timeout
		case "NETWORK":
			return "🌐";  // Globe for network issues
		case "VALIDATION":
			return "⚠️";  // Warning for validation
		case "UNKNOWN":
		default:
			return "❓";  // Question mark for unknown
	}
}

/**
 * Create a formatted box with title and content
 * Uses Unicode box-drawing characters for visual appeal
 */
function formatBox(title: string, content: string[], width: number = 60): string {
	const lines: string[] = [];
	const innerWidth = width - 4;  // Account for "│ " and " │"
	
	// Top border with title
	const titlePadded = ` ${title} `;
	const titleLen = titlePadded.length;
	const leftBorder = Math.floor((width - titleLen - 2) / 2);
	const rightBorder = width - titleLen - leftBorder - 2;
	lines.push(`┌${"─".repeat(leftBorder)}${titlePadded}${"─".repeat(rightBorder)}┐`);
	
	// Content lines
	for (const line of content) {
		// Word-wrap long lines
		if (line.length <= innerWidth) {
			lines.push(`│ ${line.padEnd(innerWidth)} │`);
		} else {
			// Simple word wrap
			let remaining = line;
			while (remaining.length > 0) {
				const chunk = remaining.slice(0, innerWidth);
				remaining = remaining.slice(innerWidth);
				lines.push(`│ ${chunk.padEnd(innerWidth)} │`);
			}
		}
	}
	
	// Bottom border
	lines.push(`└${"─".repeat(width - 2)}┘`);
	
	return lines.join("\n");
}

/**
 * Create a simple divider line
 */
function formatDivider(width: number = 60): string {
	return "─".repeat(width);
}

/**
 * Format a key-value pair with consistent alignment
 */
function formatKeyValue(key: string, value: string, keyWidth: number = 14): string {
	return `${key.padEnd(keyWidth)}: ${value}`;
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 4.2: Create Enhanced Error Display Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Add immediately after `formatKeyValue()` from Step 4.1
- **Pattern Reference**: Based on `formatErrorForRetry()` from Phase 3
- **Action**: Add comprehensive error display function that uses visual formatting

```typescript
/**
 * Format error details as a visually appealing box for display
 * Used by /spec-status and /spec-error commands
 */
function formatErrorBox(error: ErrorDetails, state: PipelineState): string {
	const emoji = getErrorEmoji(error.errorType);
	const content: string[] = [];
	
	content.push(formatKeyValue("Timestamp", error.timestamp));
	content.push(formatKeyValue("Agent", `${error.agent} (${error.role})`));
	
	if (error.phase !== undefined) {
		const totalPhases = state.phases.length || "?";
		let phaseInfo = `${error.phase} of ${totalPhases}`;
		if (error.cycle !== undefined) {
			phaseInfo += `, Cycle ${error.cycle} of 3`;
		}
		content.push(formatKeyValue("Phase", phaseInfo));
	}
	
	content.push(formatKeyValue("Error Type", `${emoji} ${error.errorType}`));
	content.push(formatKeyValue("Exit Code", String(error.exitCode)));
	
	if (error.stderr) {
		content.push("");
		content.push("─── Error Message ───");
		// Truncate and format error message
		const preview = truncateString(error.stderr, 400);
		// Split by newlines and add each line
		for (const line of preview.split("\n").slice(0, 6)) {
			content.push(`  ${line.trim()}`);
		}
	}
	
	content.push("");
	content.push("─── Recovery ───");
	content.push(`  ${getErrorSuggestion(error.errorType)}`);
	
	content.push("");
	content.push(formatKeyValue("Error Log", `.pi/spec-pipeline/${state.id}.error.log`));
	
	if (error.agentTask) {
		content.push(formatKeyValue("Can Retry", "Yes (/spec-resume)"));
	} else {
		content.push(formatKeyValue("Can Retry", "No (task not stored)"));
	}
	
	return formatBox(`${emoji} Error Details`, content);
}
```

- **Verify**: Load extension in pi to verify it compiles

### Step 4.3: Replace formatState() with Enhanced Visual Version

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for the start of `function formatState` 
- **Pattern Reference**: Existing formatState() structure, enhanced with Phase 4 visual helpers
- **Action**: Replace the entire formatState() function with an enhanced version that includes visual section headers and error box display

```typescript
// Replace the entire formatState() function with an enhanced version:

function formatState(state: PipelineState): string {
	const lines: string[] = [];
	
	// Header section
	lines.push(formatDivider(50));
	lines.push(`  Pipeline: ${state.id}`);
	lines.push(formatDivider(50));
	lines.push("");
	
	// Basic info section
	lines.push("📋 Basic Information");
	lines.push(formatKeyValue("  Description", state.description.slice(0, 50) + (state.description.length > 50 ? "..." : "")));
	lines.push(formatKeyValue("  Stage", formatStage(state.stage)));
	lines.push(formatKeyValue("  Created", state.createdAt));
	lines.push(formatKeyValue("  Updated", state.updatedAt));
	lines.push(formatKeyValue("  Spec", state.specFilename));
	
	// Git section (added by Phase 2)
	if (state.pipelineBranch || state.originalBranch) {
		lines.push("");
		lines.push("🔀 Git Branch");
		if (state.pipelineBranch) {
			lines.push(formatKeyValue("  Branch", state.pipelineBranch));
		}
		if (state.originalBranch && state.pipelineBranch) {
			lines.push(formatKeyValue("  Original", state.originalBranch));
		}
		if (state.checkpoints && state.checkpoints.length > 0) {
			lines.push(formatKeyValue("  Checkpoints", String(state.checkpoints.length)));
		}
		if (state.errorStash) {
			lines.push(formatKeyValue("  Error Stash", state.errorStash + " (will be dropped on resume)"));
		}
	}
	
	// Discovery progress section
	if (state.discovery) {
		lines.push("");
		lines.push("🔍 Discovery");
		if (state.discovery.skipped) {
			lines.push("  Skipped (--quick mode)");
		} else if (state.stage === "discovery") {
			lines.push(formatKeyValue("  Round", `${state.discovery.currentRound}/${state.discovery.maxRounds}`));
			lines.push(formatKeyValue("  Q&A Exchanges", String(state.discovery.qaHistory.length)));
			if (state.discovery.qaHistory.length > 0) {
				const lastExchange = state.discovery.qaHistory[state.discovery.qaHistory.length - 1];
				const lastTime = new Date(lastExchange.timestamp).toISOString().slice(11, 19);
				lines.push(formatKeyValue("  Last Exchange", `Round ${lastExchange.round} at ${lastTime} UTC`));
			}
		} else if (state.discovery.completed && state.discovery.qaHistory.length > 0) {
			lines.push(formatKeyValue("  Status", `Completed (${state.discovery.qaHistory.length} exchanges)`));
			const summaryLength = state.discovery.discoverySummary?.length || 0;
			if (summaryLength > 0) {
				lines.push(formatKeyValue("  Summary", `${Math.round(summaryLength / 1000)}KB`));
			}
		} else if (state.discovery.completed) {
			lines.push("  Completed (no exchanges)");
		}
	}
	
	// Spec progress section
	if (state.stage === "spec_drafting" || state.stage === "spec_review" || state.stage === "user_approval") {
		lines.push("");
		lines.push("📝 Spec Progress");
		lines.push(formatKeyValue("  Iteration", `${state.specIteration}/${MAX_SPEC_ITERATIONS}`));
		lines.push(formatKeyValue("  Approved", state.specApproved ? "Yes ✅" : "No"));
	}
	
	// Phases section
	if (state.phases.length > 0) {
		lines.push("");
		lines.push("🏗️ Implementation Phases");
		const generatedCount = state.phasesGenerated.filter(Boolean).length;
		lines.push(formatKeyValue("  Total Phases", String(state.phases.length)));
		lines.push(formatKeyValue("  Plans Ready", `${generatedCount}/${state.phases.length}`));
		
		if (state.stage === "implementation") {
			lines.push(formatKeyValue("  Current Phase", `${state.currentPhaseIndex + 1}/${state.phases.length}`));
			lines.push(formatKeyValue("  Review Cycle", `${state.currentReviewCycle}/${REVIEW_CYCLES}`));
			
			// Show phase names with progress indicators
			lines.push("");
			lines.push("  Phase Progress:");
			for (let i = 0; i < state.phases.length && i < 5; i++) {  // Limit to 5 phases for display
				const phaseName = state.phases[i].slice(0, 30) + (state.phases[i].length > 30 ? "..." : "");
				let status = "  ⬜";  // Pending
				if (i < state.currentPhaseIndex) {
					status = "  ✅";  // Completed
				} else if (i === state.currentPhaseIndex) {
					status = "  🔄";  // In progress
				}
				lines.push(`  ${status} Phase ${i + 1}: ${phaseName}`);
			}
			if (state.phases.length > 5) {
				lines.push(`    ... and ${state.phases.length - 5} more phases`);
			}
		}
	}
	
	// Error section - use enhanced display
	if (state.lastError) {
		lines.push("");
		if (typeof state.lastError === "string") {
			// Legacy error format
			lines.push("❌ Last Error (Legacy)");
			lines.push(`  ${state.lastError.slice(0, 200)}${state.lastError.length > 200 ? "..." : ""}`);
		} else {
			// Structured ErrorDetails - use enhanced display
			lines.push(formatErrorBox(state.lastError, state));
		}
	}
	
	lines.push("");
	lines.push(formatDivider(50));
	
	return lines.join("\n");
}
```

- **Verify**: Run `/spec-status` and verify the new visual layout

### Step 4.4: Register /spec-error Command

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `pi.registerCommand("spec-cancel"` and add the new command BEFORE it
- **Pattern Reference**: Based on existing `/spec-status` command
- **Action**: Add a dedicated command to view full error details and agent task

```typescript
// Add BEFORE the pi.registerCommand("spec-cancel") block:

	// Command to view error details
	pi.registerCommand("spec-error", {
		description: "Show detailed error information for the current pipeline",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;
			const pipelineId = args.trim();

			let state: PipelineState | null;
			if (pipelineId) {
				state = loadState(cwd, pipelineId);
				if (!state) {
					ctx.ui.notify(`Pipeline not found: ${pipelineId}`, "error");
					return;
				}
			} else {
				state = getLatestActivePipeline(cwd);
				if (!state) {
					// Check completed/cancelled pipelines
					const states = listStates(cwd);
					if (states.length === 0) {
						ctx.ui.notify("No pipelines found.", "info");
						return;
					}
					state = states[0];
				}
			}

			if (!state.lastError) {
				ctx.ui.notify("No error recorded for this pipeline.", "info");
				ctx.ui.notify(`Pipeline stage: ${formatStage(state.stage)}`, "info");
				return;
			}

			// Handle legacy string errors
			if (typeof state.lastError === "string") {
				ctx.ui.notify("Legacy Error Format", "warning");
				ctx.ui.notify(state.lastError, "info");
				ctx.ui.notify("\nThis is a legacy error format. Limited details available.", "info");
				return;
			}

			const error = state.lastError;

			// Display full error details
			ctx.ui.notify(formatErrorBox(error, state), "info");

			// Show full stderr if available
			if (error.stderr) {
				ctx.ui.notify("\n📜 Full Error Output:", "info");
				ctx.ui.notify(formatDivider(60), "info");
				ctx.ui.notify(error.stderr, "info");
				ctx.ui.notify(formatDivider(60), "info");
			}

			// Show agent task excerpt
			if (error.agentTask) {
				ctx.ui.notify("\n📋 Agent Task (excerpt):", "info");
				ctx.ui.notify(formatDivider(60), "info");
				// Show first 1000 chars of task
				const taskPreview = error.agentTask.slice(0, 1000);
				ctx.ui.notify(taskPreview, "info");
				if (error.agentTask.length > 1000) {
					ctx.ui.notify(`... (${error.agentTask.length - 1000} more characters)`, "info");
				}
				ctx.ui.notify(formatDivider(60), "info");
			}

			// Error log file location
			const logPath = path.join(getStateDir(cwd), `${state.id}.error.log`);
			if (fs.existsSync(logPath)) {
				ctx.ui.notify(`\n📁 Full error log: ${logPath}`, "info");
				ctx.ui.notify("   View with: cat " + logPath, "info");
			} else {
				ctx.ui.notify(`\n📁 Error log not found: ${logPath}`, "warning");
			}

			// Recovery suggestions
			ctx.ui.notify("\n💡 Recovery Options:", "info");
			ctx.ui.notify(`   1. ${getErrorSuggestion(error.errorType)}`, "info");
			if (state.pipelineBranch) {
				ctx.ui.notify(`   2. View changes: git diff ${state.pipelineBranch}`, "info");
				if (state.checkpoints && state.checkpoints.length > 0) {
					const lastCheckpoint = state.checkpoints[state.checkpoints.length - 1];
					ctx.ui.notify(`   3. Revert to checkpoint: git reset --hard ${lastCheckpoint}`, "info");
				}
			}
		},
	});

```

- **Verify**: Run `/spec-error` and verify it displays error details

### Step 4.5: Update formatErrorForRetry() with Enhanced Visual Formatting

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `function formatErrorForRetry` (added by Phase 3)
- **Pattern Reference**: Phase 3's implementation
- **Action**: Replace with visually enhanced version using box formatting

```typescript
// Replace the entire formatErrorForRetry() function (from Phase 3):

/**
 * Format error details for display before retry
 * Returns formatted string for user notification
 */
function formatErrorForRetry(error: ErrorDetails, state: PipelineState): string {
	const emoji = getErrorEmoji(error.errorType);
	const content: string[] = [];
	
	content.push(formatKeyValue("Failed at", error.timestamp));
	content.push(formatKeyValue("Agent", error.agent));
	content.push(formatKeyValue("Role", error.role));
	
	if (error.phase !== undefined) {
		const totalPhases = state.phases.length || "?";
		const phaseInfo = `${error.phase} of ${totalPhases}`;
		if (error.cycle !== undefined) {
			content.push(formatKeyValue("Phase", phaseInfo));
			content.push(formatKeyValue("Cycle", `${error.cycle} of ${REVIEW_CYCLES}`));
		} else {
			content.push(formatKeyValue("Phase", phaseInfo));
		}
	}
	
	content.push(formatKeyValue("Error type", `${emoji} ${error.errorType}`));
	
	if (error.stderr) {
		const preview = error.stderr.length > 150 
			? error.stderr.slice(0, 150) + "..." 
			: error.stderr;
		content.push(formatKeyValue("Message", preview));
	}
	
	content.push("");
	content.push(`💡 ${getErrorSuggestion(error.errorType)}`);
	
	const box = formatBox("Resuming from Error", content, 55);
	return "\n" + box + "\n";
}
```

- **Verify**: Run `/spec-resume` after an error and verify the display

### Step 4.6: Enhance Error Notification in handleAgentError()

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `async function handleAgentError` (added by Phase 1, made async by Phase 2)
- **Action**: Update the notification formatting to use the new visual helpers

**Note**: This modifies the existing handleAgentError() function. Find the notification section at the end of the function (after the stashing logic from Phase 2) and replace it.

**Before (Phase 2 version)** - find this exact pattern:
```typescript
	// Format user notification
	const phaseInfo = phase !== undefined ? ` (Phase ${phase}${cycle !== undefined ? `, Cycle ${cycle}` : ""})` : "";
	const errorMessage = `${role} failed${phaseInfo}: ${errorDetails.errorType}`;
	const stderrPreview = errorDetails.stderr ? `\n${truncateString(errorDetails.stderr, 500)}` : "";
	const suggestion = `\n\n💡 ${getErrorSuggestion(errorDetails.errorType)}`;
	const logInfo = `\n📁 Full error log: .pi/spec-pipeline/${state.id}.error.log`;
	
	notify(errorMessage + stderrPreview + suggestion + logInfo, "error");
	
	return errorDetails;
}
```

**After** - replace with:
```typescript
	// Format user notification with visual formatting
	const emoji = getErrorEmoji(errorDetails.errorType);
	const phaseInfo = phase !== undefined 
		? ` (Phase ${phase}${cycle !== undefined ? `, Cycle ${cycle}` : ""})` 
		: "";
	
	// Build notification content
	const notifyLines: string[] = [];
	notifyLines.push(`${emoji} ${role} failed${phaseInfo}`);
	notifyLines.push("");
	notifyLines.push(formatKeyValue("Error Type", errorDetails.errorType, 12));
	
	if (errorDetails.stderr) {
		const preview = truncateString(errorDetails.stderr, 300);
		notifyLines.push("");
		notifyLines.push("Error Message:");
		notifyLines.push(`  ${preview}`);
	}
	
	notifyLines.push("");
	notifyLines.push(formatDivider(40));
	notifyLines.push("");
	notifyLines.push(`💡 ${getErrorSuggestion(errorDetails.errorType)}`);
	notifyLines.push("");
	notifyLines.push(`📁 Error log: .pi/spec-pipeline/${state.id}.error.log`);
	notifyLines.push(`🔍 Details: /spec-error`);
	
	notify(notifyLines.join("\n"), "error");
	
	return errorDetails;
}
```

- **Verify**: Trigger an error and verify the enhanced notification

### Step 4.7: Update /spec-list with Visual Improvements

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `pi.registerCommand("spec-list"`
- **Pattern Reference**: Existing spec-list implementation
- **Action**: Enhance the output with visual formatting

```typescript
// Find and replace the handler inside pi.registerCommand("spec-list"):

		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const states = listStates(cwd);

			if (states.length === 0) {
				ctx.ui.notify("No pipelines found. Use /spec to start one.", "info");
				return;
			}

			const lines: string[] = [];
			lines.push(formatDivider(60));
			lines.push(`  📋 Pipelines (${states.length} total)`);
			lines.push(formatDivider(60));
			lines.push("");

			for (const state of states) {
				const isActive = state.stage !== "completed" && state.stage !== "cancelled";
				const hasError = state.lastError !== undefined;
				
				// Status indicator
				let statusIcon = "  ";
				if (state.stage === "completed") {
					statusIcon = "✅";
				} else if (state.stage === "cancelled") {
					statusIcon = "🚫";
				} else if (hasError) {
					statusIcon = "❌";
				} else if (isActive) {
					statusIcon = "▶️";
				}
				
				lines.push(`${statusIcon} ${state.id}`);
				lines.push(`   ${state.description.slice(0, 55)}${state.description.length > 55 ? "..." : ""}`);
				lines.push(`   Stage: ${formatStage(state.stage)}`);
				
				// Show error type if present
				if (hasError && typeof state.lastError !== "string") {
					const errEmoji = getErrorEmoji(state.lastError.errorType);
					lines.push(`   Error: ${errEmoji} ${state.lastError.errorType}`);
				}
				
				// Show branch if present
				if (state.pipelineBranch) {
					lines.push(`   Branch: ${state.pipelineBranch}`);
				}
				
				lines.push(`   Updated: ${state.updatedAt}`);
				lines.push("");
			}

			lines.push(formatDivider(60));
			lines.push("Legend: ▶️ Active  ✅ Completed  🚫 Cancelled  ❌ Error");
			lines.push(formatDivider(60));

			ctx.ui.notify(lines.join("\n"), "info");
		},
```

- **Verify**: Run `/spec-list` and verify the visual improvements

### Step 4.8: Add Recovery Hints to Completion Message

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `ctx.ui.notify("\n🎉 Spec pipeline complete!", "success");` at the end of runPipeline
- **Action**: Enhance the completion message with summary information

```typescript
// Find the completion notification (at the very end of runPipeline):
// Replace:
	ctx.ui.notify("\n🎉 Spec pipeline complete!", "success");

// With:
	// Enhanced completion message
	const completionLines: string[] = [];
	completionLines.push("");
	completionLines.push(formatDivider(50));
	completionLines.push("  🎉 Spec Pipeline Complete!");
	completionLines.push(formatDivider(50));
	completionLines.push("");
	completionLines.push(formatKeyValue("  Pipeline ID", state.id));
	completionLines.push(formatKeyValue("  Spec File", state.specFilename));
	completionLines.push(formatKeyValue("  Phases", String(state.phases.length)));
	if (state.checkpoints && state.checkpoints.length > 0) {
		completionLines.push(formatKeyValue("  Checkpoints", String(state.checkpoints.length)));
	}
	completionLines.push("");
	completionLines.push("  📋 Next Steps:");
	completionLines.push("     • Review the implementation changes");
	completionLines.push("     • Run tests: " + (projectConfig.testCommand || "npm test"));
	completionLines.push("     • Commit any final adjustments");
	completionLines.push("");
	completionLines.push(formatDivider(50));
	
	ctx.ui.notify(completionLines.join("\n"), "success");
```

- **Verify**: Complete a pipeline and verify the enhanced completion message

### Step 4.9: Update /spec-status for Completed Pipelines

- **Files**: `extensions/spec-pipeline/index.ts`
- **Find by**: Search for `pi.registerCommand("spec-status"`
- **Action**: Add contextual hints after the formatState() output

**Note**: After Step 4.3, `formatState()` now outputs a visually enhanced format with section headers, emoji indicators, and box-drawn error details. The output will include dividers, key-value pairs, and (for pipelines with errors) the `formatErrorBox()` output.

```typescript
// Find the end of the spec-status handler (after ctx.ui.notify(formatState(state), "info");)
// Replace:
			ctx.ui.notify(formatState(state), "info");

// With:
			ctx.ui.notify(formatState(state), "info");
			
			// Add contextual hints based on state
			if (state.stage === "completed") {
				ctx.ui.notify("\n✅ This pipeline completed successfully.", "success");
			} else if (state.stage === "cancelled") {
				ctx.ui.notify("\n🚫 This pipeline was cancelled. Use /spec-resume to restart.", "info");
			} else if (state.lastError) {
				ctx.ui.notify("\n❌ This pipeline stopped due to an error.", "warning");
				ctx.ui.notify("   Use /spec-error for details, /spec-resume to retry", "info");
			} else {
				ctx.ui.notify("\n▶️ This pipeline is active. Use /spec-resume to continue.", "info");
			}
```

- **Verify**: Run `/spec-status` on various pipeline states and verify hints

### Step 4.10: Final Verification and Testing

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Final compilation and comprehensive testing
- **Commands**:
  ```bash
  # Verify extension loads without errors
  pi --help
  
  # Start a pi session and test commands
  pi
  /spec-status      # Test enhanced status display
  /spec-list        # Test enhanced list display
  /spec-error       # Test error details command
  ```

- **Verify**: All commands work with visual formatting

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| (none) | All changes in existing file | |

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Visual formatting helpers, enhanced error display, `/spec-error` command, improved status output |

## Implementation Order

The steps must be done in this order due to dependencies:

1. **Step 4.1**: Visual formatting helpers (foundational, no dependencies)
2. **Step 4.2**: Enhanced error display function (depends on 4.1)
3. **Step 4.3**: formatState() full overhaul (depends on 4.1, 4.2)
4. **Step 4.4**: /spec-error command (depends on 4.1, 4.2)
5. **Step 4.5**: formatErrorForRetry() enhancement (depends on 4.1)
6. **Step 4.6**: handleAgentError() notification update (depends on 4.1)
7. **Step 4.7**: /spec-list visual improvements (depends on 4.1)
8. **Step 4.8**: Completion message enhancement (depends on 4.1)
9. **Step 4.9**: /spec-status contextual hints (depends on 4.3)
10. **Step 4.10**: Final verification

## Completion Checklist

- [ ] Step 4.1: Visual formatting helpers added (`getErrorEmoji`, `formatBox`, `formatDivider`, `formatKeyValue`)
- [ ] Step 4.2: `formatErrorBox()` function added
- [ ] Step 4.3: formatState() restructured with section headers and emoji indicators
- [ ] Step 4.4: `/spec-error` command registered and working
- [ ] Step 4.5: formatErrorForRetry() enhanced with box formatting
- [ ] Step 4.6: handleAgentError() notification enhanced
- [ ] Step 4.7: `/spec-list` has visual improvements and legend
- [ ] Step 4.8: Completion message has summary and next steps
- [ ] Step 4.9: `/spec-status` has contextual hints
- [ ] Step 4.10: All commands compile and work correctly
- [ ] Error type emoji indicators visible (⏱️ rate limit, ⌛ timeout, 🌐 network, ⚠️ validation, ❓ unknown)
- [ ] Box-drawing characters render correctly in terminal
- [ ] `/spec-error` shows full stderr and agent task excerpt
- [ ] Recovery suggestions displayed with error notifications
- [ ] Extension loads without TypeScript errors

## Testing Strategy

### 1. Test Visual Formatting
```bash
pi
/spec-status
# Expected: Section headers with emoji, dividers, formatted key-value pairs
```

### 2. Test Error Display
```bash
# After an error occurs:
/spec-status
# Expected: Error box with emoji, type indicator, recovery suggestion

/spec-error
# Expected: Full error details, stderr, agent task excerpt, recovery options
```

### 3. Test Pipeline List
```bash
/spec-list
# Expected: Status icons (▶️ ✅ 🚫 ❌), legend at bottom, branch info
```

### 4. Test Error Type Emoji
```bash
# Rate limit error:  ⏱️
# Timeout error:     ⌛
# Network error:     🌐
# Validation error:  ⚠️
# Unknown error:     ❓
```

### 5. Test Completion Message
```bash
# Complete a pipeline successfully
# Expected: Formatted completion box with pipeline stats and next steps
```

### 6. Test Contextual Hints
```bash
/spec-status  # On completed pipeline
# Expected: "✅ This pipeline completed successfully."

/spec-status  # On pipeline with error
# Expected: "❌ This pipeline stopped due to an error."
```

### 7. Test Box Drawing Characters
Verify in different terminals:
- Linux terminal: Should render correctly
- VS Code terminal: Should render correctly
- Windows Terminal: Should render correctly (may need UTF-8 encoding)

## Notes

- Unicode box-drawing characters (┌┐└┘│─) provide visual structure
- Emoji indicators provide at-a-glance status recognition
- formatKeyValue() ensures consistent alignment across all displays
- Error messages are truncated but full details available via `/spec-error` and log file
- All visual enhancements are backward compatible with legacy string errors
- The `/spec-error` command is a complement to `/spec-status`, not a replacement
- Recovery suggestions use existing `getErrorSuggestion()` from Phase 1 for consistency
- Phase progress display in `/spec-status` is limited to 5 phases to prevent excessive output
