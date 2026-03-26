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
