"""Workflow runner for the engine.

Loads a workflow definition (JSON), reads state, dispatches to the
appropriate stage handler, saves state, and returns an Instruction.
"""

from __future__ import annotations

import json
import os
from typing import Optional

from . import instructions as inst
from . import stages
from .config import Config, load_config, derive_short_name, construct_paths, clear_cache
from .context import build_variables, render_template
from .state import (
    read_state, write_state, find_active, list_ids,
    initialize_state, now_iso, apply_schema_defaults,
)

_SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_WORKFLOWS_DIR = os.path.join(_SCRIPT_DIR, "workflows")


def load_workflow(workflow_name: str) -> dict:
    """Load a workflow definition JSON file."""
    path = os.path.join(_WORKFLOWS_DIR, f"{workflow_name}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Workflow definition not found: {path}")
    with open(path, "r") as f:
        return json.load(f)


def find_stage(workflow: dict, stage_name: str) -> Optional[dict]:
    """Find a stage definition by name in the workflow."""
    for stage in workflow.get("stages", []):
        if stage["name"] == stage_name:
            return stage
    return None


def run(workflow_name: str, command: str, args: list,
        flags: list, named_args: dict) -> inst.Instruction:
    """Main entry point: run a workflow command and return an instruction.

    Args:
        workflow_name: e.g., "brainstorm", "spec", "implement"
        command: e.g., "start", "next", "agent-done", "user-responded"
        args: positional arguments (e.g., description for start)
        flags: flag arguments (e.g., ["--quick"])
        named_args: named arguments (e.g., {"id": "...", "output": "...", "input": "..."})
    """
    # Clear config cache for each engine call (stateless between calls)
    clear_cache()

    try:
        workflow = load_workflow(workflow_name)
    except FileNotFoundError as e:
        return inst.Error(message=str(e))

    state_type = workflow.get("stateType", workflow_name + "s")
    config = load_config()

    # Dispatch by command
    if command == "start":
        return _handle_start(workflow, workflow_name, state_type, config, args, flags, named_args)
    elif command == "resume":
        return _handle_resume(workflow, workflow_name, state_type, config)
    elif command == "status":
        return _handle_status(workflow, workflow_name, state_type)
    elif command == "list":
        return _handle_list(state_type)
    elif command == "cancel":
        return _handle_cancel(workflow_name, state_type)
    elif command in ("next", "agent-done", "user-responded",
                     "file-read", "file-written", "command-done"):
        return _handle_continuation(workflow, workflow_name, state_type,
                                    config, command, named_args)
    else:
        return inst.Error(message=f"Unknown command: {command}")


