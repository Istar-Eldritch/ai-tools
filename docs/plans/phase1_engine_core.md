# Phase 1: Engine Core

**Estimated Effort**: 3 days

## Overview

Build the workflow engine's foundation: a Python CLI entry point and package that loads workflow definitions (JSON), manages state on disk, renders prompt templates, and emits typed JSON instructions. After this phase, the engine can be called from the command line and will deterministically walk through a workflow, emitting one instruction per call. No workflow definitions or prompt templates are created yet -- those come in Phase 2.

## Prerequisites

- Python 3.x available (verified: Python 3.13.12 on this machine)
- Existing shell scripts (`config.sh`, `state.sh`, `parse.sh`, `git-helpers.sh`) in `skills/spec-pipeline-core/` remain untouched

## Steps

### Step 1.1: Create the instruction dataclasses (`instructions.py`)

- Files: `skills/spec-pipeline-core/engine/instructions.py` (new)
- Pattern Reference: The instruction protocol from the spec (lines 126-219 of the spec)
- Action: Define dataclasses for each instruction type and a `to_json()` serialization method. All instructions share `action` and optional `then` fields. Terminal instructions (`done`, `error`) have no `then`.

```python
"""Instruction types for the workflow engine.

Each instruction represents exactly one action for the host LLM to perform.
The engine emits one instruction per call, serialized as JSON to stdout.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Instruction:
    """Base instruction. All instructions serialize to JSON via to_json()."""
    action: str

    def to_dict(self) -> dict:
        """Return dict representation, dropping None values."""
        d = {}
        for k, v in asdict(self).items():
            if v is not None:
                d[k] = v
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)


@dataclass
class CallAgent(Instruction):
    action: str = field(default="call_agent", init=False)
    model: str = "sonnet"
    prompt: str = ""
    then: Optional[str] = None


@dataclass
class AskUser(Instruction):
    action: str = field(default="ask_user", init=False)
    text: str = ""
    then: Optional[str] = None


@dataclass
class Present(Instruction):
    action: str = field(default="present", init=False)
    text: str = ""
    then: Optional[str] = None


@dataclass
class WriteFile(Instruction):
    action: str = field(default="write_file", init=False)
    path: str = ""
    content: str = ""
    then: Optional[str] = None


@dataclass
class ReadFile(Instruction):
    action: str = field(default="read_file", init=False)
    path: str = ""
    then: Optional[str] = None


@dataclass
class RunCommand(Instruction):
    action: str = field(default="run_command", init=False)
    command: str = ""
    then: Optional[str] = None


@dataclass
class Done(Instruction):
    action: str = field(default="done", init=False)
    text: str = ""


@dataclass
class Error(Instruction):
    action: str = field(default="error", init=False)
    message: str = ""
```

- Verify:
```bash
cd /home/istar/code/ai_tools && python3 -c "
from skills.spec_pipeline_core_engine.instructions import CallAgent, Done, Error
i = CallAgent(model='opus', prompt='Do stuff', then='engine.py spec agent-done --id 123 --output')
print(i.to_json())
d = Done(text='All done')
print(d.to_json())
"
```

Note: For the Python import to work during development, we will invoke via `python3 skills/spec-pipeline-core/engine.py` which adds the engine package to sys.path. The verification above is just for the dataclass logic; see Step 1.7 for the actual CLI.

---

### Step 1.2: Create the config loader (`config.py`)

- Files: `skills/spec-pipeline-core/engine/config.py` (new)
- Pattern Reference: `skills/spec-pipeline-core/config.sh` (subprocess wrapper)
- Action: Wrap `config.sh` via `subprocess.run()`, parse its JSON output, cache for the call duration. Also wrap `derive-short-name`, `construct-paths`, and `build-agent-context`.

