import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { logClaudeNativeDiagnostic, redactClaudeArgs } from "./claude-diagnostics.ts";
import { encodeUserInput, isClaudeResultEvent } from "./claude-protocol.ts";

type SpawnFn = typeof spawn;

export interface ClaudeProcessEventHandlers {
	onMessage(message: any): void;
	onMalformedJson?(line: string): void;
	onStderr?(text: string): void;
	onStatus?(status: string): void;
}

export interface ClaudeTurnOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export type ClaudeTurnFailureCode =
	| "aborted"
	| "timeout"
	| "stdin_error"
	| "process_error"
	| "process_close"
	| "terminated";

export class ClaudeTurnError extends Error {
	constructor(
		message: string,
		readonly code: ClaudeTurnFailureCode,
		readonly unsafeSession = false,
	) {
		super(message);
		this.name = "ClaudeTurnError";
		Object.setPrototypeOf(this, ClaudeTurnError.prototype);
	}
}

export interface ClaudeProcessExitEvent {
	code: ClaudeTurnFailureCode | "idle";
	reason: string;
	unsafeSession: boolean;
}

export interface ClaudeProcessConfig {
	bin: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	idleTimeoutMs: number;
	spawnFn?: SpawnFn;
	onExit?: (event: ClaudeProcessExitEvent) => void;
}

interface InFlightTurn {
	handlers: ClaudeProcessEventHandlers;
	resolve(): void;
	reject(error: Error): void;
	timeoutHandle?: ReturnType<typeof setTimeout>;
	abortHandler?: () => void;
	signal?: AbortSignal;
}

export class ClaudeNativeProcess {
	private child?: ChildProcessWithoutNullStreams;
	private rl?: readline.Interface;
	private inFlight?: InFlightTurn;
	private queue?: Promise<void>;
	private idleHandle?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(private readonly config: ClaudeProcessConfig) {}

	isLive(): boolean {
		return !!this.child && !this.closed && !this.child.killed;
	}

	runTurn(prompt: string, handlers: ClaudeProcessEventHandlers, options: ClaudeTurnOptions = {}): Promise<void> {
		const run = () => this.runTurnNow(prompt, handlers, options);
		const scheduled = this.queue ? this.queue.then(run, run) : run();
		const tail = scheduled.catch(() => undefined);
		this.queue = tail;
		tail.finally(() => {
			if (this.queue === tail) this.queue = undefined;
		});
		return scheduled;
	}

	terminate(reason: string): void {
		this.terminateWithEvent(reason, "terminated");
	}

	private start(): void {
		if (this.isLive()) return;
		if (this.closed) throw new ClaudeTurnError("Claude Code process is closed", "terminated", false);
		this.clearIdleTimer();
		const spawnFn = this.config.spawnFn ?? spawn;
		logClaudeNativeDiagnostic("process.spawn", {
			bin: this.config.bin,
			args: redactClaudeArgs(this.config.args),
			cwd: this.config.cwd,
		}, this.config.env);
		const child = spawnFn(this.config.bin, this.config.args, {
			cwd: this.config.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: this.config.env,
		}) as ChildProcessWithoutNullStreams;
		this.child = child;
		this.rl = readline.createInterface({ input: child.stdout });
		this.rl.on("line", (line) => this.handleStdoutLine(line));
		child.stderr.on("data", (chunk) => this.inFlight?.handlers.onStderr?.(chunk.toString()));
		child.on("error", (err) => this.handleProcessFailure(err, child, "process_error"));
		child.on("close", (code) => this.handleProcessFailure(new Error(`Claude Code exited with code ${code}`), child, "process_close"));
	}

	private runTurnNow(prompt: string, handlers: ClaudeProcessEventHandlers, options: ClaudeTurnOptions): Promise<void> {
		this.clearIdleTimer();
		try {
			this.start();
		} catch (err) {
			return Promise.reject(err instanceof Error ? err : new Error(String(err)));
		}
		if (!this.child) return Promise.reject(new Error("Claude Code process is not available"));

		return new Promise((resolve, reject) => {
			this.inFlight = { handlers, resolve, reject, signal: options.signal };

			if (options.timeoutMs && options.timeoutMs > 0) {
				this.inFlight.timeoutHandle = setTimeout(() => {
					this.failInFlight(new ClaudeTurnError(`Claude Code timed out after ${options.timeoutMs}ms`, "timeout", true));
				}, options.timeoutMs);
				this.inFlight.timeoutHandle.unref?.();
			}

			if (options.signal) {
				this.inFlight.abortHandler = () => this.failInFlight(new ClaudeTurnError("Claude Code request aborted", "aborted", true));
				if (options.signal.aborted) {
					this.inFlight.abortHandler();
					return;
				}
				options.signal.addEventListener("abort", this.inFlight.abortHandler, { once: true });
			}

			this.child!.stdin.write(encodeUserInput(prompt), (err) => {
				if (err) this.failInFlight(new ClaudeTurnError(err.message, "stdin_error", true));
			});
		});
	}

