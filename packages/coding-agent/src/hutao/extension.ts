import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "../core/extensions/types.ts";
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
} from "./commands.ts";
import { GitAdapter } from "./git-adapter.ts";
import { isProtectedRepoPath } from "./secret-guard.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TraceRecorder } from "./trace-recorder.ts";
import { commandNeedsTraceStage, getHutaoTraceStatus, stageHutaoTrace } from "./trace-stager.ts";

const HUTAO_EXTENSION_LOADED = Symbol.for("hutao-agent.trace-extension.loaded");

type HutaoGlobalState = typeof globalThis & {
	[HUTAO_EXTENSION_LOADED]?: boolean;
};

let recorder: TraceRecorder | undefined;
let recorderRepoRoot: string | undefined;
const startupNoticeRepos = new Set<string>();

async function getRecorder(ctx: ExtensionContext): Promise<TraceRecorder | undefined> {
	const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
	if (!repoRoot) return undefined;
	const registry = new SessionRegistry(repoRoot);
	const currentSessionId = registry.readCurrentSessionId();
	if (recorder && recorderRepoRoot === repoRoot && (!currentSessionId || recorder.getSessionId() === currentSessionId)) {
		return recorder;
	}
	const currentMetadata = currentSessionId ? registry.readSession(currentSessionId) : undefined;
	recorderRepoRoot = repoRoot;
	recorder = new TraceRecorder(repoRoot, currentMetadata);
	await recorder.init();
	return recorder;
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

export default function hutaoTraceExtension(pi: ExtensionAPI): void {
	const state = globalThis as HutaoGlobalState;
	if (state[HUTAO_EXTENSION_LOADED]) return;
	state[HUTAO_EXTENSION_LOADED] = true;

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
		if (startupNoticeRepos.has(repoRoot)) return;
		startupNoticeRepos.add(repoRoot);
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
	pi.registerCommand("action", { description: "Open Hutao action menus", handler: actionCommand });
	pi.registerCommand("language", { description: "Set Hutao menu language", handler: languageCommand });
	pi.registerCommand("doctor", { description: "Validate or rebuild Hutao trace data", handler: doctorCommand });
}
