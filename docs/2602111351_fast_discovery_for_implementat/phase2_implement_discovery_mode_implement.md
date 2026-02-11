# Phase 2: Implement Discovery Mode for /implement Command

**Estimated Effort**: 1 day

## Overview
This phase implements the discovery mode entry point for the `/implement` command. When invoked with a text description instead of a file path, the command will enter conversational discovery mode, allowing the user to refine requirements through natural conversation with the discovery agent. After `/discovery-done`, the discovery summary is written to a file and passed to the existing implementation pipeline.

## Prerequisites
- Phase 1 complete (unified discovery prompt and `/discovery-done` command)
- Understanding of the ephemeral state pattern from `/plan` command
- Familiarity with the existing `/implement` command structure

## Steps

### Step 2.1: Add Module-Level State for Implement-Discovery Flags
- **Files**: `extensions/spec-pipeline/index.ts` (line ~240, near other module-level state)
- **Pattern Reference**: Based on `activeScopingState` and `activePipelineKind` variables
- **Action**: Add module-level variables to track implement-discovery session flags

```typescript
// After line ~242 (after activePipelineKind declaration):
/** Flags for implement-discovery sessions (--no-plan, --no-review) - ephemeral, cleared on exit */
let pendingImplementFlags: { noPlan: boolean; noReview: boolean } | null = null;

/** Short name for implement-discovery session - ephemeral, cleared on exit */
let pendingImplementShortName: string | null = null;

/** Timestamp for implement-discovery session - ephemeral, cleared on exit */
let pendingImplementTimestamp: string | null = null;
```

- **Verify**: Variables declared in the module scope with proper JSDoc comments

### Step 2.2: Create enterImplementDiscoveryMode Function
- **Files**: `extensions/spec-pipeline/index.ts` (line ~344, after `enterHierarchyMode` function)
- **Pattern Reference**: Based on `enterScopingMode()` at line ~284
- **Action**: Add new function to enter implement-discovery mode

```typescript
// After enterHierarchyMode function (~line 344):
/**
 * Enter discovery mode for an implement pipeline (no persistent state, just ephemeral discovery)
 */
function enterImplementDiscoveryMode(
	cwd: string,
	projectConfig: ProjectConfig,
	discoveryState: ConversationalPipelineState,
	flags: { noPlan: boolean; noReview: boolean },
	shortName: string,
	timestamp: string
): void {
	pipelineMode = "discovery";
	activePipelineState = discoveryState;
	activePipelineKind = "implement";
	activeHierarchyLevel = null;
	activeParentContext = undefined;
	activeStateSaveFn = null;  // No persistence for implement-discovery
	activeCwd = cwd;
	activeProjectConfig = projectConfig;
	activeScopingState = null;
	lastUserMessage = "";
	exchangeCount = discoveryState.discovery?.conversationHistory?.length ?? 0;
	
	// Store flags and metadata for use at /discovery-done
	pendingImplementFlags = flags;
	pendingImplementShortName = shortName;
	pendingImplementTimestamp = timestamp;
}
```

- **Verify**: Function signature matches pattern, sets all required state variables

### Step 2.3: Extend exitMode to Clear Implement-Discovery State
- **Files**: `extensions/spec-pipeline/index.ts` (line ~349, in `exitMode` function)
- **Pattern Reference**: Existing `exitMode()` function
- **Action**: Add clearing of implement-discovery state variables

```typescript
// In exitMode function, after exchangeCount = 0 (~line 361):
function exitMode(): { exchangeCount: number } {
	const result = { exchangeCount };
	pipelineMode = "idle";
	activePipelineState = null;
	activePipelineKind = null;
	activeHierarchyLevel = null;
	activeParentContext = undefined;
	activeStateSaveFn = null;
	activeScopingState = null;
	activeCwd = "";
	activeProjectConfig = null;
	lastUserMessage = "";
	exchangeCount = 0;
	// Clear implement-discovery ephemeral state
	pendingImplementFlags = null;
	pendingImplementShortName = null;
	pendingImplementTimestamp = null;
	return result;
}
```

- **Verify**: All implement-discovery variables are cleared when exiting any mode

### Step 2.4: Update updateModeWidget for Implement Discovery
- **Files**: `extensions/spec-pipeline/index.ts` (line ~660, in discovery branch of `updateModeWidget`)
- **Pattern Reference**: Existing discovery widget code
- **Action**: Update kindLabel calculation to handle "implement" pipeline kind

