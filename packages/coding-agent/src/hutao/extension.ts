import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "../core/extensions/types.ts";
import { isToolCallEventType } from "../core/extensions/types.ts";
import { editCommand, forkCommand, gitCommand, mergeCommand, promptingCommand, sessionCommand } from "./commands.ts";
import { GitAdapter } from "./git-adapter.ts";
import { isProtectedRepoPath } from "./secret-guard.ts";
import { TraceRecorder } from "./trace-recorder.ts";

const HUTAO_EXTENSION_LOADED = Symbol.for("hutao-agent.trace-extension.loaded");

type HutaoGlobalState = typeof globalThis & {
	[HUTAO_EXTENSION_LOADED]?: boolean;
};

let recorder: TraceRecorder | undefined;
let recorderRepoRoot: string | undefined;

async function getRecorder(ctx: ExtensionContext): Promise<TraceRecorder | undefined> {
	const repoRoot = await new GitAdapter(ctx.cwd).getRepoRoot();
	if (!repoRoot) return undefined;
	if (recorder && recorderRepoRoot === repoRoot) return recorder;
	recorderRepoRoot = repoRoot;
	recorder = new TraceRecorder(repoRoot);
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
		if (active) ctx.ui.setStatus("hutao", `hutao trace: ${active.getSessionId().slice(0, 18)}`);
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
}
