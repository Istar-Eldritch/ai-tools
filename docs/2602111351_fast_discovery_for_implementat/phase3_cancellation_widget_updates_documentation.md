# Phase 3: Cancellation, Widget Updates, and Documentation

**Estimated Effort**: 0.5 days

## Overview

Phase 3 completes the implement-discovery feature by ensuring all UI/UX touchpoints and documentation are updated to reflect the new discovery mode capabilities. This phase is primarily documentation-focused, as the core cancellation and widget update logic were already implemented in Phases 1 and 2.

## Prerequisites

- Phase 1 complete (unified discovery prompt and `/discovery-done`)
- Phase 2 complete (implement discovery mode)
- All 337 existing tests passing

## Current State Analysis

Based on codebase exploration:

**Already Implemented:**
- `/implement-cancel` already handles discovery phase cancellation (index.ts lines 2402-2407)
- `updateModeWidget()` already handles `activePipelineKind === "implement"` in discovery mode (index.ts lines 705-717)

**Needs Implementation:**
- Update header comment in index.ts to document `/implement <description>` usage
- Update `/implement` command description string
- Update README.md with comprehensive documentation of new discovery mode
- Add examples showing both file path and description usage patterns

## Steps

### Step 3.1: Verify Cancellation Logic (Already Implemented)

- **Files**: `extensions/spec-pipeline/index.ts` (lines 2393-2448)
- **Pattern Reference**: `/plan-cancel` command (lines 3070-3082)
- **Action**: Verify existing implementation
  ```typescript
  // CURRENT STATE (lines 2401-2407):
  pi.registerCommand("implement-cancel", {
    description: "Cancel an active implementation or discovery session",
    handler: async (args, ctx) => {
      // ...
      
      // Check if we're in implement-discovery mode (ephemeral, not persisted)
      if (pipelineMode === "discovery" && activePipelineKind === "implement") {
        exitMode();
        clearPipelineWidget(ctx);
        ctx.ui.notify("Discovery session cancelled.", "info");
        return;
      }
      
      // ... rest of implementation cancellation logic
    }
  });
  ```
- **Verify**: 
  - Check that the discovery phase check happens BEFORE the persisted state logic
  - Verify that `exitMode()` clears all ephemeral state including `pendingImplementFlags`
  - Confirm that `clearPipelineWidget()` removes the widget display
  - Test manually: `/implement "test"` → chat → `/implement-cancel` → widget clears

### Step 3.2: Verify Widget Updates (Already Implemented)

- **Files**: `extensions/spec-pipeline/index.ts` (lines 683-729)
- **Pattern Reference**: Widget handling for scoping mode (lines 686-694)
- **Action**: Verify existing implementation
  ```typescript
  // CURRENT STATE (lines 705-717):
  function updateModeWidget(ctx: any): void {
    // ...
    
    const kindLabel = activePipelineKind === "hierarchy" && activeHierarchyLevel
      ? activeHierarchyLevel.charAt(0).toUpperCase() + activeHierarchyLevel.slice(1)
      : activePipelineKind === "implement"
        ? "Implementation"
        : "Spec";

    if (pipelineMode === "discovery") {
      ctx.ui.setWidget("spec-pipeline-status", [
        `🔍 ${kindLabel} Discovery Mode`,
        "────────────────────────────────────",
        `Exchanges: ${exchangeCount}`,
        "",
        "Confirm or correct each assumption.",
        `Type ${doneCmd} when ready to proceed.`,
      ]);
    }
    // ...
  }
  ```
- **Verify**:
  - Check that `kindLabel` correctly shows "Implementation" when `activePipelineKind === "implement"`
  - Verify that the widget displays `🔍 Implementation Discovery Mode`
  - Confirm that `/discovery-done` command is shown (not a custom command)
  - Test manually: `/implement "test"` → verify widget shows correct label and instructions

### Step 3.3: Update index.ts Header Comment

