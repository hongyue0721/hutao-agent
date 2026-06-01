import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEventResult,
	ToolCallEvent,
} from "../core/extensions/types.ts";
import { isToolCallEventType } from "../core/extensions/types.ts";
import {
	actionCommand,
	doctorCommand,
	editCommand,
	forkCommand,
	gitCommand,
	languageCommand,
	mergeCommand,
	promptingCommand,
	runCommand,
	sessionCommand,
	subagentCommand,
} from "./commands.ts";
import { GitAdapter } from "./git-adapter.ts";
import { defaultHistoricalContinuationCoordinator } from "./historical-continuation-coordinator.ts";
import { isProtectedRepoPath } from "./secret-guard.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TraceRecorder } from "./trace-recorder.ts";
import { commandNeedsTraceStage, getHutaoTraceStatus, stageHutaoTrace } from "./trace-stager.ts";

type HutaoTraceExtensionState = {
	recorder?: TraceRecorder;
	recorderRepoRoot?: string;
	startupNoticeRepos: Set<string>;
	nativeEntryLinkUnsubscribe?: () => void;
	nativeEntryLinkSessionKey?: string;
};

function createNativeContextProvider(ctx: ExtensionContext) {
	return () => ({
		sessionId: ctx.sessionManager.getSessionId(),
		sessionFile: ctx.sessionManager.getSessionFile(),
		leafEntryId: ctx.sessionManager.getLeafId(),
	});
}

function ensureNativeEntryLinkListener(ctx: ExtensionContext, state: HutaoTraceExtensionState): void {
	const sessionKey = ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
	if (state.nativeEntryLinkSessionKey === sessionKey) return;
	state.nativeEntryLinkUnsubscribe?.();
	state.nativeEntryLinkSessionKey = sessionKey;
	state.nativeEntryLinkUnsubscribe = ctx.sessionManager.onAppendEntry((entry) => {
		void state.recorder?.recordNativeEntryLink(entry).catch(() => {
			// Native entry links are best-effort trace metadata and must not affect session persistence.
		});
	});
}

async function createRecorder(
	ctx: ExtensionContext,
	state: HutaoTraceExtensionState,
): Promise<TraceRecorder | undefined> {
	const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
	if (!repoRoot) return undefined;
	const registry = new SessionRegistry(repoRoot);
	const nativeSessionId = ctx.sessionManager.getSessionId();
	const repoLocalNativeSessionId = /^(sess|fs)_/.test(nativeSessionId) ? nativeSessionId : undefined;
	const registryCurrentSessionId = registry.readCurrentSessionId();
	const registryCurrentSession = registryCurrentSessionId ? registry.readSession(registryCurrentSessionId) : undefined;
	const currentSessionId =
		registryCurrentSession?.kind === "forkSession" && registryCurrentSession.id !== repoLocalNativeSessionId
			? registryCurrentSession.id
			: (repoLocalNativeSessionId ?? registryCurrentSessionId);
	if (
		state.recorder &&
		state.recorderRepoRoot === repoRoot &&
		(!currentSessionId || state.recorder.getSessionId() === currentSessionId)
	) {
		state.recorder.setNativeContextProvider(createNativeContextProvider(ctx));
		ensureNativeEntryLinkListener(ctx, state);
		return state.recorder;
	}
	const currentMetadata = currentSessionId ? registry.readSession(currentSessionId) : undefined;
	state.recorderRepoRoot = repoRoot;
	state.recorder = new TraceRecorder(repoRoot, currentMetadata, currentSessionId, createNativeContextProvider(ctx));
	await state.recorder.init();
	ensureNativeEntryLinkListener(ctx, state);
	return state.recorder;
}

function getPathInput(event: ToolCallEvent): string | undefined {
	if (isToolCallEventType("read", event)) return event.input.path;
	if (isToolCallEventType("edit", event)) return event.input.path;
	if (isToolCallEventType("write", event)) return event.input.path;
	if (isToolCallEventType("grep", event)) return event.input.path;
	if (isToolCallEventType("find", event)) return event.input.path;
	if (isToolCallEventType("ls", event)) return event.input.path;
	return undefined;
}

function isDangerousCommand(command: string): boolean {
	return /\b(rm\s+-rf|sudo\b|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-fd|git\s+push\s+--force|curl\b.*\|\s*sh|wget\b.*\|\s*sh)\b/i.test(
		command,
	);
}

function isCommandCapableContext(ctx: ExtensionContext): ctx is ExtensionCommandContext {
	return typeof (ctx as Partial<ExtensionCommandContext>).fork === "function";
}

function safeNotify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	try {
		ctx.ui.notify(message, type);
	} catch {
		// The input interceptor may fork and stale the old context. Notifications must not
		// change whether the original prompt is handled or blocked.
	}
}

function safeRestoreEditorText(ctx: ExtensionContext, text: string): void {
	try {
		if (!ctx.ui.getEditorText().trim()) ctx.ui.setEditorText(text);
	} catch {
		// Best-effort recovery only; returning handled is still safer than writing the
		// prompt into the historical session after a failed continuation.
	}
}

