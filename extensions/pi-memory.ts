/**
 * pi-memory — Hermes-style persistent memory for pi.
 *
 * Two scopes, one tool:
 *   - global  ~/.pi/agent/memory/global/MEMORY.md          (user-level, cross-project)
 *   - project ~/.pi/agent/memory/<slug>/MEMORY.md          (per-cwd)
 *
 * Each file holds entries separated by a literal `§` line. Both files are
 * loaded once at session_start, injected verbatim into the system prompt,
 * and never re-read for the rest of the session (prefix-cache stability).
 *
 * Writes go through the `memory` tool: { scope, action: add|replace|remove, ... }.
 * Hard char caps; `add` errors and returns current entries when the file is full,
 * forcing the agent to consolidate via replace/remove before retrying.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Scope = "global" | "project";

const SEPARATOR = "\n§\n";
const MEMORY_ROOT = path.join(process.env.HOME ?? "", ".pi", "agent", "memory");

const CAPS: Record<Scope, number> = {
	global: 1375,
	project: 2200,
};

function slugForCwd(cwd: string): string {
	const abs = path.resolve(cwd);
	return abs.replace(/\//g, "-");
}

function fileFor(scope: Scope, cwd: string): string {
	const dir = scope === "global" ? "global" : slugForCwd(cwd);
	return path.join(MEMORY_ROOT, dir, "MEMORY.md");
}

function readFileOrEmpty(p: string): string {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return "";
	}
}

function splitEntries(body: string): string[] {
	const trimmed = body.trim();
	if (!trimmed) return [];
	return trimmed
		.split(SEPARATOR)
		.map((e) => e.trim())
		.filter((e) => e.length > 0);
}

function joinEntries(entries: string[]): string {
	if (entries.length === 0) return "";
	return entries.join(SEPARATOR) + "\n";
}

function formatEntriesForList(entries: string[]): string {
	if (entries.length === 0) return "(empty)";
	return entries.map((e, i) => `[${i + 1}] ${e}`).join("\n---\n");
}

function findMatches(entries: string[], needle: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].includes(needle)) out.push(i);
	}
	return out;
}

async function withMemoryFile<T>(
	filePath: string,
	fn: (current: string) => Promise<{ result: T; next?: string }>,
): Promise<T> {
	return withFileMutationQueue(filePath, async () => {
		const current = readFileOrEmpty(filePath);
		const { result, next } = await fn(current);
		if (next !== undefined && next !== current) {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, next, "utf8");
		}
		return result;
	});
}

const SYSTEM_PROMPT_HEADER = `
## Persistent Memory

You have two memory files, frozen at the start of this session and injected
below. They will NOT update mid-session — anything you write via the \`memory\`
tool will only be visible to you in future sessions.

- **global** (cap: ${CAPS.global} chars): user-level notes that apply across all
  projects — preferences, identity, communication style.
- **project** (cap: ${CAPS.project} chars): notes about THIS project — its
  conventions, gotchas, decisions, environment facts.

### When to write

Write a memory entry when you learn something **surprising, non-obvious, and
durable** that you would want to remember next session. Good candidates:
- User preferences ("prefers terse responses", "uses fish, not bash")
- Project conventions not visible from a single file ("tests live next to source
  as \`*.test.ts\`, not under \`__tests__/\`")
- Sharp edges and gotchas ("this script must be run from repo root")
- Decisions and their rationale ("we chose X over Y because Z")

### What NOT to write

- Facts derivable from \`git log\`, \`README.md\`, or one \`ls\` away
- Information about the current task — that's session-local
- Generic programming knowledge
- Anything you'd be embarrassed to surface unprompted to the user later

### How to write

Use the \`memory\` tool. Entries are short standalone notes — one fact each,
not a journal. The tool enforces a hard character cap per file. If \`add\`
fails because the file is full, the tool returns current entries; you must
\`replace\` or \`remove\` to make room before retrying.

When the file is above 80% capacity, consolidate before adding: prefer
merging or rewriting existing entries over piling on new ones.
`;

function buildInjection(scope: Scope, filePath: string, body: string): string {
	const entries = splitEntries(body);
	const used = body.length;
	const cap = CAPS[scope];
	const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
	const header = `### ${scope} memory — ${used}/${cap} chars (${pct}% used) — ${filePath}`;
	if (entries.length === 0) {
		return `${header}\n\n(no entries yet)`;
	}
	return `${header}\n\n${formatEntriesForList(entries)}`;
}

export default function piMemoryExtension(pi: ExtensionAPI) {
	let frozenSnapshot: { global: string; project: string } = { global: "", project: "" };
	let projectFile = "";
	let globalFile = "";

	pi.on("session_start", async (_event, ctx) => {
		globalFile = fileFor("global", ctx.cwd);
		projectFile = fileFor("project", ctx.cwd);
		frozenSnapshot = {
			global: readFileOrEmpty(globalFile),
			project: readFileOrEmpty(projectFile),
		};
		const globalEntries = splitEntries(frozenSnapshot.global).length;
		const projectEntries = splitEntries(frozenSnapshot.project).length;
		ctx.ui.setStatus(
			"pi-memory",
			`memory: ${globalEntries}g / ${projectEntries}p`,
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("pi-memory", undefined);
	});

	pi.on("before_agent_start", async (event) => {
		const globalBlock = buildInjection("global", globalFile, frozenSnapshot.global);
		const projectBlock = buildInjection("project", projectFile, frozenSnapshot.project);
		return {
			systemPrompt:
				event.systemPrompt +
				"\n" +
				SYSTEM_PROMPT_HEADER +
				"\n" +
				globalBlock +
				"\n\n" +
				projectBlock +
				"\n",
		};
	});

	pi.registerTool({
		name: "memory",
		label: "Memory",
		description:
			"Read or modify persistent memory. Memory is frozen at session start; " +
			"writes are visible only in future sessions. Scopes: global (cross-project " +
			"user prefs) and project (per-cwd notes). Actions: add | replace | remove. " +
			"Hard char caps are enforced — when full, add fails and returns current entries.",
		promptSnippet:
			"Persist notes across sessions (memory tool, scopes: global|project, actions: add|replace|remove)",
		promptGuidelines: [
			"Use memory to record durable, surprising facts you want to remember next session — not session-local task state.",
			"Use memory with action=add for new entries. For consolidation or correction, use replace (substring match) or remove.",
			"If memory add fails because the file is full, do not retry blindly — consolidate via memory replace/remove first.",
		],
		parameters: Type.Object({
			scope: StringEnum(["global", "project"] as const),
			action: StringEnum(["add", "replace", "remove"] as const),
			content: Type.Optional(
				Type.String({
					description:
						"For add: the entry to append. For replace: the new text. Omitted for remove.",
				}),
			),
			target: Type.Optional(
				Type.String({
					description:
						"For replace/remove: a substring uniquely identifying the entry to modify. Ignored for add.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const scope = params.scope as Scope;
			const filePath = scope === "global" ? globalFile : projectFile;
			const cap = CAPS[scope];

			return withMemoryFile<{ content: { type: "text"; text: string }[]; details: unknown }>(
				filePath,
				async (current) => {
					const entries = splitEntries(current);

					if (params.action === "add") {
						if (!params.content || !params.content.trim()) {
							throw new Error("memory add: content is required and must be non-empty");
						}
						const entry = params.content.trim();
						const next = joinEntries([...entries, entry]);
						if (next.length > cap) {
							return {
								result: {
									content: [
										{
											type: "text" as const,
											text:
												`memory add rejected: ${scope} file would exceed cap (${next.length}/${cap} chars).\n\n` +
												`Current entries (consolidate via replace/remove, then retry):\n\n` +
												formatEntriesForList(entries),
										},
									],
									details: { scope, action: "add", rejected: true, used: current.length, cap },
								},
							};
						}
						return {
							result: {
								content: [
									{
										type: "text" as const,
										text: `Added entry to ${scope} memory (${next.length}/${cap} chars).`,
									},
								],
								details: { scope, action: "add", used: next.length, cap, entry },
							},
							next,
						};
					}

					if (params.action === "remove" || params.action === "replace") {
						const needle = params.target?.trim();
						if (!needle) {
							throw new Error(`memory ${params.action}: target substring is required`);
						}
						const matches = findMatches(entries, needle);
						if (matches.length === 0) {
							throw new Error(
								`memory ${params.action}: no entry in ${scope} matches target ${JSON.stringify(needle)}.\n\nCurrent entries:\n${formatEntriesForList(entries)}`,
							);
						}
						if (matches.length > 1) {
							const matched = matches.map((i) => `[${i + 1}] ${entries[i]}`).join("\n---\n");
							throw new Error(
								`memory ${params.action}: target ${JSON.stringify(needle)} matched ${matches.length} entries in ${scope}; provide a more specific substring.\n\nMatches:\n${matched}`,
							);
						}
						const idx = matches[0];

						if (params.action === "remove") {
							const nextEntries = entries.filter((_, i) => i !== idx);
							const next = joinEntries(nextEntries);
							return {
								result: {
									content: [
										{
											type: "text" as const,
											text: `Removed entry [${idx + 1}] from ${scope} memory (${next.length}/${cap} chars).`,
										},
									],
									details: { scope, action: "remove", used: next.length, cap, removed: entries[idx] },
								},
								next,
							};
						}

						// replace
						if (!params.content || !params.content.trim()) {
							throw new Error("memory replace: content is required and must be non-empty");
						}
						const replacement = params.content.trim();
						const nextEntries = entries.map((e, i) => (i === idx ? replacement : e));
						const next = joinEntries(nextEntries);
						if (next.length > cap) {
							return {
								result: {
									content: [
										{
											type: "text" as const,
											text:
												`memory replace rejected: ${scope} file would exceed cap (${next.length}/${cap} chars).\n\n` +
												`Current entries:\n\n${formatEntriesForList(entries)}`,
										},
									],
									details: { scope, action: "replace", rejected: true, used: current.length, cap },
								},
							};
						}
						return {
							result: {
								content: [
									{
										type: "text" as const,
										text: `Replaced entry [${idx + 1}] in ${scope} memory (${next.length}/${cap} chars).`,
									},
								],
								details: {
									scope,
									action: "replace",
									used: next.length,
									cap,
									before: entries[idx],
									after: replacement,
								},
							},
							next,
						};
					}

					throw new Error(`memory: unknown action ${params.action}`);
				},
			);
		},
	});

	pi.registerCommand("memory", {
		description: "Show current persistent memory (global and project)",
		handler: async (_args, ctx) => {
			const g = readFileOrEmpty(globalFile);
			const p = readFileOrEmpty(projectFile);
			const gEntries = splitEntries(g);
			const pEntries = splitEntries(p);
			ctx.ui.notify(
				`global (${g.length}/${CAPS.global}, ${gEntries.length} entries): ${globalFile}\n` +
					`project (${p.length}/${CAPS.project}, ${pEntries.length} entries): ${projectFile}`,
				"info",
			);
		},
	});
}
