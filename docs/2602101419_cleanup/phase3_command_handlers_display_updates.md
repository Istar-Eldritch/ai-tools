# Phase 3: Command Handlers and Display Updates

**Estimated Effort**: 1 hour

## Overview

This phase removes unused role literals from the `run_spec_agent` tool schema and updates display functions to stop showing removed configuration options. After Phase 2 removed the config fields and defaults, this phase ensures the runtime tool registration and user-facing displays are consistent with the simplified configuration surface.

## Prerequisites

- Phase 1 complete (schema and type system cleaned up)
- Phase 2 complete (configuration loading and state management updated)
- TypeScript compilation passes

## Codebase Context

**Project Structure**: TypeScript extension for pi coding agent
**Extension API**: Uses `pi.registerTool()` with TypeBox schemas for parameter validation
**Display System**: Uses formatted text output with box-drawing characters and dividers
**Location**: `/home/rpaz/code/ai_tools/extensions/spec-pipeline/`

**Key Files**:
- `index.ts` - Extension entry point with command registration and tool schemas (~3500 lines)
- `formatting.ts` - Display formatting utilities (~600 lines)

**Patterns Observed**:
- Tool schemas use `Type.Union()` with `Type.Literal()` for enum-like role values
- Display functions use `formatKeyValue()` helper for consistent alignment
- Config display uses `formatDivider()` and structured sections
- Box-drawing characters: `┌─┐│└┘` for visual appeal

## Steps

### Step 3.1: Remove Unused Roles from run_spec_agent Tool Schema

**Files**: `extensions/spec-pipeline/index.ts`
**Lines**: ~3444-3475 (run_spec_agent tool registration)
**Pattern Reference**: Based on existing tool schema with Type.Union of role literals

**Current State** (verified via grep):
```typescript
pi.registerTool({
	name: "run_spec_agent",
	label: "Run Spec Agent",
	description: `Run a specialized agent for the spec pipeline.

IMPORTANT: The subagent runs in a completely isolated context with NO memory of prior conversation.
The 'task' parameter is the ONLY input the subagent receives.
You MUST include ALL relevant context in the task.`,
	parameters: Type.Object({
		agent: Type.Union([Type.Literal("opus"), Type.Literal("sonnet"), Type.Literal("haiku")], {
			description: "Agent to run (opus for complex tasks, sonnet for reviews, haiku for simple tasks)",
		}),
		role: Type.Union(
			[
				Type.Literal("discoveryAgent"),         // REMOVE
				Type.Literal("specDrafter"),            // REMOVE
				Type.Literal("specReviewer"),           // REMOVE
				Type.Literal("planDrafter"),            // KEEP
				Type.Literal("planReviewer"),           // KEEP
				Type.Literal("implementer"),            // KEEP
				Type.Literal("codeReviewer"),           // KEEP
				Type.Literal("commitMessageWriter"),    // KEEP
				Type.Literal("addressReview"),          // KEEP
				Type.Literal("scopingAgent"),           // REMOVE
				Type.Literal("roadmapDrafter"),         // REMOVE
				Type.Literal("roadmapReviewer"),        // REMOVE
				Type.Literal("epicDrafter"),            // REMOVE
				Type.Literal("epicReviewer"),           // REMOVE
			],
			{ description: "Role/system prompt to use" }
		),
		task: Type.String({ 
			description: "Complete task description including ALL context" 
		}),
	}),
	// ... execute function continues
```

**Action**: Remove unused role literals from the `Type.Union` array:

```typescript
// AFTER (updated role union):
role: Type.Union(
	[
		Type.Literal("planDrafter"),
		Type.Literal("planReviewer"),
		Type.Literal("implementer"),
		Type.Literal("codeReviewer"),
		Type.Literal("commitMessageWriter"),
		Type.Literal("addressReview"),
	],
	{ description: "Role/system prompt to use" }
),
```

**Rationale**: 
- Tool is used for programmatic agent invocation during implementation pipeline
- Discovery/drafting/scoping happen conversationally with host LLM (no separate tool invocation)
- Spec/roadmap/epic reviews happen via user approval (no agent tool invocation)
- Only implementation-related roles need to be invocable via this tool

**Verify**: 
```bash
# TypeScript compilation succeeds
cd /home/rpaz/code/ai_tools
npm run build

# No references to removed roles in tool invocations
grep -r "run_spec_agent.*discoveryAgent" extensions/spec-pipeline/
grep -r "run_spec_agent.*specDrafter" extensions/spec-pipeline/
grep -r "run_spec_agent.*specReviewer" extensions/spec-pipeline/
# All should return no results
```

**Important Notes**:
- The `execute` function body remains unchanged - it already uses `SYSTEM_PROMPTS[params.role]`
- System prompts for removed roles MUST remain in `agents-config.ts` (used for host LLM injection)
- This only affects the tool schema validation, not the prompt definitions

---

### Step 3.2: Update formatEffectiveConfig to Remove Unused Model Configs