// Keep Hutao state scoped to one loaded extension instance. ResourceLoader can
// rebuild runtimes during reload/resume/fork, and process-global dedupe would
// silently skip handler registration for the real runtime. If built-in extension
// de-duplication is needed later, do it in the loader with explicit identities,
// not by short-circuiting this factory.
export default function hutaoTraceExtension(pi: ExtensionAPI): void {
	const state: HutaoTraceExtensionState = { startupNoticeRepos: new Set() };
	const getRecorder = (ctx: ExtensionContext) => createRecorder(ctx, state);

	pi.on("session_start", async (_event, ctx) => {
		const active = await getRecorder(ctx);
		if (!active) return;
		const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
		if (!repoRoot) {
			ctx.ui.setStatus("hutao", `hutao trace: ${active.getSessionId().slice(0, 18)}`);
			return;
		}
		const traceStatus = await getHutaoTraceStatus(repoRoot);
		ctx.ui.setStatus(
			"hutao",
			traceStatus.exists && !traceStatus.clean
				? `hutao trace: unstaged ${traceStatus.unstaged.length + traceStatus.untracked.length}`
				: `hutao trace: ${active.getSessionId().slice(0, 18)}`,
		);
		if (state.startupNoticeRepos.has(repoRoot)) return;
		state.startupNoticeRepos.add(repoRoot);
		const sessions = new SessionRegistry(repoRoot).readSessions();
		if (sessions.length > 0) {
			ctx.ui.notify(`Found ${sessions.length} Hutao sessions. Use /session to browse and resume.`, "info");
		}
		if (traceStatus.exists && (traceStatus.unstaged.length > 0 || traceStatus.untracked.length > 0)) {
			ctx.ui.notify(
				`Hutao trace has unstaged canonical files.\nunstaged: ${traceStatus.unstaged.length}\nuntracked: ${traceStatus.untracked.length}\nRun /git stage-trace before committing.`,
				"warning",
			);
		}
	});

	pi.on("input", async (event, ctx): Promise<InputEventResult | undefined> => {
		const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
		if (!repoRoot) return undefined;
		if (!isCommandCapableContext(ctx)) return undefined;
		const decision = await defaultHistoricalContinuationCoordinator.handleInput(repoRoot, event, ctx);
		if (decision.action === "continue") return undefined;
		if (decision.action === "handled") {
			return { action: "handled" };
		}
		safeRestoreEditorText(ctx, event.text);
		safeNotify(
			ctx,
			`Hutao continuation blocked\n${decision.reason}\n\nYour input was restored to the editor.`,
			"warning",
		);
		return { action: "handled" };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const active = await getRecorder(ctx);
		if (!active) return;
		await active.recordPrompting(event.prompt, ctx.cwd);
	});

	pi.on("tool_call", async (event, ctx) => {
		const active = await getRecorder(ctx);
		if (active) await active.recordToolCall(event.toolName, event.toolCallId, event.input);
		const path = getPathInput(event);
		if (path && isProtectedRepoPath(path)) {
			return { block: true, reason: "Hutao blocked access to protected path" };
		}
		if (isToolCallEventType("bash", event)) {
			if (commandNeedsTraceStage(event.input.command)) {
				const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
				if (repoRoot) {
					const result = await stageHutaoTrace(repoRoot);
					if (!result.ok) {
						ctx.ui.notify(
							`Hutao trace was not staged before git commit.\n${result.error ?? "Unknown error"}\n${result.warnings.join("\n")}`,
							"warning",
						);
					} else if (result.staged.length > 0) {
						ctx.ui.setStatus("hutao", `hutao trace staged: ${result.staged.length} files`);
					}
				}
			}
			if (isDangerousCommand(event.input.command)) {
				const allowed = await ctx.ui.confirm(
					"Hutao safety",
					`Allow potentially destructive command?\n\n${event.input.command}`,
				);
				if (!allowed) return { block: true, reason: "Blocked by Hutao safety confirmation" };
			}
		}
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		const active = await getRecorder(ctx);
		if (!active) return;
		await active.startRun(event.toolName, event.toolCallId, event.args, ctx.cwd);
	});

	pi.on("tool_result", async (event, ctx) => {
		const active = await getRecorder(ctx);
		if (!active) return;
		await active.finishRun(event, ctx.cwd);
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const active = await getRecorder(ctx);
		if (!active) return;
		ctx.ui.setStatus("hutao", `hutao fork requested: ${event.entryId.slice(0, 12)}`);
	});

	pi.registerCommand("session", { description: "List or inspect Hutao sessions", handler: sessionCommand });
	pi.registerCommand("prompting", { description: "List or inspect Hutao promptings", handler: promptingCommand });
	pi.registerCommand("edit", { description: "List or inspect Hutao edits", handler: editCommand });
	pi.registerCommand("git", { description: "Show Hutao Git trace", handler: gitCommand });
	pi.registerCommand("fork", { description: "Create a Hutao forkSession", handler: forkCommand });
	pi.registerCommand("merge", { description: "Preview or merge Hutao sessions", handler: mergeCommand });
	pi.registerCommand("run", { description: "List or inspect Hutao runs", handler: runCommand });
	pi.registerCommand("subagent", { description: "List or inspect Hutao subagents", handler: subagentCommand });
	pi.registerCommand("action", { description: "Open Hutao action menus", handler: actionCommand });
	pi.registerCommand("hutao", { description: "Open Hutao main menu", handler: actionCommand });
	pi.registerCommand("language", { description: "Set Hutao menu language", handler: languageCommand });
	pi.registerCommand("doctor", { description: "Validate or rebuild Hutao trace data", handler: doctorCommand });
}
