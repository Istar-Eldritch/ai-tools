---
name: condense-spec
description: "Condense implemented specifications by removing implementation details while preserving architectural value. Use when a spec transitions to 'Implemented' status. Invoke with /condense-spec <spec-path>."
---

# /condense-spec - Condense Implemented Specifications

Condense a specification by removing implementation details while preserving architectural value.

## Target

Spec file path: `$1`

## When to Use

Use this prompt when a spec transitions from "Draft/Approved" to "Implemented" status. The code becomes the source of truth for implementation details, and the spec should serve as architectural documentation explaining WHY decisions were made.

## Workflow

1. **Detect Format**
   - Read the file at `$1`
   - Determine if it is Markdown (`.md`) or Typst (`.typ`) based on extension
   - All edits must preserve the original format — do not convert between formats

2. **Verify Pre-conditions**
   - Spec status is "Implemented" or "Complete"
   - Feature is merged to main branch
   - Tests exist in codebase

3. **Read the Spec**
   - Load the full specification file at `$1`
   - Identify current structure and sections

4. **Remove Implementation Details**
   Remove these sections entirely:
   - "Files to Modify" / file lists — Git history shows this
   - "Implementation Plan" (with phases/TDD steps) — Already done
   - "Test Cases" detailed lists — Tests exist in code
   - "Testing Strategy" step-by-step — Tests exist in code
   - "Success Criteria" checklists — Already met
   - Detailed code snippets showing line-by-line changes
   - "Migration Guide" sections — Move to CHANGELOG if still relevant
   - "Current State" / "Current Implementation" sections — Outdated after implementation

5. **Condense Sections**
   Keep essence, remove details from:
   - "API Changes" — Show final signature, not before/after/migration
   - "Database Schema" — Show final schema, not migration steps
   - "Usage Examples" — One clear example, not exhaustive variations

6. **Preserve Architecture**
   Keep these sections in full:
   - "Problem Statement" / "Overview" — Context for why this was needed
   - "Solution Overview" / "Solution Design" — High-level approach taken
   - "Key Design Decisions" — Rationale for specific choices
   - "Alternatives Considered" — Why not other approaches
   - "Breaking Changes" — User impact summary
   - "Future Enhancements" / "Out of Scope" — Deliberately deferred features
   - "Requirements" — What was needed and why (R1, R2, etc.)

7. **Restructure**

   Preserve the original format. Use the appropriate structure:

   ### For Typst (`.typ`) specs:
   1. Keep the `#import "_template.typ": *` and `#show: doc-setup.with(...)` header
   2. Update `status: "IMPLEMENTED"` and add/update `revision:` field
   3. Use Typst headings (`= SECTION`, `== SUBSECTION`)
   4. Use `#table(...)`, `#note-box[...]`, `#field-list(...)`, `#hr()` as appropriate
   5. Sections in order: Overview → Problem Statement → Requirements (condensed) → Solution Design → Key Decisions → API/Schema (final form) → Edge Cases → Future Enhancements

   ### For Markdown (`.md`) specs:
   1. Header (Status: ✅ Implemented, Created, Completed dates)
   2. Problem Statement
   3. Solution Overview (with implementation phases if multi-phase)
   4. Key Design Decisions (with code examples only where essential)
   5. API/Schema (final form, condensed)
   6. Alternatives Considered
   7. Breaking Changes (summary)
   8. Future Enhancements (optional)

8. **Apply Style Guidelines**
   - Focus on "what" and "why", not "how"
   - Code examples: Only show final API signature, not migration paths
   - Target length: ~20-30% of original (or leave as-is if already concise)
   - Remove phrases like "we will", "should be", "needs to" (implementation language)
   - Use past tense: "Implemented X", "Added Y", not "Will add Y"
   - For Typst: use `#table()` for structured data, `#note-box[]` for callouts
   - For Markdown: use tables and bullet points over prose

9. **Write Condensed Version**
   - Save the condensed spec back to `$1`
   - Verify length is reduced (or unchanged if already concise)
   - For Typst: ensure `status: "IMPLEMENTED"` in `doc-setup` header
   - For Markdown: ensure header shows "Status: ✅ Implemented"

## Anti-Patterns to Avoid

### Don't: Include step-by-step migration instructions
```
Step 1: Update `Cargo.toml` to add...
Step 2: Modify `src/lib.rs` line 42...
```

### Do: Summarize breaking changes
```
Breaking Changes:
- `EventBus::publish` now takes `Arc<Event<T>>`
- Users must wrap events before publishing
```

---

### Don't: Show before/after code comparisons
```rust
// Before:
fn old_api() { }

// After:
fn new_api() { }
```

### Do: Show final API with rationale
```rust
// Final API uses Arc for shared ownership
fn publish(&self, event: Arc<Event<T>>) -> Result<()>
// Enables efficient fan-out to multiple observers (O(1) vs O(n) cloning)
```

---

### Don't: List every file that was modified
```
Files to Modify:
1. `epoch_core/src/event_store.rs` - Update EventBus trait
2. `epoch_core/src/projection.rs` - Update apply signature
3. `epoch_pg/src/event_bus.rs` - Implement new publish
```

### Do: Summarize scope
```
Changed event ownership model across:
- Core traits (EventBus, EventObserver)
- All backend implementations (Pg, InMemory)
- Event streaming utilities
```

---

### Don't: Convert between formats
Don't rewrite a `.typ` spec as Markdown or vice versa. Preserve the original format.

## Post-Condensing Checklist

- [ ] Status updated to "Implemented" / "IMPLEMENTED" (format-appropriate)
- [ ] No "Files to Modify" or "Implementation Plan" sections remain
- [ ] No detailed test case lists (just high-level testing approach if relevant)
- [ ] Code examples show final state, not migration paths
- [ ] Length reduced to ~20-30% of original (or left as-is if already concise)
- [ ] All "why" explanations preserved
- [ ] Original file format (`.md` or `.typ`) preserved
- [ ] Update docs/README.md if needed

## Key Principle

If in doubt, ask: "Does this help someone understand the architecture?"
- If yes → keep
- If no → remove
