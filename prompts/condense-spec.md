# /condense-spec - Condense Implemented Specifications

Condense a specification by removing implementation details while preserving architectural value.

## Usage

```
/condense-spec <spec-path>
```

## Example

```
/condense-spec specs/0005-some-feature.md
```

## When to Use

Use this prompt when a spec transitions from "Draft/Approved" to "Implemented" status. The code becomes the source of truth for implementation details, and the spec should serve as architectural documentation explaining WHY decisions were made.

## Workflow

1. **Verify Pre-conditions**
   - Spec status is "Implemented" or "Complete"
   - Feature is merged to main branch
   - Tests exist in codebase

2. **Read the Spec**
   - Load the full specification file
   - Identify current structure and sections

3. **Remove Implementation Details**
   Remove these sections entirely:
   - "Files to Modify" - Git history shows this
   - "Implementation Plan" (with phases/TDD steps) - Already done
   - "Test Cases" detailed lists - Tests exist in code
   - "Testing Strategy" step-by-step - Tests exist in code
   - "Success Criteria" checklists - Already met
   - Detailed code snippets showing line-by-line changes
   - "Migration Guide" sections - Move to CHANGELOG if still relevant

4. **Condense Sections**
   Keep essence, remove details from:
   - "API Changes" - Show final signature, not before/after/migration
   - "Database Schema" - Show final schema, not migration steps
   - "Usage Examples" - One clear example, not exhaustive variations

5. **Preserve Architecture**
   Keep these sections in full:
   - "Problem Statement" - Context for why this was needed
   - "Solution Overview" - High-level approach taken
   - "Key Design Decisions" - Rationale for specific choices
   - "Alternatives Considered" - Why not other approaches
   - "Breaking Changes" - User impact summary
   - "Future Enhancements/Considerations" - Deliberately deferred features

6. **Restructure**
   Use this order:
   1. Header (Spec ID, Status: ✅ Complete, Created, Completed dates)
   2. Problem Statement
   3. Solution Overview (with implementation phases if multi-phase)
   4. Key Design Decisions (with code examples only where essential)
   5. API/Schema (final form, condensed)
   6. Alternatives Considered
   7. Breaking Changes (summary)
   8. Future Enhancements (optional)

7. **Apply Style Guidelines**
   - Use tables and bullet points over prose
   - Code examples: Only show final API signature, not migration paths
   - Focus on "what" and "why", not "how"
   - Target length: 100-250 lines (vs typical 800+ line implementation spec)
   - Remove phrases like "we will", "should be", "needs to" (implementation language)
   - Use past tense: "Implemented X", "Added Y", not "Will add Y"

8. **Write Condensed Version**
   - Save the condensed spec to the same file path
   - Ensure header shows "Status: ✅ Complete" with completion date
   - Verify length is reduced to ~20-30% of original

## Anti-Patterns to Avoid

### ❌ Don't: Include step-by-step migration instructions
```
Step 1: Update `Cargo.toml` to add...
Step 2: Modify `src/lib.rs` line 42...
```

### ✅ Do: Summarize breaking changes
```
Breaking Changes:
- `EventBus::publish` now takes `Arc<Event<T>>`
- Users must wrap events before publishing
```

---

### ❌ Don't: Show before/after code comparisons
```rust
// Before:
fn old_api() { }

// After:
fn new_api() { }
```

### ✅ Do: Show final API with rationale
```rust
Final API uses Arc for shared ownership:
fn publish(&self, event: Arc<Event<T>>) -> Result<()>

Enables efficient fan-out to multiple observers (O(1) vs O(n) cloning).
```

---

### ❌ Don't: List every file that was modified
```
Files to Modify:
1. `epoch_core/src/event_store.rs` - Update EventBus trait
2. `epoch_core/src/projection.rs` - Update apply signature
3. `epoch_pg/src/event_bus.rs` - Implement new publish
```

### ✅ Do: Summarize scope
```
Changed event ownership model across:
- Core traits (EventBus, EventObserver)
- All backend implementations (Pg, InMemory)
- Event streaming utilities
```

## Example Condensing

### Before (Implementation Detail):
```markdown
### 3.2 Update `InMemoryEventBus::publish`

**Current Implementation** (lines ~394-410):
```rust
fn publish<'a>(...) -> ... {
    Box::pin(async move {
        let projections = self.projections.read().await;
        for projection in projections.iter() {
            projection.on_event(Arc::clone(&event)).await...
```

**New Implementation**:
```rust
fn publish<'a>(...) -> ... {
    Box::pin(async move {
        let projections = self.projections.read().await;
        let mut handles = Vec::new();
        for projection in projections.iter() {
            let handle = tokio::spawn(async move {
```
```

### After (Architectural):
```markdown
### Event Publishing

Changed from sequential to concurrent dispatch:
```rust
fn publish(&self, event: Arc<Event<T>>) -> Result<()> {
    // Spawns each observer in separate task for concurrent processing
}
```

Enables efficient fan-out to multiple observers (O(1) vs O(n) cloning).
```

## Post-Condensing Checklist

- [ ] Header shows "Status: ✅ Complete" with completion date
- [ ] No "Files to Modify" or "Implementation Plan" sections remain
- [ ] No detailed test case lists (just high-level testing approach if relevant)
- [ ] Code examples show final state, not migration paths
- [ ] Length reduced to ~20-30% of original
- [ ] All "why" explanations preserved
- [ ] Update specs/README.md if needed

## Reference Examples

See these condensed specs as reference:
- `0001-reduce-event-cloning.md` - Multi-phase implementation
- `0002-pg-event-bus-reliability.md` - Complex feature with many components
- `0003-pg-migrations.md` - Migration system
- `0008-aggregate-self-subscription-anti-pattern.md` - Trait refactoring

## Key Principle

If in doubt, ask: "Does this help someone understand the architecture?"
- If yes → keep
- If no → remove
