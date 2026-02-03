# Phase 2: Verdict Standardization and Parsing

**Estimated Effort**: 1 day

## Overview

This phase standardizes all review agent prompts to use consistent verdict terminology (`APPROVED | NEEDS_CHANGES`) and implements verdict parsing logic to extract the verdict from review output. This prepares the groundwork for Phase 3's tiered review implementation, which will use these verdicts to drive flow control decisions.

## Prerequisites

- Phase 1 complete (configuration schema and loading) - OR use fallback insertion points
- Understanding of current review prompts in `agents-config.mts`

## Current State Analysis

| Role | Current Prompt Verdict | Spec Requirement | Action |
|------|------------------------|------------------|--------|
| specReviewer | `APPROVED \| NEEDS_CHANGES` | Same | None |
| planReviewer | `READY \| NEEDS_WORK` | `APPROVED \| NEEDS_CHANGES` | Update prompt |
| codeReviewer | `APPROVED \| CHANGES_REQUESTED` | `APPROVED \| NEEDS_CHANGES` | Update prompt |

Current verdict detection in `index.ts`:
- **planReviewer** (line 2232): `planReviewResult.output.includes("NEEDS") || planReviewResult.output.includes("Missing")`
- **codeReviewer** (lines 2434-2435): `codeReviewResult.output.includes("CRITICAL") || codeReviewResult.output.includes("MAJOR")`
- **specReviewer**: No verdict parsing - user manually approves

## Steps

### Step 2.1: Define Verdict Type and Parsing Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: 
  - If Phase 1 complete: Insert after the model config helpers (`getModelArgs`, `getReviewerConfig`, `getRoleConfig`)
  - If Phase 1 not complete: Insert after the type definitions ending around line 107 (after `ProjectConfig` interface)
- **Pattern Reference**: Based on existing type definitions at lines 64-90
- **Action**: Add verdict type and parsing function

```typescript
// Insert at the appropriate location (see Insertion Point above)

/**
 * Review verdict types (R11)
 */
type ReviewVerdict = "APPROVED" | "NEEDS_CHANGES";

/**
 * Parse verdict from review output (R12, R13)
 * 
 * Looks for explicit verdict markers in the output.
 * Returns NEEDS_CHANGES if no clear verdict is found (conservative behavior per R13).
 */
function parseVerdict(output: string): ReviewVerdict {
	// Normalize output for reliable matching
	const normalized = output.toUpperCase();
	
	// Look for explicit verdict markers using word boundaries
	// Word boundary \b prevents matching partial words (e.g., "UNAPPROVED")
	const approvedMatch = normalized.match(/\bAPPROVED\b/);
	const needsChangesMatch = normalized.match(/\bNEEDS_CHANGES\b/);
	
	// If both appear, use the last one (final verdict takes precedence)
	if (approvedMatch && needsChangesMatch) {
		const approvedIndex = normalized.lastIndexOf("APPROVED");
		const needsChangesIndex = normalized.lastIndexOf("NEEDS_CHANGES");
		return needsChangesIndex > approvedIndex ? "NEEDS_CHANGES" : "APPROVED";
	}
	
	if (approvedMatch) {
		return "APPROVED";
	}
	
	if (needsChangesMatch) {
		return "NEEDS_CHANGES";
	}
	
	// Legacy support: check for old verdict formats that may still appear
	// This helps during transition period and with historical outputs
	if (normalized.includes("CHANGES_REQUESTED") || 
	    normalized.includes("NEEDS_WORK") ||
	    normalized.includes("NEEDS WORK")) {
		return "NEEDS_CHANGES";
	}
	
	if (normalized.includes("READY") && !normalized.includes("NEEDS")) {
		// READY without NEEDS suggests approval (planReviewer legacy)
		return "APPROVED";
	}
	
	// Default to NEEDS_CHANGES if no clear verdict (R13 - conservative behavior)
	return "NEEDS_CHANGES";
}
```

- **Verify**: Function correctly parses various verdict formats

### Step 2.2: Add Verdict Parsing Unit Tests (Inline Comments)

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Add inline documentation with test cases for the parsing function