**Files**: `extensions/spec-pipeline/formatting.ts`
**Lines**: ~126-163 (formatEffectiveConfig function)
**Pattern Reference**: Based on existing `formatKeyValue()` calls for model configs

**Current State** (verified via read):
```typescript
export function formatEffectiveConfig(config: ProjectConfig, fromFile: boolean): string {
	const lines: string[] = [];
	
	lines.push(formatDivider(60));
	lines.push(`  📋 Configuration${fromFile ? " (from .pi/spec-pipeline.json)" : " (defaults)"}`);
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
	lines.push(`    scopingAgent      : ${formatModelConfig(config.models.scopingAgent)}`);
	lines.push(`    roadmapDrafter    : ${formatModelConfig(config.models.roadmapDrafter)}`);
	lines.push(`    roadmapReviewer   : ${formatTieredConfig(config.models.roadmapReviewer)}`);
	lines.push(`    epicDrafter       : ${formatModelConfig(config.models.epicDrafter)}`);
	lines.push(`    epicReviewer      : ${formatTieredConfig(config.models.epicReviewer)}`);
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
	lines.push(`    roadmapReviewer: ${formatCycles(config.reviewCycles.roadmapReviewer)}`);
	lines.push(`    epicReviewer: ${formatCycles(config.reviewCycles.epicReviewer)}`);
	lines.push("");
	
	// ... rest of function
}
```

**Action**: Remove display lines for unused model configs and review cycles:

```typescript
// Model configurations section - AFTER:
lines.push("  Model Configurations:");
lines.push(`    planDrafter       : ${formatModelConfig(config.models.planDrafter)}`);
lines.push(`    planReviewer      : ${formatTieredConfig(config.models.planReviewer)}`);
lines.push(`    implementer       : ${formatModelConfig(config.models.implementer)}`);
lines.push(`    codeReviewer      : ${formatTieredConfig(config.models.codeReviewer)}`);
lines.push(`    addressReview     : ${formatModelConfig(config.models.addressReview)}`);
lines.push(`    agentCommitMessageWriter: ${formatModelConfig(config.models.agentCommitMessageWriter)}`);
lines.push("");

// Review cycles section - AFTER:
lines.push("  Review Cycles (cheap/expensive):");
const formatCycles = (cycles: { cheap: number; expensive: number }) => {
	if (cycles.cheap === 0 && cycles.expensive === 0) return "skipped";
	return `${cycles.cheap}/${cycles.expensive}`;
};
lines.push(`    planReviewer: ${formatCycles(config.reviewCycles.planReviewer)}`);
lines.push(`    codeReviewer: ${formatCycles(config.reviewCycles.codeReviewer)}`);
lines.push("");
```

**Changes**:
- Remove lines displaying: `discoveryAgent`, `specDrafter`, `specReviewer`, `scopingAgent`, `roadmapDrafter`, `roadmapReviewer`, `epicDrafter`, `epicReviewer`
- Add line displaying: `agentCommitMessageWriter` (this is a real config that was missing from display)
- Remove review cycle lines for: `specReviewer`, `roadmapReviewer`, `epicReviewer`
- Keep review cycle lines for: `planReviewer`, `codeReviewer` (actually used)

**Rationale**:
- Users should only see configs that actually affect pipeline behavior
- Displaying unused configs creates false sense of control
- `agentCommitMessageWriter` is a real config that should be shown (used for git commits after agent operations)

**Verify**:
```bash
# Start a spec pipeline and check the config display
cd /home/rpaz/code/ai_tools
# Should show only 6 model configs (not 14)
# Should show only 2 review cycle configs (not 5)
```

**Expected Output Example**:
```
────────────────────────────────────────────────────────────
  📋 Configuration (from .pi/spec-pipeline.json)
────────────────────────────────────────────────────────────

  Model Configurations:
    planDrafter       : opus/high
    planReviewer      : cheap=sonnet/medium, expensive=opus/high
    implementer       : opus/high
    codeReviewer      : cheap=sonnet/medium, expensive=opus/high
    addressReview     : sonnet/medium
    agentCommitMessageWriter: haiku/off

  Review Cycles (cheap/expensive):
    planReviewer: 2/2
    codeReviewer: 2/2

  Spec Templates:
    template     : .pi/spec-template.md
    conventions  : .pi/spec-conventions.md

────────────────────────────────────────────────────────────
```

---

### Step 3.3: Verify No Other Display Functions Reference Removed Configs

**Files**: `extensions/spec-pipeline/formatting.ts` (entire file)
**Action**: Search for any other functions that might display removed config fields

**Search Commands**:
```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline

# Check for references to removed model configs in formatting.ts
grep -n "discoveryAgent\|specDrafter\|specReviewer\|scopingAgent\|roadmapDrafter\|roadmapReviewer\|epicDrafter\|epicReviewer" formatting.ts

# Check for references to discovery config
grep -n "discovery\." formatting.ts
```

