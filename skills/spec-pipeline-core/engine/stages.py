"""Stage type handlers for the workflow engine.

Each stage type has a handler function that:
1. Examines current state and the command/input that triggered this call
2. Mutates state as needed (record exchanges, advance counters)
3. Returns the next Instruction to emit

Stage types: conversation, agent, approval, review, commit, loop
"""

from __future__ import annotations

import shlex
from typing import Optional

from . import instructions as inst
from . import context as ctx
from .config import Config, build_agent_context


def _engine_then(workflow_name: str, command: str, state_id: str,
                 result_arg: Optional[str] = None) -> str:
    """Build a 'then' command. If result_arg is given, append it as a flag placeholder."""
    cmd = f"python3 skills/spec-pipeline-core/engine.py {workflow_name} {command} --id {state_id}"
    if result_arg:
        # The LLM fills in the value; use --<arg>-file for large outputs
        cmd += f" --{result_arg}"
    return cmd


def handle_conversation(stage: dict, state: dict, config: Config,
                        workflow_name: str, command: str,
                        input_text: Optional[str] = None,
                        agent_output: Optional[str] = None,
                        intent: Optional[str] = None) -> inst.Instruction:
    """Handle a 'conversation' stage (interactive exchange loop).

    Flow per exchange:
    1. Engine emits call_agent (agent explores and proposes assumption)
    2. LLM calls agent-done with agent output
    3. Engine emits ask_user (present agent's output, ask for response)
    4. LLM calls user-responded with user's reply
    5. Engine records exchange, checks transition, loops or advances

    The 'command' tells us where we are in this cycle:
    - 'start' or 'next': emit call_agent for new exchange
    - 'agent-done': emit ask_user with agent output
    - 'user-responded': record exchange, check transition
    """
    state_field = stage.get("stateField", "discovery.exchanges")
    # Navigate to the exchanges list in state
    exchanges = _get_nested(state, state_field, default=[])
    min_exchanges = _get_variant_field(stage, state, "minExchanges", 3)
    max_exchanges = _get_variant_field(stage, state, "maxExchanges", 7)
    prompt_template = _get_variant_field(stage, state, "promptTemplate", None)
    transition_to = stage.get("transitionTo")
    state_id = state["id"]

    if command in ("start", "next", "resume"):
        # Emit call_agent for next exchange
        if prompt_template:
            project_context = build_agent_context(stage.get("modelKey", "specDrafter"))
            extra = {
                "project_context": project_context,
                "projectContext": project_context,
                "exchange_history": ctx.format_exchange_history(
                    exchanges, style=stage.get("exchangeStyle", "discovery")
                ),
            }
            prompt = ctx.render_prompt(prompt_template, state, config.data, extra)
        else:
            prompt = f"Continue the discovery conversation about: {state.get('description', '')}"

        model = config.model_for(stage.get("modelKey", "specDrafter"))
        return inst.CallAgent(
            model=model,
            prompt=prompt,
            then=_engine_then(workflow_name, "agent-done", state_id, "output"),
        )

    elif command == "agent-done":
        # Agent produced output -- present to user and ask for response
        # Store agent output temporarily in state for recording later
        state["_pending_agent_output"] = agent_output
        return inst.AskUser(
            text=agent_output or "",
            then=_engine_then(workflow_name, "user-responded", state_id, "input"),
        )

    elif command == "user-responded":
        # Record the exchange
        agent_key = stage.get("agentOutputKey", "assumption")
        user_key = stage.get("userInputKey", "response")
        exchange = {
            agent_key: state.pop("_pending_agent_output", ""),
            user_key: input_text or "",
        }
        exchanges.append(exchange)
        _set_nested(state, state_field, exchanges)

        # Check for transition
        exchange_count = len(exchanges)
        should_transition = False

        if intent == "TRANSITION" and exchange_count >= min_exchanges:
            should_transition = True
        elif exchange_count >= max_exchanges:
            should_transition = True

        if should_transition:
            # Generate summary and transition
            state["stage"] = transition_to
            # Mark discovery summary placeholder -- the next stage will use exchanges
            discovery_key = state_field.split(".")[0] if "." in state_field else state_field
            if isinstance(state.get(discovery_key), dict):
                state[discovery_key]["summary"] = _build_discovery_summary(exchanges)
            return inst.Present(
                text=f"Discovery complete ({exchange_count} exchanges). Moving to {transition_to}.",
                then=_engine_then(workflow_name, "next", state_id),
            )
        else:
            # Continue conversation -- emit next call_agent
            return handle_conversation(stage, state, config, workflow_name,
                                       "next", None, None, None)

    return inst.Error(message=f"Unexpected command '{command}' for conversation stage")