```typescript
// Add as a comment block above parseVerdict function:

/**
 * Parse verdict from review output (R12, R13)
 * 
 * Looks for explicit verdict markers in the output.
 * Returns NEEDS_CHANGES if no clear verdict is found (conservative behavior per R13).
 * 
 * Test cases:
 *   - "**Verdict**: APPROVED" → APPROVED
 *   - "**Verdict**: NEEDS_CHANGES" → NEEDS_CHANGES  
 *   - "**Status**: APPROVED" → APPROVED
 *   - "**Status**: NEEDS_CHANGES" → NEEDS_CHANGES
 *   - "Blah blah... APPROVED ... more text" → APPROVED
 *   - "The code is APPROVED for merge" → APPROVED
 *   - "NEEDS_CHANGES - see issues below" → NEEDS_CHANGES
 *   - "**Status**: CHANGES_REQUESTED" (legacy) → NEEDS_CHANGES
 *   - "**Status**: READY" (legacy) → APPROVED
 *   - "**Status**: NEEDS_WORK" (legacy) → NEEDS_CHANGES
 *   - "No verdict in output at all" → NEEDS_CHANGES (conservative)
 *   - "APPROVED then later NEEDS_CHANGES" → NEEDS_CHANGES (last wins)
 *   - "NEEDS_CHANGES then later APPROVED" → APPROVED (last wins)
 */
```

- **Verify**: Test cases document expected behavior

### Step 2.3: Update planReviewer Prompt Verdict Format

- **Files**: `extensions/spec-pipeline/agents-config.mts`
- **Pattern Reference**: Existing specReviewer prompt format (lines 133-167)
- **Action**: Update planReviewer's Response Format section to use standardized verdicts

```typescript
// Before (around line 305):
## Response Format

**Status**: READY | NEEDS_WORK

**Issues** (if any):
1. Issue description
   - Suggestion: How to fix

**Missing** (if any):
- What's not covered that should be

Keep it concise - focus on actionable feedback.`,

// After:
## Response Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Issues** (if any):
1. Issue description
   - Suggestion: How to fix

**Missing** (if any):
- What's not covered that should be

Keep it concise - focus on actionable feedback.`,
```

- **Verify**: Prompt now instructs model to use APPROVED | NEEDS_CHANGES

### Step 2.4: Update codeReviewer Prompt Verdict Format

- **Files**: `extensions/spec-pipeline/agents-config.mts`
- **Pattern Reference**: Existing specReviewer prompt format (lines 133-167)
- **Action**: Update codeReviewer's Review Format section to use standardized verdicts

```typescript
// Before (around lines 401-405):
## Review Format

**Status**: APPROVED | CHANGES_REQUESTED

**Test Coverage**: Note if tests exist for the implementation
- Are there appropriate test files?
- If tests are missing → mark as CHANGES_REQUESTED

// After:
## Review Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Test Coverage**: Note if tests exist for the implementation
- Are there appropriate test files?
- If tests are missing → mark as NEEDS_CHANGES
```

- **Verify**: Prompt now instructs model to use APPROVED | NEEDS_CHANGES

### Step 2.5: Verify specReviewer Prompt Format

- **Files**: `extensions/spec-pipeline/agents-config.mts`
- **Action**: Verify that specReviewer already uses the correct format (no changes needed)

```typescript
// Verify current format (around line 156):
**Verdict**: APPROVED | NEEDS_CHANGES

// This is already correct - verification only
```

- **Verify**: Confirm all three reviewer prompts use `**Verdict**: APPROVED | NEEDS_CHANGES` format

### Step 2.6: Add hasSignificantIssues Helper Function

- **Files**: `extensions/spec-pipeline/index.ts`
- **Insertion Point**: Same as Step 2.1 (immediately after parseVerdict function)
- **Action**: Add helper to detect if review mentions critical/major issues (for addressReview flow)

```typescript
// Add after parseVerdict function

/**
 * Check if review output mentions critical or major issues
 * Used to determine if addressReview should run
 */
function hasSignificantIssues(output: string): boolean {
	const normalized = output.toUpperCase();
	return normalized.includes("CRITICAL") || normalized.includes("MAJOR");
}
```

- **Verify**: Function correctly identifies significant issues

