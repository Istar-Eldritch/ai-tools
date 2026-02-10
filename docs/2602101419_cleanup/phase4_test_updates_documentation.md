# Phase 4: Test Updates and Documentation

**Estimated Effort**: 2 hours

## Overview

This phase updates tests to remove coverage of deleted configuration fields and updates all documentation to reflect the simplified configuration schema. It also updates the project's own config file to serve as a clean reference example.

## Prerequisites

- Phase 1 complete (schema and type system cleanup)
- Phase 2 complete (configuration loading and state management)
- Phase 3 complete (command handlers and display updates)

## Exploration Summary

**Test Patterns Observed:**
- Tests use vitest with `describe`/`it` structure
- `config.test.ts` tests DEFAULT_MODEL_CONFIGS, DEFAULT_TIERED_CONFIGS, DEFAULT_REVIEW_CYCLES
- `commit-agent.test.ts` tests commit message generation for all role types
- Tests are well-organized by feature with clear expectations

**Documentation Structure:**
- Root `README.md` shows high-level overview with example config
- `extensions/spec-pipeline/README.md` is comprehensive with detailed configuration docs
- `.pi/spec-pipeline.json` serves as reference example (currently has removed fields)

**Current State:**
- `.pi/spec-pipeline.json` includes all the fields being removed (discoveryAgent, specDrafter, specReviewer, etc.)
- Root README shows simplified config but still mentions `discovery` section
- Extension README has detailed tables for "Conversational Roles" and "Hierarchy Review Roles"

## Steps

### Step 4.1: Update config.test.ts

**Files**: `extensions/spec-pipeline/config.test.ts`

**Pattern Reference**: Based on existing test structure in the file

**Action**: Remove tests checking for removed configurations

**Before** (lines to remove):
```typescript
// In describe("formatValidationErrors") block
it("formats multiple errors", () => {
	const errors = [
		{ path: "/specsDir", message: "Expected string" },
		{ path: "/models/specDrafter/model", message: "Invalid model" },  // ← Remove this reference
	];
	const formatted = formatValidationErrors(errors);
	expect(formatted).toContain("/specsDir");
	expect(formatted).toContain("/models/specDrafter/model");  // ← Remove this line
});
```

**After**:
```typescript
// In describe("formatValidationErrors") block
it("formats multiple errors", () => {
	const errors = [
		{ path: "/specsDir", message: "Expected string" },
		{ path: "/models/planDrafter/model", message: "Invalid model" },
	];
	const formatted = formatValidationErrors(errors);
	expect(formatted).toContain("/specsDir");
	expect(formatted).toContain("/models/planDrafter/model");
});
```

**Verify**: 
```bash
cd extensions/spec-pipeline
npm test -- config.test.ts
```

### Step 4.2: Update commit-agent.test.ts

**Files**: `extensions/spec-pipeline/commit-agent.test.ts`

**Pattern Reference**: Based on existing test structure for implementation roles

**Action**: Remove test cases for removed roles

**Tests to Remove** (in `describe("role-based templates")` block):
```typescript
it("generates specDrafter message", () => { ... })
it("generates specReviewer message", () => { ... })
it("generates roadmapDrafter message", () => { ... })
it("generates epicDrafter message", () => { ... })
```

**Tests to Remove** (in `describe("document name extraction and usage")` block):
```typescript
it("includes roadmap name in commit message", () => { ... })  // uses roadmapDrafter
it("includes epic name in commit message", () => { ... })     // uses epicDrafter
it("truncates long roadmap names", () => { ... })             // uses roadmapDrafter
it("uses plain roadmap scope when docName is undefined", () => { ... })  // uses roadmapDrafter
it("includes spec name in commit message", () => { ... })     // uses specDrafter
it("uses plain spec scope when docName is undefined", () => { ... })  // uses specDrafter
it("handles spec reviewer commits with docName", () => { ... })  // uses specReviewer
it("handles roadmap reviewer commits with docName", () => { ... })  // uses roadmapReviewer
it("handles epic reviewer commits with docName", () => { ... })  // uses epicReviewer
```

**Test to Update** (in `describe("role-based templates")` block):
```typescript
// Before:
it("generates fallback chore message for unknown roles", () => {
	const context: CommitMessageContext = {
		role: "discoveryAgent" as any,
		modelConfig: { model: "sonnet", thinking: "medium" },
		files: ["notes.md"],
	};
	const result = generateCommitMessage(context);
	expect(result.type).toBe("success");
	expect(result.message).toContain("chore(pipeline): discoveryAgent changes");
});

// After:
it("generates fallback chore message for unknown roles", () => {
	const context: CommitMessageContext = {
		role: "unknownRole" as any,
		modelConfig: { model: "sonnet", thinking: "medium" },
		files: ["notes.md"],
	};
	const result = generateCommitMessage(context);
	expect(result.type).toBe("success");
	expect(result.message).toContain("chore(pipeline): unknownRole changes");
});
```

