You are synthesizing a brainstorming session into a structured document.

{projectContext}

## Topic

{description}

## Conversation History

{exchange_history}

## Task

Generate a synthesis document from the brainstorming session above. Use exactly this structure:

```
# Brainstorm: {description}

**Status**: Draft
**Created**: {createdAt}
**Timestamp**: {brainstormTimestamp}

## Problem / Opportunity
[What problem are we solving or opportunity are we exploring?]

## Context & Background
[Current state, what's in place, relevant constraints]

## Proposed Directions
[Each direction explored, with tradeoffs]

- **Option A: <name>**
  - Description: ...
  - Pros: ...
  - Cons: ...

- **Option B: <name>**
  - ...

## Out of Scope
[What this brainstorm explicitly does NOT cover]

## Open Questions
[Unresolved decisions]

## Rough Scope Assessment
[Feature, epic, or roadmap-level effort -- and why]
```

Output ONLY the document content, nothing else. Do not wrap in code fences.
