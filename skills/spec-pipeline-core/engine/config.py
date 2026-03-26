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
