# Add --no-review Argument to /implement Command

**Status**: Draft  
**Created**: 2026-02-10  
**Spec ID**: 2602102223

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

During rapid prototyping, bug fixes, or experimental changes, developers sometimes need to bypass the review system to iterate quickly without the overhead of plan and code reviews. While the review system provides valuable quality assurance, it adds latency and cost that may not be justified for all implementation scenarios.

Currently, users can configure review cycles globally in `.pi/spec-pipeline.json` or skip them entirely by setting `cheap: 0, expensive: 0` for each reviewer, but this requires editing the configuration file for temporary changes. This creates friction for workflows that alternate between "quality mode" and "fast mode."

#### Current State

**Existing Behavior:**

1. **Global Configuration**: Users configure review cycles in `.pi/spec-pipeline.json`:
   ```json
   {
     "reviewCycles": {
       "planReviewer": { "cheap": 2, "expensive": 2 },
       "codeReviewer": { "cheap": 2, "expensive": 2 }
     }
   }
   ```

2. **Review Process**: For each phase during `/implement`:
   - `planReviewer` reviews the generated implementation plan
   - `codeReviewer` reviews the implemented code
   - Both use tiered review (cheap → expensive model)
   - Reviews continue until `APPROVED` or max cycles reached

3. **Skip Mechanism**: Setting `cheap: 0, expensive: 0` causes the review to return `APPROVED` immediately (see `review.ts:176-185`)

4. **Existing Flag**: The `--no-plan` flag skips plan generation by modifying `projectConfig.skipPlanGeneration` in-memory

**Similar Pattern:**

The `/implement` command already supports `--no-plan` which:
- Is parsed from the argument string
- Modifies `projectConfig` in-memory (not persisted)
- Shows modified config with `formatEffectiveConfig()`
- Displays a notification: `"⏭️ Plan generation will be skipped (--no-plan flag)"`

#### Key Issues

| ID | Issue | Impact |
|----|-------|--------|
| I1 | No runtime flag to skip reviews | Must edit config file for temporary fast iteration |
| I2 | Config file changes persist across runs | Easy to forget to restore review settings |
| I3 | Inconsistent with `--no-plan` pattern | Missing parallel functionality for review skipping |

### 2. Requirements

#### Command-Line Interface

**R1**: The `/implement` command MUST accept a `--no-review` flag in addition to the existing `--no-plan` flag.

**R2**: The flag MUST be parsed from the argument string, allowing combinations:
- `/implement --no-review spec.md`
- `/implement --no-plan spec.md`
- `/implement --no-plan --no-review spec.md`
- `/implement --no-review --no-plan spec.md`

**R3**: The flag MUST be position-independent within the arguments (before or after other flags).

**R4**: The usage message MUST be updated to: `"Usage: /implement [--no-plan] [--no-review] <path-to-spec-file>"`

#### Configuration Override

**R5**: When `--no-review` is present, the system MUST set both reviewer cycles to zero in-memory:
```typescript
projectConfig.reviewCycles.planReviewer = { cheap: 0, expensive: 0 };
projectConfig.reviewCycles.codeReviewer = { cheap: 0, expensive: 0 };
```

**R6**: The configuration override MUST happen after loading the config from disk but before displaying it to the user.

**R7**: The override MUST NOT persist to `.pi/spec-pipeline.json` (in-memory only, same as `--no-plan`).

**R8**: The override MUST apply to the current implementation run only.

#### User Feedback

**R9**: After modifying the config, the system MUST display the effective configuration using the existing `formatEffectiveConfig()` function.

**R10**: The `formatEffectiveConfig()` output MUST show `"skipped"` for both reviewers when cycles are `0/0` (this behavior already exists).

**R11**: The system MUST display an explicit notification: `"⏭️ Reviews will be skipped (--no-review flag)"` (following the same pattern as `--no-plan`).

**R12**: The notification MUST appear after the configuration display and before starting the implementation.

#### Behavior Consistency

**R13**: The implementation MUST follow the same pattern as the `--no-plan` flag:
- Parse flag from argument string with `.includes()`
- Modify `projectConfig` object in-memory
- Display configuration with existing formatter
- Add explicit notification
- Proceed with normal pipeline execution

**R14**: When reviews are skipped (via flag or config), the existing review skip logic MUST be used (no new code paths).

**R15**: The review system's existing behavior of returning `APPROVED` for `0/0` cycles MUST remain unchanged.

### 3. Success Criteria

- [ ] `/implement --no-review spec.md` skips both plan and code reviews
- [ ] `/implement --no-plan --no-review spec.md` skips both plan generation and reviews
- [ ] Configuration display shows `"skipped"` for both reviewers when flag is used
- [ ] Explicit notification `"⏭️ Reviews will be skipped (--no-review flag)"` is displayed
- [ ] The `.pi/spec-pipeline.json` file is not modified
- [ ] Running `/implement spec.md` (without flag) uses normal review cycles from config
- [ ] The usage message includes both `--no-plan` and `--no-review` in the help text
- [ ] Implementation completes successfully without review cycles when flag is used

### 4. Out of Scope

- Skipping individual reviewers (e.g., `--no-plan-review` or `--no-code-review`)
- Persisting the flag's effect across `/implement-resume` operations
- Adding the flag to other commands (`/spec`, `/roadmap`, `/epic`)
- Modifying the global configuration file
- Adding configuration options to control the flag's behavior
- Changing the review system's core logic

### 5. Open Questions

None - all ambiguities were resolved during discovery.

---

## PART II: High-Level Implementation Plan

### Implementation Approach

This is a minimal change following the established `--no-plan` pattern. The implementation modifies only the `/implement` command handler in `extensions/spec-pipeline/index.ts`.

### Phase Overview

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Add --no-review flag parsing and configuration override | 0.5 days |
| Phase 2 | Add user notification and update usage message | 0.25 days |

### High-Level Guidance

**Pattern to Follow:**

The implementation should mirror the existing `--no-plan` implementation exactly:

1. **Flag Parsing** (line ~1844 in `index.ts`):
   ```typescript
   const noPlan = argsStr.includes("--no-plan");
   const noReview = argsStr.includes("--no-review");
   ```

2. **Config Override** (line ~1913 in `index.ts`):
   ```typescript
   if (noReview) {
       projectConfig.reviewCycles.planReviewer = { cheap: 0, expensive: 0 };
       projectConfig.reviewCycles.codeReviewer = { cheap: 0, expensive: 0 };
   }
   ```

3. **User Notification** (line ~1919 in `index.ts`):
   ```typescript
   if (noReview) {
       ctx.ui.notify("⏭️ Reviews will be skipped (--no-review flag)", "info");
   }
   ```

**Key Files:**

- `extensions/spec-pipeline/index.ts` - `/implement` command handler (only file needing changes)

**Existing Infrastructure to Reuse:**

- `formatEffectiveConfig()` already shows `"skipped"` for `0/0` cycles
- `runTieredReview()` already returns `APPROVED` immediately for `0/0` cycles
- Flag argument string removed from `specPath` (same as `--no-plan`)

**Testing Approach:**

- Manual testing with various flag combinations
- Verify configuration display shows "skipped"
- Verify notification appears
- Verify no review cycles execute
- Verify config file unchanged after run
