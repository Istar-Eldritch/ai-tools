# Phase 2: Configuration Loading and State Management

**Estimated Effort**: 2 hours

## Overview

This phase removes unused configuration fields from the default configurations and updates the configuration loading logic and state creation functions. We remove references to discovery/drafting/scoping roles from defaults while keeping them in the schema (to be removed in Phase 1 - schema cleanup runs first).

After Phase 1 completes, the schema will reject these fields. Phase 2 removes them from defaults and updates the state creation functions to no longer require discovery config.

## Prerequisites

- Phase 1 complete (schema and type system cleanup)
- All tests from Phase 1 passing

## Steps

### Step 2.1: Remove Unused Model Configs from Defaults (R9)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `DEFAULT_MODEL_CONFIGS` structure at lines 28-39
- **Action**: Remove unused model configurations from `DEFAULT_MODEL_CONFIGS`

**Before:**
```typescript
export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
	discoveryAgent: { model: "sonnet", thinking: "medium" },  // Question generation doesn't need Opus
	specDrafter: { model: "opus", thinking: "high" },         // Complex synthesis task
	planDrafter: { model: "opus", thinking: "high" },         // Complex planning task
	implementer: { model: "opus", thinking: "high" },         // Complex code generation
	addressReview: { model: "sonnet", thinking: "medium" },    // Fix application — issues already identified by reviewer
	agentCommitMessageWriter: { model: "haiku", thinking: "off" },  // Fast, cheap commit message generation (R5)
	// Hierarchy roles
	scopingAgent: { model: "sonnet", thinking: "medium" },    // Scoping assessment doesn't need Opus
	roadmapDrafter: { model: "opus", thinking: "high" },      // Complex decomposition task
	epicDrafter: { model: "opus", thinking: "high" },         // Complex decomposition task
} as const;
```

**After:**
```typescript
export const DEFAULT_MODEL_CONFIGS: Record<string, ModelConfig> = {
	planDrafter: { model: "opus", thinking: "high" },         // Complex planning task
	implementer: { model: "opus", thinking: "high" },         // Complex code generation
	addressReview: { model: "sonnet", thinking: "medium" },    // Fix application — issues already identified by reviewer
	agentCommitMessageWriter: { model: "haiku", thinking: "off" },  // Fast, cheap commit message generation (R5)
} as const;
```

**Verify**: 
```bash
npm test -- config.test.ts
# Tests for removed configs should be updated in Phase 4
```

### Step 2.2: Remove Unused Tiered Configs from Defaults (R10)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `DEFAULT_TIERED_CONFIGS` structure at lines 44-62
- **Action**: Remove unused tiered reviewer configurations

**Before:**
```typescript
export const DEFAULT_TIERED_CONFIGS: Record<string, TieredModelConfig> = {
	specReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	planReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	codeReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	// Hierarchy reviewers
	roadmapReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	epicReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
} as const;
```

**After:**
```typescript
export const DEFAULT_TIERED_CONFIGS: Record<string, TieredModelConfig> = {
	planReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
	codeReviewer: {
		cheap: { model: "sonnet", thinking: "medium" },
		expensive: { model: "opus", thinking: "high" },
	},
} as const;
```

**Verify**: Check that only implementation-related reviewers remain

### Step 2.3: Remove Unused Review Cycles from Defaults (R11)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `DEFAULT_REVIEW_CYCLES` structure at lines 73-79
- **Action**: Remove unused review cycle configurations

**Before:**
```typescript
export const DEFAULT_REVIEW_CYCLES: NormalizedReviewCycles = {
	specReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	planReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	codeReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	roadmapReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	epicReviewer: { ...DEFAULT_REVIEWER_CYCLES },
} as const;
```

**After:**
```typescript
export const DEFAULT_REVIEW_CYCLES: NormalizedReviewCycles = {
	planReviewer: { ...DEFAULT_REVIEWER_CYCLES },
	codeReviewer: { ...DEFAULT_REVIEWER_CYCLES },
} as const;
```

**Verify**: Matches updated `NormalizedReviewCycles` type from Phase 1

### Step 2.4: Update normalizeReviewCycles Function (R11 continuation)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `normalizeReviewCycles` function at lines 127-165
- **Action**: Update to only handle planReviewer and codeReviewer

