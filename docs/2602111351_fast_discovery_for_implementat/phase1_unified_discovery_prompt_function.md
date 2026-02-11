# Phase 1: Unified Discovery Prompt Function and /discovery-done Consolidation

**Estimated Effort**: 1 day

## Overview

This phase unifies the discovery prompt infrastructure to support spec, hierarchy, and implement pipelines. It consolidates the two separate discovery prompt functions (`buildDiscoveryPromptInjection` and `buildHierarchyDiscoveryPromptInjection`) into a single configurable function, merges the `/spec-done` and `/discovery-done` commands into one unified `/discovery-done` command, and extends the `activePipelineKind` type to include `"implement"`. All changes are in `index.ts` with no modifications to other files.

## Prerequisites

- Current codebase at spec ID 2602111351

## Steps

### Step 1.1: Extend activePipelineKind Type

- **Files**: `extensions/spec-pipeline/index.ts` (line 242)
- **Pattern Reference**: Existing type definition at line 242
- **Action**: Extend the type union to include `"implement"`
  ```typescript
  // Before:
  let activePipelineKind: "spec" | "hierarchy" | null = null;
  
  // After:
  let activePipelineKind: "spec" | "hierarchy" | "implement" | null = null;
  ```
- **Verify**: TypeScript compilation succeeds, no type errors

### Step 1.2: Create Unified Discovery Prompt Function

