import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { CommitLinker } from "./commit-linker.ts";
import type { HutaoEvent } from "./event-store.ts";
import { HutaoForkCoordinator, type HutaoForkResult } from "./fork-coordinator.ts";
import { GitAdapter } from "./git-adapter.ts";
import { defaultHistoricalContinuationCoordinator } from "./historical-continuation-coordinator.ts";
import { getHutaoLanguage, type HutaoLanguage, saveHutaoLanguage, selectAction, t } from "./i18n.ts";
import { rebuildIndex } from "./index-builder.ts";
import { MergeManager, type MergeMode } from "./merge-manager.ts";
import { readAllEvents } from "./read-model.ts";
import { RevertManager } from "./revert-manager.ts";
import { SessionRegistry } from "./session-registry.ts";
import { getHutaoTraceStatus, stageHutaoTrace } from "./trace-stager.ts";

function readEvents(repoRoot: string): HutaoEvent[] {
	return readAllEvents(repoRoot);
}

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function notify(
	ctx: ExtensionCommandContext,
	title: string,
	lines: string[],
	type: "info" | "warning" | "error" = "info",
): void {
	ctx.ui.notify(`${title}\n${lines.join("\n")}`, type);
}

function appendNativeTraceEntry(ctx: ExtensionCommandContext, customType: string, data: Record<string, unknown>): void {
	try {
		ctx.appendEntry(customType, data);
	} catch {
		// Native custom entries are UI/linkage helpers. Hutao canonical .hutao events remain
		// the source of truth and command success must not depend on native append support.
	}
}

function findEvent(events: HutaoEvent[], idPrefix: string, type?: string): HutaoEvent | undefined {
	return events.find((event) => (!type || event.type === type) && String(event.id).startsWith(idPrefix));
}

function getFlagValue(parts: string[], flag: string): string | undefined {
	const index = parts.indexOf(flag);
	return index === -1 ? undefined : parts[index + 1];
}

function eventText(event: HutaoEvent): string {
	return String(event.text ?? event.summary ?? "").toLowerCase();
}

function eventTouchesFile(event: HutaoEvent, file: string): boolean {
	return stringArray(event.files).some((entry) => entry === file || entry.endsWith(`/${file}`));
}

function commitLinkedIds(events: HutaoEvent[], commit: string, field: "prompting_ids" | "edit_ids"): Set<string> {
	const ids = new Set<string>();
	for (const event of events.filter(
		(entry) => entry.type === "commit_link" && String(entry.commit).startsWith(commit),
	)) {
		for (const id of stringArray(event[field])) ids.add(id);
	}
	return ids;
}