- **Files**: `extensions/spec-pipeline/index.ts` (lines 1-68)
- **Pattern Reference**: Other command documentation in header (lines 28-64)
- **Action**: Update IMPLEMENTATION section to reflect new discovery capability
  ```markdown
  // Before:
  * IMPLEMENTATION (/implement):
  *   1. Takes a spec file path as input
  *   2. For each implementation phase (plan + implement interleaved):
  
  // After:
  * IMPLEMENTATION (/implement):
  *   1. Takes EITHER a spec file path OR a description as input
  *      - File path: Reads spec and starts implementation
  *      - Description: Enters discovery mode → writes summary → starts implementation
  *   2. Discovery (if using description): Conversational — LLM proposes assumptions
  *   3. For each implementation phase (plan + implement interleaved):
  ```
- **Verify**: Read the updated comment to ensure it accurately describes both input modes

### Step 3.4: Update `/implement` Command Usage Documentation

- **Files**: `extensions/spec-pipeline/index.ts` (lines 58-60)
- **Pattern Reference**: `/spec` command usage (lines 51-52)
- **Action**: Update the usage comments for `/implement` commands
  ```markdown
  // Before:
  *   /implement <spec-path>                          # Start implementation
  *   /implement --no-plan <spec-path>                # Skip plan generation
  
  // After:
  *   /implement <spec-path|description>              # Start implementation (file or discovery)
  *   /implement --no-plan <spec-path|description>    # Skip plan generation
  *   /implement --no-review <spec-path|description>  # Skip reviews
  ```
- **Verify**: Ensure all flag combinations are documented

### Step 3.5: Update `/implement` Command Description String

- **Files**: `extensions/spec-pipeline/index.ts` (around line 2088)
- **Pattern Reference**: `/spec` command description (around line 1506)
- **Action**: Update the command registration description
  ```typescript
  // Before:
  pi.registerCommand("implement", {
    description: "Start implementing a spec. Use --no-plan to skip planning.",
    // ...
  });
  
  // After:
  pi.registerCommand("implement", {
    description: "Start implementing from a spec file or description. Flags: --no-plan, --no-review",
    // ...
  });
  ```
- **Verify**: Check that the description is concise and mentions both input modes

### Step 3.6: Update `/implement-cancel` Command Description String

- **Files**: `extensions/spec-pipeline/index.ts` (line 2394)
- **Action**: Verify description is already correct
  ```typescript
  // CURRENT (line 2394):
  pi.registerCommand("implement-cancel", {
    description: "Cancel an active implementation or discovery session",
    // ...
  });
  ```
- **Verify**: Description correctly mentions "or discovery session" — no changes needed

### Step 3.7: Update README.md - Quick Start Section

- **Files**: `extensions/spec-pipeline/README.md` (lines 26-44)
- **Pattern Reference**: `/spec` Quick Start example (lines 26-35)
- **Action**: Add discovery mode example to Quick Start
  ```markdown
  // After existing example (around line 40), add:
  
  ### Discovery-to-Implementation (Fast Path)
  
  ```bash
  # Skip formal spec creation - go straight from discovery to code
  /implement "Add rate limiting middleware"
  # AI explores codebase and proposes assumptions
  # You confirm or correct naturally
  # When ready, type /discovery-done
  # AI writes discovery summary and starts implementation
  ```
  ```
- **Verify**: Example clearly shows the workflow and commands

### Step 3.8: Update README.md - Commands Table

- **Files**: `extensions/spec-pipeline/README.md` (lines 93-101)
- **Pattern Reference**: Spec Creation commands table (lines 77-87)
- **Action**: Update the Implementation commands table
  ```markdown
  // Before:
  | `/implement [--no-plan] <spec-path>` | Start implementing a spec (plan + code each phase) |
  
  // After:
  | `/implement [--no-plan] [--no-review] <spec-path\|description>` | Start implementation from file or discovery mode |
  ```
- **Verify**: Table accurately reflects all flags and input modes

### Step 3.9: Update README.md - Add Discovery-to-Implementation Section

