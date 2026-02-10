# Phase 1: Schema and Type System Cleanup

**Estimated Effort**: 2 hours

## Overview

This phase removes unused configuration fields from the schema and type system. These fields were used when discovery/drafting used separate agent invocations, but are now obsolete since we switched to conversational mode with the host LLM. This phase only touches type definitions and schemas - no runtime code changes yet.

## Prerequisites

- None (this is the first phase)
- Clean git working tree recommended (but not required per dirty tree support)

## Codebase Context

**Project Structure**: TypeScript extension for pi coding agent
**Type System**: Uses TypeBox for runtime schema validation
**Location**: `/home/rpaz/code/ai_tools/extensions/spec-pipeline/`
**Test Framework**: Vitest with beforeEach/afterEach patterns

**Key Files**:
- `types.ts` - All type definitions and schemas (main file for this phase)
- `config.ts` - Configuration loading and defaults (updates in Phase 2)
- `review.ts` - Review system using TieredReviewerRole
- Test files follow pattern: `*.test.ts` with describe/it blocks

## Steps

### Step 1.1: Remove Unused Model Configurations from ModelsConfigSchema

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~48-64 (ModelsConfigSchema definition)
**Pattern Reference**: Based on existing `planDrafter`, `implementer` fields

**Action**: Remove the following optional fields from `ModelsConfigSchema`:

```typescript
// BEFORE (lines ~48-64):
export const ModelsConfigSchema = Type.Object({
	discoveryAgent: Type.Optional(ModelConfigSchema),
	specDrafter: Type.Optional(ModelConfigSchema),
	specReviewer: Type.Optional(TieredModelConfigSchema),
	planDrafter: Type.Optional(ModelConfigSchema),
	planReviewer: Type.Optional(TieredModelConfigSchema),
	implementer: Type.Optional(ModelConfigSchema),
	codeReviewer: Type.Optional(TieredModelConfigSchema),
	addressReview: Type.Optional(ModelConfigSchema),
	agentCommitMessageWriter: Type.Optional(ModelConfigSchema),
	commitMessageWriter: Type.Optional(Type.Any()),
	scopingAgent: Type.Optional(ModelConfigSchema),
	roadmapDrafter: Type.Optional(ModelConfigSchema),
	roadmapReviewer: Type.Optional(TieredModelConfigSchema),
	epicDrafter: Type.Optional(ModelConfigSchema),
	epicReviewer: Type.Optional(TieredModelConfigSchema),
});

// AFTER:
export const ModelsConfigSchema = Type.Object({
	planDrafter: Type.Optional(ModelConfigSchema),
	planReviewer: Type.Optional(TieredModelConfigSchema),
	implementer: Type.Optional(ModelConfigSchema),
	codeReviewer: Type.Optional(TieredModelConfigSchema),
	addressReview: Type.Optional(ModelConfigSchema),
	agentCommitMessageWriter: Type.Optional(ModelConfigSchema),
	// commitMessageWriter allowed in config but silently ignored (R5a)
	commitMessageWriter: Type.Optional(Type.Any()),
});
```

**Rationale**: 
- `discoveryAgent`, `specDrafter`, `scopingAgent`, `roadmapDrafter`, `epicDrafter` are only used as system prompts, not separate agent invocations
- `specReviewer`, `roadmapReviewer`, `epicReviewer` reviews happen conversationally (user approval), not via tiered review agents
- Only implementation-related configs are actually used