```python
"""Configuration loading for the workflow engine.

Wraps config.sh via subprocess. The engine does not absorb config.sh logic
in this phase -- it delegates to the shell script and caches the result.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Optional

# Path to config.sh, relative to this file's location
_SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONFIG_SH = os.path.join(_SCRIPT_DIR, "config.sh")


class Config:
    """Cached configuration loaded from config.sh."""

    def __init__(self, data: dict):
        self._data = data

    @property
    def data(self) -> dict:
        return self._data

    def get(self, key: str, default=None):
        """Get a top-level config value."""
        return self._data.get(key, default)

    def get_nested(self, *keys, default=None):
        """Get a nested config value, e.g. get_nested('models', 'planDrafter')."""
        d = self._data
        for k in keys:
            if isinstance(d, dict):
                d = d.get(k)
                if d is None:
                    return default
            else:
                return default
        return d

    @property
    def specs_dir(self) -> str:
        return self._data.get("specsDir", "docs/specs")

    @property
    def spec_format(self) -> str:
        return self._data.get("specFormat", "md")

    @property
    def context_files(self) -> list:
        return self._data.get("contextFiles", [])

    def model_for(self, role: str) -> str:
        """Get model name for a given role, defaulting to 'sonnet'."""
        return self.get_nested("models", role, default="sonnet")


_cached_config: Optional[Config] = None


def load_config(needs_test_command: bool = False, needs_template: bool = False) -> Config:
    """Load config via config.sh subprocess. Caches within the process."""
    global _cached_config
    if _cached_config is not None:
        return _cached_config

    cmd = ["bash", _CONFIG_SH, "load-config"]
    if needs_test_command:
        cmd.append("--needs-test-command")
    if needs_template:
        cmd.append("--needs-template")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"config.sh failed: {result.stderr}")

    data = json.loads(result.stdout)
    _cached_config = Config(data)
    return _cached_config


def clear_cache():
    """Clear the config cache (for testing or between engine calls)."""
    global _cached_config
    _cached_config = None


def derive_short_name(description: str) -> str:
    """Derive a short name from a description via config.sh."""
    result = subprocess.run(
        ["bash", _CONFIG_SH, "derive-short-name", description],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"derive-short-name failed: {result.stderr}")
    return result.stdout.strip()


def construct_paths(specs_dir: str, timestamp: str, short_name: str,
                    fmt: str = "md", path_type: str = "spec") -> dict:
    """Construct file paths via config.sh. Returns {"filename": ..., "path": ...}."""
    result = subprocess.run(
        ["bash", _CONFIG_SH, "construct-paths",
         "--specs-dir", specs_dir, "--timestamp", timestamp,
         "--short-name", short_name, "--format", fmt, "--type", path_type],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"construct-paths failed: {result.stderr}")
    return json.loads(result.stdout)


def build_agent_context(role: str) -> str:
    """Build the project context string for an agent role via config.sh."""
    result = subprocess.run(
        ["bash", _CONFIG_SH, "build-agent-context", "--role", role],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"build-agent-context failed: {result.stderr}")
    return result.stdout
```

- Verify:
```bash
cd /home/istar/code/ai_tools && python3 -c "
import sys; sys.path.insert(0, 'skills/spec-pipeline-core')
from engine.config import load_config, derive_short_name
c = load_config()
print('specsDir:', c.specs_dir)
print('short_name:', derive_short_name('Add user authentication'))
"
```

---

### Step 1.3: Create the state manager (`state.py`)

- Files: `skills/spec-pipeline-core/engine/state.py` (new)
- Pattern Reference: `skills/spec-pipeline-core/state.sh` (subprocess for ID generation; direct JSON read/write for state files)
- Action: Implement state read/write with atomic writes (write to `.tmp`, rename). Use `state.sh` for `generate-id` and `generate-timestamp`. Support backward-compatible reads (missing fields filled from schema defaults).