### Step 2.7: Update Plan Review Verdict Detection

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current detection at line 2232
- **Action**: Replace string matching with parseVerdict call

```typescript
// Before (line 2232):
if (planReviewResult.output.includes("NEEDS") || planReviewResult.output.includes("Missing")) {

// After:
if (parseVerdict(planReviewResult.output) === "NEEDS_CHANGES") {
```

- **Verify**: Plan revision triggered correctly based on parsed verdict

### Step 2.8: Update Code Review Address Decision

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Current detection at lines 2434-2435
- **Action**: Keep existing CRITICAL/MAJOR check (for addressReview trigger) but prepare for verdict-based flow

The current code decides whether to run `addressReview` based on CRITICAL/MAJOR issues. This is a separate concern from the overall verdict. For now, we keep this logic but also add verdict parsing for future use.

```typescript
// Before (lines 2432-2436):
			// Opus addresses review if needed
			if (
				codeReviewResult.output.includes("CRITICAL") ||
				codeReviewResult.output.includes("MAJOR")
			) {

// After:
			// Parse verdict for flow control (will be used by Phase 3 tiered reviews)
			const codeReviewVerdict = parseVerdict(codeReviewResult.output);
			
			// Address critical/major issues immediately
			// Note: Even if verdict is APPROVED, we address CRITICAL/MAJOR issues
			// This ensures safety for edge cases where model approves despite listing issues
			if (hasSignificantIssues(codeReviewResult.output)) {
```

- **Verify**: Address review still triggers correctly for critical/major issues

### Step 2.9: Add Verdict to Review Logging

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Log parsed verdict after each review (for debugging and verification)

```typescript
// After the code review parsing (after parseVerdict call):
ctx.ui.notify(`Review verdict: ${codeReviewVerdict}`, "info");
```

This logging helps verify the verdict parsing is working correctly during the transition. It can be removed or made conditional later.

Similarly for plan review:

```typescript
// After planReviewResult, add:
const planReviewVerdict = parseVerdict(planReviewResult.output);
ctx.ui.notify(`Plan review verdict: ${planReviewVerdict}`, "info");
```

- **Verify**: Verdict is displayed after each review

### Step 2.10: Ensure Functions Accessible at Module Level

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Verify verdict type and functions are accessible within the module for Phase 3

The type and functions are already defined at module level, so no additional export is needed for internal use. Phase 3 will use these directly.

```typescript
// Verify these are at module level (not inside a function):
type ReviewVerdict = "APPROVED" | "NEEDS_CHANGES";
function parseVerdict(output: string): ReviewVerdict { ... }
function hasSignificantIssues(output: string): boolean { ... }
```

- **Verify**: Types and functions are accessible throughout the module

### Step 2.11: Verify Extension Loads

- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Verify TypeScript compiles without errors and extension loads correctly

```bash
# Option 1: Type check with TypeScript compiler
npx tsc --noEmit extensions/spec-pipeline/index.ts

# Option 2: Load extension in pi and verify no errors
# Start pi and run:
/spec-status
# Should show "No active pipeline" or current status, not a load error
```

- **Verify**: 
  - TypeScript compilation succeeds with no errors
  - Extension loads in pi without errors
  - `/spec-status` command responds correctly

## Files Summary

### New Files

None - all changes are in existing files.

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/agents-config.mts` | Update planReviewer verdict format (line ~305), update codeReviewer verdict format (line ~401) |
| `extensions/spec-pipeline/index.ts` | Add ReviewVerdict type and parseVerdict function, add hasSignificantIssues helper, update plan review detection (line 2232), update code review flow (line 2432), add verdict logging |

## Detailed Code Changes

### agents-config.mts Changes

#### planReviewer (around line 295-310)

```typescript
// Find this section:
## Response Format

**Status**: READY | NEEDS_WORK

// Replace with:
## Response Format

**Verdict**: APPROVED | NEEDS_CHANGES
```

#### codeReviewer (around line 395-410)

```typescript
// Find this section:
## Review Format

**Status**: APPROVED | CHANGES_REQUESTED

**Test Coverage**: Note if tests exist for the implementation
- Are there appropriate test files?
- If tests are missing → mark as CHANGES_REQUESTED

