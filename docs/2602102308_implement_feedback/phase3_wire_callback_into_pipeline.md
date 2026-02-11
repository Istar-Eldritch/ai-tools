# Phase 3: Wire Callback into Pipeline

**Estimated Effort**: 0.5 days

## Overview

This phase integrates the progress callback factory (created in Phase 2) into the implementation pipeline. The callback will be wired into three key execution points: plan drafting, implementation, and tiered reviews (both plan and code reviews). This provides real-time visibility into agent operations during the `/implement` command.

## Prerequisites

- Phase 1 complete: Event parsing implemented in `agents.ts`
- Phase 2 complete: `createProgressCallback()` factory function implemented in `agents.ts`
- Understanding of `implement-pipeline.ts` execution flow
- Understanding of `review.ts` tiered review system

## Steps

### Step 3.1: Wire Progress Callback into Plan Drafting

**Files**: `extensions/spec-pipeline/implement-pipeline.ts`  
**Location**: Around line 359 (in plan generation section)  
**Pattern Reference**: Based on existing `runAgentWithConfig()` calls and Phase 2's `createProgressCallback()` function

**Action**: Add progress callback to plan drafting phase

```typescript
// Before:
const planStartTime = new Date();
const planDraftResult = await runAgentWithConfig(
	planDrafterConfig,
	planTask,
	cwd,
	SYSTEM_PROMPTS.planDrafter,
	undefined,
	undefined,  // ← onOutput is undefined
	"planDrafter"
);

// After:
const planStartTime = new Date();

// Create progress callback for plan drafting (R17)
const planPhaseInfo = `Phase ${phaseIdx + 1}/${state.phases.length} Plan`;
const planProgressCallback = createProgressCallback(
	ctx,
	state,
	planPhaseInfo,
	true  // isImplPipeline
);

const planDraftResult = await runAgentWithConfig(
	planDrafterConfig,
	planTask,
	cwd,
	SYSTEM_PROMPTS.planDrafter,
	undefined,
	planProgressCallback,  // ← Pass callback (R17)
	"planDrafter"
);
```

**Import Addition**: Ensure `createProgressCallback` is imported at the top of the file:

```typescript
// Add to existing imports from "./agents.ts"
import { runAgentWithConfig, createProgressCallback } from "./agents.ts";
```

**Verify**: 
- Check that plan drafting shows file read operations: `"📖 Reading src/auth.ts [Phase 1/3 Plan]"`
- Check that widget updates show current action during plan drafting

---

### Step 3.2: Wire Progress Callback into Implementation

**Files**: `extensions/spec-pipeline/implement-pipeline.ts`  
**Location**: Around line 532 (in implementation section)  
**Pattern Reference**: Similar to Step 3.1

**Action**: Add progress callback to implementation phase

```typescript
// Before:
const implementStartTime = new Date();
const implementResult = await runAgentWithConfig(
	implementerConfig,
	implementTask,
	cwd,
	SYSTEM_PROMPTS.implementer,
	undefined,
	undefined,  // ← onOutput is undefined
	"implementer"
);

// After:
const implementStartTime = new Date();

// Create progress callback for implementation (R18)
const implPhaseInfo = `Phase ${phaseIdx + 1}/${state.phases.length}`;
const implProgressCallback = createProgressCallback(
	ctx,
	state,
	implPhaseInfo,
	true  // isImplPipeline
);

const implementResult = await runAgentWithConfig(
	implementerConfig,
	implementTask,
	cwd,
	SYSTEM_PROMPTS.implementer,
	undefined,
	implProgressCallback,  // ← Pass callback (R18)
	"implementer"
);
```

**Verify**:
- Check that implementation shows file operations: `"✍️ Creating src/middleware/auth.ts [Phase 2/3]"`
- Check that bash commands are visible: `"⚙️ Running: npm test [Phase 2/3]"`
- Check that widget updates during implementation

---

### Step 3.3: Wire Progress Callback into Plan Review

**Files**: `extensions/spec-pipeline/implement-pipeline.ts`  
**Location**: Around line 422 (in plan review section)  
**Pattern Reference**: Based on existing `runTieredReview()` call structure