function getRepoRoot(ctx: ExtensionCommandContext): Promise<string | undefined> {
	return new GitAdapter(ctx.cwd).getRepoRoot();
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function firstLine(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

function eventTitle(event: HutaoEvent): string {
	return firstLine(event.text ?? event.summary ?? event.tool ?? event.id);
}

function relatedCommits(events: HutaoEvent[], id: unknown, field: "prompting_ids" | "edit_ids" | "run_ids"): string[] {
	const value = String(id ?? "");
	return events
		.filter((event) => event.type === "commit_link" && stringArray(event[field]).includes(value))
		.map((event) => String(event.commit));
}

function relatedMerges(events: HutaoEvent[], id: unknown): HutaoEvent[] {
	const value = String(id ?? "");
	return events.filter(
		(event) =>
			event.type === "merge" &&
			(stringArray(event.imported_edits).includes(value) ||
				stringArray(event.applied_edits).includes(value) ||
				stringArray(event.conflict_edits).includes(value) ||
				stringArray(event.skipped_edits).includes(value) ||
				stringArray(event.resolution_edits).includes(value)),
	);
}

function relatedEditsForRun(events: HutaoEvent[], runId: unknown): HutaoEvent[] {
	const value = String(runId ?? "");
	const explicit = events.filter((event) => event.type === "edit" && event.parent_run === value);
	if (explicit.length > 0) return explicit;
	return events.filter((event) => event.type === "edit" && stringArray(event.produced_edit_ids).includes(value));
}

function editPatchPath(repoRoot: string, edit: HutaoEvent): string | undefined {
	return typeof edit.patch === "string"
		? join(repoRoot, ".hutao", "sessions", String(edit.session_id), edit.patch)
		: undefined;
}

async function previewRevertEdit(
	editIdPrefix: string,
	repoRoot: string,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	const events = readEvents(repoRoot);
	const edit = findEvent(events, editIdPrefix, "edit");
	if (!edit) {
		notify(ctx, "Hutao revert preview", [`Edit not found: ${editIdPrefix}`], "warning");
		return false;
	}
	const git = new GitAdapter(repoRoot);
	const files = stringArray(edit.files);
	const laterRelatedEdits = events.filter(
		(event) =>
			event.type === "edit" &&
			event.session_id === edit.session_id &&
			event.id !== edit.id &&
			String(event.created_at ?? "") > String(edit.created_at ?? "") &&
			stringArray(event.files).some((file) => files.includes(file)),
	);
	const patchPath = editPatchPath(repoRoot, edit);
	const status = await git.getStatusSummary();
	const reverseCheck = patchPath ? await git.applyReversePatchCheck(patchPath) : undefined;
	const lines = [
		`edit: ${edit.id}`,
		`files: ${files.join(", ") || "none"}`,
		`working tree: ${status}`,
		`reverse patch check: ${reverseCheck ? (reverseCheck.ok ? "ok" : "failed") : "no patch"}`,
		`later related edits touching same files: ${laterRelatedEdits.length}`,
		...laterRelatedEdits.slice(0, 8).map((event) => `  ${shortId(event.id)} ${stringArray(event.files).join(", ")}`),
		"",
		"Applying this revert may affect the current project. Continue only if the preview looks safe.",
	];
	if (reverseCheck && !reverseCheck.ok)
		lines.push("", reverseCheck.stderr || reverseCheck.stdout || "Reverse patch check failed.");
	notify(ctx, "Hutao revert preview", lines, reverseCheck?.ok === false || status !== "clean" ? "warning" : "info");
	if (!patchPath || reverseCheck?.ok === false) return false;
	return ctx.ui.confirm("Hutao revert preview", `Apply reverse patch for edit ${edit.id}?`);
}

function renderPromptingTree(lines: string[], events: HutaoEvent[], promptings: HutaoEvent[]): void {
	for (const prompting of promptings) {
		lines.push(`├─ Prompting ${shortId(prompting.id)} ${eventTitle(prompting)}`);
		const runs = events.filter((event) => event.type === "run_finished" && event.parent_prompting === prompting.id);
		for (const run of runs) {
			lines.push(`│  ├─ Run ${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "unknown"}`);
			for (const edit of relatedEditsForRun(events, run.id)) {
				lines.push(`│  │  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
		for (const edit of events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id)) {
			if (!runs.some((run) => relatedEditsForRun(events, run.id).includes(edit))) {
				lines.push(`│  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
	}
}

function renderMergeLine(event: HutaoEvent): string {
	return `${shortId(event.id)} ${event.mode ?? ""} ${event.status ?? ""} source=${shortId(event.source_session)} applied=${stringArray(event.applied_edits).length} conflicts=${stringArray(event.conflict_edits).length} resolutions=${stringArray(event.resolution_edits).join(",") || "none"}`;
}

function pushEventList(
	lines: string[],
	title: string,
	events: HutaoEvent[],
	render: (event: HutaoEvent) => string,
): void {
	lines.push(`${title}: ${events.length}`);
	for (const event of events.slice(-12)) lines.push(`  ${render(event)}`);
	if (events.length > 12) lines.push(`  ... ${events.length - 12} more`);
}

async function selectItem<T>(
	ctx: ExtensionCommandContext,
	title: string,
	items: T[],
	render: (item: T, index: number) => string,
): Promise<T | undefined> {
	if (items.length === 0) return undefined;
	const labels = items.map((item, index) => `${String(index + 1).padStart(2, "0")}. ${render(item, index)}`);
	const choice = await ctx.ui.select(title, labels);
	if (!choice) return undefined;
	const index = labels.indexOf(choice);
	return index === -1 ? undefined : items[index];
}

function sessionSummary(session: { id: string; kind: string; status: string }, events: HutaoEvent[]): string {
	return `${shortId(session.id)} ${session.kind} ${session.status} promptings=${events.filter((event) => event.session_id === session.id && event.type === "prompting").length} runs=${events.filter((event) => event.session_id === session.id && event.type === "run_finished").length} edits=${events.filter((event) => event.session_id === session.id && event.type === "edit").length} merges=${events.filter((event) => event.session_id === session.id && event.type === "merge").length}`;
}

async function resumeSession(sessionId: string, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const registry = new SessionRegistry(repoRoot);
	const current = registry.readCurrentSessionId();
	if (current === sessionId) {
		notify(ctx, "Hutao resume", [
			`Current Hutao session is already ${sessionId}.`,
			"Continue chatting normally; new promptings will be recorded here.",
		]);
		return;
	}
	const session = registry.readSession(sessionId);
	if (!session) return notify(ctx, "Hutao resume", [`Session not found: ${sessionId}`], "warning");
	const continuation = await registry.createContinuationSession(session.id);
	if (!continuation)
		return notify(ctx, "Hutao resume", [`Failed to create continuation for ${session.id}`], "warning");
	rebuildIndex(repoRoot);
	notify(ctx, "Hutao resume", [
		`Created continuation forkSession ${continuation.id}`,
		`parent session: ${session.id}`,
		"Continue chatting normally; new promptings/runs/edits will be recorded in the continuation session.",
	]);
}

async function runCoordinatedFork(
	repoRoot: string,
	ctx: ExtensionCommandContext,
	sourceType: "prompting" | "edit" | "commit",
	sourceId: string,
	mode: "before" | "retry" | "after",
	title = "Hutao fork",
): Promise<HutaoForkResult> {
	const result = await new HutaoForkCoordinator(repoRoot, ctx).fork({
		sourceType,
		sourceIdPrefix: sourceId,
		mode,
		onCompleted: async (freshCtx, completed) => {
			notify(freshCtx, title, [
				`Created forkSession ${completed.sessionId}`,
				`native branch: ${completed.nativeStatus ?? "unknown"}`,
				completed.nativeSessionFile ? `native session: ${completed.nativeSessionFile}` : "native session: unknown",
				completed.retryText
					? "Retry text is available from the original prompting."
					: "Continue chatting normally.",
				"New promptings/runs/edits will be recorded in the forkSession.",
			]);
			if (completed.retryText && !freshCtx.ui.getEditorText().trim()) {
				freshCtx.ui.setEditorText(completed.retryText);
			}
		},
	});
	if (!result.ok) {
		notify(ctx, title, [result.reason ?? "Fork failed."], "warning");
		return result;
	}
	if (result.nativeStatus !== "created") {
		notify(
			ctx,
			title,
			[
				`Created forkSession ${result.sessionId}`,
				`native branch: ${result.nativeStatus ?? "degraded"}`,
				result.degradedReason ?? "Native branch unavailable.",
				"Continue chatting normally; Hutao trace will record new work in the forkSession.",
			],
			"warning",
		);
	}
	if (result.ok) defaultHistoricalContinuationCoordinator.clear(repoRoot);
	return result;
}

async function resumeFromPrompting(
	prompting: HutaoEvent,
	repoRoot: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	await runCoordinatedFork(repoRoot, ctx, "prompting", String(prompting.id), "after", "Hutao resume");
}

async function resumeFromEdit(edit: HutaoEvent, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	await runCoordinatedFork(repoRoot, ctx, "edit", String(edit.id), "after", "Hutao resume");
}

async function runSessionAction(sessionId: string, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const choice = await selectAction(ctx, repoRoot, "session.action.title", [
		{ id: "viewDetails", labelKey: "session.action.viewDetails" },
		{ id: "resume", labelKey: "session.action.resume" },
		{ id: "viewPromptings", labelKey: "session.action.viewPromptings" },
		{ id: "viewRuns", labelKey: "session.action.viewRuns" },
		{ id: "viewEdits", labelKey: "session.action.viewEdits" },
		{ id: "mergeWizard", labelKey: "session.action.mergeWizard" },
		{ id: "mergePreview", labelKey: "session.action.mergePreview" },
		{ id: "importHistory", labelKey: "session.action.importHistory" },
		{ id: "applyEdits", labelKey: "session.action.applyEdits" },
		{ id: "applyFinalSnapshot", labelKey: "session.action.applyFinalSnapshot" },
	]);
	if (choice === "viewDetails") return sessionCommand(sessionId, ctx);
	if (choice === "resume") return resumeSession(sessionId, repoRoot, ctx);
	if (choice === "viewPromptings") return promptingCommand(`--session ${sessionId}`, ctx);
	if (choice === "viewRuns") return runCommand(`--session ${sessionId}`, ctx);
	if (choice === "viewEdits") return editCommand(`--session ${sessionId}`, ctx);
	if (choice === "mergeWizard") return runMergeWizard(sessionId, repoRoot, ctx);
	if (choice === "mergePreview") return mergeCommand(`session ${sessionId}`, ctx);
	if (choice === "importHistory") return mergeCommand(`session ${sessionId} --history`, ctx);
	if (choice === "applyEdits") return mergeCommand(`session ${sessionId} --apply-edits`, ctx);
	if (choice === "applyFinalSnapshot") return mergeCommand(`session ${sessionId} --apply-tree`, ctx);
	notify(ctx, "Hutao session", [t(repoRoot, "menu.noAction")]);
}

async function runPromptingAction(
	prompting: HutaoEvent,
	repoRoot: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const choice = await selectAction(ctx, repoRoot, "prompting.action.title", [
		{ id: "viewDetail", labelKey: "prompting.action.viewDetail" },
		{ id: "resumeAfter", labelKey: "prompting.action.resumeAfter" },
		{ id: "viewEdits", labelKey: "prompting.action.viewEdits" },
		{ id: "forkBefore", labelKey: "prompting.action.forkBefore" },
		{ id: "retry", labelKey: "prompting.action.retry" },
		{ id: "forkAfter", labelKey: "prompting.action.forkAfter" },
	]);
	if (choice === "viewDetail") return promptingCommand(String(prompting.id), ctx);
	if (choice === "resumeAfter") return resumeFromPrompting(prompting, repoRoot, ctx);
	if (choice === "viewEdits") return editCommand(`--prompting ${prompting.id}`, ctx);
	if (choice === "forkBefore") return forkCommand(`prompting ${prompting.id} --before`, ctx);
	if (choice === "retry") return forkCommand(`prompting ${prompting.id} --retry`, ctx);
	if (choice === "forkAfter") return forkCommand(`prompting ${prompting.id} --after`, ctx);
	notify(ctx, "Hutao prompting", [t(repoRoot, "menu.noAction")]);
}

async function runEditAction(edit: HutaoEvent, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const choice = await selectAction(ctx, repoRoot, "edit.action.title", [
		{ id: "viewPatch", labelKey: "edit.action.viewPatch" },
		{ id: "viewParentPrompting", labelKey: "edit.action.viewParentPrompting" },
		{ id: "continueAfter", labelKey: "edit.action.continueAfter" },
		{ id: "tryBefore", labelKey: "edit.action.tryBefore" },
		{ id: "previewRevert", labelKey: "edit.action.previewRevert" },
	]);
	if (choice === "viewPatch") return editCommand(String(edit.id), ctx);
	if (choice === "viewParentPrompting") return promptingCommand(String(edit.parent_prompting), ctx);
	if (choice === "continueAfter") return resumeFromEdit(edit, repoRoot, ctx);
	if (choice === "tryBefore") return forkCommand(`edit ${edit.id} --before`, ctx);
	if (choice === "previewRevert") return editCommand(`revert ${edit.id}`, ctx);
	notify(ctx, "Hutao edit", [t(repoRoot, "menu.noAction")]);
}

function readJsonlDiagnostics(path: string): { lines: number; corrupt: number } {
	if (!existsSync(path)) return { lines: 0, corrupt: 0 };
	let lines = 0;
	let corrupt = 0;
	for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
		if (!line.trim()) continue;
		lines += 1;
		try {
			JSON.parse(line);
		} catch {
			corrupt += 1;
		}
	}
	return { lines, corrupt };
}

export async function sessionCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao session", ["Not in a Git repository."], "warning");
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const events = readEvents(repoRoot);
	const query = args.trim();
	if (!query) {
		const selected = await selectItem(ctx, t(repoRoot, "session.select.title"), sessions, (session) =>
			sessionSummary(session, events),
		);
		if (!selected)
			return notify(ctx, "Hutao session", [
				t(repoRoot, sessions.length ? "session.noneSelected" : "session.noneFound"),
			]);
		return runSessionAction(selected.id, repoRoot, ctx);
	}
	const session = sessions.find((entry) => entry.id.startsWith(query));
	if (!session) return notify(ctx, "Hutao session", [`Not found: ${query}`], "warning");
	const sessionEvents = events.filter((event) => event.session_id === session.id);
	const promptings = sessionEvents.filter((event) => event.type === "prompting");
	const runs = sessionEvents.filter((event) => event.type === "run_finished");
	const edits = sessionEvents.filter((event) => event.type === "edit");
	const forks = events.filter((event) => event.type === "fork_session" && event.parent_session === session.id);
	const merges = sessionEvents.filter((event) => event.type === "merge");
	const commitLinks = sessionEvents.filter((event) => event.type === "commit_link");
	const lines = [
		`kind: ${session.kind}`,
		`status: ${session.status}`,
		`parent_session: ${session.parent_session ?? "none"}`,
		`fork_from: ${session.fork_from ? JSON.stringify(session.fork_from) : "none"}`,
		`base_git_head: ${session.base_git_head ?? "unknown"}`,
		`base_tree: ${session.base_tree ?? "unknown"}`,
		`last_git_head: ${session.current_git_head_at_last_write ?? "unknown"}`,
		`updated_at: ${session.updated_at}`,
		`summary: ${session.summary || ""}`,
		"",
	];
	pushEventList(lines, "Promptings", promptings, (event) => `${shortId(event.id)} ${eventTitle(event)}`);
	pushEventList(
		lines,
		"Runs",
		runs,
		(event) => `${shortId(event.id)} ${event.tool ?? "tool"} ${event.status ?? "unknown"}`,
	);
	pushEventList(lines, "Edits", edits, (event) => `${shortId(event.id)} ${stringArray(event.files).join(", ")}`);
	pushEventList(
		lines,
		"Forks",
		forks,
		(event) =>
			`${shortId(event.id)} ${event.fork_from_type ?? ""}:${event.fork_from_id ?? ""} ${event.fork_mode ?? ""}`,
	);
	pushEventList(lines, "Merges", merges, (event) => `${shortId(event.id)} ${event.mode ?? ""} ${event.status ?? ""}`);
	pushEventList(
		lines,
		"Commit links",
		commitLinks,
		(event) => `${String(event.commit).slice(0, 12)} ${event.link_method ?? "unknown"}`,
	);
	notify(ctx, `Session ${session.id}`, lines);
}

export async function promptingCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao prompting", ["Not in a Git repository."], "warning");
	const events = readEvents(repoRoot);
	let promptings = events.filter((event) => event.type === "prompting");
	const query = args.trim();
	const parts = query.split(/\s+/).filter(Boolean);
	const sessionFilter = getFlagValue(parts, "--session");
	const commitFilter = getFlagValue(parts, "--commit");
	const fileFilter = getFlagValue(parts, "--file");
	if (sessionFilter) promptings = promptings.filter((event) => String(event.session_id).startsWith(sessionFilter));
	if (commitFilter) {
		const ids = commitLinkedIds(events, commitFilter, "prompting_ids");
		promptings = promptings.filter((event) => ids.has(String(event.id)));
	}
	if (fileFilter) {
		const promptingIds = new Set(
			events
				.filter((event) => event.type === "edit" && eventTouchesFile(event, fileFilter))
				.map((event) => String(event.parent_prompting)),
		);
		promptings = promptings.filter((event) => promptingIds.has(String(event.id)));
	}
	if (parts[0] === "search") {
		const searchText = parts.slice(1).join(" ").toLowerCase();
		promptings = promptings.filter((event) => eventText(event).includes(searchText));
	}
	if (!query || query.startsWith("--") || parts[0] === "search") {
		const selected = await selectItem(
			ctx,
			t(repoRoot, "prompting.select.title"),
			promptings.slice(-30),
			(event) =>
				`${shortId(event.id)} ${event.created_at ?? ""} ${String(event.text ?? "")
					.split(/\r?\n/)[0]
					?.slice(0, 120)}`,
		);
		if (!selected)
			return notify(ctx, "Hutao prompting", [
				t(repoRoot, promptings.length ? "prompting.noneSelected" : "prompting.noneFound"),
			]);
		return runPromptingAction(selected, repoRoot, ctx);
	}
	const prompting = findEvent(events, query, "prompting");
	if (!prompting) return notify(ctx, "Hutao prompting", [`Not found: ${query}`], "warning");
	const runs = events.filter(
		(event) =>
			(event.type === "run_finished" || event.type === "run_started") && event.parent_prompting === prompting.id,
	);
	const edits = events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id);
	const commits = relatedCommits(events, prompting.id, "prompting_ids");
	const lines = [
		`session: ${prompting.session_id}`,
		`git_head: ${prompting.git_head ?? "unknown"}`,
		`git_tree: ${prompting.git_tree ?? "unknown"}`,
		`cwd: ${prompting.cwd ?? "."}`,
		`status: ${prompting.status ?? "unknown"}`,
		`related commits: ${commits.map((commit) => commit.slice(0, 12)).join(", ") || "none"}`,
		"",
		String(prompting.text ?? ""),
		"",
	];
	pushEventList(
		lines,
		"Runs",
		runs,
		(run) => `${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "started"} ${firstLine(run.output_summary)}`,
	);
	pushEventList(lines, "Edits", edits, (edit) => `${shortId(edit.id)} ${stringArray(edit.files).join(",")}`);
	lines.push("actions: /fork prompting <id> --before | --retry | --after, /edit --prompting <id>, /git <commit>");
	defaultHistoricalContinuationCoordinator.arm({
		repoRoot,
		sourceType: "prompting",
		sourceId: String(prompting.id),
		mode: "after",
		title: firstLine(prompting.text),
	});
	notify(ctx, `Prompting ${prompting.id}`, [
		...lines,
		"",
		"armed: next normal chat input will auto-fork after this prompting before it is recorded.",
	]);
}

export async function runCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao run", ["Not in a Git repository."], "warning");
	const events = readEvents(repoRoot);
	const query = args.trim();
	const parts = query.split(/\s+/).filter(Boolean);
	const sessionFilter = getFlagValue(parts, "--session");
	let runs = events.filter((event) => event.type === "run_finished" || event.type === "run_started");
	if (sessionFilter) runs = runs.filter((run) => String(run.session_id).startsWith(sessionFilter));
	if (!query || query.startsWith("--")) {
		notify(
			ctx,
			"Hutao runs",
			runs
				.slice(-40)
				.map(
					(run) =>
						`${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "started"} ${firstLine(run.output_summary ?? run.input_summary)}`,
				),
		);
		return;
	}
	const run = findEvent(events, query, "run_finished") ?? findEvent(events, query, "run_started");
	if (!run) return notify(ctx, "Hutao run", [`Not found: ${query}`], "warning");
	const edits = relatedEditsForRun(events, run.id);
	const commits = relatedCommits(events, run.id, "run_ids");
	const lines = [
		`session: ${run.session_id ?? "unknown"}`,
		`parent prompting: ${run.parent_prompting ?? "none"}`,
		`tool: ${run.tool ?? "unknown"}`,
		`tool_call_id: ${run.tool_call_id ?? "unknown"}`,
		`status: ${run.status ?? (run.type === "run_started" ? "started" : "unknown")}`,
		`cwd: ${run.cwd ?? "."}`,
		`command: ${run.command ?? "none"}`,
		`started_at: ${run.started_at ?? run.created_at ?? "unknown"}`,
		`ended_at: ${run.ended_at ?? "unknown"}`,
		`before_head: ${run.before_head ?? "unknown"}`,
		`after_head: ${run.after_head ?? "unknown"}`,
		`before_tree: ${run.before_tree ?? "unknown"}`,
		`after_tree: ${run.after_tree ?? "unknown"}`,
		`before_worktree_diff_hash: ${run.before_worktree_diff_hash ?? "unknown"}`,
		`after_worktree_diff_hash: ${run.after_worktree_diff_hash ?? "unknown"}`,
		`related commits: ${commits.map((commit) => commit.slice(0, 12)).join(", ") || "none"}`,
		`produced edits: ${edits.map((edit) => String(edit.id)).join(", ") || stringArray(run.produced_edit_ids).join(", ") || "none"}`,
		`input: ${firstLine(run.input_summary ?? run.command ?? "")}`,
		`output summary: ${firstLine(run.output_summary)}`,
		`output truncated: ${run.output_truncated ?? false}`,
		"",
		String(run.output_tail ?? "[no output tail stored]").slice(-4000),
	];
	notify(ctx, `Run ${run.id}`, lines);
}

