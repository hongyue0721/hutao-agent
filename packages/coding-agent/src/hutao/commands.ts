import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { CommitLinker } from "./commit-linker.ts";
import type { HutaoEvent } from "./event-store.ts";
import { ForkSessionManager } from "./fork-session-manager.ts";
import { GitAdapter } from "./git-adapter.ts";
import { MergeManager, type MergeMode } from "./merge-manager.ts";
import { readAllEvents } from "./read-model.ts";
import { RevertManager } from "./revert-manager.ts";
import { SessionRegistry } from "./session-registry.ts";

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

export async function sessionCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao session", ["Not in a Git repository."], "warning");
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const events = readEvents(repoRoot);
	const query = args.trim();
	if (!query) {
		notify(
			ctx,
			"Hutao sessions",
			sessions.map(
				(session) =>
					`${shortId(session.id)} ${session.kind} ${session.status} promptings=${events.filter((event) => event.session_id === session.id && event.type === "prompting").length} runs=${events.filter((event) => event.session_id === session.id && event.type === "run_finished").length} edits=${events.filter((event) => event.session_id === session.id && event.type === "edit").length}`,
			),
		);
		return;
	}
	const session = sessions.find((entry) => entry.id.startsWith(query));
	if (!session) return notify(ctx, "Hutao session", [`Not found: ${query}`], "warning");
	notify(ctx, `Session ${session.id}`, [
		`kind: ${session.kind}`,
		`status: ${session.status}`,
		`parent_session: ${session.parent_session ?? "none"}`,
		`fork_from: ${session.fork_from ? JSON.stringify(session.fork_from) : "none"}`,
		`base_git_head: ${session.base_git_head ?? "unknown"}`,
		`updated_at: ${session.updated_at}`,
		`promptings: ${
			events
				.filter((event) => event.session_id === session.id && event.type === "prompting")
				.map((event) => shortId(event.id))
				.join(", ") || "none"
		}`,
		`edits: ${
			events
				.filter((event) => event.session_id === session.id && event.type === "edit")
				.map((event) => shortId(event.id))
				.join(", ") || "none"
		}`,
	]);
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
		notify(
			ctx,
			"Hutao promptings",
			promptings.slice(-30).map(
				(event) =>
					`${shortId(event.id)} ${event.created_at ?? ""} ${String(event.text ?? "")
						.split(/\r?\n/)[0]
						?.slice(0, 120)}`,
			),
		);
		return;
	}
	const prompting = findEvent(events, query, "prompting");
	if (!prompting) return notify(ctx, "Hutao prompting", [`Not found: ${query}`], "warning");
	const runs = events.filter(
		(event) =>
			(event.type === "run_finished" || event.type === "run_started") && event.parent_prompting === prompting.id,
	);
	const edits = events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id);
	notify(ctx, `Prompting ${prompting.id}`, [
		`session: ${prompting.session_id}`,
		`git_head: ${prompting.git_head ?? "unknown"}`,
		`cwd: ${prompting.cwd ?? "."}`,
		`status: ${prompting.status ?? "unknown"}`,
		"",
		String(prompting.text ?? ""),
		"",
		`runs: ${runs.map((run) => `${shortId(run.id)}:${run.tool}:${run.status ?? "started"}`).join(", ") || "none"}`,
		`edits: ${edits.map((edit) => `${shortId(edit.id)}:${stringArray(edit.files).join(",")}`).join("; ") || "none"}`,
		"actions: view runs, view edits, view commits, fork before/retry/after this prompting",
	]);
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
		const confirmed = await ctx.ui.confirm(
			"Hutao revert preview",
			`Reverse apply edit ${editId}. This may modify the working tree. Continue?`,
		);
		if (!confirmed) return notify(ctx, "Hutao edit", ["Revert cancelled."]);
		const result = await new RevertManager(repoRoot).revertEdit(editId, targetSession);
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
		notify(
			ctx,
			"Hutao edits",
			edits
				.slice(-30)
				.map((event) => `${shortId(event.id)} ${event.created_at ?? ""} ${stringArray(event.files).join(", ")}`),
		);
		return;
	}
	const edit = findEvent(events, query, "edit");
	if (!edit) return notify(ctx, "Hutao edit", [`Not found: ${query}`], "warning");
	const patchPath = join(repoRoot, ".hutao", "sessions", String(edit.session_id), String(edit.patch));
	const patchPreview = existsSync(patchPath) ? readFileSync(patchPath, "utf-8").slice(0, 5000) : "[patch missing]";
	notify(ctx, `Edit ${edit.id}`, [
		`summary: ${edit.summary ?? ""}`,
		`session: ${edit.session_id}`,
		`parent prompting: ${edit.parent_prompting}`,
		`parent run: ${edit.parent_run}`,
		`related commit: ${edit.related_commit ?? "unlinked"}`,
		`files: ${stringArray(edit.files).join(", ")}`,
		`patch: ${edit.patch}`,
		`patch hash: ${edit.patch_hash}`,
		`before_tree: ${edit.before_tree ?? "unknown"}`,
		`after_tree: ${edit.after_tree ?? "unknown"}`,
		`status: ${edit.status ?? "unknown"}`,
		"actions: view patch, view parent prompting, view parent run, fork before/after this edit, /edit revert <id>",
		"",
		patchPreview,
	]);
}