	private handleStdoutLine(line: string): void {
		if (!line.trim()) return;
		let message: any;
		try {
			message = JSON.parse(line);
		} catch {
			this.inFlight?.handlers.onMalformedJson?.(line);
			return;
		}
		this.inFlight?.handlers.onMessage(message);
		if (isClaudeResultEvent(message)) this.resolveInFlight();
	}

	private resolveInFlight(): void {
		const turn = this.inFlight;
		if (!turn) return;
		this.cleanupInFlight();
		turn.resolve();
		this.armIdleTimer();
	}

	private failInFlight(error: Error): void {
		if (!this.inFlight) return;
		const turnError = error instanceof ClaudeTurnError
			? error
			: new ClaudeTurnError(error.message, "terminated", true);

		this.closed = true;
		this.clearIdleTimer();
		this.cleanupInFlight(turnError);
		this.closeReadline();
		const child = this.detachChild();
		this.config.onExit?.({
			code: turnError.code,
			reason: turnError.message,
			unsafeSession: turnError.unsafeSession,
		});
		this.killChild(child);
	}

	private cleanupInFlight(error?: Error): void {
		const turn = this.inFlight;
		if (!turn) return;
		this.inFlight = undefined;
		if (turn.timeoutHandle) clearTimeout(turn.timeoutHandle);
		if (turn.signal && turn.abortHandler) turn.signal.removeEventListener("abort", turn.abortHandler);
		if (error) turn.reject(error);
	}

	private closeReadline(): void {
		this.rl?.close();
		this.rl = undefined;
	}

	private detachChild(): ChildProcessWithoutNullStreams | undefined {
		const child = this.child;
		this.child = undefined;
		return child;
	}

	private killChild(child: ChildProcessWithoutNullStreams | undefined): void {
		if (child && !child.killed) {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}
		}
	}

	private terminateWithEvent(reason: string, code: ClaudeProcessExitEvent["code"]): void {
		if (this.closed && !this.child && !this.inFlight && !this.rl) return;
		const hadInFlight = !!this.inFlight;
		logClaudeNativeDiagnostic("process.terminate", { reason, code, hadInFlight }, this.config.env);
		this.closed = true;
		this.clearIdleTimer();
		this.cleanupInFlight(new ClaudeTurnError(`Claude Code process terminated: ${reason}`, "terminated", hadInFlight));
		this.closeReadline();
		const child = this.detachChild();
		this.config.onExit?.({ code, reason, unsafeSession: hadInFlight });
		this.killChild(child);
	}

	private handleProcessFailure(error: Error, child: ChildProcessWithoutNullStreams, code: "process_error" | "process_close"): void {
		if (child !== this.child) return;
		const hadInFlight = !!this.inFlight;
		logClaudeNativeDiagnostic("process.failure", {
			code,
			reason: error.message,
			hadInFlight,
		}, this.config.env);
		this.closed = true;
		this.clearIdleTimer();
		this.cleanupInFlight(new ClaudeTurnError(error.message, code, hadInFlight));
		this.closeReadline();
		this.child = undefined;
		this.config.onExit?.({ code, reason: error.message, unsafeSession: hadInFlight });
	}

	private armIdleTimer(): void {
		this.clearIdleTimer();
		if (this.config.idleTimeoutMs <= 0) return;
		this.idleHandle = setTimeout(() => {
			logClaudeNativeDiagnostic("process.idle_reap", { idleTimeoutMs: this.config.idleTimeoutMs, cwd: this.config.cwd }, this.config.env);
			this.terminateWithEvent(`idle timeout after ${this.config.idleTimeoutMs}ms`, "idle");
		}, this.config.idleTimeoutMs);
		this.idleHandle.unref?.();
	}

	private clearIdleTimer(): void {
		if (!this.idleHandle) return;
		clearTimeout(this.idleHandle);
		this.idleHandle = undefined;
	}
}
