# Phase 4: Documentation and Finalization

**Estimated Effort**: 0.5 days

## Overview

This is the **finalization phase** that completes the cost optimization work by:
1. Validating that Phases 1-3 are fully implemented
2. Updating documentation to reflect the new model configuration and tiered review system
3. Removing outdated comments
4. Running end-to-end verification

**IMPORTANT**: This phase consists primarily of documentation updates and verification. All functional code changes are in Phases 1-3. This phase cannot proceed until Phases 1-3 are complete.

## Prerequisites

### Hard Prerequisites (Phase MUST abort if not met)

Before executing ANY step in this phase, verify the following artifacts exist. **If ANY check fails, STOP and complete the missing phase first.**

#### Phase 1 Artifacts (Configuration Schema)

Run these grep commands to verify Phase 1 completion:

```bash
# Check 1: DEFAULT_MODEL_CONFIGS constant exists
grep -n "DEFAULT_MODEL_CONFIGS" extensions/spec-pipeline/index.ts
# Expected: Match showing the constant definition

# Check 2: DEFAULT_TIERED_CONFIGS constant exists  
grep -n "DEFAULT_TIERED_CONFIGS" extensions/spec-pipeline/index.ts
# Expected: Match showing the constant definition

# Check 3: ModelConfig type exists
grep -n "type ModelConfig" extensions/spec-pipeline/index.ts
# Expected: Match showing the type definition

# Check 4: TieredModelConfig type exists
grep -n "type TieredModelConfig\|TieredModelConfigSchema" extensions/spec-pipeline/index.ts
# Expected: Match showing the type/schema definition

# Check 5: formatValidationErrors function exists
grep -n "function formatValidationErrors" extensions/spec-pipeline/index.ts
# Expected: Match showing the function definition

# Check 6: runAgentWithConfig function exists
grep -n "function runAgentWithConfig\|async function runAgentWithConfig" extensions/spec-pipeline/index.ts
# Expected: Match showing the function definition
```

**If ANY grep returns "No matches found"**: Phase 1 is incomplete. Complete Phase 1 before proceeding.

#### Phase 2 Artifacts (Verdict Parsing)

```bash
# Check 7: parseVerdict function exists
grep -n "function parseVerdict" extensions/spec-pipeline/index.ts
# Expected: Match showing the function definition

# Check 8: Verdict type exists
grep -n "type Verdict\|APPROVED\|NEEDS_CHANGES" extensions/spec-pipeline/index.ts
# Expected: Matches showing verdict handling
```

**If ANY grep returns "No matches found"**: Phase 2 is incomplete. Complete Phase 2 before proceeding.

#### Phase 3 Artifacts (Tiered Reviews)

```bash
# Check 9: runTieredReview function exists
grep -n "function runTieredReview\|async function runTieredReview" extensions/spec-pipeline/index.ts
# Expected: Match showing the function definition

# Check 10: Discovery agent uses runAgentWithConfig (not runAgent with "opus")
grep -n "runAgentWithConfig.*discoveryAgent\|discoveryConfig.*runAgentWithConfig" extensions/spec-pipeline/index.ts
# Expected: Match showing discovery uses new config-based function

# Check 11: Discovery agent no longer hardcodes "opus"
grep -A5 "SYSTEM_PROMPTS.discoveryAgent" extensions/spec-pipeline/index.ts | grep -v "runAgent.*opus"
# Expected: Should NOT find runAgent("opus"...) near discoveryAgent calls
```

**If Check 10 fails or Check 11 shows "opus" hardcoded**: Phase 3 is incomplete. Complete Phase 3 before proceeding.

### Verification Script

Create a verification script at the start of Phase 4:

