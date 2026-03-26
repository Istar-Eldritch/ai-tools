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