**Action**: Add `onOutput` callback to plan review context

```typescript
// Before:
const planReviewResult = await runTieredReview(
	{
		cwd,
		projectConfig,
		systemPrompts: SYSTEM_PROMPTS,
		state,
		saveFn: save,
		phaseIndex: phaseIdx + 1,
		phaseName,
		notify: ctx.ui.notify.bind(ctx.ui),
		// onOutput not present
	},
	{
		role: "planReviewer",
		reviewTask: `Review this implementation plan:\n\n${planContent}`,
		fixTask: (reviewOutput) => `Revise the implementation plan based on review feedback.

Original spec: ${state.specPath}
Current plan: ${fullPhasePath}

Review feedback:
${reviewOutput}

Read the spec and current plan, revise to address the feedback, and write back to: ${fullPhasePath}`,
	}
);

// After:
// Create progress callback for plan review (R19, R20)
const planReviewPhaseInfo = `Phase ${phaseIdx + 1}/${state.phases.length} Plan Review`;
const planReviewProgressCallback = createProgressCallback(
	ctx,
	state,
	planReviewPhaseInfo,
	true  // isImplPipeline
);

const planReviewResult = await runTieredReview(
	{
		cwd,
		projectConfig,
		systemPrompts: SYSTEM_PROMPTS,
		state,
		saveFn: save,
		phaseIndex: phaseIdx + 1,
		phaseName,
		notify: ctx.ui.notify.bind(ctx.ui),
		onOutput: planReviewProgressCallback,  // ← Add callback (R19, R20)
	},
	{
		role: "planReviewer",
		reviewTask: `Review this implementation plan:\n\n${planContent}`,
		fixTask: (reviewOutput) => `Revise the implementation plan based on review feedback.

Original spec: ${state.specPath}
Current plan: ${fullPhasePath}

Review feedback:
${reviewOutput}

Read the spec and current plan, revise to address the feedback, and write back to: ${fullPhasePath}`,
	}
);
```

**Verify**:
- Check that review cycles show file reads: `"📖 Reading phase1_plan.md [Phase 1/3 Plan Review]"`
- Check that fix application shows edits: `"✏️ Editing phase1_plan.md [Phase 1/3 Plan Review]"`
- Check widget updates during review cycles

---

### Step 3.4: Wire Progress Callback into Code Review

**Files**: `extensions/spec-pipeline/implement-pipeline.ts`  
**Location**: Around line 609 (in code review section)  
**Pattern Reference**: Similar to Step 3.3

**Action**: Add `onOutput` callback to code review context

```typescript
// Before:
const codeReviewResult = await runTieredReview(
	{
		cwd,
		projectConfig,
		systemPrompts: SYSTEM_PROMPTS,
		state,
		saveFn: save,
		phaseIndex: phaseIdx + 1,
		phaseName,
		notify: ctx.ui.notify.bind(ctx.ui),
		// onOutput not present
	},
	{
		role: "codeReviewer",
		reviewTask: `Review the implementation for Phase ${phaseIdx + 1}.

Implementation plan:
${phasePlan}

Check if the implementation matches the plan and follows project conventions.
${projectConfig.testCommand ? `Verify tests pass with: ${projectConfig.testCommand}` : ""}`,
		fixTask: (reviewOutput) => `Address these code review findings:

${reviewOutput}

${projectConfig.testCommand ? `Run tests with: ${projectConfig.testCommand}` : ""}

Make the necessary fixes.`,
		runAddressReviewOnSignificantIssues: true,
	}
);

// After:
// Create progress callback for code review (R19, R20)
const codeReviewPhaseInfo = `Phase ${phaseIdx + 1}/${state.phases.length} Code Review`;
const codeReviewProgressCallback = createProgressCallback(
	ctx,
	state,
	codeReviewPhaseInfo,
	true  // isImplPipeline
);

const codeReviewResult = await runTieredReview(
	{
		cwd,
		projectConfig,
		systemPrompts: SYSTEM_PROMPTS,
		state,
		saveFn: save,
		phaseIndex: phaseIdx + 1,
		phaseName,
		notify: ctx.ui.notify.bind(ctx.ui),
		onOutput: codeReviewProgressCallback,  // ← Add callback (R19, R20)
	},
	{
		role: "codeReviewer",
		reviewTask: `Review the implementation for Phase ${phaseIdx + 1}.