**Test to Update** (in `describe("backward compatibility")` block):
```typescript
// Before:
it("accepts but ignores agentConfig parameter", () => {
	const context: CommitMessageContext = {
		role: "specDrafter",
		modelConfig: { model: "opus", thinking: "high" },
		files: ["docs/spec.md"],
	};
	// These extra params should be accepted but ignored
	const result = generateCommitMessage(
		context,
		{ model: "haiku", thinking: "off" },
		"/fake/cwd"
	);
	expect(result.type).toBe("success");
	expect(result.message).toContain("docs(spec): draft specification");
});

// After:
it("accepts but ignores agentConfig parameter", () => {
	const context: CommitMessageContext = {
		role: "planDrafter",
		modelConfig: { model: "opus", thinking: "high" },
		files: ["docs/plan.md"],
	};
	// These extra params should be accepted but ignored
	const result = generateCommitMessage(
		context,
		{ model: "haiku", thinking: "off" },
		"/fake/cwd"
	);
	expect(result.type).toBe("success");
	expect(result.message).toContain("docs(pipeline): create implementation plan");
});
```

**Verify**: 
```bash
cd extensions/spec-pipeline
npm test -- commit-agent.test.ts
```

### Step 4.3: Update .pi/spec-pipeline.json

**Files**: `.pi/spec-pipeline.json`

**Pattern Reference**: Based on Phase 1-3 changes to remove unused fields

**Action**: Remove all unused configuration fields to serve as clean example

**Before**:
```json
{
  "specsDir": "./docs/",
  "testCommand": null,
  "contextFiles": [
    "README.md"
  ],
  "models": {
    "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
    "specDrafter": { "model": "opus", "thinking": "high" },
    "specReviewer": {
      "cheap": { "model": "sonnet", "thinking": "off" },
      "expensive": { "model": "opus", "thinking": "off" }
    },
    "planDrafter": { "model": "opus", "thinking": "high" },
    "planReviewer": {
      "cheap": { "model": "sonnet", "thinking": "off" },
      "expensive": { "model": "opus", "thinking": "off" }
    },
    "implementer": { "model": "opus", "thinking": "low" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "low" },
      "expensive": { "model": "opus", "thinking": "low" }
    },
    "addressReview": { "model": "opus", "thinking": "off" }
  },
  "reviewCycles": {
    "specReviewer": { "cheap": 0, "expensive": 0 },
    "planReviewer": { "cheap": 0, "expensive": 0 },
    "codeReviewer": { "cheap": 5, "expensive": 0 }
  }
}
```

**After**:
```json
{
  "specsDir": "./docs/",
  "testCommand": null,
  "contextFiles": [
    "README.md"
  ],
  "models": {
    "planDrafter": { "model": "opus", "thinking": "high" },
    "planReviewer": {
      "cheap": { "model": "sonnet", "thinking": "off" },
      "expensive": { "model": "opus", "thinking": "off" }
    },
    "implementer": { "model": "opus", "thinking": "low" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "low" },
      "expensive": { "model": "opus", "thinking": "low" }
    },
    "addressReview": { "model": "opus", "thinking": "off" }
  },
  "reviewCycles": {
    "planReviewer": { "cheap": 0, "expensive": 0 },
    "codeReviewer": { "cheap": 5, "expensive": 0 }
  }
}
```

**Verify**: 
```bash
# Config should validate successfully
cd extensions/spec-pipeline
npm test -- config.test.ts -t "accepts full valid config"
```

### Step 4.4: Update root README.md

**Files**: `README.md`

**Pattern Reference**: Based on existing configuration example in file

**Action**: Remove `discovery` section and unused model configs from example

**Location**: Around line 60-80 (in the Configuration section under spec-pipeline)

**Before**:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "discovery": {
    "enabled": true
  },
  "models": {
    "implementer": { "model": "opus", "thinking": "high" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    }
  },
  "reviewCycles": {
    "planReviewer": { "cheap": 2, "expensive": 1 },
    "codeReviewer": { "cheap": 3, "expensive": 2 }
  }
}
```

**After**:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "models": {
    "implementer": { "model": "opus", "thinking": "high" },
    "codeReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    }
  },
  "reviewCycles": {
    "planReviewer": { "cheap": 2, "expensive": 1 },
    "codeReviewer": { "cheap": 3, "expensive": 2 }
  }
}
```

