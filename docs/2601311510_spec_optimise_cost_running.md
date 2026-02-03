# Technical Specification: Cost Optimization for Spec-Pipeline

**Status**: Draft  
**Created**: 2026-01-31  
**Spec ID**: 2601311510

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The spec-pipeline extension provides an automated specification → implementation workflow using AI agents. Currently, the pipeline uses the most expensive model configuration (Claude Opus with high thinking) for nearly every operation, including read-only tasks like reviews and question generation. This results in unnecessarily high API costs, particularly for operations that don't require the full reasoning capabilities of Opus.

Cost optimization is critical for making the pipeline economically viable for frequent use across multiple projects and features.

#### Current State

The spec-pipeline currently has these agent configurations (`extensions/spec-pipeline/index.ts`):

| Role | Current Model | Current Thinking | Cost Level |
|------|---------------|------------------|------------|
| discoveryAgent | Opus | High | 💰💰💰 |
| specDrafter | Opus | High | 💰💰💰 |
| specReviewer | Opus | High | 💰💰💰 |
| planDrafter | Opus | High | 💰💰💰 |
| planReviewer | Opus | High | 💰💰💰 |
| implementer | Opus | High | 💰💰💰 |
| codeReviewer | Opus | High | 💰💰💰 |
| addressReview | Opus | High | 💰💰💰 |
| commitMessageWriter | Haiku | Off | 💰 |

**Key observations:**
- Sonnet is defined in `agents-config.mts` but never used despite comments suggesting "Sonnet reviews"
- All review operations use Opus despite being read-only analysis tasks
- Discovery agent uses Opus but only generates clarifying questions
- Fixed `REVIEW_CYCLES = 3` regardless of whether issues are found
- No configuration options for model selection - all hardcoded
- No early termination when reviews find no issues

#### Key Issues

| ID | Issue | Impact |
|----|-------|--------|
| I1 | Reviews use Opus unnecessarily | High cost for read-only analysis tasks |
| I2 | Discovery agent uses Opus | Expensive for question generation |
| I3 | No tiered review strategy | Can't balance cost vs. quality |
| I4 | Fixed review cycles | Wastes API calls when no issues found |
| I5 | No model configuration | Users can't adjust cost/quality trade-offs |
| I6 | No thinking level configuration | Cannot fine-tune costs per role |

### 2. Requirements

#### Configuration System Requirements

**R1**: The pipeline SHALL support model and thinking level configuration per role via `.pi/spec-pipeline.json`. For reviewer roles, separate `cheap` and `expensive` tier configurations SHALL be supported:

```json
{
  "models": {
    "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
    "specDrafter": { "model": "opus", "thinking": "high" },
    "specReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "planDrafter": { "model": "opus", "thinking": "high" },
    "planReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "implementer": { "model": "opus", "thinking": "high" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    },
    "addressReview": { "model": "opus", "thinking": "high" }
  },
  "reviewCycles": {
    "cheap": 2,
    "expensive": 2
  }
}
```

**R2**: Model and thinking level SHALL be decoupled, allowing independent configuration:
- `model`: "opus" | "sonnet" | "haiku"
- `thinking`: "high" | "medium" | "off"

**R3**: When configuration is missing for a role, the pipeline SHALL use optimized defaults (not current Opus-everywhere behavior).

**R4**: When configuration is corrupt or invalid, the pipeline SHALL return an error and refuse to run.

**R5**: When configuration is partially specified, the pipeline SHALL fill missing roles with optimized defaults and display the resulting configuration at startup.

**R5a**: If `commitMessageWriter` appears in the `models` configuration, it SHALL be silently ignored (this role is fixed at Haiku and not configurable).

#### Tiered Review Requirements

**R6**: The pipeline SHALL support a tiered review approach where:
1. A cheaper model (e.g., Sonnet) performs initial review(s)
2. A more capable model (e.g., Opus) performs final review(s) as a quality gate