// Replace with:
## Review Format

**Verdict**: APPROVED | NEEDS_CHANGES

**Test Coverage**: Note if tests exist for the implementation
- Are there appropriate test files?
- If tests are missing → mark as NEEDS_CHANGES
```

### index.ts Changes

#### Add verdict types and functions

**Insertion Point**: 
- If Phase 1 complete: Insert after the model config helpers (`getModelArgs`, `getReviewerConfig`, `getRoleConfig`)
- If Phase 1 not complete: Insert after the type definitions ending around line 107 (after `ProjectConfig` interface)

Insert the following block:

```typescript
/**
 * Review verdict types (R11)
 */
type ReviewVerdict = "APPROVED" | "NEEDS_CHANGES";

/**
 * Parse verdict from review output (R12, R13)
 * 
 * Looks for explicit verdict markers in the output.
 * Returns NEEDS_CHANGES if no clear verdict is found (conservative behavior per R13).
 * 
 * Test cases:
 *   - "**Verdict**: APPROVED" → APPROVED
 *   - "**Verdict**: NEEDS_CHANGES" → NEEDS_CHANGES  
 *   - "**Status**: APPROVED" → APPROVED
 *   - "**Status**: NEEDS_CHANGES" → NEEDS_CHANGES
 *   - "Blah blah... APPROVED ... more text" → APPROVED
 *   - "The code is APPROVED for merge" → APPROVED
 *   - "NEEDS_CHANGES - see issues below" → NEEDS_CHANGES
 *   - "**Status**: CHANGES_REQUESTED" (legacy) → NEEDS_CHANGES
 *   - "**Status**: READY" (legacy) → APPROVED
 *   - "**Status**: NEEDS_WORK" (legacy) → NEEDS_CHANGES
 *   - "No verdict in output at all" → NEEDS_CHANGES (conservative)
 *   - "APPROVED then later NEEDS_CHANGES" → NEEDS_CHANGES (last wins)
 *   - "NEEDS_CHANGES then later APPROVED" → APPROVED (last wins)
 */
function parseVerdict(output: string): ReviewVerdict {
	// Normalize output for reliable matching
	const normalized = output.toUpperCase();
	
	// Look for explicit verdict markers using word boundaries
	// Word boundary \b prevents matching partial words (e.g., "UNAPPROVED")
	const approvedMatch = normalized.match(/\bAPPROVED\b/);
	const needsChangesMatch = normalized.match(/\bNEEDS_CHANGES\b/);
	
	// If both appear, use the last one (final verdict takes precedence)
	if (approvedMatch && needsChangesMatch) {
		const approvedIndex = normalized.lastIndexOf("APPROVED");
		const needsChangesIndex = normalized.lastIndexOf("NEEDS_CHANGES");
		return needsChangesIndex > approvedIndex ? "NEEDS_CHANGES" : "APPROVED";
	}
	
	if (approvedMatch) {
		return "APPROVED";
	}
	
	if (needsChangesMatch) {
		return "NEEDS_CHANGES";
	}
	
	// Legacy support: check for old verdict formats that may still appear
	// This helps during transition period and with historical outputs
	if (normalized.includes("CHANGES_REQUESTED") || 
	    normalized.includes("NEEDS_WORK") ||
	    normalized.includes("NEEDS WORK")) {
		return "NEEDS_CHANGES";
	}
	
	if (normalized.includes("READY") && !normalized.includes("NEEDS")) {
		// READY without NEEDS suggests approval (planReviewer legacy)
		return "APPROVED";
	}
	
	// Default to NEEDS_CHANGES if no clear verdict (R13 - conservative behavior)
	return "NEEDS_CHANGES";
}

/**
 * Check if review output mentions critical or major issues
 * Used to determine if addressReview should run
 */