**Before:**
```typescript
function isPerReviewerFormat(config: ReviewCyclesConfig): config is PerReviewerCycles {
	if (!config || typeof config !== "object") return false;
	// If it has any of the reviewer keys, it's per-reviewer format
	return "specReviewer" in config || "planReviewer" in config || "codeReviewer" in config
		|| "roadmapReviewer" in config || "epicReviewer" in config;
}

function normalizeReviewCycles(userReviewCycles: ReviewCyclesConfig | undefined): NormalizedReviewCycles {
	// ... existing logic ...
	if (isPerReviewerFormat(userReviewCycles)) {
		// Per-reviewer format - merge each reviewer with defaults
		return {
			specReviewer: {
				cheap: userReviewCycles.specReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.specReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			planReviewer: {
				cheap: userReviewCycles.planReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.planReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			codeReviewer: {
				cheap: userReviewCycles.codeReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.codeReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			roadmapReviewer: {
				cheap: userReviewCycles.roadmapReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.roadmapReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			epicReviewer: {
				cheap: userReviewCycles.epicReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.epicReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
		};
	}
	
	// Global format - apply to all reviewers
	const globalCheap = userReviewCycles.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap;
	const globalExpensive = userReviewCycles.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive;
	return {
		specReviewer: { cheap: globalCheap, expensive: globalExpensive },
		planReviewer: { cheap: globalCheap, expensive: globalExpensive },
		codeReviewer: { cheap: globalCheap, expensive: globalExpensive },
		roadmapReviewer: { cheap: globalCheap, expensive: globalExpensive },
		epicReviewer: { cheap: globalCheap, expensive: globalExpensive },
	};
}
```

**After:**
```typescript
function isPerReviewerFormat(config: ReviewCyclesConfig): config is PerReviewerCycles {
	if (!config || typeof config !== "object") return false;
	// If it has any of the reviewer keys, it's per-reviewer format
	return "planReviewer" in config || "codeReviewer" in config;
}

function normalizeReviewCycles(userReviewCycles: ReviewCyclesConfig | undefined): NormalizedReviewCycles {
	if (!userReviewCycles) {
		// No config provided - use defaults
		return { ...DEFAULT_REVIEW_CYCLES };
	}
	
	if (isPerReviewerFormat(userReviewCycles)) {
		// Per-reviewer format - merge each reviewer with defaults
		return {
			planReviewer: {
				cheap: userReviewCycles.planReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.planReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
			codeReviewer: {
				cheap: userReviewCycles.codeReviewer?.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap,
				expensive: userReviewCycles.codeReviewer?.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive,
			},
		};
	}
	
	// Global format - apply to all reviewers
	const globalCheap = userReviewCycles.cheap ?? DEFAULT_REVIEWER_CYCLES.cheap;
	const globalExpensive = userReviewCycles.expensive ?? DEFAULT_REVIEWER_CYCLES.expensive;
	return {
		planReviewer: { cheap: globalCheap, expensive: globalExpensive },
		codeReviewer: { cheap: globalCheap, expensive: globalExpensive },
	};
}
```

**Verify**: Function now only handles implementation reviewers

### Step 2.5: Update mergeWithDefaults Function (R12)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `mergeWithDefaults` function at lines 172-204
- **Action**: Remove references to deleted model configs