def handle_agent(stage: dict, state: dict, config: Config,
                 workflow_name: str, command: str,
                 agent_output: Optional[str] = None) -> inst.Instruction:
    """Handle an 'agent' stage (single agent delegation).

    Flow:
    1. 'start'/'next': assemble prompt, emit call_agent
    2. 'agent-done': store output in state, optionally write file, transition
    """
    state_id = state["id"]
    transition_to = stage.get("transitionTo")
    prompt_template = stage.get("promptTemplate")
    model_key = stage.get("modelKey", "specDrafter")
    output_field = stage.get("outputStateField")
    output_file = stage.get("outputFile")

    if command in ("start", "next", "resume"):
        project_context = build_agent_context(model_key)
        # Try discovery.exchanges first (spec/implement), then top-level exchanges (brainstorm)
        exchanges_field = state.get("discovery", {}).get("exchanges", [])
        if not exchanges_field:
            exchanges_field = state.get("exchanges", [])
        # Determine exchange formatting style from stage or workflow context
        exchange_style = stage.get("exchangeStyle", "discovery")
        extra = {
            "project_context": project_context,
            "projectContext": project_context,
            "exchange_history": ctx.format_exchange_history(exchanges_field, style=exchange_style),
        }
        prompt = ctx.render_prompt(prompt_template, state, config.data, extra)
        model = config.model_for(model_key)
        return inst.CallAgent(
            model=model,
            prompt=prompt,
            then=_engine_then(workflow_name, "agent-done", state_id, "output"),
        )

    elif command == "agent-done":
        # Store output in state
        if output_field and agent_output:
            state[output_field] = agent_output

        # If there's an output file, emit write_file
        if output_file and agent_output:
            variables = ctx.build_variables(state, config.data)
            resolved_path = ctx.render_template(output_file, variables)
            state["stage"] = transition_to
            return inst.WriteFile(
                path=resolved_path,
                content=agent_output,
                then=_engine_then(workflow_name, "file-written", state_id),
            )
        else:
            # No file to write, just transition
            state["stage"] = transition_to
            return inst.Present(
                text=f"Agent completed {stage['name']}. Moving to {transition_to}.",
                then=_engine_then(workflow_name, "next", state_id),
            )

    return inst.Error(message=f"Unexpected command '{command}' for agent stage")


def handle_approval(stage: dict, state: dict, config: Config,
                    workflow_name: str, command: str,
                    input_text: Optional[str] = None) -> inst.Instruction:
    """Handle an 'approval' stage (user approval loop).

    Flow:
    1. 'start'/'next': present draft to user, ask for approval
    2. 'user-responded': parse approval/revision, loop or advance
    """
    state_id = state["id"]
    max_iterations = stage.get("maxIterations", 5)
    on_revision = stage.get("onRevision")
    approval_field = stage.get("approvalStateField", "specApproved")
    iteration_field = stage.get("iterationStateField", "specIteration")
    transition_to = stage.get("transitionTo")

    current_iteration = state.get(iteration_field, 0)

    if command in ("start", "next", "resume"):
        # Include draft content so the user can see what they're approving
        draft_field = stage.get("draftStateField", stage.get("outputStateField", "specDraft"))
        draft_content = state.get(draft_field, "")
        review_text = ""
        if draft_content:
            review_text = f"## Draft\n\n{draft_content}\n\n---\n\n"
        review_text += ("Please review the draft above. Reply with:\n"
                       "- **approve** to accept\n"
                       "- Or describe the changes you'd like to see")
        return inst.AskUser(
            text=review_text,
            then=_engine_then(workflow_name, "user-responded", state_id, "input"),
        )

    elif command == "user-responded":
        response = (input_text or "").strip().lower()
        is_approved = response in ("approve", "approved", "lgtm", "looks good",
                                   "yes", "accept", "ship it")

        if is_approved:
            state[approval_field] = True
            state["stage"] = transition_to
            return inst.Present(
                text="Draft approved! Moving to next stage.",
                then=_engine_then(workflow_name, "next", state_id),
            )
        else:
            # Revision requested
            state[iteration_field] = current_iteration + 1
            if current_iteration + 1 >= max_iterations:
                state[approval_field] = True
                state["stage"] = transition_to
                return inst.Present(
                    text=f"Maximum revision iterations ({max_iterations}) reached. "
                         f"Proceeding with current draft.",
                    then=_engine_then(workflow_name, "next", state_id),
                )
            else:
                # Store revision feedback and go back to drafting
                state["_revision_feedback"] = input_text
                state["stage"] = on_revision
                return inst.Present(
                    text=f"Revision {current_iteration + 1}/{max_iterations}. "
                         f"Returning to {on_revision} with your feedback.",
                    then=_engine_then(workflow_name, "next", state_id),
                )

    return inst.Error(message=f"Unexpected command '{command}' for approval stage")


