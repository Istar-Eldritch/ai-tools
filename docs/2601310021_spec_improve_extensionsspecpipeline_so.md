# Technical Specification: Interactive Spec Discovery Phase

**Status**: Draft  
**Created**: 2026-01-31  
**Spec ID**: 2601310021

---

## PART I: Requirements

### 1. Problem Statement

#### Business Context

The spec-pipeline extension automates the specification → implementation workflow. A well-defined specification is critical for successful implementation, yet the current process produces specs that may miss important details, edge cases, and constraints. This leads to:

- Implementation rework when overlooked requirements surface
- Specs that don't fully capture the user's intent
- Edge cases discovered during implementation rather than planning
- Ambiguous requirements that cause misaligned implementations

#### Current State

The current spec drafting process works as follows:

1. User provides a description: `/spec <description>`
2. Opus drafts a complete spec in one shot based solely on the description
3. Opus reviews the draft
4. User approves or provides feedback for revision
5. Loop continues up to 5 iterations until approved

**Key limitation**: The agent receives minimal context and attempts to draft a comprehensive spec from a brief description. This "one-shot" approach relies heavily on:
- The user providing a sufficiently detailed initial description
- The reviewer catching missing elements
- The user knowing what's missing during the approval step

There is no structured discovery phase to proactively uncover requirements.

#### Key Issues

1. **Insufficient discovery**: No mechanism for the agent to ask clarifying questions before drafting
2. **Missed edge cases**: Agent cannot probe for exception scenarios, boundary conditions, or failure modes
3. **Assumed context**: Agent makes assumptions rather than confirming with the user
4. **One-way communication**: The drafting phase is agent-only; user input only comes during review
5. **Incomplete requirements**: Critical constraints (security, performance, compatibility) may be overlooked
6. **Scope ambiguity**: Unclear boundaries between what's in/out of scope

### 2. Requirements

#### Discovery Phase Requirements

**R1**: The spec-pipeline SHALL include a new "discovery" stage before spec drafting where the agent engages in back-and-forth dialogue with the user.

**R2**: During discovery, the agent SHALL ask targeted questions to clarify:
- Functional requirements (what the feature should do)
- Non-functional requirements (performance, security, scalability)
- Edge cases and error handling scenarios
- User personas and use cases
- Integration points with existing systems
- Constraints and limitations
- Success criteria and acceptance conditions

**R3**: The agent SHALL analyze the user's description and codebase context to identify areas of ambiguity or incompleteness that require clarification.

**R4**: The agent SHALL present questions in a structured, prioritized manner - asking the most critical clarifying questions first.

**R5**: The user SHALL be able to:
- Answer questions individually or in batches
- Skip questions they consider unnecessary
- Indicate when they believe sufficient information has been gathered
- Abort the discovery process and either proceed to drafting or cancel entirely

**R6**: The agent SHALL synthesize answers into a "discovery summary" that captures all gathered requirements and context before proceeding to drafting.

#### Question Quality Requirements

**R7**: The agent SHALL ask questions that are:
- Specific and actionable (not vague)
- Relevant to the feature being specified
- Non-redundant (avoid asking what was already stated)
- Grounded in codebase exploration (reference existing patterns/systems)

**R8**: The agent SHALL proactively identify potential edge cases by:
- Analyzing similar existing features in the codebase
- Considering error scenarios and failure modes
- Exploring boundary conditions and limits
- Identifying potential conflicts with existing functionality

**R9**: The agent SHALL explore constraints including:
- Backward compatibility requirements
- Performance expectations
- Security considerations
- Dependencies on external systems
- Platform/environment limitations

#### Integration Requirements

**R10**: The discovery phase SHALL be integrated into the existing pipeline state machine as a new stage between "spec_drafting" (initial) and the actual drafting.

**R11**: The discovery summary SHALL be passed to the spec drafter as additional context alongside the original description.

**R12**: The pipeline SHALL support resuming from the discovery stage if interrupted.

**R13**: The discovery phase SHALL be optional - users SHALL be able to skip it via a flag or quick command if they have a well-defined description already.

#### User Experience Requirements

**R14**: Questions SHALL be presented via pi's interactive UI (`ctx.ui.editor` or similar) allowing multi-line responses.

**R15**: The agent SHALL provide a progress indicator showing how many question rounds have occurred and estimated completeness.

**R16**: The agent SHALL summarize gathered information periodically so the user can track what's been captured.

**R17**: The user SHALL be able to add unsolicited information at any point during discovery.

### 3. Success Criteria

