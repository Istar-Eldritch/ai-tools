import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getDatabase, isDatabaseReady } from "../store/db.ts";
import { getCounts } from "../store/chunk-store.ts";
import type { HuginnConfig } from "../types.ts";

export function registerStatusCommand(
	pi: ExtensionAPI,
	getConfig: () => HuginnConfig,
) {
	pi.registerCommand("huginn-status", {
		description: "Show Huginn memory index status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const db = getDatabase();
			if (!db || !isDatabaseReady()) {
				ctx.ui.notify(
					"[huginn] Status unavailable: database not initialized.",
					"warning",
				);
				return;
			}

			const config = getConfig();
			const counts = await getCounts(db);
			const modelInfo = `${config.embeddingModel} (${config.embeddingDim}d)`;

			ctx.ui.notify(
				`[huginn] ${counts.total} chunks (${counts.conversations} conversation, ${counts.codebase} codebase) — model: ${modelInfo}`,
				"info",
			);
		},
	});
}