```python
"""State management for the workflow engine.

State lives as JSON files in .claude/spec-pipeline/<stateType>/<id>.json.
State is saved before every instruction is emitted (crash-safe).
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from typing import Optional

_SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STATE_SH = os.path.join(_SCRIPT_DIR, "state.sh")
STATE_DIR = ".claude/spec-pipeline"


def generate_id() -> str:
    """Generate a pipeline ID via state.sh."""
    result = subprocess.run(
        ["bash", _STATE_SH, "generate-id"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"generate-id failed: {result.stderr}")
    return result.stdout.strip()


def generate_timestamp() -> str:
    """Generate a timestamp (YYMMDDhhmm) via state.sh."""
    result = subprocess.run(
        ["bash", _STATE_SH, "generate-timestamp"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"generate-timestamp failed: {result.stderr}")
    return result.stdout.strip()


def init_dirs() -> None:
    """Ensure state directory structure exists via state.sh."""
    subprocess.run(
        ["bash", _STATE_SH, "init"],
        capture_output=True, text=True, timeout=10,
    )


def _state_path(state_type: str, state_id: str) -> str:
    """Return the file path for a state file."""
    return os.path.join(STATE_DIR, state_type, f"{state_id}.json")


def now_iso() -> str:
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_state(state_type: str, state_id: str) -> Optional[dict]:
    """Read a state file. Returns None if not found."""
    path = _state_path(state_type, state_id)
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json.load(f)


def write_state(state_type: str, state_id: str, data: dict) -> None:
    """Write state atomically (write .tmp then rename)."""
    path = _state_path(state_type, state_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


def find_active(state_type: str) -> Optional[str]:
    """Find the most recent active (non-completed, non-cancelled) state ID."""
    result = subprocess.run(
        ["bash", _STATE_SH, "find-active", state_type],
        capture_output=True, text=True, timeout=10,
    )
    active_id = result.stdout.strip()
    return active_id if active_id else None


def list_ids(state_type: str) -> list:
    """List all state IDs for a given type."""
    result = subprocess.run(
        ["bash", _STATE_SH, "list", state_type],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        return []
    return json.loads(result.stdout.strip())


def apply_schema_defaults(data: dict, schema: dict) -> dict:
    """Fill missing fields in data from schema defaults.

    Schema format from workflow definition:
      {"field": "string", "nested": {"sub": "string|null"}}

    Default values: string -> "", number -> 0, boolean -> false,
    array -> [], null/string|null -> None, object -> recurse.
    """
    for key, spec in schema.items():
        if key not in data:
            if isinstance(spec, dict):
                # Nested object -- recurse
                data[key] = apply_schema_defaults({}, spec)
            elif isinstance(spec, str):
                if "null" in spec:
                    data[key] = None
                elif spec == "string":
                    data[key] = ""
                elif spec == "number":
                    data[key] = 0
                elif spec == "boolean":
                    data[key] = False
                elif spec == "array":
                    data[key] = []
                else:
                    data[key] = ""
        elif isinstance(spec, dict) and isinstance(data[key], dict):
            # Existing nested dict -- ensure sub-fields present
            data[key] = apply_schema_defaults(data[key], spec)
    return data


def initialize_state(state_type: str, workflow_def: dict,
                     description: str, extra_fields: Optional[dict] = None) -> dict:
    """Create a new state dict, generate ID and timestamps, write to disk.

    Returns the initial state dict.
    """
    init_dirs()
    state_id = generate_id()
    timestamp = generate_timestamp()
    now = now_iso()

    state = {
        "id": state_id,
        "description": description,
        "stage": workflow_def["stages"][0]["name"],
        "createdAt": now,
        "updatedAt": now,
    }

    # Apply schema defaults from workflow definition
    if "stateSchema" in workflow_def:
        state = apply_schema_defaults(state, workflow_def["stateSchema"])

    # Override description (schema default would have blanked it)
    state["description"] = description
    state["stage"] = workflow_def["stages"][0]["name"]

    # Merge extra fields (e.g., computed paths, timestamps)
    if extra_fields:
        state.update(extra_fields)

    write_state(state_type, state_id, state)
    return state
```

- Verify:
```bash
cd /home/istar/code/ai_tools && python3 -c "
import sys; sys.path.insert(0, 'skills/spec-pipeline-core')
from engine.state import generate_id, generate_timestamp, now_iso, apply_schema_defaults
print('id:', generate_id())
print('ts:', generate_timestamp())
print('now:', now_iso())
schema = {'description': 'string', 'discovery': {'exchanges': 'array', 'summary': 'string|null'}}
data = apply_schema_defaults({}, schema)
print('defaults:', data)
"
```

---

### Step 1.4: Create the context/template renderer (`context.py`)

- Files: `skills/spec-pipeline-core/engine/context.py` (new)
- Pattern Reference: Variable substitution spec (lines 306-311), context assembly (lines 339-347)
- Action: Implement `{variable}` substitution from state + config + computed values. Implement prompt template file loading and rendering. Implement exchange history formatting.