**Verify**: Visual inspection - ensure JSON is valid and simplified

### Step 4.5: Update extension README.md - Remove Conversational Roles Table

**Files**: `extensions/spec-pipeline/README.md`

**Pattern Reference**: Based on existing "Available Roles" section structure

**Action**: Remove entire "Conversational Roles (NOT used)" table

**Location**: Around line 280-295 (in "Model Configuration" section)

**Before**:
```markdown
**Conversational Roles (NOT used - discovery/drafting is conversational):**

These roles exist in config but are NOT invoked because the host LLM handles these conversationally:

| Role | Default Model | Default Thinking | Notes |
|------|---------------|------------------|-------|
| `discoveryAgent` | sonnet | medium | NOT USED - discovery is conversational with host LLM |
| `specDrafter` | opus | high | NOT USED - spec drafting is conversational with host LLM |
| `scopingAgent` | sonnet | medium | NOT USED - scoping is conversational with host LLM |
| `roadmapDrafter` | opus | high | NOT USED - roadmap drafting is conversational |
| `epicDrafter` | opus | high | NOT USED - epic drafting is conversational |
```

**After**: (Delete entire section - no replacement)

**Verify**: Visual inspection - ensure table is completely removed

### Step 4.6: Update extension README.md - Remove Hierarchy Review Roles Table

**Files**: `extensions/spec-pipeline/README.md`

**Pattern Reference**: Based on existing "Available Roles" section structure

**Action**: Remove entire "Hierarchy Review Roles" table

**Location**: Around line 296-305 (in "Model Configuration" section, right after Conversational Roles)

**Before**:
```markdown
**Hierarchy Review Roles (defined but rarely used):**

| Role | Default Cheap | Default Expensive | Notes |
|------|---------------|-------------------|-------|
| `specReviewer` | sonnet/medium | opus/high | Review specs (not used - user approves conversationally) |
| `roadmapReviewer` | sonnet/medium | opus/high | Review roadmaps (not used - user approves conversationally) |
| `epicReviewer` | sonnet/medium | opus/high | Review epics (not used - user approves conversationally) |
```

**After**: (Delete entire section - no replacement)

**Verify**: Visual inspection - ensure table is completely removed

### Step 4.7: Update extension README.md - Remove Discovery Settings

**Files**: `extensions/spec-pipeline/README.md`

**Pattern Reference**: Based on existing "Configuration Options" section

**Action**: Remove entire "Discovery Settings" section and its table

**Location**: Around line 240-250 (in "Configuration Options" section)

**Before**:
```markdown
#### Discovery Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `discovery.enabled` | boolean | `true` | Whether discovery runs by default |
| `discovery.maxRounds` | number | `5` | Maximum conversation rounds (currently not enforced) |
| `discovery.questionsPerRound` | number | `4` | Questions per round (currently not enforced) |

**Note:** Discovery is fully conversational - these settings are legacy and not actively enforced. Discovery continues until you type `/discovery-done`.
```

**After**:
```markdown
#### Discovery Behavior

Discovery is controlled only by the `--quick` flag on commands:
- `/spec "description"` - Runs discovery conversation before drafting
- `/spec --quick "description"` - Skips discovery, goes straight to drafting
- Same applies to `/roadmap` and `/epic` commands

Discovery is fully conversational and continues until you type `/discovery-done`. There are no configuration settings for discovery behavior.
```

**Verify**: Visual inspection - ensure content accurately describes new behavior

### Step 4.8: Update extension README.md - Simplify Configuration Examples

**Files**: `extensions/spec-pipeline/README.md`

**Pattern Reference**: Based on Phase 4.4 root README changes

**Action**: Remove unused fields from all configuration examples

**Location 1**: Around line 230 (in "Configuration" section)