export async function editCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao edit", ["Not in a Git repository."], "warning");
	const events = readEvents(repoRoot);
	let edits = events.filter((event) => event.type === "edit");
	const query = args.trim();
	if (query.startsWith("revert ")) {
		const editId = query.slice("revert ".length).trim();
		const sessions = new SessionRegistry(repoRoot).readSessions();
		const targetSession = sessions[sessions.length - 1]?.id;
		if (!targetSession) return notify(ctx, "Hutao edit", ["No Hutao session exists."], "warning");
		const confirmed = await previewRevertEdit(editId, repoRoot, ctx);
		if (!confirmed) return notify(ctx, "Hutao edit", ["Revert cancelled."]);
		const result = await new RevertManager(repoRoot).revertEdit(editId, targetSession);
		appendNativeTraceEntry(ctx, "hutao_revert", {
			edit_id: editId,
			target_session: targetSession,
			status: result.ok ? "completed" : "failed",
			revert_edit_id: result.revertEditId,
			reason: result.reason,
		});
		if (!result.ok) return notify(ctx, "Hutao edit", [result.reason ?? "Revert failed."], "warning");
		notify(ctx, "Hutao edit", [`Reverted edit ${editId} as ${result.revertEditId}`]);
		return;
	}
	const parts = query.split(/\s+/).filter(Boolean);
	const sessionFilter = getFlagValue(parts, "--session");
	const promptingFilter = getFlagValue(parts, "--prompting");
	const commitFilter = getFlagValue(parts, "--commit");
	const fileFilter = getFlagValue(parts, "--file");
	if (sessionFilter) edits = edits.filter((event) => String(event.session_id).startsWith(sessionFilter));
	if (promptingFilter) edits = edits.filter((event) => String(event.parent_prompting).startsWith(promptingFilter));
	if (commitFilter) {
		const ids = commitLinkedIds(events, commitFilter, "edit_ids");
		edits = edits.filter((event) => ids.has(String(event.id)));
	}
	if (fileFilter) edits = edits.filter((event) => eventTouchesFile(event, fileFilter));
	if (parts.includes("--reverted")) {
		const revertedIds = new Set(
			events.filter((event) => event.type === "edit_reverted").map((event) => String(event.edit_id)),
		);
		edits = edits.filter((event) => revertedIds.has(String(event.id)) || event.status === "reverted");
	}
	if (parts.includes("--conflicts")) {
		const conflictIds = new Set(events.flatMap((event) => stringArray(event.conflict_edits)));
		edits = edits.filter((event) => conflictIds.has(String(event.id)) || event.status === "conflict");
	}
	if (!query || query.startsWith("--")) {
		const selected = await selectItem(
			ctx,
			t(repoRoot, "edit.select.title"),
			edits.slice(-30),
			(event) =>
				`${shortId(event.id)} ${event.created_at ?? ""} ${stringArray(event.files).join(", ") || firstLine(event.summary)}`,
		);
		if (!selected)
			return notify(ctx, "Hutao edit", [t(repoRoot, edits.length ? "edit.noneSelected" : "edit.noneFound")]);
		return runEditAction(selected, repoRoot, ctx);
	}
	const edit = findEvent(events, query, "edit");
	if (!edit) return notify(ctx, "Hutao edit", [`Not found: ${query}`], "warning");
	const patchPath = join(repoRoot, ".hutao", "sessions", String(edit.session_id), String(edit.patch));
	const patchPreview = existsSync(patchPath) ? readFileSync(patchPath, "utf-8").slice(0, 5000) : "[patch missing]";
	const commits = relatedCommits(events, edit.id, "edit_ids");
	const merges = relatedMerges(events, edit.id);
	const revertedBy = events.filter((event) => event.type === "edit_reverted" && event.edit_id === edit.id);
	const lines = [
		`summary: ${edit.summary ?? ""}`,
		`session: ${edit.session_id}`,
		`parent prompting: ${edit.parent_prompting}`,
		`parent run: ${edit.parent_run}`,
		`related commits: ${commits.map((commit) => commit.slice(0, 12)).join(", ") || "unlinked"}`,
		`merge/revert relation: merges=${merges.map((merge) => `${shortId(merge.id)}:${merge.mode}:${merge.status}`).join(", ") || "none"} reverted_by=${revertedBy.map((event) => shortId(event.revert_edit_id)).join(", ") || "none"}`,
		`files: ${stringArray(edit.files).join(", ")}`,
		`patch: ${edit.patch}`,
		`patch hash: ${edit.patch_hash}`,
		`before_tree: ${edit.before_tree ?? "unknown"}`,
		`after_tree: ${edit.after_tree ?? "unknown"}`,
		`status: ${edit.status ?? "unknown"}`,
		"actions: /prompting <parent>, /fork edit <id> --before|--after, /edit revert <id>",
		"",
		patchPreview,
		"",
		"armed: next normal chat input will auto-fork after this edit before it is recorded.",
	];
	defaultHistoricalContinuationCoordinator.arm({
		repoRoot,
		sourceType: "edit",
		sourceId: String(edit.id),
		mode: "after",
		title: firstLine(edit.summary ?? stringArray(edit.files).join(", ")),
	});
	notify(ctx, `Edit ${edit.id}`, lines);
}

