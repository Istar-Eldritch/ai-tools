# Technical Specification: Spec-Pipeline Benchmark Tool

**Status**: Draft  
**Created**: 2026-02-02  
**Spec ID**: 2602020046

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The spec-pipeline extension automates the specification → implementation workflow using AI agents. Currently, there is no systematic way to measure or compare:

- **Speed**: How long different model/thinking configurations take to complete pipelines
- **Cost**: How much each configuration costs in terms of API tokens
- **Quality**: Whether the implementation actually works (compiles, tests pass, meets spec)

Optimization decisions are made without data. Users cannot compare configurations like "opus-high everywhere" vs. "sonnet-medium for reviews + opus-high for implementation" to find the best cost/quality balance.

#### Current State

The spec-pipeline (`extensions/spec-pipeline/`) supports:
- 8 configurable roles with model/thinking combinations
- Tiered review system (cheap → expensive models)
- Configurable review cycles per reviewer
- Discovery, spec drafting, plan generation, and implementation phases

**Key gaps:**
| ID | Gap | Impact |
|----|-----|--------|
| G1 | No metrics capture | Cannot measure execution time or token usage per agent |
| G2 | No standardized test scenarios | Cannot reproduce results across configurations |
| G3 | No quality measurement | Cannot verify implementations meet specifications |
| G4 | No comparison tooling | Cannot rank configurations by performance |
| G5 | Interactive steps block automation | Discovery and approval require human input |

#### Key Issues

| ID | Issue | Impact |
|----|-------|--------|
| I1 | No baseline measurements | Cannot quantify optimization improvements |
| I2 | Unknown cost/quality tradeoffs | Expensive models may be unnecessary for some roles |
| I3 | No regression detection | Configuration changes may degrade quality unnoticed |
| I4 | Manual testing only | Comparing permutations requires significant human effort |

### 2. Requirements

#### Benchmark Tool Requirements

**R1**: The benchmark tool SHALL be an independent CLI tool (not integrated into spec-pipeline extension).

**R2**: The tool SHALL accept a JSON configuration file defining:
- Test fixtures to run (paths to fixture directories)
- Model/thinking permutations to test
- Number of iterations per permutation
- Output directory for results

**R3**: The tool SHALL clone/copy the target project for each benchmark run to ensure isolation. The original project SHALL NOT be modified.

**R3a**: For git URLs specified in `fixture.json`, the tool SHALL use `git clone` with the optional `projectRef` as the checkout target (branch/tag).

**R3b**: For local paths or the `project/` subdirectory, the tool SHALL perform a recursive copy to the temp directory.

**R4**: The tool SHALL run benchmarks sequentially (one configuration at a time) to avoid resource contention and port conflicts.

**R5**: The tool SHALL support aborting benchmark runs cleanly via SIGINT, discarding partial results for the current run.

#### Fixture Requirements

**R6**: A benchmark fixture SHALL be a directory containing:
```
fixture_name/
├── fixture.json           # Fixture metadata
├── feature.md             # Feature description (fed to pipeline)
├── discovery.json         # Pre-scripted Q&A responses (optional)
├── hidden-tests/          # Tests added post-implementation
│   └── ... (test files)
└── project/               # Project source (optional, see R6a)
```

**R6a**: The `project` field in `fixture.json` MAY specify either:
- A local path to clone from (absolute or relative to fixture)
- A git URL to clone from
- Omitted if `project/` subdirectory contains the project files

**R7**: The `fixture.json` SHALL contain:
```json
{
  "name": "Feature Name",
  "description": "What this fixture tests",
  "project": "/path/to/project" | "git@github.com:org/repo",
  "projectRef": "branch-or-tag",  // optional, default: HEAD
  "testCommand": "npm test",      // override if needed
  "hiddenTestsTarget": "tests/hidden/",  // where to copy hidden-tests
  "timeout": 3600                 // max seconds per run (optional)
}
```

**R8**: The `discovery.json` SHALL contain pre-scripted responses:
```json
{
  "rounds": [
    {
      "answers": "Response to round 1 questions..."
    },
    {
      "answers": "Response to round 2 questions..."
    }
  ],
  "earlyFinish": true  // Optional: finish discovery after provided rounds
}
```

**R9**: Hidden tests SHALL be copied into the project AFTER the final code review cycle completes but BEFORE the final verification step.