**Before:**
```typescript
function mergeWithDefaults(
	userModels: ModelsConfig | undefined,
	userReviewCycles: ReviewCyclesConfig | undefined
): {
	models: ProjectConfig["models"];
	reviewCycles: ProjectConfig["reviewCycles"];
} {
	// Build complete models config by merging user values with defaults
	// Note: commitMessageWriter from userModels is intentionally not used (R5a)
	const models: ProjectConfig["models"] = {
		discoveryAgent: userModels?.discoveryAgent ?? DEFAULT_MODEL_CONFIGS.discoveryAgent,
		specDrafter: userModels?.specDrafter ?? DEFAULT_MODEL_CONFIGS.specDrafter,
		specReviewer: userModels?.specReviewer ?? DEFAULT_TIERED_CONFIGS.specReviewer,
		planDrafter: userModels?.planDrafter ?? DEFAULT_MODEL_CONFIGS.planDrafter,
		planReviewer: userModels?.planReviewer ?? DEFAULT_TIERED_CONFIGS.planReviewer,
		implementer: userModels?.implementer ?? DEFAULT_MODEL_CONFIGS.implementer,
		codeReviewer: userModels?.codeReviewer ?? DEFAULT_TIERED_CONFIGS.codeReviewer,
		addressReview: userModels?.addressReview ?? DEFAULT_MODEL_CONFIGS.addressReview,
		agentCommitMessageWriter: userModels?.agentCommitMessageWriter ?? DEFAULT_MODEL_CONFIGS.agentCommitMessageWriter,
		// Hierarchy roles
		scopingAgent: userModels?.scopingAgent ?? DEFAULT_MODEL_CONFIGS.scopingAgent,
		roadmapDrafter: userModels?.roadmapDrafter ?? DEFAULT_MODEL_CONFIGS.roadmapDrafter,
		roadmapReviewer: userModels?.roadmapReviewer ?? DEFAULT_TIERED_CONFIGS.roadmapReviewer,
		epicDrafter: userModels?.epicDrafter ?? DEFAULT_MODEL_CONFIGS.epicDrafter,
		epicReviewer: userModels?.epicReviewer ?? DEFAULT_TIERED_CONFIGS.epicReviewer,
	};
	
	// Normalize review cycles to per-reviewer format
	const reviewCycles = normalizeReviewCycles(userReviewCycles);
	
	return { models, reviewCycles };
}
```

**After:**
```typescript
function mergeWithDefaults(
	userModels: ModelsConfig | undefined,
	userReviewCycles: ReviewCyclesConfig | undefined
): {
	models: ProjectConfig["models"];
	reviewCycles: ProjectConfig["reviewCycles"];
} {
	// Build complete models config by merging user values with defaults
	// Note: commitMessageWriter from userModels is intentionally not used (R5a)
	const models: ProjectConfig["models"] = {
		planDrafter: userModels?.planDrafter ?? DEFAULT_MODEL_CONFIGS.planDrafter,
		planReviewer: userModels?.planReviewer ?? DEFAULT_TIERED_CONFIGS.planReviewer,
		implementer: userModels?.implementer ?? DEFAULT_MODEL_CONFIGS.implementer,
		codeReviewer: userModels?.codeReviewer ?? DEFAULT_TIERED_CONFIGS.codeReviewer,
		addressReview: userModels?.addressReview ?? DEFAULT_MODEL_CONFIGS.addressReview,
		agentCommitMessageWriter: userModels?.agentCommitMessageWriter ?? DEFAULT_MODEL_CONFIGS.agentCommitMessageWriter,
	};
	
	// Normalize review cycles to per-reviewer format
	const reviewCycles = normalizeReviewCycles(userReviewCycles);
	
	return { models, reviewCycles };
}
```

**Verify**: Only implementation-related roles are merged

### Step 2.6: Update buildProjectConfig Function - Remove Discovery Config (R13)

- **Files**: `extensions/spec-pipeline/config.ts`
- **Pattern Reference**: Based on existing `buildProjectConfig` function at lines 393-489
- **Action**: Remove discoveryConfig construction and field from returned config

**Before (around lines 467-472):**
```typescript
	// Discovery configuration with defaults
	const discoveryConfig = {
		enabled: config.discovery?.enabled ?? true,
		maxRounds: config.discovery?.maxRounds ?? 5,
		questionsPerRound: config.discovery?.questionsPerRound ?? 4,
	};

	// Merge model configs with defaults (R3, R5)
	// Note: commitMessageWriter in config.models is silently ignored (R5a)
	const { models, reviewCycles } = mergeWithDefaults(
		config.models,
		config.reviewCycles
	);

	// Skip plan generation (experimental A/B testing)
	const skipPlanGeneration = config.skipPlanGeneration ?? false;

	return {
		specsDir,
		testCommand,
		contextFiles: foundFiles,
		projectContext,
		specTemplate: template.content,
		specTemplatePath: template.path,
		specConventions: conventions.content,
		specConventionsPath: conventions.path,
		specFormat,
		discovery: discoveryConfig,
		models,
		reviewCycles,
		skipPlanGeneration,
	};
```

