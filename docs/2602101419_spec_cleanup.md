# Spec-Pipeline Configuration Cleanup

**Status**: Draft  
**Created**: 2026-02-10  
**Spec ID**: 2602101419

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The spec-pipeline extension has evolved from using separate agent invocations for discovery/drafting to using conversational mode with the host LLM. During this evolution, several configuration options became unused but remained in the schema, creating confusion for users who see options in documentation that don't actually affect behavior.

The configuration surface area is larger than necessary, exposing internal implementation details that users shouldn't need to configure. This violates the principle of hiding complexity and creates maintenance burden through unused code paths.

#### Current State

**Configuration Schema Issues:**

The current `.pi/spec-pipeline.json` schema includes:

1. **Unused Model Configurations** (defined but only used for display):
   - `discoveryAgent` - System prompt used by host LLM, not separate agent
   - `specDrafter` - System prompt used by host LLM, not separate agent
   - `scopingAgent` - System prompt used by host LLM, not separate agent
   - `roadmapDrafter` - System prompt used by host LLM, not separate agent
   - `epicDrafter` - System prompt used by host LLM, not separate agent

2. **Unused Tiered Review Configurations** (never invoked):
   - `specReviewer` - Specs approved conversationally by user, not by agent
   - `roadmapReviewer` - Roadmaps approved conversationally by user, not by agent
   - `epicReviewer` - Epics approved conversationally by user, not by agent

3. **Unused Discovery Settings** (documented as "not enforced"):
   - `discovery.enabled` - Redundant with `--quick` flag
   - `discovery.maxRounds` - Never checked in code
   - `discovery.questionsPerRound` - Never checked in code

**Code State:**

- `agents-config.ts` contains system prompts for these roles (STILL NEEDED - used for host LLM injection)
- `types.ts` includes these in both `ModelsConfigSchema` (user-facing) and `ProjectConfig["models"]` (internal)
- `config.ts` defines defaults and merges user config for these unused fields
- `formatting.ts` displays these configs in status output
- `state.ts` passes `discoveryConfig` to state creation functions
- `index.ts` uses `projectConfig.discovery.enabled` to determine initial stage
- `review.ts` includes these in `TieredReviewerRole` type
- Test files reference these unused configurations

**What Actually Works:**

- Discovery/drafting are conversational with host LLM using system prompt injection
- Only `--quick` flag controls whether discovery runs
- Only implementation-related configs are actually used: `planDrafter`, `planReviewer`, `implementer`, `codeReviewer`, `addressReview`

#### Key Issues

| ID | Issue | Impact |
|----|-------|--------|
| I1 | Users see 8 unused config options in docs | Confusion about what's configurable |
| I2 | Discovery settings documented but ignored | False sense of control |
| I3 | Schema validates unused fields | Wasted validation logic |
| I4 | Internal types include unused fields | Code complexity |
| I5 | Tests cover unused configurations | Maintenance burden |
| I6 | Documentation explains non-existent behavior | Trust erosion |

### 2. Requirements

#### Schema Cleanup Requirements

**R1**: Remove the following fields from `ModelsConfigSchema` in `types.ts`:
- `discoveryAgent`
- `specDrafter`
- `scopingAgent`
- `roadmapDrafter`
- `epicDrafter`
- `specReviewer`
- `roadmapReviewer`
- `epicReviewer`

**R2**: Remove the entire `discovery` configuration section from `SpecPipelineConfigSchema` in `types.ts`, including:
- `discovery.enabled`
- `discovery.maxRounds`
- `discovery.questionsPerRound`

**R3**: Remove these fields from `ProjectConfig["models"]` interface in `types.ts`.

**R4**: Remove the `discovery` field from `ProjectConfig` interface in `types.ts`.

**R5**: Keep the `DiscoveryState` interface unchanged (this tracks runtime state, not configuration).

#### Type System Updates

**R6**: Update `TieredReviewerRole` type in `types.ts` to only include:
- `planReviewer`
- `codeReviewer`