```bash
#!/bin/bash
# phase4_prereq_check.sh - Run before starting Phase 4

echo "=== Phase 4 Prerequisite Check ==="
FAILED=0

check() {
    if ! grep -q "$2" extensions/spec-pipeline/index.ts 2>/dev/null; then
        echo "❌ MISSING: $1"
        FAILED=1
    else
        echo "✓ Found: $1"
    fi
}

check "DEFAULT_MODEL_CONFIGS" "DEFAULT_MODEL_CONFIGS"
check "DEFAULT_TIERED_CONFIGS" "DEFAULT_TIERED_CONFIGS"
check "ModelConfig type" "type ModelConfig"
check "formatValidationErrors" "function formatValidationErrors"
check "runAgentWithConfig" "runAgentWithConfig"
check "parseVerdict" "function parseVerdict"
check "runTieredReview" "runTieredReview"

echo ""
if [ $FAILED -eq 1 ]; then
    echo "❌ PHASE 4 BLOCKED: Complete missing phases first"
    exit 1
else
    echo "✓ All prerequisites met - Phase 4 can proceed"
    exit 0
fi
```

Run: `bash phase4_prereq_check.sh`

**If exit code is 1**: Do NOT proceed with Phase 4.

## Steps

### Step 4.1: Run Prerequisite Verification

- **Action**: Execute the prerequisite check script above
- **Expected Output**: All checks pass, script exits with code 0
- **If Failed**: Stop. Return to the incomplete phase and complete it first.

### Step 4.2: Update Extension Header Documentation

- **Files**: `extensions/spec-pipeline/index.ts`
- **Location**: Lines 1-34 (header comment block) - **Note**: Line numbers may have shifted due to Phase 1-3 additions. Find the block starting with `/**` and containing "Spec Pipeline Extension"
- **Action**: Replace the entire header comment block with updated documentation

**Find this block** (search for "Spec Pipeline Extension"):
```typescript
/**
 * Spec Pipeline Extension
 *
 * Automates the spec → implementation workflow with multiple specialized agents:
 *
 * 1. User prompts for spec draft
 * 2. Opus drafts spec
 * ...
```

**Replace with**:
```typescript
/**
 * Spec Pipeline Extension
 *
 * Automates the spec → implementation workflow with configurable AI agents:
 *
 * 1. Discovery (optional): Sonnet asks clarifying questions
 * 2. Spec Drafting: Opus drafts technical specification
 * 3. Spec Review: Tiered review (Sonnet → Opus), user approves or requests changes
 * 4. For each implementation phase:
 *    - Plan Drafting: Opus drafts implementation plan
 *    - Plan Review: Tiered review (Sonnet → Opus)
 * 5. Haiku creates commit message for spec
 * 6. For each implementation phase:
 *    - Implementation: Opus implements according to plan
 *    - Code Review: Tiered review (Sonnet → Opus)
 *    - Haiku creates commit after phase completion
 *
 * Tiered Review System:
 *   - Cheap tier (default: Sonnet) runs first for initial review cycles
 *   - Expensive tier (default: Opus) runs as final quality gate
 *   - Fixes during expensive tier stay at expensive tier
 *
 * Usage:
 *   /spec <description of what you want to build>
 *   /spec --quick <description>                     # Skip discovery phase
 *   /spec-resume                                    # Resume last pipeline
 *   /spec-status                                    # Show current state
 *   /spec-list                                      # List all pipelines
 *   /spec-cancel                                    # Cancel current pipeline
 *
 * Configuration:
 *   Create .pi/spec-pipeline.json in your project root:
 *   {
 *     "specsDir": "docs/specs",
 *     "testCommand": "npm test",
 *     "contextFiles": ["CONTRIBUTING.md", "docs/architecture.md"],
 *     "discovery": { "enabled": true, "maxRounds": 5, "questionsPerRound": 4 },
 *     "models": {
 *       "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
 *       "specDrafter": { "model": "opus", "thinking": "high" },
 *       "specReviewer": {
 *         "cheap": { "model": "sonnet", "thinking": "medium" },
 *         "expensive": { "model": "opus", "thinking": "high" }
 *       }
 *       // ... other roles
 *     },
 *     "reviewCycles": { "cheap": 2, "expensive": 2 }
 *   }
 *
 * Default Model Configuration (optimized for cost/quality balance):
 *   - discoveryAgent: Sonnet (question generation doesn't need Opus)
 *   - specDrafter: Opus (complex synthesis task)
 *   - specReviewer: Sonnet → Opus (tiered)
 *   - planDrafter: Opus (complex planning task)
 *   - planReviewer: Sonnet → Opus (tiered)
 *   - implementer: Opus (complex code generation)
 *   - codeReviewer: Sonnet → Opus (tiered)
 *   - addressReview: Opus (complex fix implementation)
 *   - commitMessageWriter: Haiku (fixed, not configurable)
 */
```