**Before**:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "discovery": {
    "enabled": true,
    "maxRounds": 5,
    "questionsPerRound": 4
  },
  "models": {
    "specDrafter": { "model": "opus", "thinking": "high" },
    "implementer": { "model": "opus", "thinking": "high" }
  },
  "reviewCycles": {
    "specReviewer": { "cheap": 2, "expensive": 1 },
    "codeReviewer": { "cheap": 3, "expensive": 2 }
  }
}
```

**After**:
```json
{
  "specsDir": "docs/specs",
  "testCommand": "npm test",
  "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
  "models": {
    "implementer": { "model": "opus", "thinking": "high" }
  },
  "reviewCycles": {
    "codeReviewer": { "cheap": 3, "expensive": 2 }
  }
}
```

**Location 2**: Around line 260 (in "Model Configuration" section)

**Before**:
```json
{
  "models": {
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
    "addressReview": { "model": "sonnet", "thinking": "medium" }
  }
}
```

**After**: (Keep this one as-is - it shows all valid implementation roles)

**Verify**: Visual inspection - ensure examples are consistent with schema

### Step 4.9: Run Full Test Suite

**Action**: Verify all tests pass after updates

**Commands**:
```bash
cd /home/rpaz/code/ai_tools/extensions/spec-pipeline
npm test
```

**Expected Output**: All tests passing, no errors

**If failures occur**:
1. Review error messages carefully
2. Check if any test still references removed configs
3. Verify test expectations match new behavior
4. Fix issues and re-run

**Verify**: Exit code 0 from test command

### Step 4.10: Manual Testing - Config Validation

**Action**: Verify old config format fails with clear error message

**Test File**: Create temporary test config with old format

**Commands**:
```bash
cd /home/rpaz/code/ai_tools

# Save current config
cp .pi/spec-pipeline.json .pi/spec-pipeline.json.backup

# Create config with old fields (should fail validation)
cat > .pi/spec-pipeline.json << 'EOF'
{
  "specsDir": "./docs/",
  "models": {
    "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
    "specDrafter": { "model": "opus", "thinking": "high" }
  }
}
EOF

# Try to run a spec command (should fail with validation error)
# This will be tested in the pi environment, not automated here
# Expected: Clear error message about unexpected properties

# Restore original config
mv .pi/spec-pipeline.json.backup .pi/spec-pipeline.json
```

**Expected Error Message**:
```
Invalid spec-pipeline configuration:

  • /models/discoveryAgent: Unexpected property
  • /models/specDrafter: Unexpected property

Please fix .pi/spec-pipeline.json and try again.
```

**Verify**: Error message is clear and helpful

## Files Summary

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/config.test.ts` | Remove test for `/models/specDrafter/model` validation error |
| `extensions/spec-pipeline/commit-agent.test.ts` | Remove 13 test cases for removed roles (specDrafter, specReviewer, roadmapDrafter, roadmapReviewer, epicDrafter, epicReviewer); update 2 test cases to use valid roles |
| `.pi/spec-pipeline.json` | Remove discoveryAgent, specDrafter, specReviewer, roadmapDrafter, epicDrafter, roadmapReviewer, epicReviewer from models; remove specReviewer, roadmapReviewer, epicReviewer from reviewCycles |
| `README.md` | Remove `discovery` section from configuration example |
| `extensions/spec-pipeline/README.md` | Remove "Conversational Roles" table, remove "Hierarchy Review Roles" table, replace "Discovery Settings" section with "Discovery Behavior" explanation, simplify configuration examples |

### No New Files

All changes are modifications to existing files.

## Completion Checklist

- [ ] Step 4.1: config.test.ts updated and passing
- [ ] Step 4.2: commit-agent.test.ts updated and passing
- [ ] Step 4.3: .pi/spec-pipeline.json cleaned up
- [ ] Step 4.4: Root README.md updated
- [ ] Step 4.5: Extension README - Conversational Roles table removed
- [ ] Step 4.6: Extension README - Hierarchy Review Roles table removed
- [ ] Step 4.7: Extension README - Discovery Settings updated
- [ ] Step 4.8: Extension README - Configuration examples simplified
- [ ] Step 4.9: Full test suite passing
- [ ] Step 4.10: Manual validation testing complete
- [ ] All tests pass with `npm test`
- [ ] Old config format fails with clear error message
- [ ] Documentation accurately reflects new schema
- [ ] No references to removed configs remain

## Testing Strategy

**Unit Tests**:
- `config.test.ts` - Validates configuration schema enforcement
- `commit-agent.test.ts` - Validates commit message generation for valid roles only

**Integration Tests**:
- Full test suite must pass
- Config validation must reject old format

**Manual Tests**:
- Try old config format → should get clear validation error
- Check `/spec-status` → should not display removed configs
- Verify documentation is accurate and helpful

## Success Criteria

1. All tests pass (`npm test` exits with 0)
2. Old config format rejected with helpful error message
3. Documentation doesn't reference removed configs
4. Configuration examples are consistent with schema
5. `.pi/spec-pipeline.json` serves as clean reference example
6. Test coverage maintained for all remaining functionality