**R7**: Update `NormalizedReviewCycles` interface in `types.ts` to only include:
- `planReviewer`
- `codeReviewer`

**R8**: Update `RoleName` type in `types.ts` to remove:
- `discoveryAgent`
- `specDrafter`
- `scopingAgent`
- `roadmapDrafter`
- `roadmapReviewer`
- `epicDrafter`
- `epicReviewer`

#### Configuration Loading Updates

**R9**: Remove from `DEFAULT_MODEL_CONFIGS` in `config.ts`:
- `discoveryAgent`
- `scopingAgent`
- `roadmapDrafter`
- `epicDrafter`

**R10**: Remove from `DEFAULT_TIERED_CONFIGS` in `config.ts`:
- `specReviewer`
- `roadmapReviewer`
- `epicReviewer`

**R11**: Remove from `DEFAULT_REVIEW_CYCLES` in `config.ts`:
- `specReviewer`
- `roadmapReviewer`
- `epicReviewer`

**R12**: Update `mergeWithDefaults()` function in `config.ts` to:
- Remove references to deleted model configs
- Remove references to deleted review cycles
- Remove `discoveryConfig` object construction

**R13**: Update `buildProjectConfig()` function in `config.ts` to:
- Remove `discoveryConfig` object creation
- Remove `discovery` field from returned `ProjectConfig`

#### State Management Updates

**R14**: Update `createInitialSpecState()` in `state.ts`:
- Remove `discoveryConfig` parameter
- Change logic from `const shouldSkip = skipDiscovery || !discoveryConfig.enabled;` to `const shouldSkip = skipDiscovery;`
- Discovery now controlled ONLY by `--quick` flag

**R15**: Update `createInitialRoadmapState()` in `state.ts`:
- Remove `discoveryConfig` parameter
- Apply same logic change as R14

**R16**: Update `createInitialEpicState()` in `state.ts`:
- Remove `discoveryConfig` parameter
- Apply same logic change as R14

#### Command Handler Updates

**R17**: Update all calls to `createInitialSpecState()` in `index.ts`:
- Remove `projectConfig.discovery` argument
- Update to: `createInitialSpecState(description, specTimestamp, shortName, projectConfig.specsDir, isQuick, projectConfig.specFormat)`

**R18**: Update all calls to `createInitialRoadmapState()` in `index.ts`:
- Remove `projectConfig.discovery` argument

**R19**: Update all calls to `createInitialEpicState()` in `index.ts`:
- Remove `projectConfig.discovery` argument

**R20**: Update `run_spec_agent` tool schema in `index.ts`:
- Remove role literals: `"discoveryAgent"`, `"specDrafter"`, `"scopingAgent"`, `"roadmapDrafter"`, `"roadmapReviewer"`, `"epicDrafter"`, `"epicReviewer"`
- Keep only implementation-related roles

#### Display Updates

**R21**: Update `formatting.ts` to remove display of:
- `discoveryAgent`, `specDrafter`, `scopingAgent`, `roadmapDrafter`, `epicDrafter` model configs
- `specReviewer`, `roadmapReviewer`, `epicReviewer` review cycles

#### Review System Updates

**R22**: Update the `tieredReviewerRoles` array in `review.ts`:
- Change from: `["specReviewer", "planReviewer", "codeReviewer"]`
- Change to: `["planReviewer", "codeReviewer"]`

#### Test Updates

**R23**: Update `config.test.ts`:
- Remove tests checking for `discoveryAgent`, `specDrafter`, etc. in default configs
- Remove tests validating discovery settings
- Keep tests for implementation-related configs

**R24**: Update `commit-agent.test.ts`:
- Remove test cases for `discoveryAgent`, `specDrafter`, `scopingAgent`, `roadmapDrafter`, `epicDrafter` roles
- Keep tests for implementation roles

#### Documentation Updates

**R25**: Update `README.md` (root):
- Remove `discoveryAgent`, `specDrafter` from example config
- Remove `specReviewer` from example config
- Remove `discovery` section from example config
- Show simplified config with only implementation roles