Implementation plan:
${phasePlan}

Check if the implementation matches the plan and follows project conventions.
${projectConfig.testCommand ? `Verify tests pass with: ${projectConfig.testCommand}` : ""}`,
		fixTask: (reviewOutput) => `Address these code review findings:

${reviewOutput}

${projectConfig.testCommand ? `Run tests with: ${projectConfig.testCommand}` : ""}

Make the necessary fixes.`,
		runAddressReviewOnSignificantIssues: true,
	}
);
```

**Verify**:
- Check that review shows file reads: `"📖 Reading src/auth/middleware.ts [Phase 2/3 Code Review]"`
- Check that test execution is visible: `"⚙️ Running: npm test [Phase 2/3 Code Review]"`
- Check that fix cycles show edits: `"✏️ Editing src/auth/middleware.ts [Phase 2/3 Code Review]"`

---

### Step 3.5: Verify Threading Through Tiered Reviews

**Files**: `extensions/spec-pipeline/review.ts`  
**Context**: The `runTieredReview()` function already threads `onOutput` through to all internal `runAgentWithConfig()` calls (implemented in Phase 2)  
**Pattern Reference**: See `review.ts` line ~225 and similar locations

**Verification**: Confirm that `review.ts` properly threads the callback:

```typescript
// In review.ts, around line 225 (cheap tier review):
const reviewResult = await runAgentWithConfig(
	tieredConfig.cheap,
	cycle === 1 ? reviewTask : `Continue review after fixes were applied:\n\n${reviewTask}`,
	cwd,
	systemPrompts[role],
	signal,
	onOutput,  // ← Already threads onOutput from context (R20)
	role
);
```

**No changes needed** - Phase 2 implementation already handles this. Just verify that the threading works correctly.

**Verify**:
- Review the `runTieredReview()` function to confirm all `runAgentWithConfig()` calls include the `onOutput` parameter
- Check that both cheap and expensive tier reviews receive the callback
- Check that addressReview (fix application) also receives the callback

---

### Step 3.6: Manual Integration Testing

**Action**: Test the complete integration with a real implementation pipeline

**Test Scenario 1: Single-Phase Implementation**
```bash
# Create a simple test spec
cd /home/rpaz/code/ai_tools
cat > docs/test_progress_spec.md << 'EOF'
# Test Progress Visibility

## Phase 1: Add Simple Utility Function

Add a utility function to format dates in ISO format.

**Files to modify:**
- Create `utils/date-formatter.ts` with `formatDateISO()` function
- Add test in `utils/date-formatter.test.ts`

**Acceptance criteria:**
- Function formats Date objects to ISO strings
- Tests pass
EOF

# Run implementation
/implement docs/test_progress_spec.md
```

**Expected Observations**:
- During plan drafting: See notifications like `"📖 Reading utils/..."`
- During implementation: See notifications like `"✍️ Creating utils/date-formatter.ts [Phase 1/1]"`
- During code review: See notifications like `"📖 Reading utils/date-formatter.ts [Phase 1/1 Code Review]"`
- Widget shows current action in real-time
- Terminal history shows complete trail of operations

**Test Scenario 2: Multi-Phase Implementation**
```bash
# Use an existing multi-phase spec if available
/implement docs/2602102308_spec_implement_feedback.md
```

**Expected Observations**:
- Plan drafting for each phase shows progress
- Implementation phases show different contexts: `[Phase 1/3]`, `[Phase 2/3]`, `[Phase 3/3]`
- Review cycles show context: `[Phase 2/3 Code Review]`
- Widget updates throughout all phases

**Test Scenario 3: Error Handling**
```bash
# Trigger an error (e.g., by implementing a spec with invalid requirements)
# Verify that progress stops cleanly and error messages are displayed
```

**Verify**:
- No crashes or errors from JSON parsing
- Progress stops cleanly on errors
- Error messages are still displayed correctly
- Widget is cleared on error

---

### Step 3.7: Check Review Cycle Context (Optional Enhancement)

