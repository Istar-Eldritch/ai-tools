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