```python
"""Template rendering and context assembly for the workflow engine.

Handles:
- Loading .md prompt template files
- Substituting {variable} placeholders from state, config, computed values
- Assembling project context from config files
- Formatting exchange history
"""

from __future__ import annotations

import os
import re
from typing import Optional

_SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROMPTS_DIR = os.path.join(_SCRIPT_DIR, "prompts")


def load_template(template_name: str) -> str:
    """Load a prompt template file from the prompts/ directory."""
    path = os.path.join(_PROMPTS_DIR, template_name)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Prompt template not found: {path}")
    with open(path, "r") as f:
        return f.read()


def render_template(template: str, variables: dict) -> str:
    """Substitute {variableName} placeholders in a template string.

    Variables are resolved from the provided dict. Unresolved placeholders
    are left as-is (they may be resolved in a later pass or are intentional).
    Nested access is not supported -- callers should flatten before calling.
    """
    def replacer(match):
        key = match.group(1)
        if key in variables:
            val = variables[key]
            if val is None:
                return ""
            return str(val)
        return match.group(0)  # Leave unresolved

    return re.sub(r"\{(\w+)\}", replacer, template)


def build_variables(state: dict, config_data: dict,
                    extra: Optional[dict] = None) -> dict:
    """Build a flat variable dict from state + config + extras.

    Flattens one level of nesting for state (e.g., state.discovery.summary
    becomes discovery_summary). Config fields are included as-is.
    """
    variables = {}

    # Config values (top-level)
    for k, v in config_data.items():
        if isinstance(v, (str, int, float, bool)):
            variables[k] = v

    # State values (top-level)
    for k, v in state.items():
        if isinstance(v, (str, int, float, bool)):
            variables[k] = v
        elif isinstance(v, dict):
            # Flatten one level: discovery.summary -> discovery_summary
            for sub_k, sub_v in v.items():
                if isinstance(sub_v, (str, int, float, bool, type(None))):
                    variables[f"{k}_{sub_k}"] = sub_v

    # Extra computed values override
    if extra:
        variables.update(extra)

    return variables


def format_exchange_history(exchanges: list, style: str = "discovery") -> str:
    """Format a list of exchange dicts into a markdown conversation transcript.

    For discovery style:
        exchanges = [{"assumption": "...", "response": "..."}, ...]

    For brainstorm style:
        exchanges = [{"topic": "...", "discussion": "..."}, ...]
    """
    if not exchanges:
        return "(No exchanges yet)"

    lines = []
    for i, ex in enumerate(exchanges, 1):
        if style == "discovery":
            assumption = ex.get("assumption", "")
            response = ex.get("response", "")
            lines.append(f"### Exchange {i}")
            lines.append(f"**Assumption**: {assumption}")
            lines.append(f"**Response**: {response}")
            lines.append("")
        elif style == "brainstorm":
            topic = ex.get("topic", ex.get("assumption", ""))
            discussion = ex.get("discussion", ex.get("response", ""))
            lines.append(f"### Exchange {i}")
            lines.append(f"**Topic**: {topic}")
            lines.append(f"**Discussion**: {discussion}")
            lines.append("")
        else:
            # Generic fallback
            lines.append(f"### Exchange {i}")
            for k, v in ex.items():
                lines.append(f"**{k}**: {v}")
            lines.append("")

    return "\n".join(lines)


def render_prompt(template_name: str, state: dict, config_data: dict,
                  extra: Optional[dict] = None) -> str:
    """Load a prompt template and render it with variables from state + config.

    This is the main entry point for prompt assembly:
    1. Load the .md template file
    2. Build the variable dict from state + config + extras
    3. Substitute all {variable} placeholders
    """
    template = load_template(template_name)
    variables = build_variables(state, config_data, extra)
    return render_template(template, variables)
```

- Verify:
```bash
cd /home/istar/code/ai_tools && python3 -c "
import sys; sys.path.insert(0, 'skills/spec-pipeline-core')
from engine.context import render_template, build_variables, format_exchange_history
t = 'Hello {name}, your spec is at {specPath}. Unknown: {unknown}'
v = {'name': 'Alice', 'specPath': 'docs/specs/test.md'}
print(render_template(t, v))
exchanges = [{'assumption': 'Use JWT', 'response': 'Yes'}]
print(format_exchange_history(exchanges))
"
```

---

### Step 1.5: Create the stage type handlers (`stages.py`)