**R26**: Update `extensions/spec-pipeline/README.md`:
- Remove "Conversational Roles (NOT used)" table entirely
- Remove "Hierarchy Review Roles" table entirely
- Remove discovery settings documentation (`discovery.enabled`, `discovery.maxRounds`, `discovery.questionsPerRound`)
- Update "Discovery Settings" section to explain that discovery is controlled only by `--quick` flag
- Remove config examples showing these removed fields
- Simplify "Model Configuration" section to focus only on implementation roles

**R27**: Update `.pi/spec-pipeline.json` (project config):
- Remove `discoveryAgent`, `specDrafter`, `specReviewer` from models
- This serves as the reference example for users

#### What MUST Stay Unchanged

**R28**: Keep all system prompts in `agents-config.ts`:
- `SYSTEM_PROMPTS.discoveryAgent` - Used for host LLM injection
- `SYSTEM_PROMPTS.specDrafter` - Used for host LLM injection
- `SYSTEM_PROMPTS.scopingAgent` - Used for host LLM injection
- `SYSTEM_PROMPTS.roadmapDrafter` - Used for host LLM injection
- `SYSTEM_PROMPTS.epicDrafter` - Used for host LLM injection
- These are NOT configuration, they are prompt templates

**R29**: Keep all implementation-related model configs:
- `planDrafter`
- `planReviewer`
- `implementer`
- `codeReviewer`
- `addressReview`
- `agentCommitMessageWriter`

**R30**: Keep the `DiscoveryState` interface and all runtime state tracking.

**R31**: Keep the `--quick` flag functionality unchanged.

### 3. Success Criteria

**Schema & Types:**
- [ ] `ModelsConfigSchema` does not include removed roles
- [ ] `ProjectConfig["models"]` does not include removed roles
- [ ] `ProjectConfig` does not have `discovery` field
- [ ] `TieredReviewerRole` only includes `planReviewer` and `codeReviewer`
- [ ] `NormalizedReviewCycles` only includes `planReviewer` and `codeReviewer`
- [ ] `RoleName` does not include removed roles

**Configuration:**
- [ ] `DEFAULT_MODEL_CONFIGS` does not include removed roles
- [ ] `DEFAULT_TIERED_CONFIGS` does not include removed roles
- [ ] `mergeWithDefaults()` does not reference removed configs
- [ ] User config with old fields fails validation with clear error message

**State Management:**
- [ ] `createInitialSpecState()` has no `discoveryConfig` parameter
- [ ] `createInitialRoadmapState()` has no `discoveryConfig` parameter
- [ ] `createInitialEpicState()` has no `discoveryConfig` parameter
- [ ] Discovery controlled only by `skipDiscovery` boolean

**Commands:**
- [ ] All `createInitial*State()` calls in `index.ts` updated
- [ ] `run_spec_agent` tool schema does not include removed roles
- [ ] Discovery still works with `--quick` flag
- [ ] Discovery still works without `--quick` flag

**Display:**
- [ ] `formatting.ts` does not display removed configs
- [ ] `/spec-status` does not show removed configs

**Review:**
- [ ] `tieredReviewerRoles` array only includes implementation reviewers

**Tests:**
- [ ] All tests pass
- [ ] No tests reference removed configs
- [ ] Test coverage maintained for remaining configs

**Documentation:**
- [ ] Root README shows simplified config
- [ ] Extension README explains discovery is `--quick`-controlled
- [ ] Extension README does not document removed configs
- [ ] `.pi/spec-pipeline.json` serves as clean example

**System Prompts:**
- [ ] All prompts in `agents-config.ts` still exist
- [ ] Conversational mode still uses correct prompts

### 4. Out of Scope

**OS1**: Backward compatibility for existing user configs - This is a breaking change. Users with old configs will get validation errors and must update their config files.

**OS2**: Migration tool for old configs - Users must manually remove the unused fields.