export async function gitCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao git", ["Not in a Git repository."], "warning");
	const query = args.trim();
	if (query === "scan") {
		const result = await new CommitLinker(repoRoot).scanRecentCommits();
		notify(ctx, "Hutao git", [`linked commits: ${result.linked}`]);
		return;
	}
	if (query === "stage-trace") {
		const result = await stageHutaoTrace(repoRoot);
		const lines = [
			result.ok ? "Hutao trace staged." : "Hutao trace was not staged.",
			`staged files: ${result.staged.length}`,
			...(result.error ? [`error: ${result.error}`] : []),
			...(result.warnings.length > 0 ? ["warnings:", ...result.warnings] : []),
		];
		notify(ctx, "Hutao git", lines, result.ok ? "info" : "warning");
		return;
	}
	const git = new GitAdapter(repoRoot);
	const events = readEvents(repoRoot);
	const promptings = events.filter((event) => event.type === "prompting");
	const edits = events.filter((event) => event.type === "edit");
	const runs = events.filter((event) => event.type === "run_finished");
	const commitLinks = events.filter((event) => event.type === "commit_link");
	const parts = query.split(/\s+/).filter(Boolean);
	if (parts[0] === "graph" || parts.includes("--range") || parts.includes("--file")) {
		const range = getFlagValue(parts, "--range") ?? "--max-count=20";
		const fileFilter = getFlagValue(parts, "--file");
		const logArgs = ["log", "--oneline", "--decorate", "--graph", range];
		if (fileFilter) logArgs.push("--", fileFilter);
		const graph = await git.run(logArgs, { maxBuffer: 5 * 1024 * 1024 });
		const lines = [
			`HEAD: ${(await git.getHead()) ?? "unknown"}`,
			`status: ${await git.getStatusSummary()}`,
			`range: ${range}`,
			`file: ${fileFilter ?? "all"}`,
			"",
			...(graph.ok ? graph.stdout.trim().split(/\r?\n/).slice(0, 60) : [graph.stderr || "git log failed"]),
			"",
			"Hutao commit links:",
		];
		for (const link of commitLinks.slice(-30)) {
			const linkedPromptings = stringArray(link.prompting_ids)
				.map((id) => promptings.find((event) => event.id === id))
				.filter((event): event is HutaoEvent => Boolean(event));
			const linkedEdits = stringArray(link.edit_ids)
				.map((id) => edits.find((event) => event.id === id))
				.filter((event): event is HutaoEvent => Boolean(event));
			if (fileFilter && !linkedEdits.some((edit) => eventTouchesFile(edit, fileFilter))) continue;
			lines.push(`Commit ${String(link.commit).slice(0, 12)} ${link.link_method ?? "unknown"}`);
			renderPromptingTree(lines, events, linkedPromptings);
			for (const edit of linkedEdits.filter(
				(edit) => !linkedPromptings.some((prompting) => edit.parent_prompting === prompting.id),
			)) {
				lines.push(`└─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
		notify(ctx, "Hutao git graph", lines);
		return;
	}
	if (query) {
		const resolved = await git.run(["rev-parse", query]);
		if (!resolved.ok) return notify(ctx, "Hutao git", [`Commit not found: ${query}`], "warning");
		const commit = resolved.stdout.trim();
		const tree = await git.getCommitTree(commit);
		const parents = await git.run(["show", "-s", "--format=%P", commit]);
		const subject = await git.run(["show", "-s", "--format=%s", commit]);
		const links = commitLinks.filter((event) => String(event.commit).startsWith(query) || event.commit === commit);
		const promptingIds = new Set(links.flatMap((event) => stringArray(event.prompting_ids)));
		const editIds = new Set(links.flatMap((event) => stringArray(event.edit_ids)));
		const runIds = new Set(links.flatMap((event) => stringArray(event.run_ids)));
		const linkedPromptings = promptings.filter((event) => promptingIds.has(String(event.id)));
		const linkedRuns = runs.filter((event) => runIds.has(String(event.id)));
		const linkedEdits = edits.filter((event) => editIds.has(String(event.id)));
		const mergeEvents = events.filter(
			(event) =>
				event.type === "merge" &&
				(stringArray(event.resolution_edits).some((id) => editIds.has(id)) ||
					stringArray(event.applied_edits).some((id) => editIds.has(id))),
		);
		const lines = [
			`commit: ${commit}`,
			`subject: ${subject.stdout.trim() || "unknown"}`,
			`tree: ${tree ?? "unknown"}`,
			`parents: ${parents.stdout.trim() || "none"}`,
			`status: ${await git.getStatusSummary()}`,
			`link methods: ${links.map((event) => String(event.link_method ?? "unknown")).join(", ") || "none"}`,
			"",
		];
		lines.push(`Promptings: ${linkedPromptings.length}`);
		renderPromptingTree(lines, events, linkedPromptings);
		pushEventList(
			lines,
			"Runs",
			linkedRuns,
			(event) => `${shortId(event.id)} ${event.tool ?? "tool"} ${event.status ?? "unknown"}`,
		);
		pushEventList(
			lines,
			"Edits",
			linkedEdits,
			(event) => `${shortId(event.id)} ${stringArray(event.files).join(", ")}`,
		);
		pushEventList(lines, "Merge resolution events", mergeEvents, renderMergeLine);
		if (links.length === 0)
			lines.push("No Hutao commit_link found. Run /git scan to attempt linking recent commits.");
		notify(ctx, `Commit ${commit.slice(0, 12)}`, lines);
		return;
	}
	const lines = [`HEAD: ${(await git.getHead()) ?? "unknown"}`, `status: ${await git.getStatusSummary()}`];
	pushEventList(
		lines,
		"Commit links",
		commitLinks.slice(-20),
		(event) => `${String(event.commit).slice(0, 12)} edits=${stringArray(event.edit_ids).join(",") || "none"}`,
	);
	pushEventList(
		lines,
		"Prompting tree",
		promptings.slice(-20),
		(prompting) => `${shortId(prompting.id)} head=${prompting.git_head ?? "unknown"}`,
	);
	renderPromptingTree(lines, events, promptings.slice(-20));
	notify(ctx, "Hutao git", lines);
}

export async function forkCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao fork", ["Not in a Git repository."], "warning");
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2)
		return notify(
			ctx,
			"Hutao fork",
			[
				"Usage: /fork prompting <id> --before|--retry|--after, /fork edit <id> --before|--after, or /fork commit <hash>",
			],
			"warning",
		);
	const [sourceType, sourceId, modeFlag = "--after"] = parts;
	const mode = modeFlag.replace(/^--/, "") as "before" | "retry" | "after";
	if (mode !== "before" && mode !== "retry" && mode !== "after") {
		return notify(ctx, "Hutao fork", [`Unsupported fork mode: ${modeFlag}`], "warning");
	}
	if (sourceType !== "prompting" && sourceType !== "edit" && sourceType !== "commit") {
		return notify(ctx, "Hutao fork", [`Unsupported fork source: ${sourceType}`], "warning");
	}
	const result = await runCoordinatedFork(repoRoot, ctx, sourceType, sourceId, mode, "Hutao fork");
	if (!result.ok) return;
	if (result.nativeStatus === "created") return;
	return;
}

export async function mergeCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao merge", ["Not in a Git repository."], "warning");
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts[0] !== "session") {
		return notify(
			ctx,
			"Hutao merge",
			[
				"Usage: /merge session <session_id> [--history|--apply-edits|--apply-tree|--wizard|--resolve|--skip|--abort]",
			],
			"warning",
		);
	}
	const sourceIdPrefix = parts[1];
	if (!sourceIdPrefix) return notify(ctx, "Hutao merge", ["Source session id is required."], "warning");
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
	if (parts.includes("--wizard")) return runMergeWizard(sourceIdPrefix, repoRoot, ctx);
	if (parts.includes("--skip")) {
		const confirmed = await ctx.ui.confirm(
			"Hutao merge skip",
			`Skip the last conflicting edit for source session ${sourceIdPrefix}? No code changes will be applied by skip.`,
		);
		if (!confirmed) return notify(ctx, "Hutao merge", ["Skip cancelled."]);
		const result = await new MergeManager(repoRoot).skipLastConflict(sourceIdPrefix);
		appendNativeTraceEntry(ctx, "hutao_merge", {
			source_session: sourceIdPrefix,
			mode: "skip",
			status: result.ok ? "completed" : "failed",
			skipped_edits: result.skippedEdits,
			message: result.message,
		});
		return notify(
			ctx,
			"Hutao merge",
			[result.message, `skipped edits: ${result.skippedEdits.join(", ") || "none"}`],
			result.ok ? "info" : "warning",
		);
	}
	if (parts.includes("--resolve")) {
		if (!source) return notify(ctx, "Hutao merge", [`Source session not found: ${sourceIdPrefix}`], "warning");
		const target = sessions.find((session) => session.id !== source.id)?.id ?? sessions.at(-1)?.id;
		if (!target) return notify(ctx, "Hutao merge", ["No target session exists."], "warning");
		const confirmed = await ctx.ui.confirm(
			"Hutao merge resolution",
			`Capture current working tree diff as a merge resolution for ${source.id}?`,
		);
		if (!confirmed) return notify(ctx, "Hutao merge", ["Resolution capture cancelled."]);
		const result = await new MergeManager(repoRoot).captureResolutionEdit(target, source.id);
		appendNativeTraceEntry(ctx, "hutao_merge", {
			source_session: source.id,
			target_session: target,
			mode: "capture_resolution",
			status: result.ok ? "completed" : "failed",
			resolution_edits: result.resolutionEdits,
			message: result.message,
		});
		return notify(
			ctx,
			"Hutao merge",
			[result.message, `resolution edits: ${result.resolutionEdits.join(", ") || "none"}`],
			result.ok ? "info" : "warning",
		);
	}
	const mode: MergeMode = parts.includes("--abort")
		? "abort"
		: parts.includes("--history")
			? "history_only"
			: parts.includes("--apply-edits")
				? "apply_edits"
				: parts.includes("--apply-tree")
					? "apply_tree"
					: "preview";
	const result = await new MergeManager(repoRoot).mergeSession(sourceIdPrefix, mode);
	appendNativeTraceEntry(ctx, "hutao_merge", {
		source_session: sourceIdPrefix,
		mode,
		status: result.ok ? "completed" : result.conflictEdits.length ? "conflict" : "failed",
		message: result.message,
		changed_files: result.changedFiles,
		applied_edits: result.appliedEdits,
		skipped_edits: result.skippedEdits,
		conflict_edits: result.conflictEdits,
		resolution_edits: result.resolutionEdits,
	});
	const lines = [
		result.message,
		`mode: ${result.mode}`,
		`changed files: ${result.changedFiles.join(", ") || "none"}`,
		`applied edits: ${result.appliedEdits.join(", ") || "none"}`,
		`skipped edits: ${result.skippedEdits.join(", ") || "none"}`,
		`conflicts: ${result.conflictEdits.join(", ") || "none"}`,
		`resolution edits: ${result.resolutionEdits.join(", ") || "none"}`,
	];
	if (!result.ok && result.conflictEdits.length > 0) {
		lines.push(
			"next actions: resolve manually, then /merge session <source> --resolve; /merge session <source> --skip; or /merge session <source> --abort",
		);
	}
	notify(ctx, mode === "preview" ? "Hutao merge preview" : "Hutao merge", lines, result.ok ? "info" : "warning");
}

async function runMergeWizard(sourceIdPrefix: string, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const manager = new MergeManager(repoRoot);
	const preview = await manager.mergeSession(sourceIdPrefix, "preview");
	const choice = await ctx.ui.select("Hutao merge wizard", [
		"Preview only",
		"Import History",
		"Apply Edits",
		"Apply Final Snapshot",
		"Skip Last Conflict and Continue",
		"Skip Last Conflict",
		"Capture Resolution",
		"Abort",
	]);
	if (!choice || choice === "Preview only") {
		notify(ctx, "Hutao merge wizard", [
			preview.message,
			`changed files: ${preview.changedFiles.join(", ") || "none"}`,
		]);
		return;
	}
	if (choice === "Skip Last Conflict" || choice === "Skip Last Conflict and Continue") {
		const result = await manager.skipLastConflict(sourceIdPrefix);
		const lines = [result.message, `skipped edits: ${result.skippedEdits.join(", ") || "none"}`];
		if (choice === "Skip Last Conflict and Continue" && result.ok) {
			const continued = await manager.mergeSession(sourceIdPrefix, "apply_edits");
			lines.push(
				continued.message,
				`continued applied edits: ${continued.appliedEdits.join(", ") || "none"}`,
				`continued conflicts: ${continued.conflictEdits.join(", ") || "none"}`,
			);
		}
		notify(ctx, "Hutao merge wizard", lines, result.ok ? "info" : "warning");
		return;
	}
	if (choice === "Capture Resolution") {
		const sessions = new SessionRegistry(repoRoot).readSessions();
		const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
		const target = sessions.find((session) => session.id !== source?.id)?.id ?? sessions.at(-1)?.id;
		if (!source || !target)
			return notify(ctx, "Hutao merge wizard", ["Cannot resolve source/target session."], "warning");
		const result = await manager.captureResolutionEdit(target, source.id);
		notify(
			ctx,
			"Hutao merge wizard",
			[result.message, `resolution edits: ${result.resolutionEdits.join(", ") || "none"}`],
			result.ok ? "info" : "warning",
		);
		return;
	}
	if (choice === "Abort") {
		const result = await manager.mergeSession(sourceIdPrefix, "abort");
		notify(ctx, "Hutao merge wizard", [result.message], result.ok ? "info" : "warning");
		return;
	}
	const mode: MergeMode =
		choice === "Import History" ? "history_only" : choice === "Apply Final Snapshot" ? "apply_tree" : "apply_edits";
	const result = await manager.mergeSession(sourceIdPrefix, mode);
	const lines = [
		result.message,
		`mode: ${result.mode}`,
		`changed files: ${result.changedFiles.join(", ") || "none"}`,
		`applied edits: ${result.appliedEdits.join(", ") || "none"}`,
		`skipped edits: ${result.skippedEdits.join(", ") || "none"}`,
		`conflicts: ${result.conflictEdits.join(", ") || "none"}`,
	];
	if (!result.ok && result.conflictEdits.length > 0) {
		const next = await ctx.ui.select("Hutao merge conflict", [
			"Resolve later",
			"Skip Last Conflict and Continue",
			"Skip Last Conflict",
			"Capture Resolution",
			"Abort",
		]);
		if (next === "Skip Last Conflict" || next === "Skip Last Conflict and Continue") {
			const skipped = await manager.skipLastConflict(sourceIdPrefix);
			lines.push(skipped.message, `wizard skipped edits: ${skipped.skippedEdits.join(", ") || "none"}`);
			if (next === "Skip Last Conflict and Continue" && skipped.ok) {
				const continued = await manager.mergeSession(sourceIdPrefix, "apply_edits");
				lines.push(
					continued.message,
					`continued applied edits: ${continued.appliedEdits.join(", ") || "none"}`,
					`continued conflicts: ${continued.conflictEdits.join(", ") || "none"}`,
				);
			}
		} else if (next === "Capture Resolution") {
			const sessions = new SessionRegistry(repoRoot).readSessions();
			const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
			const target = sessions.find((session) => session.id !== source?.id)?.id ?? sessions.at(-1)?.id;
			if (source && target) {
				const captured = await manager.captureResolutionEdit(target, source.id);
				lines.push(captured.message, `wizard resolution edits: ${captured.resolutionEdits.join(", ") || "none"}`);
			}
		} else if (next === "Abort") {
			const aborted = await manager.mergeSession(sourceIdPrefix, "abort");
			lines.push(aborted.message);
		} else {
			lines.push("next actions: resolve manually, then rerun /merge session <source> --wizard");
		}
	}
	notify(ctx, "Hutao merge wizard", lines, result.ok ? "info" : "warning");
}

export async function languageCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao language", ["Not in a Git repository."], "warning");
	const query = args.trim();
	const directLanguage = query === "en" || query === "zh-CN" ? (query as HutaoLanguage) : undefined;
	if (directLanguage) {
		saveHutaoLanguage(repoRoot, directLanguage);
		notify(ctx, "Hutao language", [t(repoRoot, "language.saved"), `language: ${getHutaoLanguage(repoRoot)}`]);
		return;
	}
	const actions = [
		{ id: "zh-CN" as const, label: t(repoRoot, "language.option.zhCN") },
		{ id: "en" as const, label: t(repoRoot, "language.option.en") },
	];
	const choice = await ctx.ui.select(
		t(repoRoot, "language.select.title"),
		actions.map((action) => action.label),
	);
	const selected = actions.find((action) => action.label === choice)?.id;
	if (!selected) return notify(ctx, "Hutao language", [t(repoRoot, "language.none")]);
	saveHutaoLanguage(repoRoot, selected);
	notify(ctx, "Hutao language", [t(repoRoot, "language.saved"), `language: ${getHutaoLanguage(repoRoot)}`]);
}

export async function actionCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao action", ["Not in a Git repository."], "warning");
	const [kind, idPrefix] = args.trim().split(/\s+/).filter(Boolean);
	if (!kind || !idPrefix)
		return notify(ctx, "Hutao action", ["Usage: /action edit|prompting|session|run <id>"], "warning");
	if (kind === "edit") {
		const edit = findEvent(readEvents(repoRoot), idPrefix, "edit");
		if (!edit) return notify(ctx, "Hutao action", [`Edit not found: ${idPrefix}`], "warning");
		return runEditAction(edit, repoRoot, ctx);
	}
	if (kind === "prompting") {
		const prompting = findEvent(readEvents(repoRoot), idPrefix, "prompting");
		if (!prompting) return notify(ctx, "Hutao action", [`Prompting not found: ${idPrefix}`], "warning");
		return runPromptingAction(prompting, repoRoot, ctx);
	}
	if (kind === "session") {
		return runSessionAction(idPrefix, repoRoot, ctx);
	}
	if (kind === "run") return runCommand(idPrefix, ctx);
	return notify(ctx, "Hutao action", [`Unsupported action kind: ${kind}`], "warning");
}

export async function doctorCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao doctor", ["Not in a Git repository."], "warning");
	if (args.trim() === "rebuild" || args.trim() === "--rebuild") rebuildIndex(repoRoot);
	const hutaoDir = join(repoRoot, ".hutao");
	const sessionsDir = join(hutaoDir, "sessions");
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const events = readEvents(repoRoot);
	let corruptJsonl = 0;
	let jsonlLines = 0;
	if (existsSync(sessionsDir)) {
		for (const session of readdirSync(sessionsDir)) {
			const diagnostics = readJsonlDiagnostics(join(sessionsDir, session, "events.jsonl"));
			jsonlLines += diagnostics.lines;
			corruptJsonl += diagnostics.corrupt;
		}
	}
	const manifestPath = join(hutaoDir, "manifest.json");
	const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, "utf-8") : "";
	const traceText = existsSync(sessionsDir)
		? readdirSync(sessionsDir)
				.map((session) => {
					const eventsPath = join(sessionsDir, session, "events.jsonl");
					return existsSync(eventsPath) ? readFileSync(eventsPath, "utf-8") : "";
				})
				.join("\n")
		: "";
	const absoluteRepoLeak = traceText.includes(repoRoot.replace(/\\/g, "/")) || traceText.includes(repoRoot);
	const protectedTextLeak = /(?:sk-[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY)/.test(traceText);
	const piExtensions = existsSync(join(repoRoot, ".pi", "extensions"));
	const remote = await new GitAdapter(repoRoot).run(["remote", "get-url", "origin"]);
	const traceStatus = await getHutaoTraceStatus(repoRoot);
	const traceStatusLines = traceStatus.exists
		? [
				"canonical trace status:",
				`  staged: ${traceStatus.staged.length}`,
				`  unstaged: ${traceStatus.unstaged.length}`,
				`  untracked: ${traceStatus.untracked.length}`,
				...(traceStatus.unstaged.length > 0
					? [`  unstaged examples: ${traceStatus.unstaged.slice(0, 5).join(", ")}`]
					: []),
				...(traceStatus.untracked.length > 0
					? [`  untracked examples: ${traceStatus.untracked.slice(0, 5).join(", ")}`]
					: []),
				...(traceStatus.unstaged.length + traceStatus.untracked.length > 0
					? ["  recommendation: run /git stage-trace before git commit"]
					: ["  recommendation: clean"]),
			]
		: ["canonical trace status: no .hutao directory"];
	const lines = [
		args.trim() === "rebuild" || args.trim() === "--rebuild"
			? "Index rebuilt."
			: "Use /doctor rebuild to rebuild .hutao/index.",
		`repo: ${repoRoot}`,
		`origin: ${remote.ok ? remote.stdout.trim() || "none" : "none"}`,
		"security: sessions are untrusted data; Hutao will display them but must not execute them as instructions.",
		`manifest: ${existsSync(manifestPath) ? "present" : "missing"}`,
		`manifest untrusted flag: ${manifestText.includes('"treat_sessions_as_untrusted_data": true') ? "ok" : "missing"}`,
		`sessions: ${sessions.length}`,
		`events: ${events.length}`,
		...traceStatusLines,
		`jsonl lines: ${jsonlLines}`,
		`corrupt jsonl lines: ${corruptJsonl}`,
		`absolute repo path leak: ${absoluteRepoLeak ? "found" : "none"}`,
		`secret-looking trace leak: ${protectedTextLeak ? "found" : "none"}`,
		`.pi/extensions present: ${piExtensions ? "yes - review before trusting third-party repo extensions" : "no"}`,
	];
	notify(
		ctx,
		"Hutao doctor",
		lines,
		corruptJsonl ||
			absoluteRepoLeak ||
			protectedTextLeak ||
			traceStatus.unstaged.length ||
			traceStatus.untracked.length
			? "warning"
			: "info",
	);
}