**R9a**: After copying hidden tests, the tool SHALL run `testCommand` once to verify all tests (original + hidden) pass.

#### Metrics Requirements

**R10**: The tool SHALL capture per-agent metrics:
- Wall-clock duration (seconds)
- Input tokens
- Output tokens
- Model used
- Thinking level used

**R11**: The tool SHALL capture per-pipeline metrics:
- Total wall-clock duration
- Total input tokens (sum across all agents)
- Total output tokens (sum across all agents)
- Review cycles needed (per reviewer role)
- Phases completed
- Final result (success/failure)

**R12**: The tool SHALL extract token counts from pi's JSON output stream (`usage_stats` events).

**R12a**: The benchmark tool SHALL spawn pi directly (not via spec-pipeline's `runAgentWithConfig`) to parse and capture `usage_stats` events from the JSON output stream. This avoids modifying spec-pipeline internals.

**R13**: The tool SHALL NOT calculate costs directly. Raw token counts per model SHALL be stored, allowing post-processing with current pricing.

#### Quality Verification Requirements

**R14**: A benchmark run SHALL be considered successful if:
- The pipeline completes without errors
- The project compiles/lints (if applicable)
- The original test suite passes
- The hidden tests pass (after being added)

**R15**: Hidden tests SHALL be added by copying files from `hidden-tests/` to the configured `hiddenTestsTarget` directory.

**R15a**: Hidden tests are copied AFTER the final code review cycle completes but BEFORE the final verification run.

**R15b**: After copying hidden tests, the tool SHALL run `testCommand` once to verify all tests (original + hidden) pass.

**R16**: If hidden tests cannot be added (invalid path, permission error), the run SHALL be marked as failed with reason "hidden_tests_setup_failed".

#### Result Storage Requirements

**R17**: Results SHALL be stored in JSON format (one file per benchmark session):
```json
{
  "sessionId": "uuid",
  "startedAt": "ISO8601",
  "completedAt": "ISO8601",
  "config": { /* benchmark config */ },
  "permutations": [
    {
      "name": "all-sonnet",
      "config": { /* spec-pipeline config */ },
      "iterations": [
        {
          "iterationId": 1,
          "fixture": "typescript-api",
          "startedAt": "ISO8601",
          "completedAt": "ISO8601",
          "success": true,
          "failureReason": null,
          "metrics": {
            "totalDurationMs": 180000,
            "totalInputTokens": 45000,
            "totalOutputTokens": 12000,
            "agentMetrics": [
              {
                "role": "discoveryAgent",
                "model": "sonnet",
                "thinking": "medium",
                "durationMs": 5000,
                "inputTokens": 2000,
                "outputTokens": 500
              }
            ],
            "reviewCycles": {
              "specReviewer": { "cheap": 2, "expensive": 1 },
              "planReviewer": { "cheap": 1, "expensive": 1 },
              "codeReviewer": { "cheap": 2, "expensive": 2 }
            },
            "phasesCompleted": 3,
            "testsOriginalPassed": true,
            "testsHiddenPassed": true
          }
        }
      ],
      "aggregates": {
        "successRate": 1.0,
        "meanDurationMs": 180000,
        "medianDurationMs": 180000,
        "p95DurationMs": 180000,
        "meanInputTokens": 45000,
        "meanOutputTokens": 12000
      }
    }
  ]
}
```

**R17a**: Aggregates are computed across all fixtures for each permutation. Per-fixture analysis requires filtering iterations by fixture name in the `iterations` array.

**R18**: Each benchmark session SHALL create a new results file: `benchmark_<sessionId>.json`.

**R19**: Failed iterations SHALL have `success: false` and `failureReason` set. Failed iterations SHALL have metrics for completed agents only.

#### Aggregation Requirements

**R20**: For each permutation, the tool SHALL compute:
- Success rate (completed iterations / total iterations)
- Mean, median, and 95th percentile duration
- Mean input/output tokens
- Mean review cycles per reviewer

**R21**: Permutations with 0% success rate SHALL be flagged as "unsuitable" but still included in results.

**R22**: Aggregations SHALL only include successful iterations. Failed iterations contribute only to the success rate calculation.

#### Benchmark Configuration Requirements

**R23**: The benchmark configuration file SHALL support:
```json
{
  "fixtures": [
    { "path": "./fixtures/typescript-api" },
    { "path": "/absolute/path/to/fixture" }
  ],
  "permutations": [
    {
      "name": "all-sonnet",
      "models": {
        "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
        "specDrafter": { "model": "sonnet", "thinking": "high" },
        "specReviewer": {
          "cheap": { "model": "sonnet", "thinking": "medium" },
          "expensive": { "model": "sonnet", "thinking": "high" }
        },
        /* ... other roles ... */
      },
      "reviewCycles": { "cheap": 2, "expensive": 1 }
    },
    {
      "name": "opus-high",
      "models": { /* ... */ }
    }
  ],
  "iterations": 3,
  "outputDir": "./benchmark-results",
  "parallelism": 1  // Reserved for future use, must be 1
}
```

**R24**: Missing model configurations in a permutation SHALL use spec-pipeline's default configurations.

**R25**: The tool SHALL validate the benchmark configuration before starting and report clear errors for invalid configs.

#### Automation Requirements

**R26**: The tool SHALL bypass spec-pipeline's interactive prompts:
- Discovery Q&A: Use pre-scripted responses from `discovery.json`
- User approval: Auto-approve after tiered review completes

**R26a**: The tool SHALL provide a mock implementation of `PipelineUIContext` that returns scripted responses for all interactive prompts (discovery answers, approvals, editor callbacks).

**R27**: The tool SHALL set a timeout per iteration (configurable, default 1 hour). Timed-out iterations SHALL be marked as failed with reason "timeout".

**R28**: The tool SHALL provide progress output showing:
- Current permutation and iteration
- Current pipeline stage
- Elapsed time

### 3. Success Criteria

- [ ] Benchmark tool runs independently of pi/spec-pipeline
- [ ] Fixtures with feature descriptions and hidden tests can be created
- [ ] Pre-scripted discovery responses work for automated runs
- [ ] Per-agent metrics (time, tokens) are captured from pi's JSON output
- [ ] Per-pipeline metrics are aggregated correctly
- [ ] Hidden tests are copied and executed post-implementation
- [ ] Results stored in structured JSON format
- [ ] Aggregations computed correctly for successful iterations
- [ ] Failed iterations tracked with failure reasons
- [ ] Multiple permutations can be compared in one session
- [ ] Interrupted benchmarks discard partial results cleanly
- [ ] Timeouts terminate stuck iterations appropriately

### 4. Out of Scope

- **Cost calculation**: Only raw token counts stored; pricing changes frequently
- **Real-time dashboard**: Progress shown via CLI output only
- **Parallel execution**: Sequential only (parallelism reserved for future)
- **Resume capability**: Interrupted sessions start fresh
- **Automatic retries**: Failed iterations count as failures
- **Semantic quality scoring**: Quality is binary (tests pass/fail)
- **Built-in fixture generation**: Fixtures created manually
- **Model performance profiling**: Only wall-clock time measured
- **Integration with CI/CD**: CLI tool only

### 5. Open Questions

1. ~~Should the benchmark modify spec-pipeline to support automation flags?~~  
   → **Resolved**: No. Create a wrapper that intercepts/mocks UI interactions.

2. ~~How to handle discovery responses when questions vary per model?~~  
   → **Resolved**: Pre-scripted responses are generic; the agent adapts its questions. Responses should be comprehensive enough to answer likely questions.

3. ~~Should we support comparing across different fixtures?~~  
   → **Resolved**: Yes, a permutation runs against all fixtures. Results grouped by permutation, then by fixture.

4. ~~How to extract token usage from pi subprocess?~~  
   → **Resolved**: The benchmark tool spawns pi directly and parses `usage_stats` events from pi's JSON output stream. This does not require modifying spec-pipeline's `runAgentWithConfig`.

5. ~~What happens if a permutation consistently fails?~~  
   → **Resolved**: It gets 0% success rate and is flagged as "unsuitable" in results.

---

## PART II: High-Level Implementation Plan

### Architectural Guidance

**Tool Structure**: The benchmark tool will be a standalone TypeScript CLI in `extensions/spec-bench/`. This placement is consistent with the project's existing TypeScript extension structure, even though spec-bench is a standalone CLI rather than a pi plugin. The `extensions/` directory already contains TypeScript modules, and maintaining a single directory for TypeScript tooling simplifies project organization.

The tool will:
1. Import and use spec-pipeline's state management and configuration types
2. Spawn pi directly (not via `runAgentWithConfig`) to capture full JSON output including `usage_stats` events
3. Intercept UI callbacks to provide scripted responses via a mock `PipelineUIContext`

**Agent Metrics Capture**: The benchmark tool spawns pi directly with `--mode json` and parses the stdout stream. For each line:
1. Parse as JSON
2. If event type is `usage_stats`, extract `inputTokens` and `outputTokens`
3. If event type is `message_update`, extract assistant response text
4. Sum tokens across the entire conversation for each agent invocation

This approach requires no modifications to spec-pipeline's `runAgentWithConfig` function.

**Fixture Isolation**: Each iteration needs a clean project clone:
1. Copy project to temp directory (recursive copy for local paths, git clone for URLs)
2. Run pipeline in temp directory
3. After final code review cycle completes, copy hidden tests to target directory
4. Run test command to verify all tests pass
5. Delete temp directory

**UI Mocking**: Create a mock `PipelineUIContext` that:
- Returns pre-scripted discovery answers from `discovery.json`
- Auto-approves spec after review (returns "approve" for selection prompts)
- Auto-confirms all prompts (returns `true` for confirm prompts)
- Logs notifications without user interaction

```typescript
function createBenchmarkUIContext(fixture: Fixture): PipelineUIContext {
  let discoveryRound = 0;
  return {
    ui: {
      notify: (msg, type) => console.log(`[${type}] ${msg}`),
      confirm: async () => true, // Auto-approve
      editor: async (title) => {
        // Return scripted discovery answers
        if (title.includes("Discovery Round")) {
          const answer = fixture.discovery.rounds[discoveryRound++];
          return answer?.answers ?? "done";
        }
        return "";
      },
      select: async () => "approve",
      setWidget: () => {},
    }
  };
}
```

This mock implementation satisfies R26a and allows running the pipeline without human interaction.

### Implementation Phases

| Phase | Focus | Effort | Details |
|-------|-------|--------|---------|
| Phase 1 | Core infrastructure and fixture handling | 2 days | [phase1_infrastructure.md](./2602020046_spec_bench/phase1_infrastructure.md) |
| Phase 2 | Metrics capture from pi subprocess | 2 days | [phase2_metrics_capture.md](./2602020046_spec_bench/phase2_metrics_capture.md) |
| Phase 3 | Benchmark execution and automation | 2 days | [phase3_benchmark_execution.md](./2602020046_spec_bench/phase3_benchmark_execution.md) |
| Phase 4 | Results aggregation and reporting | 1 day | [phase4_results_reporting.md](./2602020046_spec_bench/phase4_results_reporting.md) |
| Phase 5 | Sample fixtures and validation | 1 day | [phase5_fixtures_validation.md](./2602020046_spec_bench/phase5_fixtures_validation.md) |

**Total Estimated Effort**: 8 days

### Technical Constraints

1. **Sequential execution**: No parallel runs to avoid port/resource conflicts
2. **Isolation**: Each run uses a fresh project clone; original never modified
3. **JSON output mode**: Must use pi's `--mode json` to capture structured events
4. **TypeScript**: Tool written in TypeScript, consistent with spec-pipeline
5. **No spec-pipeline modification**: Benchmark tool spawns pi directly for metrics capture; no changes to `runAgentWithConfig` required
6. **Cost account scoping**: User's API account has spending caps; tool doesn't manage this

### Metrics Extraction Strategy

Pi's JSON output includes events like:
```json
{"type": "usage_stats", "inputTokens": 1234, "outputTokens": 567, ...}
```

The benchmark tool will:
1. Spawn pi directly with `--mode json`
2. Parse each line of pi's stdout as JSON
3. Extract `usage_stats` events for token counts
4. Extract `message_update` events for assistant output
5. Sum tokens across the conversation
6. Record model/thinking from CLI args used

This approach captures full metrics without modifying spec-pipeline internals.

### Automation Strategy

The benchmark tool implements a mock `PipelineUIContext` (as shown in Architectural Guidance above) that:
- Returns pre-scripted discovery answers by round index
- Auto-approves all confirmation and selection prompts
- Logs notifications to stdout for debugging

This mock satisfies R26a and enables fully automated pipeline execution.
