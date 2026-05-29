import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
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

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
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
	const promptings = events.filter((event) => event.type === "prompting");
	const query = args.trim();
	if (!query) {
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
	const edits = events.filter((event) => event.type === "edit");
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
	if (!query) {
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

export async function gitCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao git", ["Not in a Git repository."], "warning");
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
	if (parts.length < 3)
		return notify(
			ctx,
			"Hutao fork",
			["Usage: /fork prompting <id> --before|--retry|--after or /fork edit <id> --before|--after"],
			"warning",
		);
	const [sourceType, sourceId, modeFlag] = parts;
	const events = readEvents(repoRoot);
	const source = findEvent(
		events,
		sourceId,
		sourceType === "prompting" ? "prompting" : sourceType === "edit" ? "edit" : undefined,
	);
	if (!source) return notify(ctx, "Hutao fork", [`Source not found: ${sourceId}`], "warning");
	const git = new GitAdapter(repoRoot);
	if ((await git.getStatusSummary()) !== "clean")
		return notify(
			ctx,
			"Hutao fork",
			["Working tree is dirty. Commit, stash, or clean before forking from history."],
			"warning",
		);
	const forkId = createHutaoId("fs");
	const now = new Date().toISOString();
	const metadata = {
		schema_version: HUTAO_SCHEMA_VERSION,
		id: forkId,
		kind: "forkSession" as const,
		title: `Fork from ${source.id}`,
		created_at: now,
		updated_at: now,
		base_git_head: stringValue(source.after_head) ?? stringValue(source.git_head) ?? (await git.getHead()),
		base_tree: stringValue(source.after_tree) ?? stringValue(source.git_tree) ?? (await git.getTree()),
		current_git_head_at_last_write: await git.getHead(),
		current_tree_at_last_write: await git.getTree(),
		status: "active" as const,
		parent_session: String(source.session_id ?? ""),
		fork_from: { type: sourceType, id: source.id, mode: modeFlag.replace(/^--/, "") },
		summary: `Fork created from ${sourceType} ${source.id}`,
	};
	const store = new EventStore(repoRoot, forkId);
	store.init(metadata);
	store.append({
		schema_version: HUTAO_SCHEMA_VERSION,
		type: "fork_session",
		id: forkId,
		session_id: forkId,
		parent_session: metadata.parent_session,
		fork_from_type: sourceType,
		fork_from_id: source.id,
		fork_mode: modeFlag.replace(/^--/, ""),
		base_git_head: metadata.base_git_head,
		base_tree: metadata.base_tree,
		created_by: "human",
		reason: metadata.summary,
		created_at: now,
	});
	rebuildIndex(repoRoot);
	notify(ctx, "Hutao fork", [
		`Created forkSession ${forkId}`,
		"Continue work in the new forkSession context from this history node.",
	]);
}

export async function mergeCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao merge", ["Not in a Git repository."], "warning");
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts[0] !== "session")
		return notify(
			ctx,
			"Hutao merge",
			["Usage: /merge session <session_id> [--history|--apply-edits|--apply-tree]"],
			"warning",
		);
	const sourceIdPrefix = parts[1];
	const mode = parts.includes("--history")
		? "history_only"
		: parts.includes("--apply-edits")
			? "apply_edits"
			: parts.includes("--apply-tree")
				? "apply_tree"
				: "preview";
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const source = sourceIdPrefix ? sessions.find((session) => session.id.startsWith(sourceIdPrefix)) : undefined;
	if (!source) return notify(ctx, "Hutao merge", [`Source session not found: ${sourceIdPrefix ?? ""}`], "warning");
	const events = readEvents(repoRoot);
	const sourceEvents = events.filter((event) => event.session_id === source.id);
	const sourceEdits = sourceEvents.filter((event) => event.type === "edit");
	const changedFiles = new Set<string>();
	for (const edit of sourceEdits) for (const file of stringArray(edit.files)) changedFiles.add(file);
	const git = new GitAdapter(repoRoot);
	const status = await git.getStatusSummary();
	if (mode === "preview" || mode === "apply_tree") {
		notify(ctx, "Hutao merge preview", [
			`source session: ${source.id}`,
			`source kind: ${source.kind}`,
			`parent session: ${source.parent_session ?? "none"}`,
			`fork_from: ${source.fork_from ? JSON.stringify(source.fork_from) : "none"}`,
			`base git head: ${source.base_git_head ?? "unknown"}`,
			`prompting count: ${sourceEvents.filter((event) => event.type === "prompting").length}`,
			`run count: ${sourceEvents.filter((event) => event.type === "run_finished").length}`,
			`edit count: ${sourceEdits.length}`,
			`changed files: ${[...changedFiles].join(", ") || "none"}`,
			`current working tree dirty: ${status === "clean" ? "no" : "yes"}`,
			mode === "apply_tree"
				? "apply-tree is experimental: preview only in this version."
				: "available modes: --history, --apply-edits, --apply-tree",
		]);
		return;
	}
	const targetSession = sessions[sessions.length - 1]?.id ?? source.id;
	const store = new EventStore(repoRoot, targetSession);
	if (mode === "history_only") {
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "merge",
			id: createHutaoId("m"),
			session_id: targetSession,
			source_session: source.id,
			target_session: targetSession,
			mode,
			status: "completed",
			imported_promptings: sourceEvents.filter((event) => event.type === "prompting").map((event) => event.id),
			imported_runs: sourceEvents.filter((event) => event.type === "run_finished").map((event) => event.id),
			imported_edits: sourceEdits.map((event) => event.id),
			applied_edits: [],
			conflict_edits: [],
			resolution_edits: [],
			created_at: new Date().toISOString(),
		});
		rebuildIndex(repoRoot);
		notify(ctx, "Hutao merge", ["History imported. No code changes were applied."]);
		return;
	}
	if (status !== "clean")
		return notify(
			ctx,
			"Hutao merge",
			["Working tree is dirty. Commit, stash, or clean before applying edits."],
			"warning",
		);
	const applied: string[] = [];
	const conflicts: string[] = [];
	const skipped: string[] = [];
	const previouslyApplied = new Set<string>();
	for (const merge of events.filter((event) => event.type === "merge")) {
		for (const editId of stringArray(merge.applied_edits)) previouslyApplied.add(editId);
	}
	const targetBeforeTree = await git.getTree();
	for (const edit of sourceEdits) {
		if (previouslyApplied.has(String(edit.id))) {
			skipped.push(String(edit.id));
			continue;
		}
		const patchPath = join(repoRoot, ".hutao", "sessions", source.id, String(edit.patch));
		const check = await git.applyPatchCheck(patchPath);
		if (!check.ok) {
			conflicts.push(String(edit.id));
			break;
		}
		const apply = await git.applyPatch(patchPath);
		if (!apply.ok) {
			conflicts.push(String(edit.id));
			break;
		}
		applied.push(String(edit.id));
	}
	store.append({
		schema_version: HUTAO_SCHEMA_VERSION,
		type: "merge",
		id: createHutaoId("m"),
		session_id: targetSession,
		source_session: source.id,
		target_session: targetSession,
		mode,
		status: conflicts.length ? "conflict" : "completed",
		imported_edits: sourceEdits.map((event) => event.id),
		applied_edits: applied,
		conflict_edits: conflicts,
		skipped_edits: skipped,
		resolution_edits: [],
		target_before_tree: targetBeforeTree,
		target_after_tree: await git.getTree(),
		created_at: new Date().toISOString(),
	});
	rebuildIndex(repoRoot);
	notify(
		ctx,
		"Hutao merge",
		[
			`applied edits: ${applied.join(", ") || "none"}`,
			`skipped edits: ${skipped.join(", ") || "none"}`,
			`conflicts: ${conflicts.join(", ") || "none"}`,
		],
		conflicts.length ? "warning" : "info",
	);
}
