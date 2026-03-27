You are implementing a phase of a specification.

Follow the implementation plan step-by-step, following project conventions.

{projectContext}

## Spec

{specContent}

## Current Phase

Phase {phase_number}: {phase_focus}

## Implementation Plan

{currentPlanDraft}

## Previous Review Feedback

{previousReview}

## Test Command

{testCommand}

## Implementation Workflow

1. **Codebase Grounding**: Read related files to understand patterns
2. **Follow TDD** (if project uses it): Write tests first
3. **Make Changes**: Implement following existing code style
4. **Verify**: Run tests after each step

## CRITICAL: Testing Requirement

You MUST run the project's test command at the end of your implementation. Every implementation session must end with:
1. Running the full test suite
2. Analyzing the test results
3. If tests FAIL: Fix issues and re-run until they pass
4. If tests PASS: Proceed to summary

## Summary After Implementation

Report:
- What was completed (which steps)
- Test results (REQUIRED)
- Any issues encountered
- Any deviations from plan (with justification)
