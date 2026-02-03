# Per-Reviewer Cycle Configuration

**Status**: Implemented  
**Created**: 2026-01-31

## PART I: Requirements

### Problem Statement

**Business context**: The spec-pipeline extension uses a global review cycle configuration that applies identical cycle counts to all three tiered reviewers (specReviewer, planReviewer, codeReviewer). Users need finer control to optimize their workflows—some reviews may be unnecessary for certain projects, while others need more iterations.

**Current state**: The configuration format is:
```json
{
  "reviewCycles": { "cheap": 2, "expensive": 2 }
}
```
This applies to all three reviewer roles uniformly. There is no way to skip a review phase or tune cycles per reviewer.

**Key issues**:
1. Cannot skip unnecessary reviews (e.g., plan review for simple features)
2. Cannot allocate more review cycles to critical phases (e.g., code review) while reducing others
3. Forced to pay for review cycles even when not needed

### Requirements

**R1**: Support per-reviewer cycle configuration with the format:
```json
{
  "reviewCycles": {
    "specReviewer": { "cheap": 2, "expensive": 2 },
    "planReviewer": { "cheap": 0, "expensive": 0 },
    "codeReviewer": { "cheap": 2, "expensive": 1 }
  }
}
```

**R2**: When both `cheap` and `expensive` are 0 for a reviewer, skip that review phase entirely (no agent calls, no state transitions for review—proceed directly to next pipeline stage).

**R3**: When `cheap` is 0 but `expensive` > 0, skip the cheap tier entirely and run only the expensive tier review.

**R4**: When `cheap` > 0 but `expensive` is 0, run only the cheap tier with no expensive quality gate (approved by cheap = done).

**R5**: Maintain backward compatibility—the old global format `{ "cheap": 2, "expensive": 2 }` must continue to work and apply to all reviewers.

**R6**: The default configuration remains unchanged in behavior (cheap: 2, expensive: 2 for all reviewers).

**R7**: Display per-reviewer cycle counts in `formatEffectiveConfig` output.

**R8**: Allow minimum value of 0 for both cheap and expensive cycles (current schema requires minimum: 1).

### Success Criteria

- [x] Per-reviewer config format is validated and accepted
- [x] Old global format continues to work (backward compatibility)
- [x] Setting both cycles to 0 for a reviewer skips that review entirely
- [x] Setting cheap=0, expensive>0 runs only expensive tier
- [x] Setting cheap>0, expensive=0 runs only cheap tier
- [x] Effective config display shows per-reviewer cycle counts
- [ ] All existing tests pass (no test suite in project)
- [x] Unit tests verified configuration parsing logic

### Out of Scope

- Per-phase cycle configuration (e.g., different cycles for phase 1 vs phase 2)
- Dynamic cycle adjustment based on review outcomes
- UI changes beyond config display updates
- Changes to the review prompts or verdict parsing

### Open Questions

None—requirements are clear from the provided context.

---

## PART II: High-Level Implementation Plan

| Phase | Focus | Effort | Details |
|-------|-------|--------|---------|
| Phase 1 | Config schema and types | 0.5 days | [phase1_config_schema.md](./2601312019_per_reviewer_cycles/phase1_config_schema.md) |
| Phase 2 | Review loop logic | 0.5 days | [phase2_review_logic.md](./2601312019_per_reviewer_cycles/phase2_review_logic.md) |

### Architectural Guidance

**Config Schema Changes** (Phase 1):
- `ReviewCyclesConfigSchema` needs to accept a union type: either the old flat format OR an object with reviewer-specific settings
- The `mergeWithDefaults` function should normalize both formats into the per-reviewer structure internally
- `ProjectConfig.reviewCycles` type should reflect the per-reviewer structure

**Review Loop Changes** (Phase 2):
- `runTieredReview` receives the role parameter—use it to look up cycle counts from `projectConfig.reviewCycles[role]`
- Add early-return logic at the start of `runTieredReview` to handle skip cases:
  - Both 0: return immediately with APPROVED verdict
  - Cheap 0: skip cheap tier loop entirely
  - Expensive 0: return after cheap tier completes (regardless of verdict)