- **Files**: `extensions/spec-pipeline/index.ts` (after line 363, before existing `buildDiscoveryPromptInjection`)
- **Pattern Reference**: Based on existing `buildDiscoveryPromptInjection` (line 369) and `buildHierarchyDiscoveryPromptInjection` (line 546)
- **Action**: Create new unified function that accepts `ConversationalPipelineState` and config parameters
  ```typescript
  /**
   * Build the unified discovery system prompt injection for before_agent_start.
   * This turns the host LLM into a discovery agent for any pipeline type.
   * 
   * @param state - The conversational pipeline state (spec, hierarchy, or implement)
   * @param projectConfig - The project configuration
   * @param doneCommand - Command to tell user (e.g., "/discovery-done")
   * @param sessionLabel - Label for the session type (e.g., "Spec", "Implementation", "Roadmap")
   * @param nextStep - What happens after discovery (e.g., "proceed to spec drafting", "proceed to implementation")
   * @param parentContext - Optional parent context for hierarchy pipelines
   * @returns The discovery system prompt injection string
   */
  function buildUnifiedDiscoveryPrompt(
  	state: ConversationalPipelineState,
  	projectConfig: ProjectConfig,
  	doneCommand: string,
  	sessionLabel: string,
  	nextStep: string,
  	parentContext?: string
  ): string {
  	const SYSTEM_PROMPTS = createSystemPrompts(buildPromptOptions(projectConfig));
  	const discoveryPrompt = SYSTEM_PROMPTS.discoveryAgent;

  	let conversationContext = "";
  	if (state.discovery?.conversationHistory && state.discovery.conversationHistory.length > 0) {
  		conversationContext = "\n\n## Previous Discovery Exchanges\n\n";
  		for (const exchange of state.discovery.conversationHistory) {
  			conversationContext += `**User**: ${exchange.userMessage}\n\n`;
  			conversationContext += `**You**: ${exchange.assistantResponse}\n\n---\n\n`;
  		}
  	}

  	const scopingSection = state.discovery?.discoverySummary
  		? `\n\n## Prior Context\n\nThe following context was gathered before this discovery session:\n\n${state.discovery.discoverySummary}\n`
  		: "";

  	const parentSection = parentContext
  		? `\n\n## Parent Context\n\n${parentContext}\n`
  		: "";

  	return `
${discoveryPrompt}

## Active ${sessionLabel} Discovery Session

You are currently conducting a discovery session for:

${state.description}
${scopingSection}${parentSection}${conversationContext}

## Instructions

- Explore the project using read, bash, grep, find, ls tools — USE THEM
- Reference specific files and patterns you find
- Present ONE assumption at a time — propose the most likely solution, explain your reasoning, and ask the user to confirm or correct
- The user will respond naturally — adapt based on their feedback and move to the next topic
- When you feel you have enough context, tell the user they can type ${doneCommand} to ${nextStep}
${state.discovery?.discoverySummary ? "- Prior context is available above — factor it in but don't skip exploring the codebase" : ""}

IMPORTANT: You are in DISCOVERY MODE. Do NOT write specs, plans, or code. Only propose assumptions and explore the codebase.
`;
  }
  ```
- **Verify**: Function compiles, accepts all parameter types correctly

### Step 1.3: Update before_agent_start Handler to Use Unified Function

- **Files**: `extensions/spec-pipeline/index.ts` (lines 1099-1111)
- **Pattern Reference**: Existing conditional branches in `before_agent_start` handler
- **Action**: Replace the two separate function calls with unified function calls
  ```typescript
  // Before:
  } else if (pipelineMode === "discovery" && activePipelineState) {
  	if (activePipelineKind === "spec") {
  		injection = buildDiscoveryPromptInjection(activePipelineState as SpecState, activeProjectConfig);
  	} else {
  		injection = buildHierarchyDiscoveryPromptInjection(
  			activePipelineState as HierarchyState,
  			activeHierarchyLevel!,
  			activeProjectConfig,
  			activeParentContext
  		);
  	}
  	customType = "spec-discovery-context";
  	contextLabel = `[DISCOVERY MODE ACTIVE - Exploring requirements for: ${activePipelineState.description}]`;
  
  // After:
  } else if (pipelineMode === "discovery" && activePipelineState) {
  	let sessionLabel = "Spec";
  	let nextStep = "proceed to spec drafting";
  	
  	if (activePipelineKind === "spec") {
  		sessionLabel = "Spec";
  		nextStep = "proceed to spec drafting";
  	} else if (activePipelineKind === "hierarchy") {
  		sessionLabel = activeHierarchyLevel!.charAt(0).toUpperCase() + activeHierarchyLevel!.slice(1);
  		nextStep = `proceed to ${activeHierarchyLevel} drafting`;
  	} else if (activePipelineKind === "implement") {
  		sessionLabel = "Implementation";
  		nextStep = "proceed to implementation";
  	}
  	
  	injection = buildUnifiedDiscoveryPrompt(
  		activePipelineState,
  		activeProjectConfig,
  		"/discovery-done",
  		sessionLabel,
  		nextStep,
  		activeParentContext
  	);
  	customType = "spec-discovery-context";
  	contextLabel = `[DISCOVERY MODE ACTIVE - Exploring requirements for: ${activePipelineState.description}]`;
  ```
- **Verify**: Discovery mode works for both spec and hierarchy pipelines

### Step 1.4: Remove Old Discovery Prompt Functions

- **Files**: `extensions/spec-pipeline/index.ts` (lines 369-405 and 546-599)
- **Action**: Delete the old `buildDiscoveryPromptInjection` and `buildHierarchyDiscoveryPromptInjection` functions
- **Verify**: No compilation errors, all references now use the unified function

### Step 1.5: Unify /discovery-done Command to Handle All Pipeline Types

- **Files**: `extensions/spec-pipeline/index.ts` (lines 1275-1351, command handler for `/discovery-done`)
- **Pattern Reference**: Existing `/discovery-done` handler (hierarchy) and `/spec-done` handler (line 1243)
- **Action**: Extend the `/discovery-done` handler to dispatch based on `activePipelineKind`
  ```typescript
  // Before (existing hierarchy-only handler):
  pi.registerCommand("discovery-done", {
  	description: "End hierarchy discovery and proceed to drafting",
  	handler: async (_args, ctx) => {
  		if (pipelineMode !== "discovery" || activePipelineKind !== "hierarchy") {
  			ctx.ui.notify("No active hierarchy discovery session. Use /roadmap or /epic to start one.", "error");
  			return;
  		}
  		// ... rest of hierarchy logic
  
  // After (unified handler for all types):
  pi.registerCommand("discovery-done", {
  	description: "End discovery and proceed to next phase (spec drafting, hierarchy drafting, or implementation)",
  	handler: async (_args, ctx) => {
  		if (pipelineMode !== "discovery" || !activePipelineKind || !activePipelineState || !activeCwd || !activeProjectConfig) {
  			ctx.ui.notify("No active discovery session.", "error");
  			return;
  		}
  
  		if (exchangeCount === 0) {
  			const proceed = await ctx.ui.confirm(
  				"No Discovery Exchanges",
  				"No conversation exchanges recorded yet. Proceed anyway?"
  			);
  			if (!proceed) return;
  		}
  
  		// Dispatch based on pipeline kind
  		if (activePipelineKind === "spec") {
  			// Absorb /spec-done logic
  			await endDiscoveryAndStartDrafting(ctx);
  		} else if (activePipelineKind === "hierarchy") {
  			// Existing hierarchy logic (extract from current handler body)
  			const state = getActiveHierarchyState();
  			if (!state) {
  				ctx.ui.notify("No active hierarchy discovery session.", "error");
  				return;
  			}
  
  			// Build the discovery summary from conversation history
  			if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
  				state.discovery.discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
  			}
  
  			state.discovery!.completed = true;
  			const discoveryExchanges = exchangeCount;
  
  			const level = activeHierarchyLevel!;
  			const cwd = activeCwd;
  			const projectConfig = activeProjectConfig;
  			const parentContext = activeParentContext;
  			const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  
  			ctx.ui.notify(formatStepBanner(
  				"DISCOVERY COMPLETE",
  				`${discoveryExchanges} exchanges recorded. Entering ${level} drafting mode...`,
  				"✅"
  			), "success");
  
  			// Initialize drafting state and transition to drafting mode
  			state.drafting = {
  				conversationHistory: [],
  				completed: false,
  			};
  			state.stage = "drafting";
  			if (state.level === "roadmap") saveRoadmapState(cwd, state as RoadmapState);
  			else saveEpicState(cwd, state as EpicState);
  
  			// Enter hierarchy drafting mode
  			enterHierarchyMode("drafting", state, level, cwd, projectConfig, parentContext);
  			updateModeWidget(ctx);
  
  			ctx.ui.notify(formatStepBanner(
  				`${levelLabel.toUpperCase()} DRAFTING MODE`,
  				`The LLM will draft the ${level} document. Guide it conversationally.`,
  				"📝"
  			), "info");
  			ctx.ui.notify(`Document will be written to: ${state.docPath}`, "info");
  			ctx.ui.notify("When satisfied, type /draft-done to proceed to approval.", "info");
  
  			// Send the kickoff message
  			const fullDocPath = path.join(cwd, state.docPath);
  			const discoveryContext = state.discovery?.discoverySummary
  				? `\n\nHere is the context gathered during discovery:\n\n${state.discovery.discoverySummary}`
  				: "";
  
  			pi.sendUserMessage(
  				`Please create a ${level} document for: ${state.description}${discoveryContext}\n\n` +
  				`Write the document to this exact path: ${fullDocPath}\n` +
  				`Use document timestamp: ${state.docTimestamp}\n\n` +
  				`Explore the codebase first to understand existing patterns, then create a comprehensive ${level} document.`
  			);
  		} else if (activePipelineKind === "implement") {
  			// Placeholder for Phase 2 - implement discovery → implementation transition
  			ctx.ui.notify("Implement discovery completion will be added in Phase 2.", "info");
  			exitMode();
  		}
  	},
  });
  ```
- **Verify**: `/discovery-done` works for both spec and hierarchy pipelines, shows appropriate message for implement

### Step 1.6: Remove /spec-done Command

- **Files**: `extensions/spec-pipeline/index.ts` (lines 1243-1261)
- **Action**: Delete the entire `/spec-done` command registration block
- **Verify**: `/spec-done` command no longer exists, `/discovery-done` handles spec discovery completion

### Step 1.7: Update Discovery Prompt Strings to Reference /discovery-done

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Search for all references to `/spec-done` in prompt strings
- **Action**: Replace all occurrences of `/spec-done` with `/discovery-done` in:
  - Line 398 in old `buildDiscoveryPromptInjection` (if not yet deleted)
  - Any user-facing messages that reference the command
  
  Search pattern: `"When you're satisfied with the discovery, type /spec-done"`
  Replace with: `"When you're satisfied with the discovery, type /discovery-done"`
  
  Also update:
  - Line 1482 (spec discovery kickoff message): change `/spec-done` → `/discovery-done`
  - Line 1550 (spec resume discovery message): change `/spec-done` → `/discovery-done`
- **Verify**: All discovery prompts consistently reference `/discovery-done`

### Step 1.8: Update updateModeWidget Function

- **Files**: `extensions/spec-pipeline/index.ts` (lines 687-734)
- **Pattern Reference**: Existing widget update logic with conditional command names
- **Action**: Update the widget to always use `/discovery-done` for discovery mode
  ```typescript
  // Before:
  const doneCmd = activePipelineKind === "spec" ? "/spec-done" : "/discovery-done";
  
  // After:
  const doneCmd = "/discovery-done";  // Unified for all pipeline types
  ```
- **Verify**: Widget displays `/discovery-done` in all discovery modes (spec, hierarchy)

### Step 1.9: Update Command Descriptions and Help Text

- **Files**: `extensions/spec-pipeline/index.ts`
- **Pattern Reference**: Command descriptions at top of file (lines 31-38)
- **Action**: Update command list in header comments
  ```typescript
  // Before (in header):
  *   /spec-done                                      # Accept or override scoping recommendation
  
  // After (in header):
  *   /discovery-done                                 # End discovery and proceed to next phase
  ```
- **Verify**: Header documentation accurately reflects the unified command

### Step 1.10: Update README.md Documentation

- **Files**: `extensions/spec-pipeline/README.md` (lines 69-75)
- **Pattern Reference**: Existing command table format
- **Action**: Update the Spec Creation command table
  ```markdown
  <!-- Before: -->
  | `/spec [--quick] <description>` | Start spec pipeline. Enters conversational discovery, then drafting |
  | `/spec-resume` | Resume the last spec pipeline (continues from where it left off) |
  | `/discovery-done` | Exit discovery mode and move to drafting |
  | `/spec-draft-done` or `/draft-done` | Finalize the draft and proceed to approval |
  
  <!-- After: -->
  | `/spec [--quick] <description>` | Start spec pipeline. Enters conversational discovery, then drafting |
  | `/spec-resume` | Resume the last spec pipeline (continues from where it left off) |
  | `/discovery-done` | End discovery and proceed to next phase (works for spec, hierarchy, and implement) |
  | `/spec-draft-done` or `/draft-done` | Finalize the draft and proceed to approval |
  ```
- **Verify**: README accurately documents the unified `/discovery-done` command

### Step 1.11: Verify No Broken References

- **Files**: All files in `extensions/spec-pipeline/`
- **Action**: Search for any remaining references to `/spec-done` or `buildHierarchyDiscoveryPromptInjection`
  ```bash
  grep -r "spec-done" extensions/spec-pipeline/
  grep -r "buildHierarchyDiscoveryPromptInjection" extensions/spec-pipeline/
  ```
- **Verify**: No references found except in this phase plan and git history

## Files Summary

### New Files
None - all changes are modifications to existing files.

### Modified Files

| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | • Extend `activePipelineKind` type to include `"implement"`<br>• Add `buildUnifiedDiscoveryPrompt()` function<br>• Update `before_agent_start` handler to use unified function<br>• Delete `buildDiscoveryPromptInjection()` and `buildHierarchyDiscoveryPromptInjection()`<br>• Extend `/discovery-done` command to dispatch all types<br>• Remove `/spec-done` command<br>• Update `updateModeWidget()` to use unified command<br>• Update discovery prompt strings to reference `/discovery-done`<br>• Update header documentation |
| `extensions/spec-pipeline/README.md` | • Update command table to document unified `/discovery-done` command |

## Completion Checklist

- [ ] Step 1.1: `activePipelineKind` type extended to include `"implement"`
- [ ] Step 1.2: `buildUnifiedDiscoveryPrompt()` function created
- [ ] Step 1.3: `before_agent_start` handler updated to use unified function
- [ ] Step 1.4: Old discovery prompt functions deleted
- [ ] Step 1.5: `/discovery-done` command extended to dispatch all types
- [ ] Step 1.6: `/spec-done` command removed
- [ ] Step 1.7: All discovery prompt strings updated to reference `/discovery-done`
- [ ] Step 1.8: `updateModeWidget()` function updated
- [ ] Step 1.9: Command descriptions in header updated
- [ ] Step 1.10: README.md documentation updated
- [ ] Step 1.11: No broken references to old commands/functions
- [ ] All existing tests pass (337 tests)
- [ ] TypeScript compilation succeeds with no errors
- [ ] Manual testing: `/spec` discovery → `/discovery-done` works
- [ ] Manual testing: `/roadmap` discovery → `/discovery-done` works
- [ ] Manual testing: `/epic` discovery → `/discovery-done` works

## Testing Notes

**Existing Tests**: All 337 existing tests should pass unchanged since:
- No changes to `types.ts`, `state.ts`, `implement-pipeline.ts`, or other core files
- Only changes are in `index.ts` conversational mode handling
- The unified function maintains the same behavior, just with different structure

**Manual Testing Scenarios**:
1. `/spec "test feature"` → chat → `/discovery-done` → verify enters drafting mode
2. `/roadmap "test initiative"` → chat → `/discovery-done` → verify enters drafting mode  
3. `/epic "test epic"` → chat → `/discovery-done` → verify enters drafting mode
4. Verify `/spec-done` command no longer exists (shows "command not found")
5. Verify widget shows `/discovery-done` in all discovery modes

**Integration Points**:
- Phase 2 will implement the `"implement"` branch in `/discovery-done`
- Phase 2 will add `enterImplementDiscoveryMode()` function
- Phase 2 will modify `/implement` command to detect and enter discovery mode