- Files: `skills/spec-pipeline-core/engine/stages.py` (new)
- Pattern Reference: Stage type table from spec (lines 293-302)
- Action: Implement a handler function for each stage type. Each handler receives the stage definition, current state, config, and current command/input, and returns an `Instruction`. The handler also mutates the state dict as needed (e.g., recording exchanges, advancing stage).

```python
"""Stage type handlers for the workflow engine.

Each stage type has a handler function that:
1. Examines current state and the command/input that triggered this call
2. Mutates state as needed (record exchanges, advance counters)
3. Returns the next Instruction to emit

Stage types: conversation, agent, approval, review, commit, loop
"""

from __future__ import annotations

from typing import Optional

from . import instructions as inst
from . import context as ctx
from .config import Config, build_agent_context


def _engine_cmd(workflow_name: str, command: str, state_id: str,
                **kwargs) -> str:
    """Build an engine CLI command string for the 'then' field."""
    base = f"python3 skills/spec-pipeline-core/engine.py {workflow_name} {command} --id {state_id}"
    for k, v in kwargs.items():
        base += f" --{k}"
        if v is not True:  # Flag-only args (like --output) have no value in then
            base += f" {v}"
    return base


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
                "exchange_history": ctx.format_exchange_history(exchanges),
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
        exchange = {
            "assumption": state.pop("_pending_agent_output", ""),
            "response": input_text or "",
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
        exchanges_field = state.get("discovery", {}).get("exchanges", [])
        extra = {
            "project_context": project_context,
            "projectContext": project_context,
            "exchange_history": ctx.format_exchange_history(exchanges_field),
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
        return inst.AskUser(
            text="Please review the draft above. Reply with:\n"
                 "- **approve** to accept\n"
                 "- Or describe the changes you'd like to see",
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
        if commit_phase == "generate_message":
            # Generate commit message via haiku
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
            prompt = (
                "You are writing git commit messages.\n\n"
                "Format:\n<type>(<scope>): <subject>\n\n<body>\n\n"
                "Rules:\n- type: feat | fix | docs | refactor | test | chore\n"
                "- scope: Component/area affected\n"
                "- subject: Imperative mood, lowercase, no period, max 50 chars\n"
                "- body: Explain what and why (not how), wrap at 72 chars\n\n"
                "Output ONLY the commit message, nothing else.\n\n"
                f"Diff:\n```\n{command_output or '(no diff)'}\n```"
            )
            return inst.CallAgent(
                model="haiku",
                prompt=prompt,
                then=_engine_then(workflow_name, "agent-done", state_id, "output"),
            )
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
            commit_cmd = (
                f'bash skills/spec-pipeline-core/git-helpers.sh scoped-commit '
                f'--files "{files_str}" --message "{commit_msg}"'
            )
            return inst.RunCommand(
                command=commit_cmd,
                then=_engine_then(workflow_name, "command-done", state_id, "output"),
            )

    return inst.Error(message=f"Unexpected command '{command}' for commit stage")


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
```

- Verify: Verification deferred to integration test in Step 1.7.

---

### Step 1.6: Create the workflow runner (`runner.py`)

- Files: `skills/spec-pipeline-core/engine/runner.py` (new)
- Pattern Reference: CLI interface from spec (lines 313-337), workflow definition format (lines 222-291)
- Action: Implement the workflow runner that loads a workflow JSON definition, looks up the current stage, dispatches to the appropriate stage handler, saves state, and returns the instruction. Also handle `resume`, `status`, `list`, and `cancel` commands.

```python
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

    # Compute extra initial fields
    short_name = derive_short_name(description)
    from .state import generate_timestamp
    timestamp = generate_timestamp()
    paths = construct_paths(config.specs_dir, timestamp, short_name,
                            config.spec_format, workflow_name)

    extra_fields = {
        "_active_flags": flags,
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
    if stage_type == "commit" and "output" in named_args and command == "command-done":
        kwargs["command_output"] = named_args["output"]

    # Dispatch to stage handler
    handler = {
        "conversation": stages.handle_conversation,
        "agent": stages.handle_agent,
        "approval": stages.handle_approval,
        "review": stages.handle_review,
        "commit": stages.handle_commit,
        "loop": stages.handle_loop,
    }.get(stage_type)

    if not handler:
        return inst.Error(message=f"Unknown stage type: {stage_type}")

    # Call the handler
    instruction = handler(**kwargs)

    # Save state before emitting instruction
    state["updatedAt"] = now_iso()
    write_state(state_type, state["id"], state)

    return instruction
```