def _handle_start(workflow: dict, workflow_name: str, state_type: str,
                  config: Config, args: list, flags: list,
                  named_args: dict) -> inst.Instruction:
    """Handle the 'start' command: initialize state and emit first instruction."""
    description = args[0] if args else named_args.get("description", "")
    if not description:
        return inst.Error(message="Description is required for 'start' command")

    # Implement-specific: first arg may be a spec file path
    extra_fields_pre = {}
    if workflow_name == "implement":
        spec_path_or_desc = description
        if os.path.exists(spec_path_or_desc):
            extra_fields_pre["specPath"] = spec_path_or_desc
            # Use the spec filename as the description if no separate description provided
            if not named_args.get("description"):
                description = os.path.basename(spec_path_or_desc)
        else:
            description = spec_path_or_desc
        # Map flags to state fields
        if "--no-plan" in flags:
            extra_fields_pre["skipPlanGeneration"] = True
        if "--no-review" in flags:
            extra_fields_pre["skipReview"] = True

    # Compute extra initial fields
    short_name = derive_short_name(description)
    from .state import generate_timestamp
    timestamp = generate_timestamp()
    paths = construct_paths(config.specs_dir, timestamp, short_name,
                            config.spec_format, workflow_name)

    # Normalize _active_flags to only contain flag names (not their values)
    active_flags = [f for f in flags if f.startswith("--")]
    extra_fields = {
        "_active_flags": active_flags,
        f"{workflow_name}Timestamp": timestamp,
    }

    # Add path fields if the workflow uses them
    schema = workflow.get("stateSchema", {})
    for key in schema:
        if "Path" in key or "path" in key:
            if key.endswith("Path") and key != "brainstormPath":
                extra_fields[key] = paths.get("path", "")
        if "Filename" in key or "filename" in key:
            extra_fields[key] = paths.get("filename", "")

    # Check for --from-brainstorm flag
    for i, flag in enumerate(flags):
        if flag == "--from-brainstorm" and i + 1 < len(flags):
            brainstorm_path = flags[i + 1]
            if "discovery" in schema and isinstance(schema["discovery"], dict):
                extra_fields.setdefault("discovery", {})
                if isinstance(extra_fields.get("discovery"), dict):
                    extra_fields["discovery"]["brainstormPath"] = brainstorm_path

    # Merge implement-specific fields
    if workflow_name == "implement":
        extra_fields.update(extra_fields_pre)

    state = initialize_state(state_type, workflow, description, extra_fields)

    # Check for skip conditions on the first stage
    first_stage = workflow["stages"][0]
    skip_when = first_stage.get("skipWhen", [])
    should_skip = any(f in flags for f in skip_when)

    if should_skip and len(workflow["stages"]) > 1:
        # Skip to next stage
        state["stage"] = workflow["stages"][1]["name"]
        if "discovery" in state and isinstance(state["discovery"], dict):
            state["discovery"]["skipped"] = True
        write_state(state_type, state["id"], state)
        return inst.Present(
            text=f"Skipping {first_stage['name']} (--quick). "
                 f"Moving to {state['stage']}.",
            then=stages._engine_then(workflow_name, "next", state["id"]),
        )

    # Save state and emit first instruction
    write_state(state_type, state["id"], state)
    return _emit_for_stage(workflow, workflow_name, state_type, state,
                           config, "start")


def _handle_resume(workflow: dict, workflow_name: str, state_type: str,
                   config: Config) -> inst.Instruction:
    """Handle the 'resume' command: find active state and re-emit instruction."""
    active_id = find_active(state_type)
    if not active_id:
        return inst.Error(message=f"No active {workflow_name} pipeline found")

    state = read_state(state_type, active_id)
    if not state:
        return inst.Error(message=f"State file not found for {active_id}")

    # Apply schema defaults for backward compatibility
    if "stateSchema" in workflow:
        state = apply_schema_defaults(state, workflow["stateSchema"])

    return _emit_for_stage(workflow, workflow_name, state_type, state,
                           config, "resume")


def _handle_status(workflow: dict, workflow_name: str,
                   state_type: str) -> inst.Instruction:
    """Handle the 'status' command: show status of all pipelines."""
    ids = list_ids(state_type)
    if not ids:
        return inst.Present(text=f"No {workflow_name} pipelines found.")

    lines = [f"## {workflow_name.title()} Pipelines\n"]
    for state_id in ids:
        state = read_state(state_type, state_id)
        if state:
            desc = state.get("description", "(no description)")
            stage = state.get("stage", "unknown")
            created = state.get("createdAt", "unknown")
            lines.append(f"- **{state_id}**: {desc}")
            lines.append(f"  Stage: `{stage}` | Created: {created}")
    return inst.Present(text="\n".join(lines))


def _handle_list(state_type: str) -> inst.Instruction:
    """Handle the 'list' command: list pipeline IDs."""
    ids = list_ids(state_type)
    if not ids:
        return inst.Present(text="No pipelines found.")
    return inst.Present(text="\n".join(ids))