- [ ] Discovery phase successfully gathers clarifying information through Q&A dialogue
- [ ] Agent asks relevant, non-redundant questions based on initial description
- [ ] Agent explores codebase to ground questions in existing patterns
- [ ] Edge cases are identified that would likely have been missed in one-shot drafting
- [ ] User can control the discovery process (answer, skip, proceed, cancel)
- [ ] Discovery summary is included in spec drafter context
- [ ] Pipeline state correctly tracks discovery stage and supports resume
- [ ] Specs produced after discovery are more comprehensive than one-shot drafts
- [ ] Skip option works for users who want the old behavior

### 4. Out of Scope

- **Automated requirement validation**: No automated testing of requirements against code
- **AI-generated acceptance tests**: Tests are defined in implementation phase
- **Multi-user collaboration**: Discovery assumes single user interaction
- **Version control of discovery sessions**: No git integration for discovery
- **Discovery templates**: No pre-defined question templates (agent generates dynamically)
- **Natural language processing**: No semantic analysis beyond what the LLM provides
- **Integration with external requirement tools**: No Jira, Linear, etc. integration

### 5. Open Questions

1. ~~How many question rounds should be the default maximum?~~ → **Resolved**: Default to 5 rounds, configurable via `spec-pipeline.json`

2. Should questions be asked one at a time or in batches?
   - **Recommendation**: Start with batches (3-5 questions), allow user to answer any/all
   - User can request more questions or proceed when satisfied

3. Should discovery be mandatory or opt-in by default?
   - **Recommendation**: Opt-out by default (discovery runs unless `--quick` flag)
   - Rationale: Better specs are worth the extra time; power users can skip

4. How to handle very simple features that don't need discovery?
   - **Recommendation**: Agent can detect simple requests and suggest skipping
   - User always has final say

5. Should the discovery agent have access to tools (read, grep) during questioning?
   - **Recommendation**: Yes, limited tools (read, grep, find, ls) for codebase exploration
   - No write access during discovery

---

## PART II: High-Level Implementation Plan

### Architectural Guidance

**State Machine Extension**: Add `discovery` stage to `PipelineStage` type between initial state and `spec_drafting`. The stage should track:
- Question rounds completed
- Questions asked and answers received
- Discovery summary (accumulated)

**New Agent Role**: Create `discoveryAgent` role in `agents-config.mts` with system prompt optimized for:
- Asking clarifying questions
- Analyzing codebases for context
- Synthesizing answers into structured requirements

**UI Interaction Pattern**: Use `ctx.ui.editor` for multi-line question/answer sessions. The pattern should:
- Present questions clearly formatted
- Accept multi-line answers
- Show accumulated context summary
- Provide navigation options (more questions, proceed, cancel)

**Tools Access**: Discovery agent should have read-only tools: `read`, `grep`, `find`, `ls`, `bash` (for read-only commands like `cat`, `tree`).

### Implementation Phases

| Phase | Focus | Effort | Details |
|-------|-------|--------|---------|
| Phase 1 | Discovery stage infrastructure | 2 days | [phase1_discovery_stage.md](./2601310021_interactive_discovery/phase1_discovery_stage.md) |
| Phase 2 | Discovery agent and Q&A loop | 2 days | [phase2_qa_loop.md](./2601310021_interactive_discovery/phase2_qa_loop.md) |
| Phase 3 | Integration and skip option | 1 day | [phase3_integration.md](./2601310021_interactive_discovery/phase3_integration.md) |

### Phase Descriptions

**Phase 1: Discovery Stage Infrastructure**
- Add `discovery` to `PipelineStage` type union
- Extend `PipelineState` interface with discovery-related fields
- Update state machine transitions (discovery → spec_drafting)
- Add configuration options to `spec-pipeline.json` schema

**Phase 2: Discovery Agent and Q&A Loop**
- Create `discoveryAgent` system prompt in `agents-config.mts`
- Implement Q&A interaction loop with `ctx.ui.editor`
- Build question round management (tracking, limits)
- Implement discovery summary generation

**Phase 3: Integration and Skip Option**
- Wire discovery output into spec drafter context
- Add `--quick` flag / `/spec-quick` command to skip discovery
- Update `/spec-status` to show discovery progress
- Handle resume from discovery stage

### Technical Constraints

1. **Maintain backward compatibility**: Existing pipelines in progress must continue working
2. **Respect pipeline state format**: New fields in `PipelineState` must not break existing state files
3. **UI interaction pattern**: Must work within pi's `ctx.ui` capabilities (editor, confirm, notify)
4. **Agent isolation**: Discovery agent runs as subprocess like other agents (via `runAgent`)