- **Verify**: `grep -A5 "Spec Pipeline Extension" extensions/spec-pipeline/index.ts` shows "configurable AI agents"

### Step 4.3: Remove Outdated discoveryAgent Comment

- **Files**: `extensions/spec-pipeline/index.ts`
- **Location**: Search for "NOTE: discoveryAgent system prompt to be added in Phase 2"
- **Action**: Remove the outdated comment

**Find** (use grep to locate exact line):
```bash
grep -n "discoveryAgent system prompt to be added" extensions/spec-pipeline/index.ts
```

**Current code** (around READ_ONLY_ROLES):
```typescript
// Roles that only need to read and analyze
// NOTE: discoveryAgent system prompt to be added in Phase 2 (agents-config.mts)
const READ_ONLY_ROLES = new Set(["specReviewer", "planReviewer", "codeReviewer", "commitMessageWriter", "discoveryAgent"]);
```

**Replace with**:
```typescript
// Roles that only need to read and analyze (no write/edit access)
const READ_ONLY_ROLES = new Set(["specReviewer", "planReviewer", "codeReviewer", "commitMessageWriter", "discoveryAgent"]);
```

- **Verify**: `grep "discoveryAgent system prompt to be added" extensions/spec-pipeline/index.ts` returns no matches

### Step 4.4: Add Legacy Comment to AGENTS Constant

- **Files**: `extensions/spec-pipeline/index.ts`
- **Location**: Search for `const AGENTS = {`
- **Action**: Add documentation explaining AGENTS is legacy

**Find** (use grep):
```bash
grep -n "const AGENTS = {" extensions/spec-pipeline/index.ts
```

**Current code**:
```typescript
// Agent configurations
const AGENTS = {
	opus: {
```

**Replace with**:
```typescript
/**
 * Legacy agent configurations
 *
 * Used by the original `runAgent` function for backward compatibility.
 * New code should use `runAgentWithConfig` with `ProjectConfig.models` instead.
 *
 * @see DEFAULT_MODEL_CONFIGS for optimized default configurations
 * @see runAgentWithConfig for the config-based agent runner
 */
const AGENTS = {
	opus: {
```

- **Verify**: `grep -B3 "const AGENTS = {" extensions/spec-pipeline/index.ts` shows "Legacy agent configurations"

### Step 4.5: Update README.md Workflow Description

- **Files**: `README.md`
- **Location**: Lines 22-32 (spec-pipeline description section)
- **Action**: Update the workflow description to reflect tiered reviews

**Find this section**:
```markdown
### spec-pipeline

Automates the spec → implementation workflow with multiple specialized agents:

1. **Spec Drafting**: Opus drafts a technical specification
2. **Spec Review**: Opus reviews the draft, user approves or requests changes
3. **Plan Generation**: For each implementation phase, Opus creates detailed plans
4. **Implementation**: Opus implements, Opus reviews, addresses feedback (3 cycles per phase)
5. **Commits**: Haiku writes commit messages after each cycle
```

**Replace with**:
```markdown
### spec-pipeline

Automates the spec → implementation workflow with configurable AI agents:

1. **Discovery** (optional): Sonnet asks clarifying questions to gather requirements
2. **Spec Drafting**: Opus drafts a technical specification
3. **Spec Review**: Tiered review (Sonnet → Opus), user approves or requests changes
4. **Plan Generation**: For each implementation phase, Opus creates detailed plans with tiered review
5. **Implementation**: Opus implements, tiered code review (Sonnet → Opus), Opus addresses feedback
6. **Commits**: Haiku writes commit messages after each phase

The tiered review system runs cheaper models (Sonnet) first, then expensive models (Opus) as a final quality gate, optimizing costs while maintaining quality.
```