**Context**: The current implementation shows phase information, but review cycles could be enhanced to show cycle numbers.

**Current behavior**:
```
📖 Reading file.ts [Phase 2/3 Code Review]
```

**Potential enhancement** (future work, not required for Phase 3):
```
📖 Reading file.ts [Phase 2/3 Code Review - Cycle 1/2]
```

**Decision**: Keep current implementation simple. Cycle information is already shown in the main notifications from `runTieredReview()`. The progress notifications focus on file-level operations.

**No action needed** for Phase 3.

---

## Files Summary

### Modified Files

| File | Changes | Lines Affected |
|------|---------|----------------|
| `extensions/spec-pipeline/implement-pipeline.ts` | Add 4 progress callback creations and wire into agent calls | ~359, ~422, ~532, ~609 |

### Modified Sections in implement-pipeline.ts

1. **Import statement** (~line 30): Add `createProgressCallback` to imports from `"./agents.ts"`
2. **Plan drafting** (~line 359): Create and pass callback to `runAgentWithConfig()`
3. **Plan review** (~line 422): Create and pass callback to `runTieredReview()`
4. **Implementation** (~line 532): Create and pass callback to `runAgentWithConfig()`
5. **Code review** (~line 609): Create and pass callback to `runTieredReview()`

### No Changes Required

| File | Reason |
|------|--------|
| `extensions/spec-pipeline/review.ts` | Already threads `onOutput` through to agent calls (Phase 2) |
| `extensions/spec-pipeline/agents.ts` | Phase 1 and 2 complete - event parsing and callback factory implemented |
| `extensions/spec-pipeline/formatting.ts` | Widget update functions already support `currentAction` parameter |

---

## Completion Checklist

- [ ] Step 3.1: Import `createProgressCallback` in `implement-pipeline.ts`
- [ ] Step 3.2: Wire callback into plan drafting (`runAgentWithConfig` call)
- [ ] Step 3.3: Wire callback into plan review (`runTieredReview` call)
- [ ] Step 3.4: Wire callback into implementation (`runAgentWithConfig` call)
- [ ] Step 3.5: Wire callback into code review (`runTieredReview` call)
- [ ] Step 3.6: Verify no TypeScript compilation errors
- [ ] Step 3.7: Manual test - plan drafting shows file reads
- [ ] Step 3.8: Manual test - implementation shows file writes/edits
- [ ] Step 3.9: Manual test - reviews show file operations
- [ ] Step 3.10: Manual test - bash commands are visible
- [ ] Step 3.11: Manual test - widget updates in real-time
- [ ] Step 3.12: Manual test - multi-phase implementation works correctly
- [ ] Step 3.13: Manual test - error handling works correctly
- [ ] Step 3.14: Existing tests still pass (`npm test`)

---

## Testing Notes

### Unit Tests

**Status**: No new unit tests required for Phase 3.

**Rationale**: 
- Phase 2 already has comprehensive tests for `createProgressCallback()` in `agents.test.ts`
- Integration testing is better suited for manual verification
- The changes are simple wiring of existing tested functions

**Existing test coverage**:
- `agents.test.ts`: Tests for `createProgressCallback()` with all tool types
- `implement-pipeline.test.ts`: Existing tests should continue passing
- `review.test.ts`: Existing tests should continue passing

### Manual Testing Required

Phase 3 requires manual testing because:
1. Integration with live pi subprocess (hard to mock)
2. Real-time widget updates (visual verification needed)
3. End-to-end pipeline flow verification
4. User experience validation

---

## Rollback Plan

If issues arise, rollback is straightforward:

1. **Revert the import addition**:
   ```typescript
   // Remove createProgressCallback from imports
   import { runAgentWithConfig } from "./agents.ts";
   ```

2. **Revert all callback additions** (4 locations):
   ```typescript
   // Change back to:
   undefined,  // onOutput parameter
   ```

3. **Verify tests pass**: `npm test`

The changes are localized to `implement-pipeline.ts` and all changes are simple parameter additions. No complex logic changes mean low risk of breaking changes.

---

## Performance Considerations

### Expected Impact