export async function gitCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao git", ["Not in a Git repository."], "warning");
	if (args.trim() === "scan") {
		const result = await new CommitLinker(repoRoot).scanRecentCommits();
		notify(ctx, "Hutao git", [`linked commits: ${result.linked}`]);
		return;
	}
	const git = new GitAdapter(repoRoot);
	const events = readEvents(repoRoot);
	const promptings = events.filter((event) => event.type === "prompting");
	const edits = events.filter((event) => event.type === "edit");
	const commitLinks = events.filter((event) => event.type === "commit_link");
	const lines = [`HEAD: ${(await git.getHead()) ?? "unknown"}`, `status: ${await git.getStatusSummary()}`];
	for (const commitLink of commitLinks.slice(-20)) {
		lines.push(
			`Commit ${String(commitLink.commit).slice(0, 12)} edits=${stringArray(commitLink.edit_ids).join(",") || "none"}`,
		);
	}
	for (const prompting of promptings.slice(-20)) {
		lines.push(`Prompting ${shortId(prompting.id)} head=${prompting.git_head ?? "unknown"}`);
		for (const edit of edits.filter((entry) => entry.parent_prompting === prompting.id)) {
			lines.push(`  Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ")}`);
		}
	}
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
	const result = await new ForkSessionManager(repoRoot).createFork(sourceType, sourceId, mode);
	if (!result.ok) return notify(ctx, "Hutao fork", [result.reason ?? "Fork failed."], "warning");
	notify(ctx, "Hutao fork", [
		`Created forkSession ${result.sessionId}`,
		"Working tree has been restored to the requested history state when possible.",
	]);
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
			["Usage: /merge session <session_id> [--history|--apply-edits|--apply-tree]"],
			"warning",
		);
	}
	const sourceIdPrefix = parts[1];
	if (!sourceIdPrefix) return notify(ctx, "Hutao merge", ["Source session id is required."], "warning");
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
	const lines = [
		result.message,
		`mode: ${result.mode}`,
		`changed files: ${result.changedFiles.join(", ") || "none"}`,
		`applied edits: ${result.appliedEdits.join(", ") || "none"}`,
		`skipped edits: ${result.skippedEdits.join(", ") || "none"}`,
		`conflicts: ${result.conflictEdits.join(", ") || "none"}`,
		`resolution edits: ${result.resolutionEdits.join(", ") || "none"}`,
	];
	notify(ctx, mode === "preview" ? "Hutao merge preview" : "Hutao merge", lines, result.ok ? "info" : "warning");
}