- **Files**: `extensions/spec-pipeline/README.md` (after line 208)
- **Pattern Reference**: "Conversational Discovery" section (lines 122-186)
- **Action**: Add new section explaining the fast path
  ```markdown
  // Insert after "Conversational Drafting" section:
  
  ### Discovery-to-Implementation (Fast Path)
  
  For small-to-medium changes where a full formal spec is overkill, use `/implement` with a description instead of a file path:
  
  ```bash
  /implement "Add rate limiting to the API"
  ```
  
  This enters the same conversational discovery mode as `/spec`, but proceeds directly to implementation instead of spec drafting:
  
  1. **Discovery conversation** - AI explores codebase, proposes assumptions
  2. **Type `/discovery-done`** - When ready to proceed
  3. **Summary written** - AI writes discovery summary to `specsDir/{timestamp}_discovery_{shortname}.md`
  4. **Implementation starts** - AI plans and implements phases (same as normal `/implement`)
  
  **Example interaction:**
  ```
  User: /implement "Add rate limiting to the API"
  
  AI: I'm exploring your API routes... I see you're using Express with middleware
      in src/middleware/. 
      
      Assumption: We should create a rate-limit middleware using the 'express-rate-limit'
      package and apply it globally to all routes. Does that match your vision?
  
  User: Yes, but only apply it to public routes, not admin routes
  
  AI: Got it - public routes only. I see your route definitions in src/routes/...
      Should the rate limit be 100 requests per 15 minutes per IP?
  
  User: Make it 50 per 10 minutes
  
  AI: Perfect. I have enough context. Type /discovery-done to proceed to implementation.
  
  User: /discovery-done
  
  [AI writes summary to docs/2602111400_discovery_rate_limiting_api.md]
  [Implementation pipeline starts - planning and coding phases]
  ```
  
  **Flags work the same:**
  ```bash
  /implement --no-plan "Fix null pointer in auth service"
  /implement --no-review "Add logging to user endpoints"
  /implement --no-plan --no-review "Quick bug fix"
  ```
  
  **When to use:**
  - Small bug fixes that need codebase exploration
  - Medium features where formal spec is overkill
  - When you want to iterate quickly with AI before committing to a spec
  
  **When NOT to use:**
  - Large features (use `/spec` or `/plan` → `/epic` → `/spec`)
  - When you need stakeholder review of requirements
  - When the spec will be referenced by multiple implementations
  ```
- **Verify**: Section clearly explains when to use discovery-to-implementation vs full spec workflow

### Step 3.10: Update README.md - Implementation Stage Section

- **Files**: `extensions/spec-pipeline/README.md` (lines 187-238)
- **Action**: Update the introduction paragraph to mention both input modes
  ```markdown
  // Before (line 189):
  The AI implements the spec with interleaved planning, coding, and review:
  
  // After:
  The AI implements the spec (or discovery summary) with interleaved planning, coding, and review:
  ```
- **Verify**: Subtle change that acknowledges discovery summaries are treated as specs

### Step 3.11: Update README.md - Git Workflow Section

- **Files**: `extensions/spec-pipeline/README.md` (lines 239-252)
- **Action**: Add discovery file example to the git branch diagram
  ```markdown
  // After existing diagram (around line 252), add:
  
  **Discovery-to-implementation branches:**
  ```
  main
   └─ spec/2602111400-rate-limiting-impl-2602111405  [Implementation branch]
       ├─ docs/2602111400_discovery_rate_limiting.md  [Discovery summary]
       ├─ Phase 1 commit: Rate limiting middleware
       └─ Phase 2 commit: Integration tests
  ```
  
  Discovery summaries are committed on the implementation branch, not a separate spec branch.
  ```
- **Verify**: Diagram clearly shows that discovery-to-implementation doesn't create a spec branch

### Step 3.12: Update README.md - Clean Tree Requirements Section

- **Files**: `extensions/spec-pipeline/README.md` (lines 432-437)
- **Action**: Update to clarify git clean check timing
  ```markdown
  // Before:
  ### ⚠️ Requires Clean Tree
  
  - `/implement` and `/implement-resume`
  
  Implementation requires a clean tree because it uses destructive git operations...
  
  // After:
  ### ⚠️ Requires Clean Tree
  
  - `/implement` with a **file path** - checked at invocation
  - `/implement` with a **description** - checked at `/discovery-done` (deferred)
  - `/implement-resume` - checked at resume time
  
  Implementation requires a clean tree because it uses destructive git operations 
  (`git add -A`, `git reset --hard`) during error recovery.
  
  **Note:** When using `/implement <description>`, the git clean check happens at 
  `/discovery-done` time (not at `/implement` invocation). This allows you to chat 
  naturally during discovery, then commit/stash changes before proceeding.
  ```