- **Notification frequency**: 10-50+ notifications per phase (depending on code complexity)
- **Widget updates**: Same frequency as notifications
- **Performance overhead**: Minimal (notifications are async, widget updates are lightweight)

### Monitoring

After deployment, monitor:
- User feedback on notification spam
- Terminal scrollback performance with many notifications
- Widget update frequency and flicker

### Future Optimizations

If performance issues arise:
- Add throttling to notifications (max 1 per second for `read` operations)
- Batch widget updates (debounce with 200ms delay)
- Add configuration option to disable progress notifications

---

## Success Criteria Verification

After implementation, verify all requirements from spec:

### Visibility Requirements (R10-R16)
- [ ] **R10**: Notifications use `ctx.ui.notify()` with "info" severity ✓
- [ ] **R11**: All tool actions generate notifications ✓
- [ ] **R12**: Notification frequency is high (no throttling) ✓
- [ ] **R13**: Widget shows `currentAction` in real-time ✓
- [ ] **R14**: Widget updates replace previous action ✓
- [ ] **R15**: Widget shows proper format with action and phase ✓
- [ ] **R16**: Widget format matches specification ✓

### Integration Requirements (R17-R21)
- [ ] **R17**: Callback wired into plan drafting ✓
- [ ] **R18**: Callback wired into implementation ✓
- [ ] **R19**: Callback wired into tiered reviews ✓
- [ ] **R20**: `runTieredReview()` threads callback correctly ✓
- [ ] **R21**: Notifications include phase context ✓

### Backward Compatibility (R22-R24)
- [ ] **R22**: `onOutput` remains optional in signatures ✓
- [ ] **R23**: Existing code with `undefined` still works ✓
- [ ] **R24**: Changes localized to specified files ✓

### User Experience (from Success Criteria)
- [ ] Plan drafting shows file reads with phase context
- [ ] Implementation shows file write/edit operations with phase context
- [ ] Reviews show file operations with review context
- [ ] Bash commands are visible with truncation
- [ ] Widget updates in real-time with current action
- [ ] Widget shows phase context in action text
- [ ] Terminal history shows complete action trail
- [ ] No errors from malformed JSON events
- [ ] Existing tests pass without modification

---

## Related Documentation

- **Spec**: `/tmp/spec-pipeline-spec-xgRQt6/spec.md` - Full requirements and context
- **Phase 1 Plan**: `docs/2602102308_implement_feedback/phase1_enhance_event_parsing_runagentwithconfig.md`
- **Phase 2 Plan**: `docs/2602102308_implement_feedback/phase2_create_progress_callback_factory.md`
- **agents.ts**: Event parsing and callback factory implementation
- **review.ts**: Tiered review system and callback threading
- **formatting.ts**: Widget update functions

---

## Notes

### Implementation Order

1. Start with Step 3.1 (import) - Required for all subsequent steps
2. Do Steps 3.2-3.5 in any order - They are independent
3. Do Step 3.6 (testing) after all wiring is complete

### Phase Information Format

The phase context string format is consistent across all callbacks:
- Plan drafting: `"Phase ${phaseIdx + 1}/${state.phases.length} Plan"`
- Plan review: `"Phase ${phaseIdx + 1}/${state.phases.length} Plan Review"`
- Implementation: `"Phase ${phaseIdx + 1}/${state.phases.length}"`
- Code review: `"Phase ${phaseIdx + 1}/${state.phases.length} Code Review"`

This provides clear context about which phase and operation is active.

### Cycle Information

Review cycle numbers are already shown in the main tiered review notifications (e.g., "Cheap cycle 1/2"). The progress notifications focus on file-level operations and don't repeat the cycle information to avoid redundancy.

### Error Scenarios

The progress callback is designed to be resilient:
- Malformed events are ignored (Phase 1 implementation)
- Missing tool arguments don't cause crashes (Phase 2 implementation)
- If callback throws, agent execution continues (callback errors are non-fatal)

### Widget Update Strategy

The widget is updated on every tool action. This provides real-time feedback but has minimal performance impact because:
- `updateImplWidget()` only updates if content changed
- Pi's widget system is optimized for frequent updates
- Widget rendering is async and non-blocking