```typescript
// In updateModeWidget function, after line ~656:
const kindLabel = activePipelineKind === "hierarchy" && activeHierarchyLevel
	? activeHierarchyLevel.charAt(0).toUpperCase() + activeHierarchyLevel.slice(1)
	: activePipelineKind === "implement"
		? "Implementation"
		: "Spec";
```

- **Verify**: Widget displays "Implementation Discovery Mode" when `activePipelineKind === "implement"` and `pipelineMode === "discovery"`

### Step 2.5: Modify /implement Command to Detect Discovery Mode
- **Files**: `extensions/spec-pipeline/index.ts` (line ~1800, `/implement` command handler)
- **Pattern Reference**: Based on `/spec` command at line ~1332
- **Action**: Add argument parsing and file detection logic

**Before (lines ~1808-1831):**
```typescript
const argsStr = args || "";
const noPlan = argsStr.includes("--no-plan");
const noReview = argsStr.includes("--no-review");
const specPath = argsStr
	.replace("--no-plan", "")
	.replace("--no-review", "")
	.replace(/\s+/g, " ")
	.trim();

if (!specPath) {
	ctx.ui.notify("Usage: /implement [--no-plan] [--no-review] <path-to-spec-file>", "error");
	return;
}

const cwd = ctx.cwd;

// Validate spec file exists
const fullSpecPath = path.isAbsolute(specPath)
	? specPath
	: path.join(cwd, specPath);

if (!fs.existsSync(fullSpecPath)) {
	ctx.ui.notify(`Spec file not found: ${specPath}`, "error");
	return;
}
```