def handle_review(stage: dict, state: dict, config: Config,
                  workflow_name: str, command: str,
                  agent_output: Optional[str] = None) -> inst.Instruction:
    """Handle a 'review' stage (automated review cycle).

    Flow:
    1. Emit call_agent for reviewer
    2. Parse verdict from reviewer output
    3. If APPROVED, transition
    4. If NEEDS_CHANGES, emit call_agent for fix agent, then re-review
    5. Repeat up to maxCycles
    """
    state_id = state["id"]
    max_cycles = stage.get("maxCycles", 3)
    reviewer_model = stage.get("reviewerModelKey", "codeReviewer")
    fix_model = stage.get("fixModelKey", "addressReview")
    reviewer_prompt_tmpl = stage.get("reviewerPrompt")
    fix_prompt_tmpl = stage.get("fixPrompt")
    transition_to = stage.get("transitionTo")
    cycle_field = stage.get("cycleStateField", "reviewCycle")

    current_cycle = state.get(cycle_field, 0)

    if command in ("start", "next", "resume"):
        # Emit reviewer call
        if reviewer_prompt_tmpl:
            project_context = build_agent_context(reviewer_model)
            extra = {"project_context": project_context, "projectContext": project_context}
            prompt = ctx.render_prompt(reviewer_prompt_tmpl, state, config.data, extra)
        else:
            prompt = f"Review the current work for: {state.get('description', '')}"
        model = config.model_for(reviewer_model)
        state["_review_phase"] = "reviewing"
        return inst.CallAgent(
            model=model,
            prompt=prompt,
            then=_engine_then(workflow_name, "agent-done", state_id, "output"),
        )

    elif command == "agent-done":
        review_phase = state.get("_review_phase", "reviewing")

        if review_phase == "reviewing":
            # Parse verdict from reviewer output
            verdict = _parse_verdict(agent_output or "")
            state["_last_review"] = agent_output

            if verdict == "APPROVED" or current_cycle >= max_cycles:
                state.pop("_review_phase", None)
                state.pop("_last_review", None)
                state["stage"] = transition_to
                return inst.Present(
                    text=f"Review {'approved' if verdict == 'APPROVED' else 'max cycles reached'}. "
                         f"Moving to {transition_to}.",
                    then=_engine_then(workflow_name, "next", state_id),
                )
            else:
                # Needs changes -- emit fix agent
                state[cycle_field] = current_cycle + 1
                state["_review_phase"] = "fixing"
                if fix_prompt_tmpl:
                    project_context = build_agent_context(fix_model)
                    extra = {
                        "project_context": project_context,
                        "projectContext": project_context,
                        "review_feedback": agent_output,
                    }
                    prompt = ctx.render_prompt(fix_prompt_tmpl, state, config.data, extra)
                else:
                    prompt = f"Address this review feedback:\n\n{agent_output}"
                model = config.model_for(fix_model)
                return inst.CallAgent(
                    model=model,
                    prompt=prompt,
                    then=_engine_then(workflow_name, "agent-done", state_id, "output"),
                )

        elif review_phase == "fixing":
            # Fix agent done -- re-review
            state["_review_phase"] = "reviewing"
            return handle_review(stage, state, config, workflow_name, "next")

    return inst.Error(message=f"Unexpected command '{command}' for review stage")