**R7**: The expensive model SHALL perform an independent targeted review, focusing on areas the cheaper model might miss (not just validating the cheap model's verdict).

**R8**: When the expensive model outputs a negative verdict, fixes SHALL be reviewed by the expensive model only (stay at expensive tier until approved).

**R9**: The number of review cycles for cheap and expensive models SHALL be separately configurable via the `reviewCycles` configuration (see R1).

**R10**: Tiered reviews SHALL apply to all three review types:
- Spec reviews (specReviewer)
- Plan reviews (planReviewer)  
- Code reviews (codeReviewer)

#### Verdict Parsing Requirements

**R11**: All review agent prompts SHALL be standardized to use consistent verdict terminology:
- `APPROVED` - No issues found, proceed
- `NEEDS_CHANGES` - Issues found, needs iteration

This requires updating the existing prompts which currently use inconsistent terminology:
- specReviewer: already uses `APPROVED | NEEDS_CHANGES` ✓
- planReviewer: currently uses `READY | NEEDS_WORK` → change to `APPROVED | NEEDS_CHANGES`
- codeReviewer: currently uses `APPROVED | CHANGES_REQUESTED` → change to `APPROVED | NEEDS_CHANGES`

**R12**: The pipeline SHALL parse the verdict from review output to determine whether to:
- Continue to next cycle (if `NEEDS_CHANGES` in cheap tier)
- Escalate to expensive tier (after cheap cycles complete)
- Proceed to next phase (if `APPROVED` in expensive tier)

**R13**: If no clear verdict is found in review output, the pipeline SHALL default to `NEEDS_CHANGES` (conservative behavior).

#### Default Configuration Requirements

**R14**: The optimized default configuration SHALL be:

| Role | Tier | Default Model | Default Thinking | Rationale |
|------|------|---------------|------------------|-----------|
| discoveryAgent | - | Sonnet | Medium | Question generation doesn't need Opus |
| specDrafter | - | Opus | High | Complex synthesis task |
| specReviewer | cheap | Sonnet | Medium | Initial review pass |
| specReviewer | expensive | Opus | High | Final quality gate |
| planDrafter | - | Opus | High | Complex planning task |
| planReviewer | cheap | Sonnet | Medium | Initial review pass |
| planReviewer | expensive | Opus | High | Final quality gate |
| implementer | - | Opus | High | Complex code generation |
| codeReviewer | cheap | Sonnet | Medium | Initial code review |
| codeReviewer | expensive | Opus | High | Final quality gate |
| addressReview | - | Opus | High | Complex fix implementation |
| commitMessageWriter | - | Haiku | Off | Simple formatting task (fixed) |

**R15**: Default review cycles SHALL be:
- Cheap model cycles: 2
- Expensive model cycles: 2

**R16**: The commit message writer (Haiku) SHALL remain fixed and not be configurable - it's already optimal.

#### Backward Compatibility Requirements

**R17**: Existing pipelines without model configuration SHALL use the new optimized defaults.

**R18**: The configuration schema SHALL be validated using TypeBox, consistent with existing config validation.

### 3. Review Flow Specification

The tiered review flow operates as follows:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TIERED REVIEW FLOW                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────┐                          │
│  │         CHEAP TIER (Sonnet)          │                          │
│  │  Cycles: 1..N (configurable, def=2)  │                          │
│  └──────────────┬───────────────────────┘                          │
│                 │                                                   │
│                 ▼                                                   │
│         ┌──────────────┐                                           │
│         │    Review    │                                           │
│         └──────┬───────┘                                           │
│                │                                                   │
│       ┌────────┴────────┐                                          │
│       ▼                 ▼                                          │
│   APPROVED         NEEDS_CHANGES                                   │
│       │                 │                                          │
│       │                 ▼                                          │
│       │         ┌──────────────┐                                   │
│       │         │  Apply Fix   │                                   │
│       │         └──────┬───────┘                                   │
│       │                │                                          │
│       │                ▼                                          │
│       │         More cheap cycles?                                 │
│       │           Yes: loop back to Review                         │
│       │           No: proceed to expensive tier                    │
│       │                │                                          │
│       ▼                ▼                                          │
│  ┌──────────────────────────────────────┐                          │
│  │       EXPENSIVE TIER (Opus)          │                          │
│  │  Cycles: 1..M (configurable, def=2)  │                          │
│  └──────────────┬───────────────────────┘                          │
│                 │                                                   │
│                 ▼                                                   │
│         ┌──────────────┐                                           │
│         │    Review    │◄─────────────────────┐                    │
│         └──────┬───────┘                      │                    │
│                │                              │                    │
│       ┌────────┴────────┐                     │                    │
│       ▼                 ▼                     │                    │
│   APPROVED         NEEDS_CHANGES              │                    │
│       │                 │                     │                    │
│       │                 ▼                     │                    │
│       │         ┌──────────────┐              │                    │
│       │         │  Apply Fix   │              │                    │
│       │         └──────┬───────┘              │                    │
│       │                │                      │                    │
│       │                ▼                      │                    │
│       │         More expensive cycles?        │                    │
│       │           Yes: ────────────────────────┘                    │
│       │           No: proceed (max cycles reached)                 │
│       │                                                            │
│       ▼                                                            │
│  ┌──────────────────────────────────────┐                          │
│  │         PROCEED TO NEXT PHASE        │                          │
│  └──────────────────────────────────────┘                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

KEY BEHAVIORS:
• Cheap model approval → still escalates to expensive tier for final QA
• Expensive model rejection → fixes stay at expensive tier (never back to cheap)
• Max cycles reached in any tier → proceed anyway (avoid infinite loops)
```

### 4. Success Criteria

- [ ] Model and thinking level are configurable per role via `.pi/spec-pipeline.json`
- [ ] Tiered review configuration supports separate cheap/expensive model settings per reviewer role
- [ ] Tiered review system works for spec, plan, and code reviews
- [ ] Cheap model runs first, expensive model runs as final quality gate
- [ ] Review cycles are separately configurable for cheap and expensive tiers
- [ ] When expensive model finds issues, fixes stay at expensive tier until approved
- [ ] Discovery agent defaults to Sonnet (cost reduction)
- [ ] All review roles default to tiered approach (Sonnet → Opus)
- [ ] Review prompts standardized to use `APPROVED | NEEDS_CHANGES` verdict format
- [ ] Verdicts are parsed from review outputs to drive flow control
- [ ] Missing config values filled with optimized defaults
- [ ] `commitMessageWriter` in config is silently ignored
- [ ] Corrupt/invalid config returns clear error
- [ ] Existing pipelines continue to work (backward compatible)
- [ ] Configuration displayed at pipeline startup shows effective settings

### 5. Out of Scope

- **Cost tracking/metrics**: No token counting or cost estimation display (future enhancement)
- **A/B testing**: No shadow mode comparison between models
- **Per-phase model configuration**: Models are configured per role, not per phase
- **Dynamic model selection**: No runtime switching based on task complexity
- **Custom model endpoints**: Only supports built-in Opus/Sonnet/Haiku
- **Automatic retry with model fallback**: No upgrading model on failure
- **User-defined review prompts**: Uses existing system prompts (only verdict terminology updated)
- **Quality scoring**: No automated measurement of review quality
- **Commit message writer configuration**: Stays fixed at Haiku

### 6. Open Questions

1. ~~Should cheap model approval skip the expensive review entirely?~~  
   → **Resolved**: No. Always run expensive model as final quality gate.

2. ~~Should tiered reviews apply to all review types?~~  
   → **Resolved**: Yes, apply to spec, plan, and code reviews.

3. ~~Should discovery agent switch to Sonnet?~~  
   → **Resolved**: Yes, Sonnet is sufficient for question generation.

4. ~~How should expensive model review after cheap model?~~  
   → **Resolved**: Independent targeted review focusing on areas cheap model might miss.

5. ~~What happens after expensive model finds issues and fix is applied?~~  
   → **Resolved**: Stay at expensive tier for subsequent reviews until approved.

6. ~~Should commit message writer be configurable?~~  
   → **Resolved**: No, keep fixed at Haiku.

7. ~~How should missing config be handled?~~  
   → **Resolved**: Fill with optimized defaults and display effective configuration.

8. ~~What happens if user configures commitMessageWriter?~~  
   → **Resolved**: Silently ignored.

9. ~~What verdict terminology should be used?~~  
   → **Resolved**: Standardize all prompts to `APPROVED | NEEDS_CHANGES`.

---

## PART II: High-Level Implementation Plan

### Architectural Guidance

**Configuration Schema Extension**: Extend the existing TypeBox-based config schema to include model configuration. Reviewer roles use a nested structure with `cheap` and `expensive` tiers. Non-reviewer roles use a flat `{ model, thinking }` structure.

**Tiered Review Pattern**: Create a reusable function for tiered reviews that encapsulates:
1. Run cheap model for N cycles (until APPROVED or max cycles)
2. Run expensive model for M cycles (until APPROVED or max cycles)
3. Handle the "stay at expensive tier for fixes" logic

**Verdict Standardization**: Update planReviewer and codeReviewer prompts to use `APPROVED | NEEDS_CHANGES` instead of their current inconsistent terminology. Add parsing logic to extract verdict from output.

**Backward Compatibility**: The `loadState()` function already handles state migration. Config loading should similarly apply defaults for missing values.

### Implementation Phases

| Phase | Focus | Effort | Details |
|-------|-------|--------|---------|
| Phase 1 | Configuration schema and loading | 1 day | [phase1_config_schema.md](./2601311510_cost_optimization/phase1_config_schema.md) |
| Phase 2 | Verdict standardization and parsing | 1 day | [phase2_verdict_parsing.md](./2601311510_cost_optimization/phase2_verdict_parsing.md) |
| Phase 3 | Tiered review implementation | 2 days | [phase3_tiered_reviews.md](./2601311510_cost_optimization/phase3_tiered_reviews.md) |
| Phase 4 | Discovery agent optimization and defaults | 0.5 days | [phase4_discovery_defaults.md](./2601311510_cost_optimization/phase4_discovery_defaults.md) |

**Total Estimated Effort**: 4.5 days

### Technical Constraints

1. **TypeBox validation**: Config schema must use TypeBox for consistency with existing validation
2. **Prompt updates**: planReviewer and codeReviewer prompts need verdict terminology updates
3. **State compatibility**: Configuration changes must not break existing pipeline states
4. **Agent spawning**: Model/thinking passed via CLI args to `pi` subprocess
5. **Role restrictions**: Maintain existing tool restrictions (write roles vs read-only roles)
6. **Single pipeline**: Only one active pipeline per project (existing limitation preserved)
