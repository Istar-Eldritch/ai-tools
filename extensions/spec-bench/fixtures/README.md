# Spec-Bench Fixtures

This directory contains sample fixtures demonstrating how to set up benchmarks for the spec-pipeline tool.

## Fixture Structure

Each fixture is a directory containing:

```
fixture_name/
├── fixture.json           # Required: Fixture metadata
├── feature.md             # Required: Feature description (fed to pipeline)
├── discovery.json         # Optional: Pre-scripted Q&A responses
├── hidden-tests/          # Optional: Tests added post-implementation
│   └── ... (test files)
└── project/               # Project source (or specify external path/URL)
    └── ... (project files)
```

## Configuration Files

### fixture.json (Required)

```json
{
  "name": "Feature Name",
  "description": "What this fixture tests",
  "project": "/path/to/project",  // Optional: external project path or git URL
  "projectRef": "branch-or-tag",  // Optional: git ref to checkout
  "testCommand": "npm test",      // Optional: override test command
  "hiddenTestsTarget": "tests/hidden/",  // Required: where to copy hidden tests
  "timeout": 3600                 // Optional: max seconds per run (default: 3600)
}
```

**Project Source Options:**

1. **Inline `project/` subdirectory**: Place project files directly in the fixture
2. **Local path**: Set `"project": "/absolute/or/relative/path"`
3. **Git URL**: Set `"project": "git@github.com:org/repo.git"` with optional `"projectRef": "main"`

### feature.md (Required)

The feature description is the input to the spec-pipeline. Write it as if you were describing a feature request to a developer.

Include:
- Clear requirements
- Expected behavior
- Example usage
- Acceptance criteria

### discovery.json (Optional)

Pre-scripted responses for the discovery phase:

```json
{
  "rounds": [
    {
      "answers": "Response to round 1 questions..."
    },
    {
      "answers": "Response to round 2 questions..."
    }
  ],
  "earlyFinish": true  // Stop discovery after provided rounds
}
```

**Tips:**
- Provide comprehensive answers that address likely questions
- Include design decisions, edge cases, and implementation preferences
- Use `earlyFinish: true` to proceed after your scripted answers

### hidden-tests/ (Optional)

Tests that are copied into the project AFTER implementation completes but BEFORE final verification. These test the quality of the implementation without being visible during development.

The tests are copied to the path specified in `hiddenTestsTarget`.

## Sample Fixtures

### minimal-ts

A minimal TypeScript fixture demonstrating basic structure. Implements a simple string utility function.

### complete-example

A complete fixture demonstrating all features:
- Discovery responses
- Hidden tests
- Calculator module implementation

## Creating Your Own Fixtures

1. Create a new directory in `fixtures/`
2. Add `fixture.json` with required fields
3. Write `feature.md` with detailed requirements
4. Either:
   - Create a `project/` subdirectory with your starter project
   - Set `project` in fixture.json to point to an external project
5. Optionally add `discovery.json` for consistent discovery responses
6. Optionally add `hidden-tests/` with additional test files

## Validating Fixtures

Use the `validate` command to check your fixture:

```bash
# Validate single fixture
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/my-fixture

# Validate all fixtures in a config
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/example-config.json

# Strict mode (warnings as errors)
npx tsx extensions/spec-bench/cli.ts validate ./fixtures/my-fixture --strict
```

## Best Practices

1. **Feature descriptions**: Be specific about requirements and acceptance criteria
2. **Discovery answers**: Provide comprehensive answers that address edge cases
3. **Hidden tests**: Focus on edge cases and behaviors not covered by original tests
4. **Timeouts**: Start with 30-60 minutes; increase if needed for complex features
5. **Test commands**: Use `--passWithNoTests` if the project may not have tests initially