**OS3**: Deprecation warnings - We're removing immediately, not deprecating first.

**OS4**: Changes to how discovery/drafting work - Only removing config options, not changing functionality.

**OS5**: Changes to implementation workflow - Only removing unused config, implementation behavior unchanged.

### 5. Open Questions

None - discovery conversation resolved all ambiguities.

---

## PART II: Implementation Plan

| Phase | Focus | Effort |
|-------|-------|--------|
| Phase 1 | Schema and type system cleanup | 2 hours |
| Phase 2 | Configuration loading and state management | 2 hours |
| Phase 3 | Command handlers and display updates | 1 hour |
| Phase 4 | Test updates and documentation | 2 hours |

**Total Estimated Effort**: 7 hours (1 day)

---

## PART III: Technical Considerations

### Architecture Notes

**Clean Separation**: The cleanup maintains a clean separation between:
- **User configuration** (`ModelsConfigSchema`) - What users can control
- **Internal implementation** (`agents-config.ts`) - How the system works
- **Runtime state** (`DiscoveryState`) - What happens during execution

**No Refactoring Required**: System prompts remain in `agents-config.ts` and are used exactly as before. Only the configuration surface is changing.

### Integration Points

**Configuration Validation**: TypeBox validation in `config.ts` will automatically reject configs with removed fields.

**State Creation**: State creation functions simplified by removing unused parameter.

**Command Handlers**: Index.ts command handlers updated to pass fewer arguments.

### Testing Strategy

**Unit Tests**: 
- Update `config.test.ts` to remove tests for deleted configs
- Update `commit-agent.test.ts` to remove tests for deleted roles
- Ensure validation rejects old config format

**Integration Tests**:
- Verify `--quick` still skips discovery
- Verify discovery still runs without `--quick`
- Verify implementation commands work with new config

**Manual Testing**:
- Run `/spec` with and without `--quick`
- Run `/roadmap` and `/epic` with and without `--quick`
- Run `/implement` with simplified config
- Verify status displays don't show removed configs

### Error Handling

**Config Validation Errors**: When users have old configs, they'll see TypeBox validation errors like:
```
Configuration validation failed:
  - /models/discoveryAgent: Unexpected property
  - /discovery: Unexpected property
```

**Migration Path**: Users must manually edit `.pi/spec-pipeline.json` to remove unused fields.

### Performance Considerations

**Negligible Impact**: Removing validation for unused fields and simplifying state creation has negligible performance impact (microseconds).

### Security Considerations

None - this is a configuration schema cleanup with no security implications.

---

## PART IV: Dependencies & Risks

### Dependencies

**D1**: TypeBox schema validation library (already in use)

**D2**: Existing test suite (must be updated)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking user configs | High | Medium | Clear error messages, update documentation |
| Accidentally removing needed code | Low | High | Thorough testing, careful code review |
| Missing references to removed configs | Medium | Medium | Comprehensive grep/search before removal |
| Test failures | Low | Low | Run full test suite before and after |

### Mitigation Strategies

**Breaking Changes**: Accept this as intentional - the config cleanup is worth the one-time user friction.

**Code Safety**: Use grep to find ALL references to each removed field before deleting.

**Test Coverage**: Run full test suite after each phase to catch issues early.

---

## PART V: Acceptance Criteria

**Functional Requirements:**
1. Users can create specs without configuring removed roles
2. Discovery works with `--quick` flag only
3. Implementation pipeline works with simplified config
4. All existing functionality preserved (only config removed)

**Non-Functional Requirements:**
1. All tests pass
2. No console warnings or errors
3. Configuration validation gives clear error messages
4. Documentation accurately reflects new schema

**Verification Steps:**
1. Create new `.pi/spec-pipeline.json` with only implementation configs
2. Run `/spec "test feature"` → enters discovery
3. Run `/spec --quick "test feature"` → skips discovery
4. Run `/implement` on a spec → works correctly
5. Try old config format → gets clear validation error
6. Check `/spec-status` → doesn't show removed configs