- Verify: Verification via integration test in Step 1.7.

---

### Step 1.7: Create the CLI entry point (`engine.py`) and package `__init__.py`

- Files:
  - `skills/spec-pipeline-core/engine/__init__.py` (new)
  - `skills/spec-pipeline-core/engine.py` (new)
- Pattern Reference: CLI interface from spec (lines 313-337), shell script dispatchers in `config.sh` and `state.sh`
- Action: Create the CLI that parses `<workflow> <command> [args] [flags]` and delegates to `runner.run()`. Support `--output-file`, `--content-file`, `--input-file` variants for large arguments.

**`engine/__init__.py`**:
```python
"""Workflow engine package for the spec pipeline."""
```

**`engine.py`** (CLI entry point):
```python
#!/usr/bin/env python3
"""Workflow engine CLI entry point.

Usage:
    python3 skills/spec-pipeline-core/engine.py <workflow> <command> [args] [flags]

Commands:
    <workflow> start "<description>" [--quick] [--from-brainstorm <path>]
    <workflow> next --id <id>
    <workflow> agent-done --id <id> --output "<text>"
    <workflow> user-responded --id <id> --input "<text>"
    <workflow> file-read --id <id> --content "<text>"
    <workflow> file-written --id <id>
    <workflow> command-done --id <id> --output "<text>"
    <workflow> resume
    <workflow> status
    <workflow> list
    <workflow> cancel

For large arguments, use file variants:
    --output-file <path>   Read --output from file
    --content-file <path>  Read --content from file
    --input-file <path>    Read --input from file

All output is JSON to stdout. Errors also go to stdout as {"action": "error", ...}.
"""

import os
import sys

# Add the engine package to the path
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from engine.runner import run


def parse_args(argv: list) -> tuple:
    """Parse CLI arguments into (workflow, command, args, flags, named_args).

    Returns:
        workflow: str - workflow name (e.g., "spec")
        command: str - command name (e.g., "start")
        args: list - positional arguments
        flags: list - flag arguments (--quick, --from-brainstorm <path>)
        named_args: dict - named arguments (--id, --output, --input, --content)
    """
    if len(argv) < 2:
        return None, None, [], [], {}

    workflow = argv[0]
    command = argv[1]
    rest = argv[2:]

    args = []
    flags = []
    named_args = {}

    # Named args that expect a value
    value_args = {"--id", "--output", "--input", "--content",
                  "--output-file", "--content-file", "--input-file",
                  "--intent", "--description"}
    # Flags that consume the next arg as part of the flag set (for variant matching)
    flag_with_value = {"--from-brainstorm"}

    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg in value_args:
            if i + 1 < len(rest):
                key = arg.lstrip("-")
                # Handle file variants: read from file instead
                if key.endswith("-file"):
                    base_key = key.replace("-file", "")
                    file_path = rest[i + 1]
                    try:
                        with open(file_path, "r") as f:
                            named_args[base_key] = f.read()
                    except (IOError, OSError) as e:
                        named_args[base_key] = f"(error reading {file_path}: {e})"
                else:
                    named_args[key] = rest[i + 1]
                i += 2
            else:
                # Flag without value -- treat as a flag that expects result from LLM
                named_args[arg.lstrip("-")] = ""
                i += 1
        elif arg in flag_with_value:
            flags.append(arg)
            if i + 1 < len(rest) and not rest[i + 1].startswith("--"):
                flags.append(rest[i + 1])
                i += 2
            else:
                i += 1
        elif arg.startswith("--"):
            flags.append(arg)
            i += 1
        else:
            args.append(arg)
            i += 1

    return workflow, command, args, flags, named_args


def main():
    argv = sys.argv[1:]

    if not argv or argv[0] in ("--help", "-h", "help"):
        print(__doc__)
        sys.exit(0)

    workflow, command, args, flags, named_args = parse_args(argv)

    if not workflow or not command:
        from engine.instructions import Error
        print(Error(message="Usage: engine.py <workflow> <command> [args] [flags]").to_json())
        sys.exit(1)

    instruction = run(workflow, command, args, flags, named_args)
    print(instruction.to_json())


if __name__ == "__main__":
    main()
```

