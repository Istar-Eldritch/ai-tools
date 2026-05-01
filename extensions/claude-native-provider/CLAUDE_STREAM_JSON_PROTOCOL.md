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

## Manual Pi Lifecycle Validation

With `claude-native` selected, validate lifecycle invalidation manually:

1. Send a prompt and observe a Claude Code process start.
2. Send a second prompt in the same Pi session and observe process reuse.
3. Change models with Pi's model selection command; the old Claude process should be terminated, and the next Claude-native request should start a safe process.
4. Navigate the session tree (`/tree`) or fork a prior user message; the Claude native process/session mapping should be hard-invalidated, so the next request starts without `--resume` from the abandoned branch.
5. Trigger context compaction; after compaction completes, the next request should not reuse the pre-compaction Claude process/session mapping.
6. Run `/claude-native-reset`; all live Claude native processes should terminate and the next request should start fresh.

## Manual Diagnostics and Reset Validation

Run Pi with Claude native diagnostics enabled:

```bash
CLAUDE_NATIVE_DEBUG=1 CLAUDE_NATIVE_IDLE_TIMEOUT_MS=2000 pi
```

Expected checks:

1. Select a `claude-native` model and send a prompt.
   - Pi status should mention `Claude Code process started`.
   - stderr/log output should include `[claude-native] pool.create_runtime` and `[claude-native] process.spawn`.
2. Send a second prompt in the same Pi session/model/cwd.
   - Pi status should mention `Claude Code process reused`.
   - logs should include `[claude-native] pool.reuse_runtime`.
3. Run `/claude-native-status`.
   - Notification should show live process count, remembered session count, model alias, cwd, and Pi session identity.
   - Raw Claude `session_id` values must not be displayed.
4. Run `/claude-native-reset`.
   - Notification should report terminated process count and cleared remembered session count.
   - logs should include `[claude-native] pool.reset` and process termination diagnostics.
5. Send another prompt after reset.
   - It should start fresh and must not resume the pre-reset Claude session.
6. Wait longer than `CLAUDE_NATIVE_IDLE_TIMEOUT_MS`.
   - logs should include `process.idle_reap` / `pool.process_exit` with `code=idle`.
   - `/claude-native-status` should show no live process for that key but may show a remembered Claude session.
7. Trigger model switch, `/tree` navigation or fork, compaction, and session shutdown.
   - logs should distinguish `model_select` retirement from hard invalidation events.
