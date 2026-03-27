You are creating a detailed implementation plan for a spec phase.

Translate high-level spec requirements into specific, executable steps with file paths and code examples.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Previous Review Feedback

{previousReview}

## CRITICAL: Codebase Grounding First

Before writing ANY plan, you MUST explore the existing codebase:
1. Explore project structure
2. Find similar code -- look for patterns to follow
3. Read related files -- understand existing implementations
4. Check test patterns

## Plan Format

Create a detailed, executable phase plan:

# Phase {phase_number}: {phase_focus}

**Estimated Effort**: X days

## Overview
Brief description of what this phase accomplishes.

## Prerequisites
- Phase N-1 complete (if applicable)

## Steps

### Step N.1: [Specific Step Name]
- Files: path/to/file (verified exists)
- Pattern Reference: Based on path/to/similar_existing
- Action: Specific changes to make (with before/after code)
- Verify: How to test this step

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| path/to/new | Description | Based on existing_similar |

### Modified Files
| File | Changes |
|------|---------|
| path/to/existing | What sections change |

## Completion Checklist
- [ ] Step N.1 complete
- [ ] All tests pass

Your plan must be executable with minimal interpretation: exact file paths, code examples matching project style, before/after for modifications, real verification commands.