- **Verify**: Explanation clearly describes the deferred check behavior

### Step 3.13: Update README.md - Troubleshooting Section

- **Files**: `extensions/spec-pipeline/README.md` (lines 856-893)
- **Action**: Update "Dirty tree not allowed" troubleshooting to mention discovery mode
  ```markdown
  // Before (lines 857-865):
  ### "Dirty tree not allowed for implementation"
  
  **Problem:** Trying to run `/implement` with uncommitted changes.
  
  **Solution:** Commit or stash changes first:
  ```bash
  git stash
  /implement specs/my-spec.md
  ```
  
  // After:
  ### "Dirty tree not allowed for implementation"
  
  **Problem:** Trying to proceed with implementation when you have uncommitted changes.
  
  **When it happens:**
  - Running `/implement <file-path>` with dirty tree (checked immediately)
  - Running `/discovery-done` during implement-discovery with dirty tree (deferred check)
  
  **Solution:** Commit or stash changes before proceeding:
  ```bash
  # If you see the error during /discovery-done:
  # Your discovery session remains active - just clean up and retry
  git stash
  /discovery-done  # Discovery session continues from where it was
  
  # OR if you see it at /implement invocation with a file:
  git stash
  /implement specs/my-spec.md
  ```
  ```
- **Verify**: Troubleshooting covers both immediate and deferred check scenarios

### Step 3.14: Add README.md - Discovery Mode Comparison Table

- **Files**: `extensions/spec-pipeline/README.md` (insert after line 237)
- **Action**: Add a comparison table showing different workflows
  ```markdown
  // Insert new section:
  
  ### Choosing Your Workflow
  
  | Workflow | Use When | Result |
  |----------|----------|--------|
  | `/spec` → `/implement` | Large features, need formal spec, stakeholder review | Full spec document → implementation |
  | `/spec --quick` → `/implement` | Medium features, skip discovery, want spec doc | Spec document (no discovery) → implementation |
  | `/implement <description>` | Small-medium changes, need discovery, no spec doc needed | Discovery summary → direct implementation |
  | `/implement --no-plan <description>` | Simple changes, need discovery, skip planning | Discovery summary → direct coding |
  | `/implement <file>` | Spec already exists | Implement existing spec |
  
  **Tip:** The discovery experience is identical across `/spec` and `/implement` - the only difference is what happens after `/discovery-done`.
  ```
- **Verify**: Table helps users choose the right workflow for their needs

## Files Summary

### Modified Files

| File | Changes | Lines Affected |
|------|---------|----------------|
| `extensions/spec-pipeline/index.ts` | Update header comment to document `/implement <description>` usage | ~1-68 |
| `extensions/spec-pipeline/index.ts` | Update `/implement` command usage comment | ~58-60 |
| `extensions/spec-pipeline/index.ts` | Update `/implement` command description string | ~2088 |
| `extensions/spec-pipeline/README.md` | Add discovery-to-implementation Quick Start example | ~40-50 |
| `extensions/spec-pipeline/README.md` | Update Implementation commands table | ~93-101 |
| `extensions/spec-pipeline/README.md` | Add "Discovery-to-Implementation (Fast Path)" section | After ~208 |
| `extensions/spec-pipeline/README.md` | Update Implementation Stage introduction | ~189 |
| `extensions/spec-pipeline/README.md` | Add discovery git workflow example | After ~252 |
| `extensions/spec-pipeline/README.md` | Update clean tree requirements section | ~432-437 |
| `extensions/spec-pipeline/README.md` | Update dirty tree troubleshooting | ~857-865 |
| `extensions/spec-pipeline/README.md` | Add workflow comparison table | After ~237 |

### No New Files

All changes are documentation updates to existing files.

## Verification Steps

### Step 3.V1: Manual Testing - Discovery Mode Widget

```bash
cd /home/rpaz/code/ai_tools
# Start implement discovery
/implement "Add test feature"

# Verify widget shows:
# - "🔍 Implementation Discovery Mode"
# - "Type /discovery-done when ready to proceed."
# - Exchange count updates as you chat
```

### Step 3.V2: Manual Testing - Discovery Cancellation

