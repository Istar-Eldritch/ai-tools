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