**After:**
```typescript
	// Merge model configs with defaults (R3, R5)
	// Note: commitMessageWriter in config.models is silently ignored (R5a)
	const { models, reviewCycles } = mergeWithDefaults(
		config.models,
		config.reviewCycles
	);

	// Skip plan generation (experimental A/B testing)
	const skipPlanGeneration = config.skipPlanGeneration ?? false;

	return {
		specsDir,
		testCommand,
		contextFiles: foundFiles,
		projectContext,
		specTemplate: template.content,
		specTemplatePath: template.path,
		specConventions: conventions.content,
		specConventionsPath: conventions.path,
		specFormat,
		models,
		reviewCycles,
		skipPlanGeneration,
	};
```

**Verify**: 
```bash
npm test -- config.test.ts
# Config loading should still work, discovery field removed from ProjectConfig
```

### Step 2.7: Update createInitialSpecState - Remove discoveryConfig Parameter (R14)

- **Files**: `extensions/spec-pipeline/state.ts`
- **Pattern Reference**: Based on existing `createInitialSpecState` function at lines 262-296
- **Action**: Remove discoveryConfig parameter and simplify logic

**Before:**
```typescript
/**
 * Create initial spec state
 */
export function createInitialSpecState(
	description: string,
	specTimestamp: string,
	shortName: string,
	specsDir: string,
	discoveryConfig: ProjectConfig["discovery"],
	skipDiscovery: boolean = false,
	specFormat: string = "md"
): SpecState {
	const specFilename = `${specTimestamp}_spec_${shortName}.${specFormat}`;
	const specPath = path.join(specsDir, specFilename);
	const now = new Date().toISOString();

	const shouldSkip = skipDiscovery || !discoveryConfig.enabled;

	return {
		id: generatePipelineId(),
		description,
		stage: shouldSkip ? "spec_drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		discovery: createInitialDiscoveryState(shouldSkip),
	
		specTimestamp,
		specFilename,
		specPath,
		specDraft: "",
		specApproved: false,
		specIteration: 0,
	};
}
```

**After:**
```typescript
/**
 * Create initial spec state
 */
export function createInitialSpecState(
	description: string,
	specTimestamp: string,
	shortName: string,
	specsDir: string,
	skipDiscovery: boolean = false,
	specFormat: string = "md"
): SpecState {
	const specFilename = `${specTimestamp}_spec_${shortName}.${specFormat}`;
	const specPath = path.join(specsDir, specFilename);
	const now = new Date().toISOString();

	return {
		id: generatePipelineId(),
		description,
		stage: skipDiscovery ? "spec_drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		discovery: createInitialDiscoveryState(skipDiscovery),
	
		specTimestamp,
		specFilename,
		specPath,
		specDraft: "",
		specApproved: false,
		specIteration: 0,
	};
}
```

**Verify**: Discovery now controlled only by skipDiscovery boolean (from --quick flag)

### Step 2.8: Update createInitialRoadmapState - Remove discoveryConfig Parameter (R15)

- **Files**: `extensions/spec-pipeline/state.ts`
- **Pattern Reference**: Based on existing `createInitialRoadmapState` function at lines 538-573
- **Action**: Remove discoveryConfig parameter and simplify logic

**Before:**
```typescript
export function createInitialRoadmapState(
	description: string,
	docTimestamp: string,
	shortName: string,
	specsDir: string,
	discoveryConfig: ProjectConfig["discovery"],
	skipDiscovery: boolean = false,
	docFormat: string = "md"
): RoadmapState {
	const docFilename = `${docTimestamp}_roadmap_${shortName}.${docFormat}`;
	const docPath = path.join(specsDir, docFilename);
	const now = new Date().toISOString();

	const shouldSkip = skipDiscovery || !discoveryConfig.enabled;

	return {
		id: generatePipelineId(),
		level: "roadmap",
		description,
		stage: shouldSkip ? "drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		discovery: createInitialDiscoveryState(shouldSkip),

		docTimestamp,
		docFilename,
		docPath,
		docContent: "",
		docApproved: false,
		docIteration: 0,

		children: [],
	};
}
```