def handle_commit(stage: dict, state: dict, config: Config,
                  workflow_name: str, command: str,
                  agent_output: Optional[str] = None,
                  command_output: Optional[str] = None) -> inst.Instruction:
    """Handle a 'commit' stage (git commit).

    Flow:
    1. Optionally generate commit message via haiku agent
    2. Emit run_command for git-helpers.sh scoped-commit
    3. On command-done, transition
    """
    state_id = state["id"]
    files = stage.get("files", [])
    commit_role = stage.get("commitRole", "specDrafter")
    transition_to = stage.get("transitionTo")
    commit_phase = state.get("_commit_phase", "generate_message")

    # Resolve file paths from variables
    variables = ctx.build_variables(state, config.data)
    resolved_files = [ctx.render_template(f, variables) for f in files]
    files_str = " ".join(resolved_files)

    if command in ("start", "next", "resume"):
        # Dispatch based on commit_phase for proper resume support
        if commit_phase == "writing_message":
            # Crashed after getting diff but before haiku finished — re-request haiku
            diff_content = state.get("_staged_diff", "(no diff)")
            return _emit_commit_message_agent(workflow_name, state_id, diff_content)
        elif commit_phase == "committing":
            # Crashed after haiku finished but before commit completed — re-commit
            commit_msg = state.get("_commit_message", f"docs: update {commit_role} artifacts")
            return _emit_commit_command(workflow_name, state_id, files_str, commit_msg)
        else:
            # generate_message: start by getting the diff
            state["_commit_phase"] = "generate_message"
            diff_cmd = "bash skills/spec-pipeline-core/git-helpers.sh staged-diff --max-chars 8000"
            return inst.RunCommand(
                command=diff_cmd,
                then=_engine_then(workflow_name, "command-done", state_id, "output"),
            )

    elif command == "command-done":
        if commit_phase == "generate_message":
            # Got the diff, now generate commit message via haiku
            state["_commit_phase"] = "writing_message"
            state["_staged_diff"] = command_output or ""
            return _emit_commit_message_agent(workflow_name, state_id, command_output or "(no diff)")
        elif commit_phase == "committing":
            # Commit done
            state.pop("_commit_phase", None)
            state.pop("_staged_diff", None)
            state.pop("_commit_message", None)
            state["stage"] = transition_to
            return inst.Present(
                text=f"Changes committed. Moving to {transition_to}.",
                then=_engine_then(workflow_name, "next", state_id),
            )

    elif command == "agent-done":
        if commit_phase == "writing_message":
            # Got commit message from haiku, now do the actual commit
            commit_msg = agent_output or f"docs: update {commit_role} artifacts"
            state["_commit_phase"] = "committing"
            state["_commit_message"] = commit_msg
            return _emit_commit_command(workflow_name, state_id, files_str, commit_msg)

    return inst.Error(message=f"Unexpected command '{command}' for commit stage")


def _emit_commit_message_agent(workflow_name: str, state_id: str,
                                diff_content: str) -> inst.Instruction:
    """Emit a call_agent instruction to generate a commit message via haiku."""
    prompt = (
        "You are writing git commit messages.\n\n"
        "Format:\n<type>(<scope>): <subject>\n\n<body>\n\n"
        "Rules:\n- type: feat | fix | docs | refactor | test | chore\n"
        "- scope: Component/area affected\n"
        "- subject: Imperative mood, lowercase, no period, max 50 chars\n"
        "- body: Explain what and why (not how), wrap at 72 chars\n\n"
        "Output ONLY the commit message, nothing else.\n\n"
        f"Diff:\n```\n{diff_content}\n```"
    )
    return inst.CallAgent(
        model="haiku",
        prompt=prompt,
        then=_engine_then(workflow_name, "agent-done", state_id, "output"),
    )


def _emit_commit_command(workflow_name: str, state_id: str,
                          files_str: str, commit_msg: str) -> inst.Instruction:
    """Emit a run_command instruction for git commit with proper shell escaping."""
    safe_msg = shlex.quote(commit_msg)
    safe_files = shlex.quote(files_str) if files_str else '""'
    commit_cmd = (
        f'bash skills/spec-pipeline-core/git-helpers.sh scoped-commit '
        f'--files {safe_files} --message {safe_msg}'
    )
    return inst.RunCommand(
        command=commit_cmd,
        then=_engine_then(workflow_name, "command-done", state_id, "output"),
    )


