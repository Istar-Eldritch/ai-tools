# Claude Code Stream-JSON Protocol Notes

## Validated CLI

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --model haiku \
  --max-turns 1
```

## Input Message

Each user turn is one JSON line written to stdin. Keep stdin open for long-lived mode.

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with OK only."}]}}
```

## Turn Boundary

Treat an output event with `type: "result"` as the end of the current user turn. The process may remain alive and can accept another input JSON line after the result.

## Observed Output Events

- `system` / `init`: includes `session_id`, cwd, tools, model, etc.
- `rate_limit_event`: includes rate limit info and `session_id`.
- `assistant`: includes `message.content` blocks and usage details.
- `result`: includes `subtype`, `is_error`, `stop_reason`, `session_id`, `usage`, and cost.

## Notes

- Do not call `stdin.end(prompt)` after each prompt in long-lived mode.
- Use `--resume <session_id>` only when starting/restarting a process.
- `CLAUDE_NATIVE_PERMISSION_MODE=none` is a local sentinel and must not be passed to the CLI.
- Real CLI validation is manual; automated tests must mock child processes.

## Optional Manual Validation

This command uses a disposable directory and sends two sequential user messages to one Claude Code process. Keep this as a manual smoke test only; do not run real Claude Code in automated tests.

```bash
tmp=$(mktemp -d)
cd "$tmp"
node <<'NODE'
const { spawn } = require("node:child_process");
const child = spawn("claude", [
  "-p",
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--verbose",
  "--model", "haiku",
  "--max-turns", "1",
], { stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
let results = 0;
const send = (text) => child.stdin.write(JSON.stringify({
  type: "user",
  message: { role: "user", content: [{ type: "text", text }] },
}) + "\n");

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    console.log(msg.type, msg.subtype || "", msg.session_id || "");
    if (msg.type === "result") {
      results++;
      if (results === 1) send("Reply with TWO only.");
      else child.stdin.end();
    }
  }
});
child.on("close", (code) => console.log("close", code, "results", results));
send("Reply with ONE only.");
NODE
cd - >/dev/null
rm -rf "$tmp"
```
