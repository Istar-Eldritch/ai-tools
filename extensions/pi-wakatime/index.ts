/**
 * WakaTime Extension for Pi
 *
 * Tracks coding activity with WakaTime when using pi coding agent.
 * Uses the wakatime-cli for heartbeats, which handles rate limiting,
 * offline queueing, language detection, and API communication.
 *
 * Tracks:
 * - Files read/written/edited by the agent
 * - Session activity (turns, thinking time)
 * - Project detection from cwd
 * - AI line changes for write/edit operations
 *
 * Requirements:
 * - wakatime-cli installed (~/.wakatime/wakatime-cli)
 * - WakaTime API key configured (~/.wakatime.cfg)
 *
 * Configuration via ~/.pi/agent/settings.json:
 * {
 *   "wakatime": {
 *     "enabled": true,
 *     "trackFiles": true,
 *     "trackSessions": false,
 *     "category": "ai coding",
 *     "cliPath": "~/.wakatime/wakatime-cli"
 *   }
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFile, execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as https from "node:https";
import { createWriteStream } from "node:fs";

// Extension version
const EXTENSION_VERSION = "0.1.3";

// Detect pi-coding-agent version from its package.json
function getPiVersion(): string {
	try {
		// Try to find pi-coding-agent package.json by resolving the module
		const piModulePath = require.resolve("@mariozechner/pi-coding-agent");
		let dir = path.dirname(piModulePath);
		
		// Walk up to find package.json
		while (dir !== path.dirname(dir)) {
			const packagePath = path.join(dir, "package.json");
			if (fs.existsSync(packagePath)) {
				const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
				if (pkg.name === "@mariozechner/pi-coding-agent" && pkg.version) {
					return pkg.version;
				}
			}
			dir = path.dirname(dir);
		}
	} catch {
		// Fallback if module resolution fails
	}
	return "unknown";
}



interface WakaTimeConfig {
	enabled: boolean;
	trackFiles: boolean;
	trackSessions: boolean;
	category: string;
	cliPath: string;
}

interface HeartbeatOptions {
	entity: string;
	entityType?: "file" | "app" | "domain";
	category?: string;
	project?: string;
	branch?: string;
	isWrite?: boolean;
	aiLineChanges?: number;
	plugin?: string;
}

// Platform and architecture detection for wakatime-cli download
function getPlatformInfo(): { platform: string; arch: string } | null {
	const platform = os.platform();
	const arch = os.arch();

	// Map Node.js platform to wakatime-cli naming
	let wkPlatform: string;
	switch (platform) {
		case "linux":
			wkPlatform = "linux";
			break;
		case "darwin":
			wkPlatform = "darwin";
			break;
		case "win32":
			wkPlatform = "windows";
			break;
		case "freebsd":
			wkPlatform = "freebsd";
			break;
		case "openbsd":
			wkPlatform = "openbsd";
			break;
		case "netbsd":
			wkPlatform = "netbsd";
			break;
		default:
			return null;
	}

	// Map Node.js arch to wakatime-cli naming
	let wkArch: string;
	switch (arch) {
		case "x64":
			wkArch = "amd64";
			break;
		case "arm64":
			wkArch = "arm64";
			break;
		case "ia32":
			wkArch = "386";
			break;
		case "arm":
			wkArch = "arm";
			break;
		default:
			return null;
	}

	return { platform: wkPlatform, arch: wkArch };
}

// Download a file from URL, following redirects
function downloadFile(url: string, destPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = createWriteStream(destPath);

		const request = (url: string) => {
			https
				.get(url, (response) => {
					// Handle redirects
					if (response.statusCode === 301 || response.statusCode === 302) {
						const redirectUrl = response.headers.location;
						if (redirectUrl) {
							file.close();
							fs.unlinkSync(destPath);
							request(redirectUrl);
							return;
						}
					}

					if (response.statusCode !== 200) {
						file.close();
						fs.unlinkSync(destPath);
						reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
						return;
					}

					response.pipe(file);
					file.on("finish", () => {
						file.close();
						resolve();
					});
				})
				.on("error", (err) => {
					file.close();
					fs.unlink(destPath, () => {}); // Delete partial file
					reject(err);
				});
		};

		request(url);
	});
}

// Check if WakaTime API key is configured
function isApiKeyConfigured(): boolean {
	const configPath = path.join(os.homedir(), ".wakatime.cfg");
	if (!fs.existsSync(configPath)) {
		return false;
	}

	try {
		const content = fs.readFileSync(configPath, "utf-8");
		// Check for api_key in the config (handles both api_key and api_key_vault_cmd)
		return /^\s*api_key\s*=/m.test(content);
	} catch {
		return false;
	}
}

// Save WakaTime API key to config file
function saveApiKey(apiKey: string): boolean {
	const configPath = path.join(os.homedir(), ".wakatime.cfg");

	try {
		let content = "";

		if (fs.existsSync(configPath)) {
			content = fs.readFileSync(configPath, "utf-8");

			// Replace existing api_key if present
			if (/^\s*api_key\s*=/m.test(content)) {
				content = content.replace(/^\s*api_key\s*=.*/m, `api_key = ${apiKey}`);
			} else if (/^\[settings\]/m.test(content)) {
				// Add api_key after [settings] section
				content = content.replace(/^\[settings\]/m, `[settings]\napi_key = ${apiKey}`);
			} else {
				// Add [settings] section with api_key
				content = `[settings]\napi_key = ${apiKey}\n\n${content}`;
			}
		} else {
			// Create new config file
			content = `[settings]\napi_key = ${apiKey}\n`;
		}

		fs.writeFileSync(configPath, content, { mode: 0o600 });
		return true;
	} catch {
		return false;
	}
}