- **Verify**: `grep "tiered review" README.md` returns matches

### Step 4.6: Add Model Configuration Documentation to README

- **Files**: `README.md`
- **Location**: After the existing configuration JSON block and table (around lines 37-58)
- **Action**: Expand the configuration documentation

**Find the existing config section** (ends with the discovery options table):
```markdown
| `discovery.questionsPerRound` | number | `4` | Target questions per round |
```

**Add after that line** (before the `### pi-wakatime` section):
```markdown
| `models` | object | see below | Model configuration per role |
| `reviewCycles.cheap` | number | `2` | Review cycles for cheap tier |
| `reviewCycles.expensive` | number | `2` | Review cycles for expensive tier |

**Model Configuration:**

All models are configurable via the `models` object. Example:
```json
{
  "models": {
    "discoveryAgent": { "model": "sonnet", "thinking": "medium" },
    "specReviewer": {
      "cheap": { "model": "sonnet", "thinking": "medium" },
      "expensive": { "model": "opus", "thinking": "high" }
    }
  },
  "reviewCycles": { "cheap": 2, "expensive": 2 }
}
```

| Role | Default Model | Default Thinking | Notes |
|------|---------------|------------------|-------|
| `discoveryAgent` | sonnet | medium | Question generation |
| `specDrafter` | opus | high | Complex synthesis |
| `specReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `planDrafter` | opus | high | Complex planning |
| `planReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `implementer` | opus | high | Code generation |
| `codeReviewer` | tiered | - | cheap: sonnet/medium, expensive: opus/high |
| `addressReview` | opus | high | Fix implementation |
| `commitMessageWriter` | haiku | off | Fixed, not configurable |

Reviewer roles use tiered configuration (`cheap`/`expensive` tiers). Other roles use flat `{ model, thinking }` configuration.
```

- **Verify**: `grep "reviewCycles.cheap" README.md` returns a match

### Step 4.7: Verify Extension Compiles and Loads

- **Action**: Test that the extension loads correctly in pi

```bash
# Navigate to project root
cd /home/istar/code/ai_tools

# Start pi and test commands (manual verification)
pi

# In pi, run these commands:
# /spec-status
# /spec-list
```

**Expected output for `/spec-status`**:
- Should display current pipeline status or "No active pipeline"
- Should NOT show any TypeScript/import errors

**Expected output for `/spec-list`**:
- Should display list of pipelines or "No pipelines found"
- Should NOT crash or show errors

### Step 4.8: End-to-End Verification (Manual Testing)

Run the following test scenarios to verify the complete implementation:

#### Test 1: Default Configuration Display

```bash
# Create a test directory without config
mkdir -p /tmp/spec-test && cd /tmp/spec-test
git init
echo "# Test" > README.md

# Start pi and run:
# /spec "Add a hello world feature"
```

**Expected behavior**:
- Configuration display shows default values
- Discovery phase log shows: `🔍 sonnet generating questions...` (NOT opus)
- Spec review shows tiered cycles (cheap tier then expensive tier)

**Verify with grep** (after running `/spec`):
```bash
# Check discovery uses sonnet
grep -i "sonnet.*question\|question.*sonnet" /tmp/spec-test/.pi/spec-pipeline/*.log 2>/dev/null || echo "Check log manually"
```

#### Test 2: Custom Configuration

```bash
mkdir -p /tmp/spec-test2/.pi && cd /tmp/spec-test2
git init
cat > .pi/spec-pipeline.json << 'EOF'
{
  "models": {
    "discoveryAgent": { "model": "opus", "thinking": "high" }
  },
  "reviewCycles": { "cheap": 1, "expensive": 1 }
}
EOF

# Start pi and run:
# /spec "Test custom config"
```

**Expected behavior**:
- Discovery phase should use opus (overridden)
- Review cycles should be 1 each (not default 2)

#### Test 3: Invalid Configuration

