/**
 * Metrics capture from pi subprocess JSON output
 * 
 * Pi emits JSON events to stdout when run with --mode json.
 * We parse these to extract:
 * - usage_stats: token counts per message
 * - message_update: assistant text output
 */

import type {
	AgentMetrics,
	IterationMetrics,
	ReviewCyclesMetrics,
	PiEvent,
	PiUsageStatsEvent,
} from "./types.ts";

// ============================================
// Metrics Accumulator
// ============================================

/**
 * Accumulates metrics during a pi subprocess run
 */
export class MetricsAccumulator {
	private inputTokens = 0;
	private outputTokens = 0;
	private output = "";
	private startTime: number;
	
	constructor() {
		this.startTime = Date.now();
	}
	
	/**
	 * Process a line of JSON output from pi
	 * Returns the text delta if this was a message_update event
	 */
	processLine(line: string): string | null {
		if (!line.trim()) return null;
		
		try {
			const event = JSON.parse(line) as PiEvent;
			return this.processEvent(event);
		} catch {
			// Ignore parse errors - pi may emit non-JSON diagnostic lines
			return null;
		}
	}
	
	/**
	 * Process a parsed pi event
	 */
	processEvent(event: PiEvent): string | null {
		if (event.type === "usage_stats") {
			const usageEvent = event as PiUsageStatsEvent;
			this.inputTokens += usageEvent.inputTokens || 0;
			this.outputTokens += usageEvent.outputTokens || 0;
			return null;
		}
		
		if (event.type === "message_update") {
			const msgEvent = event as { type: "message_update"; assistantMessageEvent?: { type: string; delta?: string } };
			if (msgEvent.assistantMessageEvent?.type === "text_delta" && msgEvent.assistantMessageEvent.delta) {
				const delta = msgEvent.assistantMessageEvent.delta;
				this.output += delta;
				return delta;
			}
		}
		
		return null;
	}
	
	/**
	 * Finalize and return captured metrics
	 */
	finalize(role: string, model: string, thinking: string): AgentMetrics {
		const endTime = Date.now();
		return {
			role,
			model,
			thinking,
			durationMs: endTime - this.startTime,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
		};
	}
	
	/**
	 * Get accumulated output text
	 */
	getOutput(): string {
		return this.output.trim();
	}
	
	/**
	 * Get current token counts (for partial results)
	 */
	getCurrentTokens(): { input: number; output: number } {
		return {
			input: this.inputTokens,
			output: this.outputTokens,
		};
	}
}

// ============================================
// Iteration Metrics Builder
// ============================================

/**
 * Builds iteration metrics from multiple agent runs
 */
export class IterationMetricsBuilder {
	private agentMetrics: AgentMetrics[] = [];
	private startTime: number;
	private reviewCycles: ReviewCyclesMetrics = {
		specReviewer: { cheap: 0, expensive: 0 },
		planReviewer: { cheap: 0, expensive: 0 },
		codeReviewer: { cheap: 0, expensive: 0 },
	};
	private phasesCompleted = 0;
	private testsOriginalPassed = false;
	private testsHiddenPassed = false;
	
	constructor() {
		this.startTime = Date.now();
	}
	
	/**
	 * Add metrics from an agent run
	 */
	addAgentMetrics(metrics: AgentMetrics): void {
		this.agentMetrics.push(metrics);
	}
	
	/**
	 * Record review cycles for a reviewer
	 */
	recordReviewCycles(
		reviewer: "specReviewer" | "planReviewer" | "codeReviewer",
		cheap: number,
		expensive: number
	): void {
		this.reviewCycles[reviewer] = { cheap, expensive };
	}
	
	/**
	 * Set phases completed count
	 */
	setPhasesCompleted(count: number): void {
		this.phasesCompleted = count;
	}
	
	/**
	 * Set test results
	 */
	setTestResults(originalPassed: boolean, hiddenPassed: boolean): void {
		this.testsOriginalPassed = originalPassed;
		this.testsHiddenPassed = hiddenPassed;
	}
	
	/**
	 * Build final iteration metrics
	 */
	build(): IterationMetrics {
		const totalDurationMs = Date.now() - this.startTime;
		const totalInputTokens = this.agentMetrics.reduce((sum, m) => sum + m.inputTokens, 0);
		const totalOutputTokens = this.agentMetrics.reduce((sum, m) => sum + m.outputTokens, 0);
		
		return {
			totalDurationMs,
			totalInputTokens,
			totalOutputTokens,
			agentMetrics: this.agentMetrics,
			reviewCycles: this.reviewCycles,
			phasesCompleted: this.phasesCompleted,
			testsOriginalPassed: this.testsOriginalPassed,
			testsHiddenPassed: this.testsHiddenPassed,
		};
	}
	
	/**
	 * Build partial metrics (for failed iterations)
	 */
	buildPartial(): IterationMetrics {
		return this.build();
	}
}

// ============================================
// Aggregation Functions (R20, R21, R22)
// ============================================

/**
 * Calculate percentile value from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	const index = (p / 100) * (sortedValues.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	const fraction = index - lower;
	
	if (lower === upper) {
		return sortedValues[lower];
	}
	return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

/**
 * Calculate median from array of values
 */
function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return percentile(sorted, 50);
}

/**
 * Calculate mean from array of values
 */
function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute aggregates from iteration results
 * Only includes successful iterations in calculations except for successRate (R22)
 */
export function computeAggregates(iterations: Array<{ success: boolean; metrics: IterationMetrics }>): {
	successRate: number;
	meanDurationMs: number;
	medianDurationMs: number;
	p95DurationMs: number;
	meanInputTokens: number;
	meanOutputTokens: number;
} {
	const totalIterations = iterations.length;
	const successful = iterations.filter(i => i.success);
	const successRate = totalIterations > 0 ? successful.length / totalIterations : 0;
	
	// If no successful iterations, return zeros
	if (successful.length === 0) {
		return {
			successRate,
			meanDurationMs: 0,
			medianDurationMs: 0,
			p95DurationMs: 0,
			meanInputTokens: 0,
			meanOutputTokens: 0,
		};
	}
	
	const durations = successful.map(i => i.metrics.totalDurationMs);
	const inputTokens = successful.map(i => i.metrics.totalInputTokens);
	const outputTokens = successful.map(i => i.metrics.totalOutputTokens);
	
	const sortedDurations = [...durations].sort((a, b) => a - b);
	
	return {
		successRate,
		meanDurationMs: mean(durations),
		medianDurationMs: median(durations),
		p95DurationMs: percentile(sortedDurations, 95),
		meanInputTokens: mean(inputTokens),
		meanOutputTokens: mean(outputTokens),
	};
}

// ============================================
// Empty/Default Metrics Helpers
// ============================================

/**
 * Create empty iteration metrics (for failed runs with no data)
 */
export function createEmptyIterationMetrics(): IterationMetrics {
	return {
		totalDurationMs: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		agentMetrics: [],
		reviewCycles: {
			specReviewer: { cheap: 0, expensive: 0 },
			planReviewer: { cheap: 0, expensive: 0 },
			codeReviewer: { cheap: 0, expensive: 0 },
		},
		phasesCompleted: 0,
		testsOriginalPassed: false,
		testsHiddenPassed: false,
	};
}