**Expected Results**: 
- Only the `formatEffectiveConfig` function (updated in Step 3.2) should have had these references
- If any other display functions reference removed configs, update them to remove those displays

**Action if Found**: Remove or update any additional display references following the same pattern as Step 3.2

**Verify**: No remaining references to removed configs in display code

---

## Files Summary

### Modified Files
| File | Changes | Lines Affected |
|------|---------|----------------|
| `extensions/spec-pipeline/index.ts` | Remove 8 role literals from `run_spec_agent` tool schema | ~3456-3470 |
| `extensions/spec-pipeline/formatting.ts` | Remove display of 8 model configs and 3 review cycles; add agentCommitMessageWriter display | ~134-155 |

### No New Files

### Files NOT Changed
| File | Reason |
|------|--------|
| `agents-config.ts` | System prompts for removed roles MUST remain (used for host LLM injection) |
| `state.ts` | State creation functions already don't use discoveryConfig (fixed in Phase 2) |
| `config.ts` | Configuration loading already updated (Phase 2) |
| `types.ts` | Type definitions already updated (Phase 1) |

---

## Completion Checklist

- [ ] Step 3.1: `run_spec_agent` tool schema only includes implementation-related roles
- [ ] Step 3.2: `formatEffectiveConfig` only displays implementation-related configs
- [ ] Step 3.3: No other display functions reference removed configs
- [ ] TypeScript compilation passes without errors
- [ ] Configuration display shows 6 model configs (not 14)
- [ ] Configuration display shows 2 review cycles (not 5)
- [ ] `agentCommitMessageWriter` now shown in config display
- [ ] Tool schema validation rejects attempts to use removed roles
- [ ] No grep results for removed role references in tool invocations

---

## Testing Notes

**Manual Testing**:
```bash
# 1. Test config display
cd /home/rpaz/code/ai_tools
# Start pi and run /spec command
# Verify config display shows only 6 model configs

# 2. Test tool schema validation (if applicable)
# Attempt to invoke run_spec_agent with a removed role should fail validation
# This would typically be tested at the API level, not manually

# 3. Verify grep results
cd extensions/spec-pipeline
grep -r "discoveryAgent" formatting.ts  # Should return no results
grep -r "specReviewer" formatting.ts    # Should return no results
```

**Automated Testing**:
- No new tests needed - this phase removes unused functionality
- Existing tests updated in Phase 4 (test updates)
- Type system ensures removed roles can't be used at compile time

---

## Rollback Plan

If issues are discovered after this phase:

1. **Revert formatting.ts changes**:
   ```bash
   git checkout HEAD -- extensions/spec-pipeline/formatting.ts
   ```

2. **Revert index.ts changes**:
   ```bash
   git checkout HEAD -- extensions/spec-pipeline/index.ts
   ```

3. **Revert requires reverting Phase 1 and Phase 2 as well** since types and config loading have been updated

---

## Dependencies

**Depends On**:
- Phase 1: Type system must have removed fields from `ProjectConfig["models"]` and `NormalizedReviewCycles`
- Phase 2: Config defaults must have removed the unused configs

**Required By**:
- Phase 4: Test updates will remove test cases for removed functionality

---

## Success Verification

After completing this phase:

1. **Config Display Verification**:
   ```bash
   # Start a spec pipeline
   cd /home/rpaz/code/ai_tools
   # Run: /spec "test feature"
   # Verify output shows:
   #   - 6 model configs (planDrafter, planReviewer, implementer, codeReviewer, addressReview, agentCommitMessageWriter)
   #   - 2 review cycles (planReviewer, codeReviewer)
   #   - NOT 14 model configs and 5 review cycles
   ```

2. **Tool Schema Verification**:
   ```bash
   # TypeScript compilation succeeds
   npm run build
   
   # Tool schema only allows implementation roles
   grep -A 20 "run_spec_agent" extensions/spec-pipeline/index.ts | grep "Type.Literal"
   # Should show only: planDrafter, planReviewer, implementer, codeReviewer, commitMessageWriter, addressReview
   ```

3. **No Dead References**:
   ```bash
   cd extensions/spec-pipeline
   # These should return NO results:
   grep "discoveryAgent" formatting.ts
   grep "specReviewer" formatting.ts  
   grep "scopingAgent" formatting.ts
   grep "roadmapReviewer" formatting.ts
   grep "epicReviewer" formatting.ts
   ```

4. **System Prompts Still Exist**:
   ```bash
   # These SHOULD still exist in agents-config.ts
   grep "discoveryAgent" agents-config.ts  # Should find the prompt definition
   grep "specDrafter" agents-config.ts     # Should find the prompt definition
   # Prompts are still used for host LLM injection, just not for separate agent invocation
   ```

The phase is complete when:
- Config display is simplified (6 configs shown instead of 14)
- Tool schema validation prevents using removed roles
- No display code references removed configurations
- System prompts remain available for host LLM injection
- All verification commands pass successfully
