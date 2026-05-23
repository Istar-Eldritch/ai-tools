import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { DbManager } from "../store/db.js";
import type { EmbeddingProvider } from "../embeddings.js";
import {
	upsertMemory,
	replaceMemory,
	removeMemory,
} from "../store/memory-store.js";
import { MEMORY_TOOL_DESCRIPTION } from "../constants.js";
import type { MemoryTarget, MemoryCategory } from "../types.js";

function resolveTarget(
	raw: "memory" | "user" | "project" | "failure",
): MemoryTarget {
	return raw === "project" ? "memory" : raw;
}

function resolveProject(
	raw: "memory" | "user" | "project" | "failure",
	projectName: string | null,
): string | null {
	return raw === "project" ? projectName : null;
}

export function registerMemoryTool(
	pi: ExtensionAPI,
	db: DbManager,
	embedder: EmbeddingProvider,
	projectName: string | null,
): void {
	pi.registerTool({
		name: "memory",
		label: "Memory",
		description: MEMORY_TOOL_DESCRIPTION,
		promptSnippet:
			"Save durable information to persistent memory that survives across sessions",
		promptGuidelines: [
			"Use the memory tool proactively when the user corrects you, shares a preference, or reveals personal details worth remembering.",
			"Use the memory tool when you discover environment facts, project conventions, or reusable patterns useful in future sessions.",
			"Do NOT use memory for temporary task state, TODO items, or session progress — only for durable, cross-session facts.",
			"Use target='failure' with category to save what didn't work (failures, corrections, insights).",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("add"),
				Type.Literal("replace"),
				Type.Literal("remove"),
			]),
			target: Type.Union([
				Type.Literal("memory"),
				Type.Literal("user"),
				Type.Literal("project"),
				Type.Literal("failure"),
			]),
			content: Type.Optional(
				Type.String({ description: "Entry content for add/replace" }),
			),
			old_text: Type.Optional(
				Type.String({
					description: "Substring identifying entry for replace/remove",
				}),
			),
			category: Type.Optional(
				Type.Union(
					[
						Type.Literal("failure"),
						Type.Literal("correction"),
						Type.Literal("insight"),
						Type.Literal("preference"),
						Type.Literal("convention"),
						Type.Literal("tool-quirk"),
					],
					{ description: "Category for failure memories" },
				),
			),
			failure_reason: Type.Optional(
				Type.String({ description: "Why it failed (for failure category)" }),
			),
		}),
		async execute(_toolCallId, params) {
			const {
				action,
				target: rawTarget,
				content,
				old_text,
				category,
				failure_reason,
			} = params;
			const target = resolveTarget(rawTarget);
			const project = resolveProject(rawTarget, projectName);

			try {
				if (action === "add") {
					if (!content?.trim()) {
						return {
							content: [
								{ type: "text" as const, text: "content is required for add" },
							],
							details: {},
						};
					}
					const result = await upsertMemory(db, embedder, {
						content: content.trim(),
						target,
						project,
						category: category as MemoryCategory | undefined,
						failureReason: failure_reason ?? null,
					});
					const msg =
						result.action === "inserted"
							? `Memory saved (id=${result.entry.id}).`
							: "Memory already exists (no duplicate stored).";
					return {
						content: [{ type: "text" as const, text: msg }],
						details: result,
					};
				}

				if (action === "replace") {
					if (!old_text?.trim() || !content?.trim()) {
						return {
							content: [
								{
									type: "text" as const,
									text: "old_text and content are required for replace",
								},
							],
							details: {},
						};
					}
					const result = await replaceMemory(db, embedder, {
						oldText: old_text.trim(),
						newContent: content.trim(),
						target,
						project,
					});
					const msg =
						result.updated > 0
							? `Updated ${result.updated} memory entry.`
							: `No matching memory found for "${old_text}".`;
					return {
						content: [{ type: "text" as const, text: msg }],
						details: result,
					};
				}

				if (action === "remove") {
					if (!old_text?.trim()) {
						return {
							content: [
								{
									type: "text" as const,
									text: "old_text is required for remove",
								},
							],
							details: {},
						};
					}
					const result = await removeMemory(db, {
						oldText: old_text.trim(),
						target,
						project,
					});
					const msg =
						result.removed > 0
							? `Removed ${result.removed} memory entry.`
							: `No matching memory found for "${old_text}".`;
					return {
						content: [{ type: "text" as const, text: msg }],
						details: result,
					};
				}

				return {
					content: [
						{ type: "text" as const, text: `Unknown action: ${action}` },
					],
					details: {},
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Memory error: ${msg}` }],
					details: {},
				};
			}
		},
	});
}