```bash
mkdir -p /tmp/spec-test3/.pi && cd /tmp/spec-test3
git init
cat > .pi/spec-pipeline.json << 'EOF'
{
  "models": {
    "discoveryAgent": { "model": "gpt4", "thinking": "high" }
  }
}
EOF

# Start pi and run:
# /spec "Test invalid config"
```

**Expected behavior**:
- Clear error message about invalid model
- Error should mention valid options: "opus", "sonnet", "haiku"
- Pipeline should NOT start

#### Test 4: commitMessageWriter Ignored

```bash
mkdir -p /tmp/spec-test4/.pi && cd /tmp/spec-test4
git init
cat > .pi/spec-pipeline.json << 'EOF'
{
  "models": {
    "commitMessageWriter": { "model": "opus", "thinking": "high" }
  }
}
EOF

# Start pi and run:
# /spec "Test commitMessageWriter ignored"
```

**Expected behavior**:
- No validation error
- Pipeline starts normally
- commitMessageWriter still uses haiku (the override is silently ignored per R5a)

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| (none) | Phase 4 creates no new code files |

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Header comment update, remove outdated comment, add AGENTS legacy comment |
| `README.md` | Workflow description update, model configuration documentation |

## Completion Checklist

### Prerequisites Verified
- [ ] Phase 1 complete: `grep "DEFAULT_MODEL_CONFIGS" extensions/spec-pipeline/index.ts` returns match
- [ ] Phase 1 complete: `grep "runAgentWithConfig" extensions/spec-pipeline/index.ts` returns match
- [ ] Phase 2 complete: `grep "parseVerdict" extensions/spec-pipeline/index.ts` returns match
- [ ] Phase 3 complete: `grep "runTieredReview" extensions/spec-pipeline/index.ts` returns match

### Documentation Updates
- [ ] Step 4.2: Extension header comment updated
- [ ] Step 4.3: Outdated discoveryAgent comment removed
- [ ] Step 4.4: AGENTS constant documented as legacy
- [ ] Step 4.5: README workflow description updated
- [ ] Step 4.6: README model configuration documented

### Verification
- [ ] Step 4.7: Extension loads in pi without errors
- [ ] Step 4.8 Test 1: Default config uses sonnet for discovery
- [ ] Step 4.8 Test 2: Custom config overrides work
- [ ] Step 4.8 Test 3: Invalid config shows helpful error
- [ ] Step 4.8 Test 4: commitMessageWriter config is silently ignored

## Note: Enhancement Recommendation for Phase 1

During Phase 1 implementation, consider enhancing the `formatValidationErrors` function to include helpful hints for model configuration errors:

```typescript
// In formatValidationErrors (Phase 1 Step 1.6), add hints:
function formatValidationErrors(errors: ConfigValidationError[]): string {
	const lines: string[] = [
		"Invalid spec-pipeline configuration:",
		"",
	];
	
	for (const error of errors) {
		let hint = "";
		// Add helpful hints for common model configuration errors
		if (error.path.includes("model")) {
			hint = ' (valid: "opus", "sonnet", "haiku")';
		} else if (error.path.includes("thinking")) {
			hint = ' (valid: "high", "medium", "off")';
		}
		lines.push(`  • ${error.path || "root"}: ${error.message}${hint}`);
	}
	
	lines.push("");
	lines.push("Please fix .pi/spec-pipeline.json and try again.");
	
	return lines.join("\n");
}
```

This enhancement should be part of Phase 1, not Phase 4, since it modifies a function created in Phase 1.

## Cost Impact Summary

After implementing all four phases, the expected cost reduction:

| Role | Before | After (Default) | Savings |
|------|--------|-----------------|---------|
| discoveryAgent | opus/high | sonnet/medium | ~80% |
| specReviewer | opus/high (all cycles) | sonnet/medium + opus/high | ~40-50% |
| planReviewer | opus/high (all cycles) | sonnet/medium + opus/high | ~40-50% |
| codeReviewer | opus/high (all cycles) | sonnet/medium + opus/high | ~40-50% |

**Overall estimated cost reduction**: 40-60% depending on how many issues are found in cheap tier reviews.