- Verify:
```bash
# Should print help
cd /home/istar/code/ai_tools && python3 skills/spec-pipeline-core/engine.py --help

# Should print error (no workflow definition yet)
cd /home/istar/code/ai_tools && python3 skills/spec-pipeline-core/engine.py brainstorm start "test topic"

# Should print error (unknown workflow)
cd /home/istar/code/ai_tools && python3 skills/spec-pipeline-core/engine.py nonexistent start "test"
```

---

### Step 1.8: Create the workflows directory

- Files: `skills/spec-pipeline-core/workflows/` (new directory), `skills/spec-pipeline-core/prompts/` (new directory)
- Action: Create empty directories that will be populated in Phase 2+. Add a minimal test workflow for validation.

```bash
mkdir -p skills/spec-pipeline-core/workflows
mkdir -p skills/spec-pipeline-core/prompts
```

Create a minimal test workflow `skills/spec-pipeline-core/workflows/_test.json` for validation:

```json
{
  "name": "_test",
  "stateType": "brainstorms",
  "commands": {
    "start": { "description": "Test workflow", "args": ["description"] },
    "resume": { "description": "Resume test" },
    "status": { "description": "Show status" },
    "list": { "description": "List IDs" },
    "cancel": { "description": "Cancel" }
  },
  "stateSchema": {
    "description": "string",
    "stage": "string",
    "notes": "string"
  },
  "stages": [
    {
      "name": "drafting",
      "type": "agent",
      "promptTemplate": "_test_prompt.md",
      "modelKey": "specDrafter",
      "outputStateField": "notes",
      "transitionTo": "completed"
    }
  ],
  "completion": {
    "message": "Test workflow complete: {description}",
    "nextStep": "/next-thing"
  }
}
```

Create a minimal test prompt `skills/spec-pipeline-core/prompts/_test_prompt.md`:

```markdown
You are a test agent. Description: {description}

Write a short note about this topic.
```

- Verify:
```bash
cd /home/istar/code/ai_tools && python3 skills/spec-pipeline-core/engine.py _test start "hello world"
# Should output a call_agent JSON instruction (will fail on prompt load if prompts dir missing)
```

---

### Step 1.9: End-to-end smoke test

- Files: No new files
- Action: Run the engine through a simulated workflow cycle using the test workflow from Step 1.8.

```bash
cd /home/istar/code/ai_tools

# 1. Start the workflow -- should emit call_agent
python3 skills/spec-pipeline-core/engine.py _test start "hello world"

# 2. Get the ID from the state file
ID=$(bash skills/spec-pipeline-core/state.sh find-active brainstorms)
echo "Active ID: $ID"

# 3. Simulate agent-done -- should emit write_file or present + transition
python3 skills/spec-pipeline-core/engine.py _test agent-done --id "$ID" --output "Here are my notes about hello world."

# 4. Simulate file-written -- should emit done
python3 skills/spec-pipeline-core/engine.py _test file-written --id "$ID"

# 5. Check status
python3 skills/spec-pipeline-core/engine.py _test status

# 6. Check list
python3 skills/spec-pipeline-core/engine.py _test list

# 7. Clean up test state
rm -f .claude/spec-pipeline/brainstorms/${ID}.json
```

- Verify: Each command should produce valid JSON output to stdout with the expected `action` field. The final `done` instruction should contain "Test workflow complete: hello world".

---

### Step 1.10: Verify backward-compatible state loading

- Files: No new files
- Action: Test that the engine can read existing state files from in-progress pipelines without errors.

```bash
cd /home/istar/code/ai_tools

# Check if any existing state files exist
ls .claude/spec-pipeline/*/  2>/dev/null || echo "No existing state files"

# Test schema defaults on a minimal state dict
python3 -c "
import sys; sys.path.insert(0, 'skills/spec-pipeline-core')
from engine.state import apply_schema_defaults
# Simulate an old state file missing new fields
old_state = {'id': 'test_123', 'description': 'old spec', 'stage': 'discovery'}
schema = {
    'description': 'string',
    'stage': 'string',
    'discovery': {'exchanges': 'array', 'summary': 'string|null', 'skipped': 'boolean', 'brainstormPath': 'string|null'},
    'specDraft': 'string',
    'specApproved': 'boolean',
    'specIteration': 'number'
}
result = apply_schema_defaults(old_state, schema)
import json
print(json.dumps(result, indent=2))
# Should show old fields preserved, new fields with defaults
assert result['id'] == 'test_123'
assert result['description'] == 'old spec'
assert result['discovery']['exchanges'] == []
assert result['discovery']['summary'] is None
assert result['specApproved'] == False
assert result['specIteration'] == 0
print('PASS: backward compatibility')
"
```