// Validate WakaTime API key format
function isValidApiKey(key: string): boolean {
	// WakaTime API keys are either:
	// - Legacy: UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
	// - New: waka_ prefix followed by UUID (waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const wakaPattern = /^waka_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	return uuidPattern.test(key) || wakaPattern.test(key);
}

// Install wakatime-cli from GitHub releases
async function installWakaTimeCli(
	cliPath: string,
	notify?: (message: string, type: "info" | "warning" | "error") => void
): Promise<boolean> {
	const platformInfo = getPlatformInfo();
	if (!platformInfo) {
		notify?.("Unsupported platform for wakatime-cli auto-install", "warning");
		return false;
	}

	const { platform, arch } = platformInfo;
	const isWindows = platform === "windows";
	const binaryName = isWindows ? "wakatime-cli.exe" : "wakatime-cli";
	const zipName = `wakatime-cli-${platform}-${arch}.zip`;

	// Create installation directory
	const installDir = path.dirname(cliPath);
	if (!fs.existsSync(installDir)) {
		fs.mkdirSync(installDir, { recursive: true });
	}

	const zipPath = path.join(installDir, zipName);

	try {
		// Get latest release info
		notify?.("Checking for latest wakatime-cli release...", "info");

		const releaseInfo = await new Promise<{ tag_name: string; assets: { name: string; browser_download_url: string }[] }>(
			(resolve, reject) => {
				https
					.get(
						"https://api.github.com/repos/wakatime/wakatime-cli/releases/latest",
						{
							headers: { "User-Agent": "pi-wakatime-extension" },
						},
						(response) => {
							let data = "";
							response.on("data", (chunk) => (data += chunk));
							response.on("end", () => {
								try {
									resolve(JSON.parse(data));
								} catch (e) {
									reject(new Error("Failed to parse release info"));
								}
							});
						}
					)
					.on("error", reject);
			}
		);

		// Find the right asset
		const asset = releaseInfo.assets.find((a) => a.name === zipName);
		if (!asset) {
			notify?.(`No wakatime-cli binary found for ${platform}-${arch}`, "warning");
			return false;
		}

		// Download the zip
		notify?.(`Downloading wakatime-cli ${releaseInfo.tag_name}...`, "info");
		await downloadFile(asset.browser_download_url, zipPath);

		// Extract the zip
		notify?.("Extracting wakatime-cli...", "info");

		if (isWindows) {
			// Use PowerShell on Windows
			execFileSync("powershell", ["-Command", `Expand-Archive -Path "${zipPath}" -DestinationPath "${installDir}" -Force`]);
		} else {
			// Use unzip on Unix-like systems
			execFileSync("unzip", ["-o", zipPath, "-d", installDir]);
		}

		// The extracted binary has a platform-specific name, rename it
		const extractedName = `wakatime-cli-${platform}-${arch}${isWindows ? ".exe" : ""}`;
		const extractedPath = path.join(installDir, extractedName);

		if (fs.existsSync(extractedPath)) {
			// Remove existing cli if present
			if (fs.existsSync(cliPath)) {
				fs.unlinkSync(cliPath);
			}
			fs.renameSync(extractedPath, cliPath);
		}

		// Make executable on Unix
		if (!isWindows) {
			fs.chmodSync(cliPath, 0o755);
		}

		// Clean up zip file
		fs.unlinkSync(zipPath);

		notify?.(`wakatime-cli ${releaseInfo.tag_name} installed successfully!`, "info");
		return true;
	} catch (error) {
		// Clean up on failure
		if (fs.existsSync(zipPath)) {
			try {
				fs.unlinkSync(zipPath);
			} catch {}
		}

		const message = error instanceof Error ? error.message : String(error);
		notify?.(`Failed to install wakatime-cli: ${message}`, "error");
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	// Default configuration
	const defaultConfig: WakaTimeConfig = {
		enabled: true,
		trackFiles: true,
		trackSessions: false, // Disabled by default - session heartbeats use cwd which pollutes file stats
		category: "ai coding",
		cliPath: path.join(os.homedir(), ".wakatime", "wakatime-cli"),
	};

	let config: WakaTimeConfig = { ...defaultConfig };
	let currentModel: string | undefined;
	let currentProject: string | undefined;
	let currentBranch: string | undefined;
	let cliAvailable = false;
	const piVersion = getPiVersion();

	// Load config from settings
	function loadConfig(ctx: { cwd: string }) {
		try {
			const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
			if (fs.existsSync(settingsPath)) {
				const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
				if (settings.wakatime) {
					config = { ...defaultConfig, ...settings.wakatime };
				}
			}
		} catch {
			// Use defaults
		}

		// Expand ~ in cliPath
		if (config.cliPath.startsWith("~")) {
			config.cliPath = path.join(os.homedir(), config.cliPath.slice(1));
		}

		// Check if CLI exists
		cliAvailable = fs.existsSync(config.cliPath);

		// Detect project from cwd
		currentProject = path.basename(ctx.cwd);

		// Try to detect git branch
		try {
			const gitDir = findGitDir(ctx.cwd);
			if (gitDir) {
				const headPath = path.join(gitDir, "HEAD");
				if (fs.existsSync(headPath)) {
					const head = fs.readFileSync(headPath, "utf-8").trim();
					if (head.startsWith("ref: refs/heads/")) {
						currentBranch = head.replace("ref: refs/heads/", "");
					}
				}
			}
		} catch {
			// No git branch
		}
	}

	// Find .git directory
	function findGitDir(startDir: string): string | null {
		let dir = startDir;
		while (dir !== path.dirname(dir)) {
			const gitDir = path.join(dir, ".git");
			if (fs.existsSync(gitDir)) {
				// Handle both regular .git dir and worktree .git file
				const stat = fs.statSync(gitDir);
				if (stat.isDirectory()) {
					return gitDir;
				} else if (stat.isFile()) {
					// .git file pointing to worktree
					const content = fs.readFileSync(gitDir, "utf-8").trim();
					if (content.startsWith("gitdir: ")) {
						return content.slice(8);
					}
				}
			}
			dir = path.dirname(dir);
		}
		return null;
	}

	// Count lines in content
	function countLines(content: string): number {
		return content.split("\n").length;
	}

	// Get today's tracked time from wakatime-cli
	function getTodayTime(): Promise<string> {
		return new Promise((resolve) => {
			if (!cliAvailable) {
				resolve("(CLI not available)");
				return;
			}

			execFile(config.cliPath, ["--today"], { timeout: 10000 }, (error, stdout) => {
				if (error) {
					if (process.env.DEBUG) {
						console.error("[wakatime] failed to get today's time:", error.message);
					}
					resolve("(failed to fetch)");
					return;
				}

				const time = stdout.trim();
				resolve(time || "0 secs");
			});
		});
	}

	// Send heartbeat via wakatime-cli
	function sendHeartbeat(opts: HeartbeatOptions) {
		if (!config.enabled || !cliAvailable) {
			return;
		}

		const args: string[] = [];

		// Entity (file path or app name)
		args.push("--entity", opts.entity);

		// Entity type
		if (opts.entityType) {
			args.push("--entity-type", opts.entityType);
		}

		// Category (default: "AI assist")
		args.push("--category", opts.category || config.category);

		// Let wakatime-cli auto-detect language from file extension/content
		// (removed manual --language flag as wakatime-cli detection is more reliable)

		// Project
		if (opts.project || currentProject) {
			args.push("--project", opts.project || currentProject!);
		}

		// Branch
		if (opts.branch || currentBranch) {
			args.push("--alternate-branch", opts.branch || currentBranch!);
		}

		// Write flag
		if (opts.isWrite) {
			args.push("--write");
		}

		// AI line changes
		if (opts.aiLineChanges && opts.aiLineChanges > 0) {
			args.push("--ai-line-changes", String(opts.aiLineChanges));
		}

		// Plugin identifier - "pi-coding-agent/version" is recognized by WakaTime as "Pi Coding"
		const plugin = opts.plugin || `pi-coding-agent/${piVersion}`;
		args.push("--plugin", plugin);

		// Debug output
		if (process.env.DEBUG) {
			console.error("[wakatime] heartbeat:", config.cliPath, args.join(" "));
		}

		// Execute async, ignore errors
		execFile(config.cliPath, args, { timeout: 10000 }, (error, stdout, stderr) => {
			if (process.env.DEBUG) {
				if (error) {
					console.error("[wakatime] heartbeat failed:", error.message);
				}
				if (stdout) {
					console.error("[wakatime] stdout:", stdout);
				}
				if (stderr) {
					console.error("[wakatime] stderr:", stderr);
				}
			}
		});
	}

	// Helper to update currentModel from context
	function updateModelFromContext(ctx: { model?: { provider: string; id: string } | null }) {
		if (ctx.model) {
			currentModel = `${ctx.model.provider}/${ctx.model.id}`;
		}
	}

	// Track session start
	pi.on("session_start", async (_event, ctx) => {
		loadConfig(ctx);
		updateModelFromContext(ctx);

		// Auto-install wakatime-cli if not found
		if (!cliAvailable) {
			const notify = ctx.hasUI ? ctx.ui.notify.bind(ctx.ui) : undefined;
			notify?.("WakaTime CLI not found, attempting auto-install...", "info");

			const installed = await installWakaTimeCli(config.cliPath, notify);
			if (installed) {
				cliAvailable = true;
			} else {
				if (ctx.hasUI) {
					ctx.ui.notify(
						"WakaTime CLI not found. Install manually from: https://wakatime.com/terminal",
						"warning"
					);
				}
				return;
			}
		}

		// Check if API key is configured
		if (!isApiKeyConfigured()) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					"WakaTime API key not configured. Run /wakatime-setup to configure.",
					"warning"
				);
			}
			// Disable tracking until API key is configured
			config.enabled = false;
			return;
		}

		if (!config.enabled) {
			return;
		}

		// Send initial heartbeat for session
		if (config.trackSessions) {
			sendHeartbeat({
				entity: ctx.cwd,
				entityType: "app",
				category: config.category,
			});
		}
	});

	// Track model changes
	pi.on("model_select", async (event, _ctx) => {
		currentModel = `${event.model.provider}/${event.model.id}`;
	});

	// Track turn activity
	pi.on("turn_start", async (_event, ctx) => {
		if (!config.enabled || !config.trackSessions) {
			return;
		}

		updateModelFromContext(ctx);
		sendHeartbeat({
			entity: ctx.cwd,
			entityType: "app",
			category: config.category,
		});
	});

	// Track file operations
	pi.on("tool_result", async (event, ctx) => {
		if (!config.enabled || !config.trackFiles) {
			return;
		}

		updateModelFromContext(ctx);
		const toolName = event.toolName;

		// Only track file operations
		if (!["read", "write", "edit"].includes(toolName)) {
			return;
		}

		// Get file path from input
		const filePath = event.input?.path as string | undefined;
		if (!filePath) {
			return;
		}

		// Resolve to absolute path and normalize (removes trailing slashes, resolves . and ..)
		const absolutePath = path.normalize(
			path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath)
		);

		// Skip if file doesn't exist (for reads that failed)
		if (toolName === "read" && !fs.existsSync(absolutePath)) {
			return;
		}

		// Calculate line changes for write/edit
		let aiLineChanges: number | undefined;
		if (toolName === "write") {
			const content = event.input?.content as string | undefined;
			if (content) {
				aiLineChanges = countLines(content);
			}
		} else if (toolName === "edit") {
			const oldText = event.input?.oldText as string | undefined;
			const newText = event.input?.newText as string | undefined;
			if (oldText && newText) {
				const oldLines = countLines(oldText);
				const newLines = countLines(newText);
				aiLineChanges = Math.abs(newLines - oldLines) || 1; // At least 1 line changed
			}
		}

		sendHeartbeat({
			entity: absolutePath,
			entityType: "file",
			isWrite: toolName !== "read",
			aiLineChanges,
		});
	});

	// Track session end
	pi.on("session_shutdown", async (_event, ctx) => {
		if (!config.enabled || !config.trackSessions) {
			return;
		}

		updateModelFromContext(ctx);
		// Final heartbeat
		sendHeartbeat({
			entity: ctx.cwd,
			entityType: "app",
			category: config.category,
		});
	});

	// Register command to check status
	pi.registerCommand("wakatime", {
		description: "Show WakaTime integration status",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const status: string[] = [];

			// Fetch today's time
			const todayTime = await getTodayTime();
			status.push(`⏱️  Today: ${todayTime}`);
			status.push("");

			// CLI status
			if (!cliAvailable) {
				status.push("❌ CLI not found: " + config.cliPath);
				status.push("   Run /wakatime-install to auto-install");
			} else {
				status.push("✓ CLI found: " + config.cliPath);
			}

			// API key status
			if (!isApiKeyConfigured()) {
				status.push("❌ API key not configured");
				status.push("   Run /wakatime-setup <api_key> to configure");
				status.push("   Get your key from: https://wakatime.com/settings/api-key");
			} else {
				status.push("✓ API key configured");
			}

			status.push("");
			status.push("Configuration:");
			status.push(`  Enabled: ${config.enabled}`);
			status.push(`  Track files: ${config.trackFiles}`);
			status.push(`  Track sessions: ${config.trackSessions}`);
			status.push(`  Category: ${config.category}`);

			status.push("");
			status.push("Current session:");
			status.push(`  Project: ${currentProject || "(none)"}`);
			status.push(`  Branch: ${currentBranch || "(none)"}`);
			status.push(`  Model: ${currentModel || "(none)"}`);

			status.push("");
			status.push("Version info:");
			status.push(`  pi-coding-agent: ${piVersion}`);
			status.push(`  pi-wakatime: ${EXTENSION_VERSION}`);

			ctx.ui.notify(status.join("\n"), "info");
		},
	});

	// Register command to manually install wakatime-cli
	pi.registerCommand("wakatime-install", {
		description: "Install or update wakatime-cli",
		handler: async (_args, ctx) => {
			const notify = ctx.hasUI ? ctx.ui.notify.bind(ctx.ui) : undefined;

			if (cliAvailable) {
				notify?.("wakatime-cli is already installed. Reinstalling...", "info");
			}

			const installed = await installWakaTimeCli(config.cliPath, notify);
			if (installed) {
				cliAvailable = true;
			}
		},
	});

	// Register command to setup WakaTime API key
	pi.registerCommand("wakatime-setup", {
		description: "Configure WakaTime API key",
		args: [{ name: "api_key", description: "Your WakaTime API key (from https://wakatime.com/settings/api-key)", optional: true }],
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			const apiKey = args.api_key as string | undefined;

			if (!apiKey) {
				ctx.ui.notify(
					"Usage: /wakatime-setup <api_key>\n\n" +
					"Get your API key from: https://wakatime.com/settings/api-key\n\n" +
					"Example: /wakatime-setup waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
					"info"
				);
				return;
			}

			// Validate API key format
			if (!isValidApiKey(apiKey)) {
				ctx.ui.notify(
					"Invalid API key format.\n\n" +
					"WakaTime API keys look like:\n" +
					"  waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n" +
					"  or: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n\n" +
					"Get your key from: https://wakatime.com/settings/api-key",
					"error"
				);
				return;
			}

			// Save API key
			if (saveApiKey(apiKey)) {
				ctx.ui.notify("WakaTime API key configured successfully!", "info");
				// Re-enable tracking
				config.enabled = true;
			} else {
				ctx.ui.notify("Failed to save API key to ~/.wakatime.cfg", "error");
			}
		},
	});

	// Register command to toggle tracking
	pi.registerCommand("wakatime-toggle", {
		description: "Toggle WakaTime tracking on/off",
		handler: async (_args, ctx) => {
			config.enabled = !config.enabled;

			if (ctx.hasUI) {
				ctx.ui.notify(`WakaTime tracking ${config.enabled ? "enabled" : "disabled"}`, "info");
			}
		},
	});
}