**After:**
```typescript
export function createInitialRoadmapState(
	description: string,
	docTimestamp: string,
	shortName: string,
	specsDir: string,
	skipDiscovery: boolean = false,
	docFormat: string = "md"
): RoadmapState {
	const docFilename = `${docTimestamp}_roadmap_${shortName}.${docFormat}`;
	const docPath = path.join(specsDir, docFilename);
	const now = new Date().toISOString();

	return {
		id: generatePipelineId(),
		level: "roadmap",
		description,
		stage: skipDiscovery ? "drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		discovery: createInitialDiscoveryState(skipDiscovery),

		docTimestamp,
		docFilename,
		docPath,
		docContent: "",
		docApproved: false,
		docIteration: 0,

		children: [],
	};
}
```

**Verify**: Same logic change as spec state

### Step 2.9: Update createInitialEpicState - Remove discoveryConfig Parameter (R16)

- **Files**: `extensions/spec-pipeline/state.ts`
- **Pattern Reference**: Based on existing `createInitialEpicState` function at lines 579-624
- **Action**: Remove discoveryConfig parameter and simplify logic

**Before:**
```typescript
export function createInitialEpicState(
	description: string,
	docTimestamp: string,
	shortName: string,
	specsDir: string,
	discoveryConfig: ProjectConfig["discovery"],
	skipDiscovery: boolean = false,
	docFormat: string = "md",
	parentId?: string,
	parentType?: "roadmap"
): EpicState {
	const docFilename = `${docTimestamp}_epic_${shortName}.${docFormat}`;
	const docPath = path.join(specsDir, docFilename);
	const now = new Date().toISOString();

	const shouldSkip = skipDiscovery || !discoveryConfig.enabled;

	return {
		id: generatePipelineId(),
		level: "epic",
		description,
		stage: shouldSkip ? "drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		parentId,
		parentType,

		discovery: createInitialDiscoveryState(shouldSkip),

		docTimestamp,
		docFilename,
		docPath,
		docContent: "",
		docApproved: false,
		docIteration: 0,

		children: [],
	};
}
```

**After:**
```typescript
export function createInitialEpicState(
	description: string,
	docTimestamp: string,
	shortName: string,
	specsDir: string,
	skipDiscovery: boolean = false,
	docFormat: string = "md",
	parentId?: string,
	parentType?: "roadmap"
): EpicState {
	const docFilename = `${docTimestamp}_epic_${shortName}.${docFormat}`;
	const docPath = path.join(specsDir, docFilename);
	const now = new Date().toISOString();

	return {
		id: generatePipelineId(),
		level: "epic",
		description,
		stage: skipDiscovery ? "drafting" : "discovery",
		createdAt: now,
		updatedAt: now,

		parentId,
		parentType,

		discovery: createInitialDiscoveryState(skipDiscovery),

		docTimestamp,
		docFilename,
		docPath,
		docContent: "",
		docApproved: false,
		docIteration: 0,

		children: [],
	};
}
```

**Verify**: Consistent with other state creation functions

### Step 2.10: Update State Creation Calls in index.ts - /spec Command (R17)

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Search for `createInitialSpecState` calls in index.ts
- **Action**: Update all calls to remove projectConfig.discovery argument

**Location 1** (around line 1674, in /spec command handler):
```typescript
// Before:
const state = createInitialSpecState(
	description,
	specTimestamp,
	shortName,
	projectConfig.specsDir,
	projectConfig.discovery,
	isQuick,
	projectConfig.specFormat
);

// After:
const state = createInitialSpecState(
	description,
	specTimestamp,
	shortName,
	projectConfig.specsDir,
	isQuick,
	projectConfig.specFormat
);
```

**Verify**: 
```bash
# Search for all occurrences to make sure we got them all
grep -n "createInitialSpecState" extensions/spec-pipeline/index.ts
```

### Step 2.11: Update State Creation Calls in index.ts - /roadmap Command (R18)

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Search for `createInitialRoadmapState` calls in index.ts
- **Action**: Update all calls to remove projectConfig.discovery argument