def handle_loop(stage: dict, state: dict, config: Config,
                workflow_name: str, command: str,
                **kwargs) -> inst.Instruction:
    """Handle a 'loop' stage (iterate over items from state).

    The loop stage runs a sub-pipeline of stages for each item in a state list.
    Loop variables ({current_phase}, {phase_number}, {phase_focus}) are set in
    state for template rendering.

    This is a placeholder implementation for Phase 1 -- full loop support
    will be needed for the implement workflow in Phase 4.
    """
    state_id = state["id"]
    over_field = stage.get("over", "phases")
    sub_stages = stage.get("stages", [])
    transition_to = stage.get("transitionTo")
    loop_index = state.get("_loop_index", 0)
    items = _get_nested(state, over_field, default=[])

    if loop_index >= len(items):
        # Loop complete
        state.pop("_loop_index", None)
        state.pop("_loop_sub_stage", None)
        state["stage"] = transition_to
        return inst.Present(
            text=f"Loop complete ({len(items)} items). Moving to {transition_to}.",
            then=_engine_then(workflow_name, "next", state_id),
        )

    # Set loop variables in state for template rendering
    item = items[loop_index]
    if isinstance(item, dict):
        state["current_phase"] = item.get("focus", "")
        state["phase_number"] = item.get("number", loop_index + 1)
        state["phase_focus"] = item.get("focus", "")
    else:
        state["current_phase"] = str(item)
        state["phase_number"] = loop_index + 1

    # Delegate to the current sub-stage
    sub_stage_index = state.get("_loop_sub_stage", 0)
    if sub_stage_index >= len(sub_stages):
        # All sub-stages done for this item, advance to next item
        state["_loop_index"] = loop_index + 1
        state["_loop_sub_stage"] = 0
        return handle_loop(stage, state, config, workflow_name, command, **kwargs)

    # Run the current sub-stage
    sub_stage = sub_stages[sub_stage_index]
    return _dispatch_stage(sub_stage, state, config, workflow_name, command, **kwargs)


# --- Helper functions ---

def _get_nested(data: dict, dotted_key: str, default=None):
    """Get a value from a dict using a dotted key path (e.g., 'discovery.exchanges')."""
    keys = dotted_key.split(".")
    d = data
    for k in keys:
        if isinstance(d, dict):
            d = d.get(k)
            if d is None:
                return default
        else:
            return default
    return d


def _set_nested(data: dict, dotted_key: str, value):
    """Set a value in a dict using a dotted key path."""
    keys = dotted_key.split(".")
    d = data
    for k in keys[:-1]:
        if k not in d or not isinstance(d[k], dict):
            d[k] = {}
        d = d[k]
    d[keys[-1]] = value


def _get_variant_field(stage: dict, state: dict, field: str, default=None):
    """Get a field from the stage definition, respecting variant overrides.

    If the stage has a 'variant' dict, check if any variant flag is active
    in state (stored as '_active_flags') and use that variant's value.
    """
    variants = stage.get("variant", {})
    active_flags = state.get("_active_flags", [])

    # Check variant overrides
    for flag in active_flags:
        if flag in variants and field in variants[flag]:
            return variants[flag][field]

    # Check default variant
    if "default" in variants and field in variants["default"]:
        return variants["default"][field]

    # Fallback to top-level stage field
    return stage.get(field, default)


def _build_discovery_summary(exchanges: list) -> str:
    """Build a discovery summary from exchanges."""
    lines = ["## Discovery Summary", ""]
    for i, ex in enumerate(exchanges, 1):
        assumption = ex.get("assumption", "")
        response = ex.get("response", "")
        # Extract a short topic from the assumption (first sentence or first 50 chars)
        topic = assumption.split(".")[0][:80] if assumption else f"Exchange {i}"
        lines.append(f"### Assumption {i}: {topic}")
        lines.append(f"**Proposed**: {assumption}")
        lines.append(f"**Decision**: {response}")
        lines.append("")
    return "\n".join(lines)


def _parse_verdict(text: str) -> str:
    """Parse a review verdict from text. Returns 'APPROVED' or 'NEEDS_CHANGES'."""
    lower = text.lower()
    # Last-wins rule: find all markers and use the last one
    markers = {
        "approved": "APPROVED",
        "ready": "APPROVED",
        "needs_changes": "NEEDS_CHANGES",
        "changes_requested": "NEEDS_CHANGES",
        "needs_work": "NEEDS_CHANGES",
    }
    last_pos = -1
    result = "NEEDS_CHANGES"
    for marker, verdict in markers.items():
        pos = lower.rfind(marker)
        if pos > last_pos:
            last_pos = pos
            result = verdict
    return result


def _dispatch_stage(stage: dict, state: dict, config: Config,
                    workflow_name: str, command: str, **kwargs) -> inst.Instruction:
    """Dispatch to the appropriate stage handler based on stage type."""
    stage_type = stage.get("type")
    handlers = {
        "conversation": handle_conversation,
        "agent": handle_agent,
        "approval": handle_approval,
        "review": handle_review,
        "commit": handle_commit,
        "loop": handle_loop,
    }
    handler = handlers.get(stage_type)
    if not handler:
        return inst.Error(message=f"Unknown stage type: {stage_type}")
    return handler(stage, state, config, workflow_name, command, **kwargs)