function hasSignificantIssues(output: string): boolean {
	const normalized = output.toUpperCase();
	return normalized.includes("CRITICAL") || normalized.includes("MAJOR");
}
```

#### Update plan review detection (around line 2232)

```typescript
// Find:
		// If review found issues, revise
		if (planReviewResult.output.includes("NEEDS") || planReviewResult.output.includes("Missing")) {

// Replace with:
		// Parse verdict and log it
		const planReviewVerdict = parseVerdict(planReviewResult.output);
		ctx.ui.notify(`Plan review verdict: ${planReviewVerdict}`, "info");
		
		// If review found issues, revise
		if (planReviewVerdict === "NEEDS_CHANGES") {
```

#### Update code review address decision (around line 2430-2440)

```typescript
// Find:
			state.previousReview = codeReviewResult.output;
			saveState(cwd, state);

			// Opus addresses review if needed
			if (
				codeReviewResult.output.includes("CRITICAL") ||
				codeReviewResult.output.includes("MAJOR")
			) {

// Replace with:
			state.previousReview = codeReviewResult.output;
			saveState(cwd, state);

			// Parse verdict for flow control (used by Phase 3 tiered reviews)
			const codeReviewVerdict = parseVerdict(codeReviewResult.output);
			ctx.ui.notify(`Code review verdict: ${codeReviewVerdict}`, "info");

			// Address critical/major issues immediately
			// Note: Even if verdict is APPROVED, we address CRITICAL/MAJOR issues
			// This ensures safety for edge cases where model approves despite listing issues
			if (hasSignificantIssues(codeReviewResult.output)) {
```

## Completion Checklist

- [ ] Step 2.1: ReviewVerdict type and parseVerdict function added
- [ ] Step 2.2: Test cases documented in function comments
- [ ] Step 2.3: planReviewer prompt updated to APPROVED | NEEDS_CHANGES
- [ ] Step 2.4: codeReviewer prompt updated to APPROVED | NEEDS_CHANGES  
- [ ] Step 2.5: specReviewer prompt verified (already correct)
- [ ] Step 2.6: hasSignificantIssues helper added
- [ ] Step 2.7: Plan review uses parseVerdict
- [ ] Step 2.8: Code review uses hasSignificantIssues for address decision
- [ ] Step 2.9: Verdict logging added for debugging
- [ ] Step 2.10: Types and functions accessible at module level
- [ ] Step 2.11: Extension compiles and loads successfully in pi
- [ ] All prompts use consistent verdict terminology
- [ ] Verdict parsing handles legacy formats gracefully

## Testing Verification

After implementation, verify:

1. **TypeScript compiles**: Run `npx tsc --noEmit extensions/spec-pipeline/index.ts`

2. **Extension loads**: Start pi and run `/spec-status` - should respond without errors

3. **New pipelines use correct verdicts**: Start a new pipeline and check that review outputs use APPROVED | NEEDS_CHANGES format

4. **Plan revision triggers correctly**: 
   - When planReviewer outputs "Verdict: NEEDS_CHANGES", revision runs
   - When planReviewer outputs "Verdict: APPROVED", revision is skipped

5. **Address review triggers correctly**:
   - When codeReviewer outputs CRITICAL/MAJOR issues, addressReview runs
   - When no CRITICAL/MAJOR issues, addressReview is skipped

6. **Legacy format handling**:
   - If an existing pipeline has old-format reviews, verdict parsing still works
   - READY → APPROVED, NEEDS_WORK → NEEDS_CHANGES, CHANGES_REQUESTED → NEEDS_CHANGES

7. **Conservative default**:
   - If review output has no clear verdict marker, NEEDS_CHANGES is assumed

8. **Verdict logging visible**:
   - After each review, the parsed verdict is displayed in the output

## Notes for Phase 3

This phase establishes the verdict parsing foundation. Phase 3 (Tiered Reviews) will:

1. Use `parseVerdict()` to determine whether to:
   - Continue to next cheap cycle (if NEEDS_CHANGES in cheap tier)
   - Escalate to expensive tier (after cheap cycles complete)
   - Proceed to next phase (if APPROVED in expensive tier)

2. Use the model configuration from Phase 1 to select the correct model for each tier

3. Implement the tiered review loop that replaces the current fixed-cycle approach

The key integration points:
- `parseVerdict(reviewOutput)` → Returns verdict for flow decisions
- `hasSignificantIssues(reviewOutput)` → Triggers addressReview for critical issues
- Both functions work with any reviewer output (spec, plan, or code)