```bash
# Start discovery
/implement "Add test feature"

# Chat a bit to verify exchanges are tracked
# Then cancel

/implement-cancel

# Verify:
# - Widget clears
# - Message: "Discovery session cancelled."
# - Can start a new /implement session
```

### Step 3.V3: Manual Testing - Flag Combinations

```bash
# Test flags are preserved through discovery
/implement --no-plan --no-review "Quick fix"

# Chat during discovery
# Type /discovery-done

# Verify implementation skips plan and review as expected
```

### Step 3.V4: Documentation Review

- Open README.md and verify:
  - All new sections render correctly in Markdown viewers
  - Code examples have proper syntax highlighting
  - Tables are properly formatted
  - Internal links work if any were added

### Step 3.V5: Existing Tests Pass

```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline
npm test

# All 337 tests should pass (no test changes in Phase 3)
```

## Completion Checklist

- [ ] Step 3.1: Verify cancellation logic is correctly implemented
- [ ] Step 3.2: Verify widget updates handle implement discovery mode
- [ ] Step 3.3: Update index.ts header comment (IMPLEMENTATION section)
- [ ] Step 3.4: Update `/implement` command usage documentation
- [ ] Step 3.5: Update `/implement` command description string
- [ ] Step 3.6: Verify `/implement-cancel` command description
- [ ] Step 3.7: Update README.md Quick Start section
- [ ] Step 3.8: Update README.md commands table
- [ ] Step 3.9: Add README.md discovery-to-implementation section
- [ ] Step 3.10: Update README.md implementation stage section
- [ ] Step 3.11: Update README.md git workflow section
- [ ] Step 3.12: Update README.md clean tree requirements
- [ ] Step 3.13: Update README.md troubleshooting section
- [ ] Step 3.14: Add README.md workflow comparison table
- [ ] Step 3.V1: Manual test - discovery mode widget
- [ ] Step 3.V2: Manual test - discovery cancellation
- [ ] Step 3.V3: Manual test - flag combinations
- [ ] Step 3.V4: Documentation review
- [ ] Step 3.V5: All 337 tests pass

## Testing Strategy

### Manual Testing Focus

Since Phase 3 is primarily documentation, manual testing focuses on:

1. **Widget Display** - Verify the widget correctly shows "Implementation Discovery Mode" with proper instructions
2. **Cancellation UX** - Verify `/implement-cancel` cleanly exits discovery mode
3. **Documentation Accuracy** - Verify all examples in README.md accurately describe the feature

### No New Automated Tests Required

- No new test files needed (cancellation and widget logic already covered by existing tests)
- All 337 existing tests should continue to pass
- The implementation logic was tested in Phase 2

### Documentation Quality Checks

1. **Readability** - All new sections follow existing README.md style
2. **Completeness** - Examples cover common use cases
3. **Accuracy** - Technical details match implementation
4. **Consistency** - Terminology consistent with existing docs

## Notes

- **No Code Changes Required**: The cancellation logic and widget updates were already implemented as part of Phases 1 and 2. Phase 3 is 100% documentation.
- **Discovery Mode Parity**: The discovery experience for `/implement <description>` is identical to `/spec` discovery — same prompts, same widget, same `/discovery-done` command.
- **Deferred Git Check**: The git clean check happens at `/discovery-done` time (not at `/implement` invocation) when using description mode. This is a UX improvement that allows natural conversation before requiring a clean tree.
- **Widget Label**: The widget shows "Implementation Discovery Mode" to clearly indicate this is discovery for an implementation pipeline, not a spec pipeline.
- **Ephemeral State**: Implement-discovery state is NOT persisted to disk (consistent with `/plan` scoping). If the session is cancelled or pi crashes, the discovery conversation is lost. This is acceptable for the fast-path workflow.

## Related Files

- Phase 1 plan: `/home/rpaz/code/ai_tools/docs/2602111351_fast_discovery_for_implementat/phase1_unified_discovery_prompt.md`
- Phase 2 plan: `/home/rpaz/code/ai_tools/docs/2602111351_fast_discovery_for_implementat/phase2_implement_discovery_mode.md`
- Spec file: `/tmp/spec-pipeline-spec-gqk4a8/spec.md`
- Implementation file: `extensions/spec-pipeline/index.ts`
- Documentation file: `extensions/spec-pipeline/README.md`