**Verify**: TypeScript compilation succeeds (schema changes will cause downstream errors - that's expected and will be fixed in subsequent steps)

---

### Step 1.2: Remove Unused Reviewer Roles from PerReviewerCyclesSchema

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~74-80 (PerReviewerCyclesSchema definition)

**Action**: Remove unused reviewer fields:

```typescript
// BEFORE:
export const PerReviewerCyclesSchema = Type.Object({
	specReviewer: Type.Optional(SingleReviewerCyclesSchema),
	planReviewer: Type.Optional(SingleReviewerCyclesSchema),
	codeReviewer: Type.Optional(SingleReviewerCyclesSchema),
	roadmapReviewer: Type.Optional(SingleReviewerCyclesSchema),
	epicReviewer: Type.Optional(SingleReviewerCyclesSchema),
});

// AFTER:
export const PerReviewerCyclesSchema = Type.Object({
	planReviewer: Type.Optional(SingleReviewerCyclesSchema),
	codeReviewer: Type.Optional(SingleReviewerCyclesSchema),
});
```

**Verify**: Schema compiles correctly

---

### Step 1.3: Remove Discovery Configuration from SpecPipelineConfigSchema

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~95-100 (SpecPipelineConfigSchema definition)

**Action**: Remove the entire `discovery` field:

```typescript
// BEFORE (lines ~83-110):
export const SpecPipelineConfigSchema = Type.Object({
	specsDir: Type.Optional(Type.String()),
	testCommand: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	contextFiles: Type.Optional(Type.Array(Type.String())),
	specTemplatePath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specConventionsPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specFormat: Type.Optional(Type.String()),
	discovery: Type.Optional(Type.Object({
		enabled: Type.Optional(Type.Boolean()),
		maxRounds: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
		questionsPerRound: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
	})),
	models: Type.Optional(ModelsConfigSchema),
	reviewCycles: Type.Optional(ReviewCyclesConfigSchema),
	skipPlanGeneration: Type.Optional(Type.Boolean()),
});

// AFTER:
export const SpecPipelineConfigSchema = Type.Object({
	specsDir: Type.Optional(Type.String()),
	testCommand: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	contextFiles: Type.Optional(Type.Array(Type.String())),
	specTemplatePath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specConventionsPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	specFormat: Type.Optional(Type.String()),
	models: Type.Optional(ModelsConfigSchema),
	reviewCycles: Type.Optional(ReviewCyclesConfigSchema),
	skipPlanGeneration: Type.Optional(Type.Boolean()),
});
```

**Verify**: Schema compiles, downstream TypeScript errors expected (fixed in next steps)

---

### Step 1.4: Update NormalizedReviewCycles Interface

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~128-134 (NormalizedReviewCycles interface)
**Pattern Reference**: Based on existing two-reviewer structure

**Action**: Remove unused reviewers:

```typescript
// BEFORE:
export interface NormalizedReviewCycles {
	specReviewer: { cheap: number; expensive: number };
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
	roadmapReviewer: { cheap: number; expensive: number };
	epicReviewer: { cheap: number; expensive: number };
}

// AFTER:
export interface NormalizedReviewCycles {
	planReviewer: { cheap: number; expensive: number };
	codeReviewer: { cheap: number; expensive: number };
}
```

**Verify**: Interface compiles correctly

---

### Step 1.5: Update ProjectConfig Models Interface

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~205-222 (ProjectConfig interface, models field)

**Action**: Remove unused model configurations:

```typescript
// BEFORE (models field within ProjectConfig interface):
	models: {
		discoveryAgent: ModelConfig;
		specDrafter: ModelConfig;
		specReviewer: TieredModelConfig;
		planDrafter: ModelConfig;
		planReviewer: TieredModelConfig;
		implementer: ModelConfig;
		codeReviewer: TieredModelConfig;
		addressReview: ModelConfig;
		agentCommitMessageWriter: ModelConfig;
		// Hierarchy roles
		scopingAgent: ModelConfig;
		roadmapDrafter: ModelConfig;
		roadmapReviewer: TieredModelConfig;
		epicDrafter: ModelConfig;
		epicReviewer: TieredModelConfig;
	};

// AFTER:
	models: {
		planDrafter: ModelConfig;
		planReviewer: TieredModelConfig;
		implementer: ModelConfig;
		codeReviewer: TieredModelConfig;
		addressReview: ModelConfig;
		agentCommitMessageWriter: ModelConfig;
	};
```

**Verify**: TypeScript compilation - expect errors in config.ts and other files using these fields

---

### Step 1.6: Remove Discovery Field from ProjectConfig Interface

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~197-203 (discovery field in ProjectConfig)

**Action**: Remove the entire discovery configuration object:

```typescript
// BEFORE:
export interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	specTemplate: string | null;
	specTemplatePath: string | null;
	specConventions: string | null;
	specConventionsPath: string | null;
	specFormat: string;
	// Discovery configuration
	discovery: {
		enabled: boolean;
		maxRounds: number;
		questionsPerRound: number;
	};
	models: { /* ... */ };
	reviewCycles: NormalizedReviewCycles;
	skipPlanGeneration: boolean;
}

// AFTER:
export interface ProjectConfig {
	specsDir: string;
	testCommand: string | null;
	contextFiles: string[];
	projectContext: string;
	specTemplate: string | null;
	specTemplatePath: string | null;
	specConventions: string | null;
	specConventionsPath: string | null;
	specFormat: string;
	models: { /* ... */ };  // Already updated in Step 1.5
	reviewCycles: NormalizedReviewCycles;  // Already updated in Step 1.4
	skipPlanGeneration: boolean;
}
```

**Verify**: TypeScript compilation - expect errors in config.ts, state.ts, index.ts (fixed in Phase 2)

---

### Step 1.7: Update TieredReviewerRole Type

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~396 (TieredReviewerRole type definition)
**Pattern Reference**: Union type of string literals

**Action**: Remove unused reviewer roles:

```typescript
// BEFORE:
export type TieredReviewerRole = "specReviewer" | "planReviewer" | "codeReviewer" | "roadmapReviewer" | "epicReviewer";

// AFTER:
export type TieredReviewerRole = "planReviewer" | "codeReviewer";
```

**Rationale**: Only `planReviewer` and `codeReviewer` use the tiered review system. Specs, roadmaps, and epics are approved conversationally.

**Verify**: 
- TypeScript compilation
- Check review.ts for usage: `const tieredReviewerRoles: TieredReviewerRole[] = ["specReviewer", "planReviewer", "codeReviewer"];` - will need update in Phase 3

---

### Step 1.8: Update RoleName Type

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~237-248 (RoleName type definition)

**Action**: Remove unused role names:

```typescript
// BEFORE:
export type RoleName = 
	| "discoveryAgent"
	| "specDrafter"
	| "specReviewer"
	| "planDrafter"
	| "planReviewer"
	| "implementer"
	| "codeReviewer"
	| "addressReview"
	| "commitMessageWriter"
	| "scopingAgent"
	| "roadmapDrafter"
	| "roadmapReviewer"
	| "epicDrafter"
	| "epicReviewer";

// AFTER:
export type RoleName = 
	| "planDrafter"
	| "planReviewer"
	| "implementer"
	| "codeReviewer"
	| "addressReview"
	| "commitMessageWriter"; // Keep for tool restrictions (read-only role)
```

**Rationale**: 
- Remove conversational roles (discoveryAgent, specDrafter, scopingAgent, roadmapDrafter, epicDrafter)
- Remove conversational review roles (specReviewer, roadmapReviewer, epicReviewer)
- Keep `commitMessageWriter` for tool restriction purposes (READ_ONLY_ROLES set)

**Verify**: TypeScript compilation - expect errors in index.ts run_spec_agent tool (fixed in Phase 3)

---

### Step 1.9: Verify READ_ONLY_ROLES and WRITE_ROLES Constants

**Files**: `extensions/spec-pipeline/types.ts`
**Lines**: ~480-483 (WRITE_ROLES and READ_ONLY_ROLES)

**Action**: Update role sets to reflect removed roles:

```typescript
// BEFORE:
export const WRITE_ROLES = new Set(["specDrafter", "planDrafter", "implementer", "addressReview", "roadmapDrafter", "epicDrafter"]);
export const READ_ONLY_ROLES = new Set(["specReviewer", "planReviewer", "codeReviewer", "commitMessageWriter", "discoveryAgent", "scopingAgent", "roadmapReviewer", "epicReviewer"]);

// AFTER:
export const WRITE_ROLES = new Set(["planDrafter", "implementer", "addressReview"]);
export const READ_ONLY_ROLES = new Set(["planReviewer", "codeReviewer", "commitMessageWriter"]);
```

**Rationale**: These sets define tool access permissions. Only implementation roles remain.

**Verify**: 
```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline
npm test types.test.ts 2>/dev/null || echo "No types.test.ts found (expected)"
```

---

### Step 1.10: Run TypeScript Compilation Check

**Files**: All TypeScript files in spec-pipeline
**Action**: Compile to verify type consistency

**Command**:
```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline
npx tsc --noEmit 2>&1 | grep -E "(error TS|types\.ts)" | head -20
```

**Expected Errors** (to be fixed in subsequent phases):
- `config.ts` - DEFAULT_MODEL_CONFIGS references removed roles
- `config.ts` - DEFAULT_TIERED_CONFIGS references removed reviewers
- `config.ts` - DEFAULT_REVIEW_CYCLES references removed reviewers
- `config.ts` - mergeWithDefaults() references removed fields
- `config.ts` - buildProjectConfig() creates discovery object
- `state.ts` - createInitialSpecState() expects discoveryConfig parameter
- `state.ts` - createInitialRoadmapState() expects discoveryConfig parameter
- `state.ts` - createInitialEpicState() expects discoveryConfig parameter
- `index.ts` - Calls to createInitial*State() functions with wrong parameters
- `index.ts` - run_spec_agent tool includes removed role literals
- `formatting.ts` - formatEffectiveConfig() references removed model configs
- `review.ts` - tieredReviewerRoles array includes removed roles

**Verify**: 
- Errors are ONLY in the expected files listed above
- No errors in types.ts itself (our changes are self-consistent)
- Errors are about "Property 'X' does not exist" (expected - will be fixed in Phase 2-4)

---

## Files Summary

### Modified Files

| File | Changes | Lines Modified |
|------|---------|----------------|
| `extensions/spec-pipeline/types.ts` | Remove 8 model config fields from ModelsConfigSchema | ~48-64 |
| `extensions/spec-pipeline/types.ts` | Remove 3 reviewer fields from PerReviewerCyclesSchema | ~74-80 |
| `extensions/spec-pipeline/types.ts` | Remove discovery field from SpecPipelineConfigSchema | ~95-100 |
| `extensions/spec-pipeline/types.ts` | Remove 3 reviewers from NormalizedReviewCycles | ~128-134 |
| `extensions/spec-pipeline/types.ts` | Remove 9 model configs from ProjectConfig.models | ~205-222 |
| `extensions/spec-pipeline/types.ts` | Remove discovery field from ProjectConfig | ~197-203 |
| `extensions/spec-pipeline/types.ts` | Remove 3 roles from TieredReviewerRole | ~396 |
| `extensions/spec-pipeline/types.ts` | Remove 9 roles from RoleName | ~237-248 |
| `extensions/spec-pipeline/types.ts` | Remove 6 roles from WRITE_ROLES and READ_ONLY_ROLES | ~480-483 |

### No New Files

All changes are modifications to existing type definitions.

---

## Completion Checklist

- [ ] **Step 1.1**: ModelsConfigSchema updated (8 fields removed)
- [ ] **Step 1.2**: PerReviewerCyclesSchema updated (3 fields removed)
- [ ] **Step 1.3**: SpecPipelineConfigSchema discovery field removed
- [ ] **Step 1.4**: NormalizedReviewCycles interface updated (3 reviewers removed)
- [ ] **Step 1.5**: ProjectConfig.models updated (9 configs removed)
- [ ] **Step 1.6**: ProjectConfig.discovery field removed
- [ ] **Step 1.7**: TieredReviewerRole type updated (3 roles removed)
- [ ] **Step 1.8**: RoleName type updated (9 roles removed)
- [ ] **Step 1.9**: WRITE_ROLES and READ_ONLY_ROLES updated
- [ ] **Step 1.10**: TypeScript compilation check shows expected errors only
- [ ] Git commit: `git commit -m "Phase 1: Remove unused schema and type definitions"`

---

## Known Issues After This Phase

**Expected TypeScript Errors**: 25-35 compilation errors in:
- config.ts (DEFAULT_* constants, mergeWithDefaults, buildProjectConfig)
- state.ts (createInitial*State function signatures)
- index.ts (createInitial*State calls, run_spec_agent tool)
- formatting.ts (formatEffectiveConfig)
- review.ts (tieredReviewerRoles array)
- Test files referencing removed configs

**Resolution**: These errors are intentional and will be systematically fixed in:
- **Phase 2**: Configuration loading and state management updates
- **Phase 3**: Command handlers and display updates  
- **Phase 4**: Test updates

**Critical Note**: After this phase, the extension will NOT function correctly. This is expected. The full cleanup requires all 4 phases.

---

## Testing Strategy

**Phase 1 Testing**: Type-level verification only
- TypeScript compilation identifies breaking changes
- No runtime tests yet (code doesn't compile)

**Post-Phase Testing** (after Phase 4):
```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline
npm test
```

**Integration Testing** (after all phases):
1. `/spec "test feature"` - Should enter discovery
2. `/spec --quick "test feature"` - Should skip discovery
3. `/implement path/to/spec.md` - Should work with simplified config
4. `/spec-status` - Should not show removed configs
5. Try loading old config → Should get clear validation error

---

## Rollback Plan

If this phase needs to be reverted:

```bash
cd /home/rpaz/code/ai_tools
git diff extensions/spec-pipeline/types.ts  # Review changes
git checkout extensions/spec-pipeline/types.ts  # Rollback
```

**Recommendation**: Complete all 4 phases in sequence rather than rolling back Phase 1 alone, as the schema cleanup is only meaningful when all phases are complete.