**After:**
```typescript
const argsStr = args || "";
const noPlan = argsStr.includes("--no-plan");
const noReview = argsStr.includes("--no-review");
const argWithoutFlags = argsStr
	.replace("--no-plan", "")
	.replace("--no-review", "")
	.replace(/\s+/g, " ")
	.trim();

if (!argWithoutFlags) {
	ctx.ui.notify("Usage: /implement [--no-plan] [--no-review] <spec-file-or-description>", "error");
	return;
}

const cwd = ctx.cwd;

// Check if argument is a file path
const fullPath = path.isAbsolute(argWithoutFlags)
	? argWithoutFlags
	: path.join(cwd, argWithoutFlags);
const isFile = fs.existsSync(fullPath);

// Heuristic: if it looks like a file path but doesn't exist, show error
const looksLikeFilePath = argWithoutFlags.includes("/") || /\.(md|typ)$/i.test(argWithoutFlags);
if (looksLikeFilePath && !isFile) {
	ctx.ui.notify(`Spec file not found: ${argWithoutFlags}`, "error");
	return;
}

// If it's a valid file, continue with existing implementation logic
if (isFile) {
	// *** EXISTING FILE-BASED IMPLEMENTATION LOGIC CONTINUES HERE ***
	// (Lines 1832-1927 remain unchanged)
	const specPath = argWithoutFlags;
	const fullSpecPath = fullPath;
	const specContent = fs.readFileSync(fullSpecPath, "utf-8");
	// ... rest of existing implementation ...
} else {
	// *** NEW: DISCOVERY MODE ENTRY ***
	const description = argWithoutFlags;
	
	// Check for existing active implement pipeline
	const existingPipeline = getLatestActiveImplPipeline(cwd);
	if (existingPipeline) {
		const proceed = await ctx.ui.confirm(
			"Active Implementation Pipeline Found",
			`There's an active implementation pipeline:\n${formatImplState(existingPipeline)}\n\nDo you want to continue with a NEW pipeline? (No = cancel)`
		);
		if (!proceed) {
			ctx.ui.notify("Use /implement-resume to continue the existing pipeline", "info");
			return;
		}
	}
	
	// Git validation (repo must exist, but don't check clean yet - deferred to /discovery-done)
	const gitValidation = await validateGitRepo(cwd);
	if (!gitValidation.valid) {
		ctx.ui.notify(gitValidation.error!, "error");
		return;
	}
	
	// Load config
	const configResult = loadPipelineConfig(cwd);
	if (!configResult.success) {
		ctx.ui.notify(configResult.error, "error");
		return;
	}
	const projectConfig = configResult.config;
	
	ctx.ui.notify(formatEffectiveConfig(projectConfig, configResult.fromFile), "info");
	ctx.ui.notify("Starting implementation discovery...", "info");
	if (projectConfig.contextFiles.length > 0) {
		ctx.ui.notify(`Using context from: ${projectConfig.contextFiles.join(", ")}`, "info");
	}
	
	// Generate timestamp and prompt for short name
	const timestamp = generateTimestamp();
	const { shortName } = await promptForShortName(ctx, description);
	
	// Create ephemeral conversational state (not persisted to disk)
	const discoveryState: ConversationalPipelineState = {
		id: generatePipelineId(),
		description,
		discovery: {
			skipped: false,
			conversationHistory: [],
			completed: false,
		},
	};
	
	// Enter implement-discovery mode
	enterImplementDiscoveryMode(cwd, projectConfig, discoveryState, { noPlan, noReview }, shortName, timestamp);
	updateModeWidget(ctx);
	
	ctx.ui.notify(formatStepBanner(
		"IMPLEMENTATION DISCOVERY MODE",
		"The LLM will explore the codebase, propose assumptions, and ask you to confirm.",
		"🔍"
	), "info");
	ctx.ui.notify("The LLM will propose what it thinks is the best approach for each aspect, one at a time. Confirm or correct each assumption.", "info");
	ctx.ui.notify("When you're satisfied with the discovery, type /discovery-done to proceed to implementation.", "info");
	
	if (noPlan) {
		ctx.ui.notify("⚡ --no-plan flag will be applied after discovery", "info");
	}
	if (noReview) {
		ctx.ui.notify("⚡ --no-review flag will be applied after discovery", "info");
	}
	
	// Send the initial discovery message
	pi.sendUserMessage(
		`I want to implement the following: ${description}\n\n` +
		`Please explore the codebase, identify the most important ambiguity or decision point, and propose your best assumption for how it should work.`
	);
}
```

- **Verify**: 
  - `/implement docs/spec.md` continues to work (file-based)
  - `/implement docs/missing.md` shows "file not found" error
  - `/implement "Add auth"` enters discovery mode
  - `/implement --no-plan "Fix bug"` enters discovery with flag stored

### Step 2.6: Implement /discovery-done Handler for Implement Pipeline
- **Files**: `extensions/spec-pipeline/index.ts` (line ~1312, in `/discovery-done` handler)
- **Pattern Reference**: Based on existing hierarchy branch in `/discovery-done`
- **Action**: Replace placeholder with full implement-discovery completion logic

**Before (lines ~1312-1316):**
```typescript
} else if (activePipelineKind === "implement") {
	// Placeholder for Phase 2 - implement discovery → implementation transition
	ctx.ui.notify("Implement discovery completion will be added in Phase 2.", "info");
	exitMode();
}
```

**After:**
```typescript
} else if (activePipelineKind === "implement") {
	// Implement-discovery → implementation transition
	const state = activePipelineState as ConversationalPipelineState;
	const cwd = activeCwd;
	const projectConfig = activeProjectConfig;
	const flags = pendingImplementFlags!;
	const shortName = pendingImplementShortName!;
	const timestamp = pendingImplementTimestamp!;
	
	// Build discovery summary
	let discoverySummary = "";
	if (state.discovery && state.discovery.conversationHistory && state.discovery.conversationHistory.length > 0) {
		discoverySummary = generateConversationalDiscoverySummary(state.discovery.conversationHistory);
	}
	
	const discoveryExchanges = exchangeCount;
	
	ctx.ui.notify(formatStepBanner(
		"DISCOVERY COMPLETE",
		`${discoveryExchanges} exchanges recorded. Checking git status...`,
		"✅"
	), "success");
	
	// NOW check git clean (deferred from /implement invocation)
	const gitClean = await checkGitClean(cwd);
	if (!gitClean.clean) {
		ctx.ui.notify(formatStepBanner(
			"UNCOMMITTED CHANGES DETECTED",
			"The implementation pipeline requires a clean working tree.",
			"⚠️"
		), "warning");
		ctx.ui.notify("Uncommitted changes:\n" + gitClean.status, "warning");
		ctx.ui.notify("\nPlease commit or stash your changes, then run /discovery-done again.", "info");
		ctx.ui.notify("Your discovery session will remain active.", "info");
		// Do NOT exit mode - leave discovery session active
		return;
	}
	
	// Exit discovery mode (clears all state including pendingImplementFlags)
	exitMode();
	clearPipelineWidget(ctx);
	
	ctx.ui.notify("Writing discovery summary...", "info");
	
	// Write discovery summary file to specsDir
	const discoveryFilename = `${timestamp}_discovery_${shortName}.md`;
	const discoveryPath = path.join(projectConfig.specsDir, discoveryFilename);
	const discoveryContent = discoverySummary || `# Discovery Summary\n\n${state.description}\n\nNo discovery exchanges recorded.`;
	
	// Ensure specsDir exists
	const fullSpecsDir = path.isAbsolute(projectConfig.specsDir)
		? projectConfig.specsDir
		: path.join(cwd, projectConfig.specsDir);
	if (!fs.existsSync(fullSpecsDir)) {
		fs.mkdirSync(fullSpecsDir, { recursive: true });
	}
	
	const fullDiscoveryPath = path.join(cwd, discoveryPath);
	fs.writeFileSync(fullDiscoveryPath, discoveryContent, "utf-8");
	
	ctx.ui.notify(`Discovery summary written to: ${discoveryPath}`, "success");
	ctx.ui.notify(formatStepBanner(
		"STARTING IMPLEMENTATION",
		`From discovery file: ${discoveryPath}`,
		"🚀"
	), "info");
	
	// Create implementation state (using discovery file as "spec")
	const implTimestamp = generateTimestamp();
	const implState = createInitialImplState(
		discoveryPath,
		discoveryContent,
		implTimestamp,
		flags.noPlan
	);
	
	// Apply --no-review flag if present (set both reviewer cycles to 0)
	if (flags.noReview) {
		// Note: This modifies projectConfig for this implementation only
		projectConfig.reviewCycles.planReviewer.cheap = 0;
		projectConfig.reviewCycles.planReviewer.expensive = 0;
		projectConfig.reviewCycles.codeReviewer.cheap = 0;
		projectConfig.reviewCycles.codeReviewer.expensive = 0;
	}
	
	implState.checkpoints = [];
	saveImplState(cwd, implState);
	
	ctx.ui.notify(formatStepBanner(
		"IMPLEMENTATION STARTED",
		`ID: ${implState.id}`,
		"🚀"
	), "info");
	ctx.ui.notify(`Spec: ${discoveryPath}`, "info");
	if (flags.noPlan) {
		ctx.ui.notify("⚡ Skipping plan generation (--no-plan)", "info");
	}
	if (flags.noReview) {
		ctx.ui.notify("⚡ Skipping reviews (--no-review)", "info");
	}
	
	updateImplWidget(ctx, implState, "Initializing...");
	
	// Run implementation pipeline
	await runImplementPipeline(implState, cwd, projectConfig, ctx);
}
```

- **Verify**:
  - Discovery summary is written to correct path with timestamp
  - Git clean check happens at `/discovery-done` time
  - Dirty tree shows warning and preserves discovery session
  - Flags are correctly applied to implementation state
  - Implementation pipeline launches with discovery file as spec

### Step 2.7: Update /implement-cancel to Handle Discovery Phase
- **Files**: `extensions/spec-pipeline/index.ts` (line ~2149, `/implement-cancel` handler)
- **Pattern Reference**: Based on `/plan-cancel` at line ~2818
- **Action**: Add discovery-phase cancellation check before existing logic

**Before (lines ~2149-2196):**
```typescript
pi.registerCommand("implement-cancel", {
	description: "Cancel an active implementation",
	handler: async (args, ctx) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("spec-pipeline requires interactive mode", "error");
			return;
		}

		const cwd = ctx.cwd;
		const pipelineId = (args || "").trim();

		let state: ImplementationState | null;
		// ... existing state loading logic ...
```

**After:**
```typescript
pi.registerCommand("implement-cancel", {
	description: "Cancel an active implementation or discovery session",
	handler: async (args, ctx) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("spec-pipeline requires interactive mode", "error");
			return;
		}
		
		// Check if we're in implement-discovery mode (ephemeral, not persisted)
		if (pipelineMode === "discovery" && activePipelineKind === "implement") {
			exitMode();
			clearPipelineWidget(ctx);
			ctx.ui.notify("Discovery session cancelled.", "info");
			return;
		}

		const cwd = ctx.cwd;
		const pipelineId = (args || "").trim();

		let state: ImplementationState | null;
		// ... existing state loading logic unchanged ...
```

- **Verify**:
  - `/implement-cancel` during discovery exits cleanly
  - `/implement-cancel` during implementation works as before
  - No persistence or cleanup needed for discovery cancellation

### Step 2.8: Update Command Descriptions
- **Files**: `extensions/spec-pipeline/index.ts`
- **Action**: Update description strings to reflect new discovery mode capability

```typescript
// Line ~1801, /implement command description:
pi.registerCommand("implement", {
	description: "Start implementation from a spec file or description (enters discovery mode). Use --no-plan to skip plan generation.",
	// ...
});
```

- **Verify**: Command help text accurately describes new functionality

## Files Summary

### Modified Files
| File | Changes |
|------|---------|
| `extensions/spec-pipeline/index.ts` | Main implementation: add discovery mode entry, state management, command handlers |

### New Files
None - all changes are modifications to existing `index.ts`

## Testing Strategy

### Manual Testing Checklist
1. **File-based implementation (unchanged)**:
   - [ ] `/implement docs/spec.md` works as before
   - [ ] `--no-plan` and `--no-review` flags work with file paths

2. **Discovery mode entry**:
   - [ ] `/implement "Add user auth"` enters discovery mode
   - [ ] Discovery widget shows "Implementation Discovery Mode"
   - [ ] Discovery agent behaves identically to spec discovery

3. **Path-like heuristic**:
   - [ ] `/implement docs/missing.md` shows "file not found" error (not discovery)
   - [ ] `/implement path/to/spec.md` shows error if file doesn't exist
   - [ ] `/implement something.typ` shows error if file doesn't exist
   - [ ] `/implement fix_login_bug` enters discovery (no slashes, no extension)

4. **Flag handling**:
   - [ ] `/implement --no-plan "description"` stores flag, applies after discovery
   - [ ] `/implement --no-review "description"` stores flag, applies after discovery
   - [ ] `/implement --no-plan --no-review "description"` handles both flags

5. **Discovery completion**:
   - [ ] `/discovery-done` after 0 exchanges prompts confirmation
   - [ ] `/discovery-done` generates discovery summary correctly
   - [ ] Discovery file written to `specsDir/{timestamp}_discovery_{shortname}.md`
   - [ ] Git clean check happens at `/discovery-done` (not `/implement`)
   - [ ] Dirty tree shows warning and preserves discovery session
   - [ ] After `git commit`, `/discovery-done` proceeds to implementation

6. **Implementation launch**:
   - [ ] Implementation pipeline receives discovery file as spec
   - [ ] `--no-plan` skips plan generation phase
   - [ ] `--no-review` skips all review cycles
   - [ ] Implementation widget shows correct state

7. **Cancellation**:
   - [ ] `/implement-cancel` during discovery exits cleanly
   - [ ] `/implement-cancel` during implementation works as before
   - [ ] No error messages or state corruption after discovery cancellation

8. **Edge cases**:
   - [ ] Empty description shows usage error
   - [ ] Active implementation warning works correctly
   - [ ] Non-git directory shows appropriate error
   - [ ] Short name prompt and sanitization works

### Automated Testing
All existing 337 tests should pass unchanged:
```bash
npm test
```

**Expected**: 337 tests pass, no failures.

## Completion Checklist
- [ ] Step 2.1: Module-level state variables added
- [ ] Step 2.2: `enterImplementDiscoveryMode()` function created
- [ ] Step 2.3: `exitMode()` clears implement-discovery state
- [ ] Step 2.4: `updateModeWidget()` handles implement discovery
- [ ] Step 2.5: `/implement` command detects and enters discovery mode
- [ ] Step 2.6: `/discovery-done` handles implement pipeline completion
- [ ] Step 2.7: `/implement-cancel` handles discovery phase
- [ ] Step 2.8: Command descriptions updated
- [ ] Manual testing completed (all scenarios above)
- [ ] All existing tests pass (`npm test`)
- [ ] Discovery file naming verified (`{timestamp}_discovery_{shortname}.md`)
- [ ] Git clean check timing verified (at `/discovery-done`, not `/implement`)
- [ ] Flags correctly applied after discovery
- [ ] Code follows project conventions and patterns

## Notes

### Key Design Decisions
1. **Ephemeral State**: Implement-discovery uses in-memory state only (like `/plan`), not persisted to disk
2. **Deferred Git Check**: Git repo validation happens at `/implement`, but clean check deferred to `/discovery-done`
3. **Flag Storage**: Module-level variables store `--no-plan` and `--no-review` flags during discovery
4. **File Naming**: Discovery files use `{timestamp}_discovery_{shortname}.md` convention
5. **Path Heuristic**: Contains `/` or ends with `.md`/`.typ` = treat as file path, show error if missing

### Integration Points
- Unified discovery prompt (Phase 1) provides consistent UX across all pipeline types
- `/discovery-done` dispatcher (Phase 1) routes to implement-specific handler
- Existing `createInitialImplState()` and `runImplementPipeline()` consume discovery file as normal spec
- No changes needed to `implement-pipeline.ts`, `types.ts`, or `state.ts`

### Error Handling
- File not found: Clear error message for path-like arguments
- Git repo missing: Same validation as spec pipeline
- Dirty tree at `/discovery-done`: Warning + preserve discovery session
- Active pipeline: Confirmation dialog before starting new one
- Invalid short name: Sanitization handles special characters

### Future Enhancements (Out of Scope for Phase 2)
- Persist implement-discovery state for resumability
- Add `/implement-resume` support for discovery phase
- Multi-phase extraction from discovery summaries (always single-phase for now)
