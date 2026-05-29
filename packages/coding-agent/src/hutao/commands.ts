import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { CommitLinker } from "./commit-linker.ts";
import type { HutaoEvent } from "./event-store.ts";
import { ForkSessionManager } from "./fork-session-manager.ts";
import { GitAdapter } from "./git-adapter.ts";
import { rebuildIndex } from "./index-builder.ts";
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
		notify(
			ctx,
			"Hutao sessions",
			sessions.map(
				(session) =>
					`${shortId(session.id)} ${session.kind} ${session.status} promptings=${events.filter((event) => event.session_id === session.id && event.type === "prompting").length} runs=${events.filter((event) => event.session_id === session.id && event.type === "run_finished").length} edits=${events.filter((event) => event.session_id === session.id && event.type === "edit").length} merges=${events.filter((event) => event.session_id === session.id && event.type === "merge").length}`,
			),
		);
		return;
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
	notify(ctx, `Prompting ${prompting.id}`, lines);
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
	const commits = relatedCommits(events, edit.id, "edit_ids");
	const merges = relatedMerges(events, edit.id);
	const revertedBy = events.filter((event) => event.type === "edit_reverted" && event.edit_id === edit.id);
	notify(ctx, `Edit ${edit.id}`, [
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
	const query = args.trim();
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
		const linkedPromptings = promptings.filter((event) => promptingIds.has(String(event.id)));
		const linkedEdits = edits.filter((event) => editIds.has(String(event.id)));
		const mergeEvents = events.filter(
			(event) => event.type === "merge" && stringArray(event.resolution_edits).some((id) => editIds.has(id)),
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
		pushEventList(lines, "Promptings", linkedPromptings, (event) => `${shortId(event.id)} ${eventTitle(event)}`);
		pushEventList(
			lines,
			"Edits",
			linkedEdits,
			(event) => `${shortId(event.id)} ${stringArray(event.files).join(", ")}`,
		);
		pushEventList(
			lines,
			"Merge resolution events",
			mergeEvents,
			(event) => `${shortId(event.id)} ${event.mode ?? ""} ${event.status ?? ""}`,
		);
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
	for (const prompting of promptings.slice(-20)) {
		for (const edit of edits.filter((entry) => entry.parent_prompting === prompting.id)) {
			lines.push(`  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ")}`);
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
			["Usage: /merge session <session_id> [--history|--apply-edits|--apply-tree|--resolve|--skip|--abort]"],
			"warning",
		);
	}
	const sourceIdPrefix = parts[1];
	if (!sourceIdPrefix) return notify(ctx, "Hutao merge", ["Source session id is required."], "warning");
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
	if (parts.includes("--skip")) {
		const confirmed = await ctx.ui.confirm(
			"Hutao merge skip",
			`Skip the last conflicting edit for source session ${sourceIdPrefix}? No code changes will be applied by skip.`,
		);
		if (!confirmed) return notify(ctx, "Hutao merge", ["Skip cancelled."]);
		const result = await new MergeManager(repoRoot).skipLastConflict(sourceIdPrefix);
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
		`jsonl lines: ${jsonlLines}`,
		`corrupt jsonl lines: ${corruptJsonl}`,
		`absolute repo path leak: ${absoluteRepoLeak ? "found" : "none"}`,
		`secret-looking trace leak: ${protectedTextLeak ? "found" : "none"}`,
		`.pi/extensions present: ${piExtensions ? "yes - review before trusting third-party repo extensions" : "no"}`,
	];
	notify(ctx, "Hutao doctor", lines, corruptJsonl || absoluteRepoLeak || protectedTextLeak ? "warning" : "info");
}