**Location** (around line 2090, in /roadmap command handler):
```typescript
// Before:
const state = createInitialRoadmapState(
	description,
	docTimestamp,
	shortName,
	projectConfig.specsDir,
	projectConfig.discovery,
	isQuick,
	projectConfig.specFormat
);

// After:
const state = createInitialRoadmapState(
	description,
	docTimestamp,
	shortName,
	projectConfig.specsDir,
	isQuick,
	projectConfig.specFormat
);
```

**Verify**: 
```bash
grep -n "createInitialRoadmapState" extensions/spec-pipeline/index.ts
```

### Step 2.12: Update State Creation Calls in index.ts - /epic Command (R19)

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Search for `createInitialEpicState` calls in index.ts
- **Action**: Update all calls to remove projectConfig.discovery argument

**Location** (around line 2235, in /epic command handler):
```typescript
// Before:
const state = createInitialEpicState(
	description,
	docTimestamp,
	shortName,
	projectConfig.specsDir,
	projectConfig.discovery,
	isQuick,
	projectConfig.specFormat,
	parentId,
	parentType
);

// After:
const state = createInitialEpicState(
	description,
	docTimestamp,
	shortName,
	projectConfig.specsDir,
	isQuick,
	projectConfig.specFormat,
	parentId,
	parentType
);
```

**Verify**: 
```bash
grep -n "createInitialEpicState" extensions/spec-pipeline/index.ts
```

### Step 2.13: Verify All State Creation Calls Updated

- **Files**: All TypeScript files in `extensions/spec-pipeline/`
- **Action**: Search entire codebase for any remaining calls to state creation functions with old signature

```bash
# Should find NO matches with 6+ arguments to createInitialSpecState
grep -rn "createInitialSpecState.*," extensions/spec-pipeline/ | grep -v "function createInitialSpecState"

# Should find NO matches with 6+ arguments to createInitialRoadmapState
grep -rn "createInitialRoadmapState.*," extensions/spec-pipeline/ | grep -v "function createInitialRoadmapState"

# Should find NO matches with 6+ arguments to createInitialEpicState
grep -rn "createInitialEpicState.*," extensions/spec-pipeline/ | grep -v "function createInitialEpicState"
```

**Verify**: All calls updated, no old signatures remain

## Files Summary

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/config.ts` | Remove unused model/review configs from defaults (Steps 2.1-2.6) |
| `extensions/spec-pipeline/state.ts` | Remove discoveryConfig parameter from state creation functions (Steps 2.7-2.9) |
| `extensions/spec-pipeline/index.ts` | Update all state creation calls to remove discovery config argument (Steps 2.10-2.12) |

### No New Files
This phase only modifies existing files.

## Completion Checklist

- [ ] Step 2.1: Removed unused model configs from DEFAULT_MODEL_CONFIGS
- [ ] Step 2.2: Removed unused tiered configs from DEFAULT_TIERED_CONFIGS
- [ ] Step 2.3: Removed unused review cycles from DEFAULT_REVIEW_CYCLES
- [ ] Step 2.4: Updated normalizeReviewCycles function
- [ ] Step 2.5: Updated mergeWithDefaults function
- [ ] Step 2.6: Updated buildProjectConfig function (removed discovery config)
- [ ] Step 2.7: Updated createInitialSpecState signature
- [ ] Step 2.8: Updated createInitialRoadmapState signature
- [ ] Step 2.9: Updated createInitialEpicState signature
- [ ] Step 2.10: Updated /spec command calls
- [ ] Step 2.11: Updated /roadmap command calls
- [ ] Step 2.12: Updated /epic command calls
- [ ] Step 2.13: Verified all state creation calls updated
- [ ] All tests pass: `npm test`
- [ ] Discovery still works with `--quick` flag
- [ ] Discovery still works without `--quick` flag
- [ ] No references to discoveryConfig remain in config/state files

## Notes

**Breaking Change Awareness**: After this phase, user configs with old discovery settings will fail validation (schema was updated in Phase 1). This is intentional and documented.

**Function Signature Changes**: All state creation functions now have one fewer parameter. TypeScript will catch any missed call sites during compilation.

**Discovery Control**: After this phase, discovery is controlled ONLY by the `--quick` flag / `skipDiscovery` boolean parameter. The config option is completely removed.
