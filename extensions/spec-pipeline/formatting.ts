/**
 * Formatting utilities for the spec pipeline UI
 */

import type {
	PipelineStage,
	PipelineState,
	ModelConfig,
	TieredModelConfig,
	ProjectConfig,
	WidgetUIContext,
} from "./types.ts";
import { PIPELINE_WIDGET_ID, MAX_SPEC_ITERATIONS } from "./types.ts";
import { getErrorEmoji, getErrorSuggestion } from "./errors.ts";

// ============================================
// Box Formatting
// ============================================

/**
 * Create a formatted box with title and content
 * Uses Unicode box-drawing characters for visual appeal
 */
export function formatBox(title: string, content: string[], width: number = 60): string {
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
			// Word-boundary aware wrapping
			let remaining = line;
			while (remaining.length > 0) {
				if (remaining.length <= innerWidth) {
					lines.push(`│ ${remaining.padEnd(innerWidth)} │`);
					break;
				}
				// Find last space within the width limit
				let breakPoint = remaining.lastIndexOf(" ", innerWidth);
				if (breakPoint <= 0) {
					// No space found, fall back to hard break
					breakPoint = innerWidth;
				}
				const chunk = remaining.slice(0, breakPoint);
				remaining = remaining.slice(breakPoint).trimStart();
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
export function formatDivider(width: number = 60): string {
	return "─".repeat(width);
}

/**
 * Format a key-value pair with consistent alignment
 */
export function formatKeyValue(key: string, value: string, keyWidth: number = 14): string {
	return `${key.padEnd(keyWidth)}: ${value}`;
}

// ============================================
// Step & Banner Formatting
// ============================================

/**
 * Format a step notification banner for pipeline progress
 * These notifications stay visible in the terminal after resize
 */
export function formatStepBanner(
	step: string,
	details?: string,
	emoji?: string
): string {
	const icon = emoji || "▶";
	const lines: string[] = [];
	lines.push("");
	lines.push(formatDivider(50));
	lines.push(`  ${icon} ${step}`);
	if (details) {
		lines.push(`     ${details}`);
	}
	lines.push(formatDivider(50));
	lines.push("");
	return lines.join("\n");
}

// ============================================
// Model Config Formatting
// ============================================

/**
 * Format model config for display
 */
export function formatModelConfig(config: ModelConfig): string {
	return `${config.model}/${config.thinking}`;
}

/**
 * Format tiered model config for display
 */
export function formatTieredConfig(config: TieredModelConfig): string {
	return `cheap=${config.cheap.model}/${config.cheap.thinking}, expensive=${config.expensive.model}/${config.expensive.thinking}`;
}

/**
 * Format effective configuration for display at startup (R5)
 */
export function formatEffectiveConfig(config: ProjectConfig, fromFile: boolean): string {
	const lines: string[] = [];
	
	lines.push(formatDivider(60));
	lines.push(`  📋 Spec Pipeline Configuration${fromFile ? " (from .pi/spec-pipeline.json)" : " (defaults)"}`);
	lines.push(formatDivider(60));
	lines.push("");
	
	// Model configurations
	lines.push("  Model Configurations:");
	lines.push(`    discoveryAgent    : ${formatModelConfig(config.models.discoveryAgent)}`);
	lines.push(`    specDrafter       : ${formatModelConfig(config.models.specDrafter)}`);
	lines.push(`    specReviewer      : ${formatTieredConfig(config.models.specReviewer)}`);
	lines.push(`    planDrafter       : ${formatModelConfig(config.models.planDrafter)}`);
	lines.push(`    planReviewer      : ${formatTieredConfig(config.models.planReviewer)}`);
	lines.push(`    implementer       : ${formatModelConfig(config.models.implementer)}`);
	lines.push(`    codeReviewer      : ${formatTieredConfig(config.models.codeReviewer)}`);
	lines.push(`    addressReview     : ${formatModelConfig(config.models.addressReview)}`);
	lines.push(`    commitMessageWriter: haiku/off (fixed)`);
	lines.push("");
	
	// Review cycles (per reviewer)
	lines.push("  Review Cycles (cheap/expensive):");
	const formatCycles = (cycles: { cheap: number; expensive: number }) => {
		if (cycles.cheap === 0 && cycles.expensive === 0) return "skipped";
		return `${cycles.cheap}/${cycles.expensive}`;
	};
	lines.push(`    specReviewer: ${formatCycles(config.reviewCycles.specReviewer)}`);
	lines.push(`    planReviewer: ${formatCycles(config.reviewCycles.planReviewer)}`);
	lines.push(`    codeReviewer: ${formatCycles(config.reviewCycles.codeReviewer)}`);
	lines.push("");
	
	lines.push(formatDivider(60));
	
	return lines.join("\n");
}

// ============================================
// Stage Formatting
// ============================================

/**
 * Format stage for display
 */
export function formatStage(stage: PipelineStage): string {
	const stageNames: Record<PipelineStage, string> = {
		discovery: "🔍 Discovery",
		spec_drafting: "📝 Spec Drafting",
		spec_review: "🔍 Spec Review",
		user_approval: "👤 Awaiting User Approval",
		plan_generation: "📋 Plan Generation",
		spec_commit: "💾 Spec Commit",
		implementation: "🚀 Implementation",
		completed: "✅ Completed",
		cancelled: "❌ Cancelled",
	};
	return stageNames[stage] || stage;
}

// ============================================
// Agent Output Formatting
// ============================================

/**
 * Generate a summary of agent output for persistent display
 * Extracts key information and truncates to reasonable length
 */
export function summarizeAgentOutput(output: string, maxLines: number = 10, maxChars: number = 800): string {
	if (!output || output.trim().length === 0) {
		return "(no output)";
	}
	
	const lines = output.trim().split("\n");
	
	// If output is short enough, return as-is
	if (lines.length <= maxLines && output.length <= maxChars) {
		return output.trim();
	}
	
	// Take first few and last few lines for context
	const headLines = Math.ceil(maxLines * 0.6);
	const tailLines = maxLines - headLines;
	
	let summary: string[] = [];
	
	if (lines.length > maxLines) {
		summary = [
			...lines.slice(0, headLines),
			`  ... (${lines.length - maxLines} lines omitted) ...`,
			...lines.slice(-tailLines)
		];
	} else {
		summary = lines;
	}
	
	let result = summary.join("\n");
	
	// Truncate if still too long
	if (result.length > maxChars) {
		result = result.slice(0, maxChars - 20) + "\n  ... (truncated)";
	}
	
	return result;
}

/**
 * Format agent completion notification
 */
export function formatAgentSummary(
	role: string,
	model: string,
	output: string,
	emoji: string = "✅",
	phase?: number,
	cycleInfo?: string
): string {
	const lines: string[] = [];
	let header = `${emoji} ${role} complete (${model})`;
	if (phase !== undefined) {
		header += ` [Phase ${phase}]`;
	}
	if (cycleInfo) {
		header += ` ${cycleInfo}`;
	}
	lines.push(header);
	lines.push("─── Output Summary ───");
	lines.push(summarizeAgentOutput(output));
	lines.push("─── End Summary ───");
	return lines.join("\n");
}

// ============================================
// Pipeline State Formatting
// ============================================

/**
 * Format state for display
 */
export function formatState(state: PipelineState): string {
	const lines: string[] = [];
	
	// Header section
	lines.push(formatDivider(50));
	lines.push(`  Pipeline: ${state.id || "unknown"}`);
	lines.push(formatDivider(50));
	lines.push("");
	
	// Basic info section
	lines.push("📋 Basic Information");
	const description = state.description || "(no description)";
	lines.push(formatKeyValue("  Description", description.slice(0, 50) + (description.length > 50 ? "..." : "")));
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
		const qaHistory = state.discovery.qaHistory || [];
		lines.push("");
		lines.push("🔍 Discovery");
		if (state.discovery.skipped) {
			lines.push("  Skipped (--quick mode)");
		} else if (state.stage === "discovery") {
			lines.push(formatKeyValue("  Round", `${state.discovery.currentRound}/${state.discovery.maxRounds}`));
			lines.push(formatKeyValue("  Q&A Exchanges", String(qaHistory.length)));
			if (qaHistory.length > 0) {
				const lastExchange = qaHistory[qaHistory.length - 1];
				const lastTime = new Date(lastExchange.timestamp).toISOString().slice(11, 19);
				lines.push(formatKeyValue("  Last Exchange", `Round ${lastExchange.round} at ${lastTime} UTC`));
			}
		} else if (state.discovery.completed && qaHistory.length > 0) {
			lines.push(formatKeyValue("  Status", `Completed (${qaHistory.length} exchanges)`));
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
	const phases = state.phases || [];
	const phasesGenerated = state.phasesGenerated || [];
	if (phases.length > 0) {
		lines.push("");
		lines.push("🏗️ Implementation Phases");
		const generatedCount = phasesGenerated.filter(Boolean).length;
		lines.push(formatKeyValue("  Total Phases", String(phases.length)));
		lines.push(formatKeyValue("  Plans Ready", `${generatedCount}/${phases.length}`));
		
		if (state.stage === "implementation") {
			lines.push(formatKeyValue("  Current Phase", `${state.currentPhaseIndex + 1}/${phases.length}`));
			// Show tiered review state if available
			if (state.currentReviewTier) {
				lines.push(formatKeyValue("  Review Tier", state.currentReviewTier));
				lines.push(formatKeyValue("  Cheap Cycles", String(state.cheapCyclesCompleted || 0)));
				lines.push(formatKeyValue("  Expensive Cycles", String(state.expensiveCyclesCompleted || 0)));
			} else {
				lines.push(formatKeyValue("  Review Cycle", String(state.currentReviewCycle)));
			}
			
			// Show phase names with progress indicators
			lines.push("");
			lines.push("  Phase Progress:");
			for (let i = 0; i < phases.length && i < 5; i++) {  // Limit to 5 phases for display
				const phase = phases[i] || "(unnamed phase)";
				const phaseName = phase.slice(0, 30) + (phase.length > 30 ? "..." : "");
				let status = "  ⬜";  // Pending
				if (i < state.currentPhaseIndex) {
					status = "  ✅";  // Completed
				} else if (i === state.currentPhaseIndex) {
					status = "  🔄";  // In progress
				}
				lines.push(`  ${status} Phase ${i + 1}: ${phaseName}`);
			}
			if (phases.length > 5) {
				lines.push(`    ... and ${phases.length - 5} more phases`);
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
			const emoji = getErrorEmoji(state.lastError.errorType);
			const content: string[] = [];
			
			content.push(formatKeyValue("Timestamp", state.lastError.timestamp));
			content.push(formatKeyValue("Agent", `${state.lastError.agent} (${state.lastError.role})`));
			
			if (state.lastError.phase !== undefined) {
				const totalPhases = (state.phases || []).length || "?";
				let phaseInfo = `${state.lastError.phase} of ${totalPhases}`;
				if (state.lastError.cycle !== undefined) {
					phaseInfo += `, Cycle ${state.lastError.cycle} of 3`;
				}
				content.push(formatKeyValue("Phase", phaseInfo));
			}
			
			content.push(formatKeyValue("Error Type", `${emoji} ${state.lastError.errorType}`));
			content.push(formatKeyValue("Exit Code", String(state.lastError.exitCode)));
			
			if (state.lastError.stderr) {
				content.push("");
				content.push("─── Error Message ───");
				const preview = state.lastError.stderr.length > 400 
					? state.lastError.stderr.slice(0, 400) + "..." 
					: state.lastError.stderr;
				for (const line of preview.split("\n").slice(0, 6)) {
					content.push(`  ${line.trim()}`);
				}
			}
			
			content.push("");
			content.push("─── Recovery ───");
			content.push(`  ${getErrorSuggestion(state.lastError.errorType)}`);
			
			lines.push(formatBox(`${emoji} Error Details`, content));
		}
	}
	
	lines.push("");
	lines.push(formatDivider(50));
	
	return lines.join("\n");
}

// ============================================
// Widget Management
// ============================================

/**
 * Update the persistent pipeline status widget
 * This widget stays visible during agent operations and survives terminal resize
 */
export function updatePipelineWidget(
	ctx: WidgetUIContext,
	state: PipelineState,
	currentAction?: string
): void {
	const lines: string[] = [];
	
	// Header
	const stateId = state.id || "unknown";
	lines.push(`📋 Pipeline: ${stateId.slice(0, 16)}...`);
	lines.push(formatDivider(40));
	
	// Stage indicator
	const stageEmoji: Record<PipelineStage, string> = {
		discovery: "🔍",
		spec_drafting: "📝",
		spec_review: "🔍",
		user_approval: "👤",
		plan_generation: "📋",
		spec_commit: "💾",
		implementation: "🚀",
		completed: "✅",
		cancelled: "❌",
	};
	lines.push(`Stage: ${stageEmoji[state.stage] || "▶"} ${formatStage(state.stage)}`);
	
	// Phase progress if in implementation
	const widgetPhases = state.phases || [];
	if (widgetPhases.length > 0 && state.stage === "implementation") {
		const completed = state.currentPhaseIndex;
		const total = widgetPhases.length;
		const progressBar = "█".repeat(completed) + "░".repeat(total - completed);
		lines.push(`Phases: [${progressBar}] ${completed + 1}/${total}`);
	}
	
	// Discovery progress if in discovery
	if (state.discovery && state.stage === "discovery" && !state.discovery.completed) {
		lines.push(`Discovery: Round ${state.discovery.currentRound}/${state.discovery.maxRounds}`);
	}
	
	// Current action
	if (currentAction) {
		lines.push(formatDivider(40));
		lines.push(`⏳ ${currentAction}`);
	}
	
	ctx.ui.setWidget(PIPELINE_WIDGET_ID, lines);
}

/**
 * Clear the pipeline status widget
 */
export function clearPipelineWidget(ctx: WidgetUIContext): void {
	ctx.ui.setWidget(PIPELINE_WIDGET_ID, undefined);
}