def _handle_cancel(workflow_name: str, state_type: str) -> inst.Instruction:
    """Handle the 'cancel' command: cancel active pipeline."""
    active_id = find_active(state_type)
    if not active_id:
        return inst.Done(text=f"No active {workflow_name} pipeline to cancel.")

    state = read_state(state_type, active_id)
    if not state:
        return inst.Error(message=f"State file not found for {active_id}")

    state["stage"] = "cancelled"
    state["updatedAt"] = now_iso()
    write_state(state_type, active_id, state)
    return inst.Done(text=f"Cancelled {workflow_name} pipeline {active_id}.")


def _handle_continuation(workflow: dict, workflow_name: str, state_type: str,
                         config: Config, command: str,
                         named_args: dict) -> inst.Instruction:
    """Handle continuation commands (next, agent-done, user-responded, etc.)."""
    state_id = named_args.get("id")
    if not state_id:
        return inst.Error(message=f"--id is required for '{command}' command")

    state = read_state(state_type, state_id)
    if not state:
        return inst.Error(message=f"State file not found: {state_type}/{state_id}")

    # Apply schema defaults for backward compatibility
    if "stateSchema" in workflow:
        state = apply_schema_defaults(state, workflow["stateSchema"])

    return _emit_for_stage(workflow, workflow_name, state_type, state,
                           config, command, named_args=named_args)


def _emit_for_stage(workflow: dict, workflow_name: str, state_type: str,
                    state: dict, config: Config, command: str,
                    named_args: Optional[dict] = None) -> inst.Instruction:
    """Find the current stage and emit an instruction for it.

    Saves state before returning the instruction.
    """
    if named_args is None:
        named_args = {}

    current_stage_name = state.get("stage")

    # Backward-compatible stage name aliases (old prose-driven -> new engine-driven)
    stage_aliases = workflow.get("stageAliases", {})
    if current_stage_name in stage_aliases:
        current_stage_name = stage_aliases[current_stage_name]
        state["stage"] = current_stage_name

    # Check for completion
    completion = workflow.get("completion", {})
    completed_stage = completion.get("stage", "completed")
    if current_stage_name in (completed_stage, "completed"):
        variables = build_variables(state, config.data)
        msg = render_template(
            completion.get("message", f"{workflow_name} complete."),
            variables,
        )
        next_step = completion.get("nextStep")
        if next_step:
            next_step = render_template(next_step, variables)
            msg += f"\n\n**Suggested next step**: `{next_step}`"

        state["stage"] = "completed"
        state["updatedAt"] = now_iso()
        write_state(state_type, state["id"], state)
        return inst.Done(text=msg)

    # Find stage definition
    stage_def = find_stage(workflow, current_stage_name)
    if not stage_def:
        return inst.Error(
            message=f"Unknown stage '{current_stage_name}' in workflow '{workflow_name}'"
        )

    # Build kwargs for stage handler
    kwargs = {
        "stage": stage_def,
        "state": state,
        "config": config,
        "workflow_name": workflow_name,
        "command": command,
    }

    # Pass through relevant named args
    stage_type = stage_def.get("type")
    if "output" in named_args:
        kwargs["agent_output"] = named_args["output"]
    if "input" in named_args:
        kwargs["input_text"] = named_args["input"]
    if "intent" in named_args:
        kwargs["intent"] = named_args["intent"]
    if "content" in named_args:
        kwargs["agent_output"] = named_args["content"]  # file content treated as output
    if "output" in named_args and command == "command-done":
        kwargs["command_output"] = named_args["output"]

    # Dispatch to stage handler
    handler = {
        "conversation": stages.handle_conversation,
        "agent": stages.handle_agent,
        "approval": stages.handle_approval,
        "review": stages.handle_review,
        "commit": stages.handle_commit,
        "loop": stages.handle_loop,
        "init_phases": stages.handle_init_phases,
    }.get(stage_type)

    if not handler:
        return inst.Error(message=f"Unknown stage type: {stage_type}")

    # Call the handler
    instruction = handler(**kwargs)

    # Save state before emitting instruction
    state["updatedAt"] = now_iso()
    write_state(state_type, state["id"], state)

    return instruction