---

## Files Summary

### New Files
| File | Purpose | Pattern From |
|------|---------|--------------|
| `skills/spec-pipeline-core/engine/__init__.py` | Package marker | Standard Python |
| `skills/spec-pipeline-core/engine/instructions.py` | Instruction dataclasses + JSON serialization | Spec instruction protocol (lines 126-219) |
| `skills/spec-pipeline-core/engine/config.py` | Config loading via config.sh subprocess | `config.sh` wrapper |
| `skills/spec-pipeline-core/engine/state.py` | State read/write/init via state.sh + direct JSON | `state.sh` wrapper + direct file I/O |
| `skills/spec-pipeline-core/engine/context.py` | Template rendering + context assembly | Spec context assembly (lines 339-347) |
| `skills/spec-pipeline-core/engine/stages.py` | Stage type handlers (conversation, agent, approval, review, commit, loop) | Spec stage types (lines 293-302) |
| `skills/spec-pipeline-core/engine/runner.py` | Workflow runner: load definition, dispatch commands | Spec CLI interface (lines 313-337) |
| `skills/spec-pipeline-core/engine.py` | CLI entry point | `config.sh`/`state.sh` dispatcher pattern |
| `skills/spec-pipeline-core/workflows/_test.json` | Minimal test workflow for validation | Spec workflow format (lines 222-291) |
| `skills/spec-pipeline-core/prompts/_test_prompt.md` | Minimal test prompt | Spec prompt template pattern |
| `skills/spec-pipeline-core/workflows/` | Directory for workflow JSON definitions | Spec file layout |
| `skills/spec-pipeline-core/prompts/` | Directory for prompt templates | Spec file layout |

### Modified Files

None. Phase 1 is additive only.

## Completion Checklist
- [ ] Step 1.1: `instructions.py` -- all instruction types serialize to JSON correctly
- [ ] Step 1.2: `config.py` -- load_config, derive_short_name, construct_paths, build_agent_context all work via subprocess
- [ ] Step 1.3: `state.py` -- generate_id, read/write state, atomic writes, schema defaults
- [ ] Step 1.4: `context.py` -- template loading, variable substitution, exchange history formatting
- [ ] Step 1.5: `stages.py` -- all 6 stage type handlers return valid instructions
- [ ] Step 1.6: `runner.py` -- workflow loading, command dispatch, state save before emit
- [ ] Step 1.7: `engine.py` -- CLI parses all command forms, file variants work
- [ ] Step 1.8: Directories and test fixtures created
- [ ] Step 1.9: End-to-end smoke test passes (start -> agent-done -> file-written -> done)
- [ ] Step 1.10: Backward-compatible state loading preserves existing fields + fills defaults

## Key Design Decisions

1. **Subprocess delegation to shell scripts**: `config.sh` and `state.sh` are called via `subprocess.run()` rather than being rewritten. This matches the spec's out-of-scope note (line 62) and keeps Phase 1 focused.

2. **Atomic state writes**: State is written to a `.tmp` file then renamed via `os.replace()`. This ensures a crash between write and rename never corrupts the state file.

3. **State saved before instruction emission**: The runner always calls `write_state()` before returning the instruction. If the LLM crashes after receiving the instruction but before executing it, `resume` will re-emit the same instruction.

4. **Flat variable namespace**: Template variables are flattened one level (e.g., `discovery.summary` becomes `discovery_summary`). This avoids the need for nested access syntax in templates while covering the common case.

5. **Variant resolution**: Stage handlers use `_get_variant_field()` to check active flags against stage variant overrides. The `_active_flags` list is stored in state at initialization time.

6. **Loop stage is a placeholder**: The loop handler is structurally complete but will need refinement when the implement workflow is migrated in Phase 4. It is sufficient for testing.
