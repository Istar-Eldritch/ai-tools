---
description: Execute a delivery plan with per-phase review, iterative fix loop (max 5), test-fix until passing, and atomic commit
argument-hint: <path-to-plan.md>
---

# /implement <plan-path>

Execute a delivery plan phase by phase, with quality gates. The plan should be a markdown file produced by the `delivery-plan-architect` agent, or any markdown with `## Phase N: <title>` sections each containing a Goal, Entry Conditions, and Exit Criteria.

## Steps

1. **Validate the input.** Read the file at `$1` (the path the user passed as the argument). If it doesn't exist, or is not a readable file, ask: "I can't find a plan at `$1`. What's the absolute path to the plan you want to implement?" Wait for the answer.

2. **Confirm the plan looks right.** Quickly scan the file for `Phase` headings. If you don't see at least one, say so and ask the user to confirm the path or to invoke `/spec` first to generate a plan.

3. **Parse the plan into phases.** For each `## Phase N: <title>` (or `# Phase N: <title>`) section in the file, extract:
   - The phase number and title
   - The **Goal** line (one sentence)
   - The **Exit Criteria** bullets
   - The **Parallelism** note if present (sequential vs parallel)
   Build an in-memory list. Don't write this to disk.

4. **Confirm with the user.** Print a tight one-line summary per phase in this format:
   ```
   Phase 1: <title> — <goal in one line>
   Phase 2: <title> — <goal in one line>
   ...
   ```
   Then ask exactly one question: "Run the workflow for these N phases? (yes / revise / cancel)". Wait for the answer.
   - **yes** → continue
   - **revise** → ask which phase to revise and what to change
   - **cancel** → stop

5. **Generate the inline workflow script.** Construct a single JavaScript string (do NOT use the `Write` tool on it) with this structure:
   ```javascript
   export const meta = {
     name: 'implement-<slug>',
     description: 'Execute delivery plan with reviews + tests + commits',
     phases: [
       { title: 'Phase 1: <title>' },
       { title: 'Phase 2: <title>' },
       // ...one entry per phase
     ]
   }

   phase('Phase 1: <title>')
   let impl1 = await agent(
     `Implement phase 1: <title>

Goal: <goal>

Exit criteria:
<bullets>

Use the existing patterns from CLAUDE.md. Write tests alongside the implementation.`,
     { label: 'impl-1', isolation: 'worktree' }
   )

   // Review loop: max 5 cycles
   let approved1 = false
   let lastReview1 = ''
   for (let cycle = 1; cycle <= 5; cycle++) {
     lastReview1 = await agent(
       `Review phase 1: <title>.

Goal: <goal>

Exit criteria:
<bullets>

Inspect the diff and changed files in this worktree. Walk through each exit criterion explicitly and mark it met/unmet/partially met. Then flag any obvious gaps (missing tests, regressions, NFR violations, debug prints, dead code). End with one of these exact markers on its own line, with no surrounding text:

APPROVED
NEEDS_CHANGES

If NEEDS_CHANGES, list the specific, actionable changes required after the marker. Do not propose solutions unless they are one obvious line.`,
       { label: `review-1-c${cycle}`, agentType: 'code-reviewer' }
     )
     const a = lastReview1.lastIndexOf('APPROVED')
     const n = lastReview1.lastIndexOf('NEEDS_CHANGES')
     if (a > n && a !== -1) { approved1 = true; break }
     if (cycle < 5) {
       impl1 = await agent(
         `Apply the reviewer's required changes for phase 1: <title>.

Review output:
${lastReview1}

Update the code and tests, then confirm.`,
         { label: `fix-1-c${cycle}` }
       )
     }
   }
   if (!approved1) {
     await agent(
       `Surface to the user: phase 1 (<title>) did not converge after 5 review cycles.

Last review output:
${lastReview1}

Continue with the next phase; do not abort the workflow.`,
       { label: 'escalate-1' }
     )
   }

   // Test-fix loop: no cycle cap — fix until green or escalate
   const testStatus1 = await agent(
     `Run the test suite for phase 1: <title>. If tests fail, fix the underlying code (not the tests, unless the test itself is wrong) and re-run. Repeat until all tests pass. Report the final pass/fail status and the count of fix iterations.`,
     { label: 'test-1' }
   )

   // Commit only if tests passed
   await agent(
     `If the previous step reported all tests passing, run \`git add -A\` then \`git commit -m "<type>: <title> (phase 1)"\`. If tests did not pass, do NOT commit — report that this phase was skipped at commit time.`,
     { label: 'commit-1' }
   )

   // ...repeat the same block for phases 2, 3, ...N
   ```
   Important details:
   - One `phase()` call per phase, named to match the meta entry
   - Per phase: implement → review loop (max 5) → test loop (no cap) → commit
   - **`agentType` per step:**
     - Implement: default subagent (no `agentType`) — flexibility over specialization
     - Review: `agentType: 'code-reviewer'` — locked-in verdict format and skeptical posture
     - Fix: default subagent — applies whatever the reviewer flagged
     - Test: default subagent — runs the suite, fixes code until green
     - Commit: default subagent — single `git add` + `git commit`
   - `isolation: 'worktree'` on the implement agent so each phase has its own working tree
   - Review verdict: `lastIndexOf('APPROVED')` vs `lastIndexOf('NEEDS_CHANGES')` — APPROVED wins on tie
   - Commit agent is conditional on tests passing; if not, log a skip

6. **Invoke the workflow inline.** Call the `Workflow` tool with the constructed script as a single inline string via the `script` parameter. Do NOT use the `Write` tool to save the script. Do NOT use `scriptPath`. The harness will auto-persist the script under the session directory — that's fine, it's transient.

7. **Report results.** When the workflow returns, summarize for the user:
   - For each phase: review outcome (APPROVED on cycle N, or did not converge), test outcome (passed / skipped), commit status (committed / skipped)
   - Any non-converged phases with their last review output
   - Total wall-clock time

## Tone

Brisk and direct. The user is delegating execution; they want a status report, not a play-by-play. Don't narrate every cycle of every review loop — wait for the workflow to finish, then summarize.

## What this command does NOT do

- Does not save the generated workflow to `.claude/workflows/`. It is ephemeral by design — the user said they will not reuse these pipelines, and they can always regenerate from the plan.
- Does not invoke the spec-pipeline MCP server. The plan is the only input.
- Does not merge branches or open PRs. Phases end at the commit.
- Does not modify the plan file. It is read-only.
