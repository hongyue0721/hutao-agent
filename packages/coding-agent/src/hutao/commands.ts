import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { CommitLinker } from "./commit-linker.ts";
import { buildConversationHydration } from "./conversation-hydrator.ts";
import { renderConversationTimeline } from "./conversation-renderer.ts";
import { ConversationStore } from "./conversation-store.ts";
import type { HutaoEvent } from "./event-store.ts";
import { EphemeralInquiryFlow } from "./ephemeral-inquiry/flow.ts";
import { HutaoForkCoordinator, type HutaoForkResult } from "./fork-coordinator.ts";
import { GitAdapter } from "./git-adapter.ts";
import { GitBranchPolicy, parseGitBranchPolicyMode, type GitBranchPolicyMode } from "./git-branch-policy.ts";
import { defaultHistoricalContinuationCoordinator } from "./historical-continuation-coordinator.ts";
import { getHutaoLanguage, type HutaoLanguage, saveHutaoLanguage, selectAction, t } from "./i18n.ts";
import { rebuildIndex } from "./index-builder.ts";
import { MergeManager, type MergeMode } from "./merge-manager.ts";
import { defaultProcessActionRegistrations } from "./process-actions/default-actions.ts";
import { HutaoProcessActionExecutor, processActionTargetFromNode } from "./process-actions/executor.ts";
import { HutaoProcessActionRegistry } from "./process-actions/registry.ts";
import type {
	HutaoProcessAction,
	HutaoProcessActionCommandHandlers,
	HutaoProcessActionTarget,
} from "./process-actions/types.ts";
import type { HutaoProcessTreeNode } from "./process-tree/types.ts";
import { buildPromptingTreeNodes, renderPromptingTree } from "./prompting-tree.ts";
import { readAllEvents } from "./read-model.ts";
import { RevertManager } from "./revert-manager.ts";
import { SessionRegistry } from "./session-registry.ts";
import { subagentCommand } from "./subagent/command.ts";
export { subagentCommand };

import {
	getCommitLinkedIds,
	getCommitsForEdit,
	getCommitsForPrompting,
	getCommitsForRun,
	getEditsForRun,
	getMergesForEdit,
	stringArray,
} from "./trace-relations.ts";
import { getHutaoTraceStatus, stageHutaoTrace } from "./trace-stager.ts";

const defaultProcessActionRegistry = new HutaoProcessActionRegistry(defaultProcessActionRegistrations);

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

function extractGitBranchPolicyMode(
	parts: string[],
): { parts: string[]; mode?: GitBranchPolicyMode; invalid?: string } {
	const next: string[] = [];
	let mode: GitBranchPolicyMode | undefined;
	let invalid: string | undefined;
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (part === "--git-branch") {
			const value = parts[index + 1];
			const parsed = parseGitBranchPolicyMode(value);
			if (parsed) mode = parsed;
			else invalid = value ?? "";
			index += 1;
			continue;
		}
		if (part.startsWith("--git-branch=")) {
			const value = part.slice("--git-branch=".length);
			const parsed = parseGitBranchPolicyMode(value);
			if (parsed) mode = parsed;
			else invalid = value;
			continue;
		}
		next.push(part);
	}
	return { parts: next, mode, invalid };
}

function eventText(event: HutaoEvent): string {
	return String(event.text ?? event.summary ?? "").toLowerCase();
}

function eventTouchesFile(event: HutaoEvent, file: string): boolean {
	return stringArray(event.files).some((entry) => entry === file || entry.endsWith(`/${file}`));
}

function getRepoRoot(ctx: ExtensionCommandContext): Promise<string | undefined> {
	return new GitAdapter(ctx.cwd).getRepoRoot();
}

function firstLine(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

function eventTitle(event: HutaoEvent): string {
	return firstLine(event.text ?? event.summary ?? event.tool ?? event.id);
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

async function runPromptingTree(
	repoRoot: string,
	events: HutaoEvent[],
	promptings: HutaoEvent[],
	ctx: ExtensionCommandContext,
): Promise<void> {
	const nodes = buildPromptingTreeNodes(repoRoot, events, promptings);
	const selected = await selectItem(ctx, "Hutao prompting tree", nodes, (node) => node.label);
	if (!selected)
		return notify(ctx, "Hutao prompting", [promptings.length ? "No tree node selected." : "No promptings found."]);
	return runProcessNodeAction(selected, repoRoot, events, ctx);
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

function getNativeSessionPath(repoRoot: string, sessionId: string): string {
	return join(repoRoot, ".hutao", "sessions", sessionId, "native-session.jsonl");
}

async function switchToNativeHutaoSession(
	ctx: ExtensionCommandContext,
	repoRoot: string,
	registry: SessionRegistry,
	sessionId: string,
): Promise<"switched" | "already" | "missing" | "cancelled"> {
	const nativeSessionPath = getNativeSessionPath(repoRoot, sessionId);
	if (!existsSync(nativeSessionPath)) return "missing";
	registry.setCurrentSession(sessionId);
	const result = await ctx.switchSession(nativeSessionPath, {
		withSession: async (freshCtx) => {
			new SessionRegistry(repoRoot).setCurrentSession(sessionId);
			notify(freshCtx, "Hutao resume", [
				`Resumed native Hutao session ${sessionId}.`,
				`native session: ${nativeSessionPath}`,
				"Previous user/assistant/tool entries are now loaded as chat context.",
			]);
		},
	});
	return result.cancelled ? "cancelled" : "switched";
}

async function resumeSession(sessionId: string, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const registry = new SessionRegistry(repoRoot);
	const session = registry.readSession(sessionId);
	if (!session) return notify(ctx, "Hutao resume", [`Session not found: ${sessionId}`], "warning");
	const nativeStatus = await switchToNativeHutaoSession(ctx, repoRoot, registry, session.id);
	if (nativeStatus === "switched") return;
	if (nativeStatus === "already") {
		return notify(ctx, "Hutao resume", [
			`Current native Hutao session is already ${session.id}.`,
			"Previous user/assistant/tool entries are already loaded as chat context.",
		]);
	}
	if (nativeStatus === "cancelled") return notify(ctx, "Hutao resume", ["Native resume cancelled."], "warning");

	const current = registry.readCurrentSessionId();
	if (current === sessionId) {
		notify(
			ctx,
			"Hutao resume",
			[
				`Current Hutao trace session is already ${sessionId}, but native-session.jsonl is missing.`,
				"Only trace history is available; native chat context cannot be resumed.",
			],
			"warning",
		);
		return;
	}
	const continuation = await registry.createContinuationSession(session.id);
	if (!continuation)
		return notify(ctx, "Hutao resume", [`Failed to create continuation for ${session.id}`], "warning");
	rebuildIndex(repoRoot);
	notify(
		ctx,
		"Hutao resume",
		[
			`native-session.jsonl is missing for ${session.id}; created degraded continuation forkSession ${continuation.id}`,
			`parent session: ${session.id}`,
			"Continue chatting normally; trace promptings/runs/edits will be recorded in the continuation session.",
		],
		"warning",
	);
}

async function runSessionConversationAction(
	sessionIdPrefix: string,
	repoRoot: string,
	ctx: ExtensionCommandContext,
	mode: "conversation" | "hydrate-preview" | "hydrate",
	options: { requireQueueConfirmation?: boolean } = {},
): Promise<void> {
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const session = sessions.find((entry) => entry.id.startsWith(sessionIdPrefix));
	if (!session) return notify(ctx, "Hutao conversation", [`Session not found: ${sessionIdPrefix}`], "warning");
	const store = new ConversationStore(repoRoot);
	const snapshot = store.load(session.id);
	if (mode === "conversation") {
		const lines = renderConversationTimeline(snapshot);
		if (snapshot.status !== "complete") {
			lines.push("", `raw evidence lines: ${store.readRawEvidenceLineCount(session.id)}`);
			lines.push("This is incomplete/degraded history, not a fabricated full chat replay.");
		}
		return notify(ctx, `Conversation ${session.id}`, lines, snapshot.status === "complete" ? "info" : "warning");
	}
	const hydration = buildConversationHydration(snapshot);
	if (mode === "hydrate-preview") {
		return notify(
			ctx,
			`Hutao hydration preview ${session.id}`,
			hydration.previewLines,
			hydration.injectable ? "info" : "warning",
		);
	}
	if (!hydration.injectable) {
		const lines = [...hydration.previewLines, "", "Hydration was not queued because this history is incomplete."];
		return notify(ctx, `Hutao hydration ${session.id}`, lines, "warning");
	}
	if (options.requireQueueConfirmation) {
		const confirmed = await ctx.ui.confirm(
			"Hutao hydration",
			[
				`Queue conversation context from ${session.id} for the next user turn?`,
				"It will be delivered as untrusted custom context, not as system/developer instructions.",
				"It will not immediately trigger a model response.",
			].join("\n"),
		);
		if (!confirmed) return notify(ctx, `Hutao hydration ${session.id}`, ["Hydration queue cancelled."]);
	}
	ctx.sendMessage(hydration.message, { deliverAs: "nextTurn" });
	appendNativeTraceEntry(ctx, "hutao_conversation_hydration_queued", {
		session_id: session.id,
		included_entry_ids: hydration.details.included_entry_ids,
		omitted_entry_count: hydration.details.omitted_entry_count,
		created_at: new Date().toISOString(),
	});
	return notify(ctx, `Hutao hydration ${session.id}`, [
		"Conversation context queued for the next user turn.",
		"It will be delivered as a custom nextTurn message, not as system/developer instructions.",
		`included entries: ${hydration.details.included_entry_ids.length}`,
		`omitted eligible entries: ${hydration.details.omitted_entry_count}`,
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

async function selectSession(
	repoRoot: string,
	ctx: ExtensionCommandContext,
	titleKey: "session.select.title" | "merge.select.source" = "session.select.title",
): Promise<{ id: string; kind: string; status: string } | undefined> {
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const events = readEvents(repoRoot);
	return selectItem(ctx, t(repoRoot, titleKey), sessions, (session) => sessionSummary(session, events));
}

async function confirmMergeOperation(
	repoRoot: string,
	ctx: ExtensionCommandContext,
	manager: MergeManager,
	sourceIdPrefix: string,
	mode: MergeMode,
): Promise<boolean> {
	if (mode === "preview" || mode === "abort") return true;
	const preview = await manager.mergeSession(sourceIdPrefix, "preview");
	const messageKey =
		mode === "history_only"
			? "merge.confirm.history"
			: mode === "apply_tree"
				? "merge.confirm.applyTree"
				: "merge.confirm.applyEdits";
	return ctx.ui.confirm(
		t(repoRoot, "merge.confirm.apply.title"),
		[
			t(repoRoot, messageKey),
			"",
			preview.message,
			`source: ${sourceIdPrefix}`,
			`mode: ${mode}`,
			`changed files: ${preview.changedFiles.join(", ") || "none"}`,
			mode === "history_only" ? "No code changes will be applied." : "This may modify the current working tree.",
		].join("\n"),
	);
}

function makeProcessActionHandlers(
	repoRoot: string,
	events: HutaoEvent[],
	ctx: ExtensionCommandContext,
): HutaoProcessActionCommandHandlers {
	return {
		openSession: async (id) => sessionCommand(id, ctx),
		openPrompting: async (id) => promptingCommand(id, ctx),
		openSubagent: async (id) => subagentCommand(id, ctx),
		openRun: async (id) => runCommand(id, ctx),
		openEdit: async (id) => editCommand(id, ctx),
		openCommit: async (id) => gitCommand(id, ctx),
		openMerge: async (id) => mergeCommand(`session ${id}`, ctx),
		viewPromptingEdits: async (promptingId) => editCommand(`--prompting ${promptingId}`, ctx),
		viewPromptingRuns: async (promptingId) => {
			const runs = events.filter(
				(event) =>
					(event.type === "run_finished" || event.type === "run_started") &&
					event.parent_prompting === promptingId,
			);
			const lines = runs.length
				? runs.map(
					(run) =>
						`${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? (run.type === "run_started" ? "started" : "unknown")} ${firstLine(run.output_summary ?? run.input_summary)}`,
					)
				: ["No related runs found."];
			notify(ctx, `Runs for prompting ${promptingId}`, lines);
		},
		viewPromptingCommits: async (promptingId) => {
			const commits = getCommitsForPrompting(events, promptingId);
			notify(
				ctx,
				`Commits for prompting ${promptingId}`,
				commits.length ? commits.map((commit) => commit.slice(0, 12)) : ["No related commits found."],
			);
		},
		viewEditChangedFiles: async (editId) => {
			const edit = findEvent(events, editId, "edit");
			notify(ctx, `Changed files for edit ${editId}`, stringArray(edit?.files).length ? stringArray(edit?.files) : ["No changed files recorded."]);
		},
		viewEditParentRun: async (runId) => runCommand(runId, ctx),
		viewEditRelations: async (editId) => {
			const edit = findEvent(events, editId, "edit");
			const commits = edit ? getCommitsForEdit(events, edit.id) : [];
			const merges = edit ? getMergesForEdit(events, edit.id) : [];
			const revertedBy = edit
				? events.filter((event) => event.type === "edit_reverted" && event.edit_id === edit.id)
				: [];
			notify(ctx, `Relations for edit ${editId}`, [
				`commits: ${commits.map((commit) => commit.slice(0, 12)).join(", ") || "none"}`,
				`merges: ${merges.map((merge) => `${shortId(merge.id)}:${merge.mode}:${merge.status}`).join(", ") || "none"}`,
				`reverted_by: ${revertedBy.map((event) => shortId(event.revert_edit_id)).join(", ") || "none"}`,
			]);
		},
		resumePromptingAfter: async (prompting) => resumeFromPrompting(prompting, repoRoot, ctx),
		resumeEditAfter: async (edit) => resumeFromEdit(edit, repoRoot, ctx),
		forkPrompting: async (promptingId, mode) => forkCommand(`prompting ${promptingId} --${mode}`, ctx),
		forkEdit: async (editId, mode) => forkCommand(`edit ${editId} --${mode}`, ctx),
		previewRevertEdit: async (editId) => editCommand(`revert ${editId}`, ctx),
		openReadOnlyInquiry: async (target) =>
			new EphemeralInquiryFlow({
				repoRoot,
				ctx,
				target,
				events,
				promotion: {
					forkPrompting: async (promptingId, mode) => forkCommand(`prompting ${promptingId} --${mode}`, ctx),
					forkEdit: async (editId, mode) => forkCommand(`edit ${editId} --${mode}`, ctx),
				},
			}).run(),
		noAction: (title) => notify(ctx, title, [t(repoRoot, "menu.noAction")]),
	};
}

async function runProcessActionTarget(
	target: HutaoProcessActionTarget,
	repoRoot: string,
	events: HutaoEvent[],
	ctx: ExtensionCommandContext,
): Promise<void> {
	const node: HutaoProcessTreeNode = target.node ?? {
		kind: target.kind,
		id: target.id,
		label: target.id,
		depth: 0,
		event: target.event,
	};
	const executor = new HutaoProcessActionExecutor({
		repoRoot,
		events,
		ctx,
		handlers: makeProcessActionHandlers(repoRoot, events, ctx),
	});
	const actions = defaultProcessActionRegistry.getActions(node, { repoRoot, events });
	if (actions.length === 0) return executor.executeNodeDefault(node);
	const titleKey = defaultProcessActionRegistry.getTitleKey(node);
	const labels = actions.map((action) => t(repoRoot, action.labelKey));
	const choice = await ctx.ui.select(titleKey ? t(repoRoot, titleKey) : `Hutao ${node.kind} actions`, labels);
	const action = actions.find((candidate) => t(repoRoot, candidate.labelKey) === choice);
	if (!action) return notify(ctx, `Hutao ${node.kind}`, [t(repoRoot, "menu.noAction")]);
	return executor.execute(action, target);
}

async function runProcessNodeAction(
	node: HutaoProcessTreeNode,
	repoRoot: string,
	events: HutaoEvent[],
	ctx: ExtensionCommandContext,
): Promise<void> {
	return runProcessActionTarget(processActionTargetFromNode(node), repoRoot, events, ctx);
}

function eventTarget(kind: "prompting" | "edit", event: HutaoEvent): HutaoProcessActionTarget {
	return {
		kind,
		id: String(event.id),
		event,
		node: { kind, id: String(event.id), label: `${kind} ${event.id}`, depth: 0, event },
	};
}

async function runSessionAction(sessionId: string, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	const choice = await selectAction(ctx, repoRoot, "session.action.title", [
		{ id: "viewDetails", labelKey: "session.action.viewDetails" },
		{ id: "viewConversation", labelKey: "session.action.viewConversation" },
		{ id: "previewHydration", labelKey: "session.action.previewHydration" },
		{ id: "queueHydration", labelKey: "session.action.queueHydration" },
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
	if (choice === "viewConversation") return runSessionConversationAction(sessionId, repoRoot, ctx, "conversation");
	if (choice === "previewHydration") return runSessionConversationAction(sessionId, repoRoot, ctx, "hydrate-preview");
	if (choice === "queueHydration")
		return runSessionConversationAction(sessionId, repoRoot, ctx, "hydrate", { requireQueueConfirmation: true });
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
	return runProcessActionTarget(eventTarget("prompting", prompting), repoRoot, readEvents(repoRoot), ctx);
}

async function runEditAction(edit: HutaoEvent, repoRoot: string, ctx: ExtensionCommandContext): Promise<void> {
	return runProcessActionTarget(eventTarget("edit", edit), repoRoot, readEvents(repoRoot), ctx);
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
	const parts = query.split(/\s+/).filter(Boolean);
	if (parts.includes("--conversation") || parts.includes("--hydrate-preview") || parts.includes("--hydrate")) {
		const mode = parts.includes("--conversation")
			? "conversation"
			: parts.includes("--hydrate-preview")
				? "hydrate-preview"
				: "hydrate";
		const sessionIdPrefix = parts.find((part) => !part.startsWith("--"));
		if (!sessionIdPrefix) {
			const flag =
				mode === "conversation" ? "--conversation" : mode === "hydrate" ? "--hydrate" : "--hydrate-preview";
			return notify(ctx, "Hutao conversation", [`Usage: /session <id> ${flag}`], "warning");
		}
		return runSessionConversationAction(sessionIdPrefix, repoRoot, ctx, mode);
	}
	if (!query) {
		const selected = await selectSession(repoRoot, ctx);
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
		`conversation: /session ${session.id} --conversation`,
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
	const listMode = parts.includes("--list");
	const detailQuery = parts.find((part) => !part.startsWith("--") && part !== "search");
	if (sessionFilter) promptings = promptings.filter((event) => String(event.session_id).startsWith(sessionFilter));
	if (commitFilter) {
		const ids = getCommitLinkedIds(events, commitFilter, "prompting_ids");
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
		if (!listMode) return runPromptingTree(repoRoot, events, promptings, ctx);
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
	const prompting = findEvent(events, detailQuery ?? query, "prompting");
	if (!prompting) return notify(ctx, "Hutao prompting", [`Not found: ${detailQuery ?? query}`], "warning");
	const runs = events.filter(
		(event) =>
			(event.type === "run_finished" || event.type === "run_started") && event.parent_prompting === prompting.id,
	);
	const edits = events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id);
	const commits = getCommitsForPrompting(events, prompting.id);
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
		const selected = await selectItem(
			ctx,
			"Select Hutao run",
			runs.slice(-40),
			(run) =>
				`${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "started"} ${firstLine(run.output_summary ?? run.input_summary)}`,
		);
		if (!selected) return notify(ctx, "Hutao run", [runs.length ? t(repoRoot, "menu.cancelled") : "No runs found."]);
		return runCommand(String(selected.id), ctx);
	}
	const run = findEvent(events, query, "run_finished") ?? findEvent(events, query, "run_started");
	if (!run) return notify(ctx, "Hutao run", [`Not found: ${query}`], "warning");
	const edits = getEditsForRun(events, run.id);
	const commits = getCommitsForRun(events, run.id);
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
		const ids = getCommitLinkedIds(events, commitFilter, "edit_ids");
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
	const commits = getCommitsForEdit(events, edit.id);
	const merges = getMergesForEdit(events, edit.id);
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
	if (!query) {
		const choice = await selectAction(ctx, repoRoot, "git.menu.title", [
			{ id: "status", labelKey: "git.menu.status" },
			{ id: "graph", labelKey: "git.menu.graph" },
			{ id: "scan", labelKey: "git.menu.scan" },
			{ id: "stageTrace", labelKey: "git.menu.stageTrace" },
			{ id: "commitDetail", labelKey: "git.menu.commitDetail" },
		]);
		if (choice === "graph") return gitCommand("graph", ctx);
		if (choice === "scan") return gitCommand("scan", ctx);
		if (choice === "stageTrace") return gitCommand("stage-trace", ctx);
		if (choice === "commitDetail") {
			const commit = await ctx.ui.input(t(repoRoot, "git.input.commit"));
			return commit ? gitCommand(commit, ctx) : notify(ctx, "Hutao git", [t(repoRoot, "menu.cancelled")]);
		}
		if (choice !== "status") return notify(ctx, "Hutao git", [t(repoRoot, "menu.cancelled")]);
	}
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
	const events = readEvents(repoRoot);
	const parsedArgs = extractGitBranchPolicyMode(args.trim().split(/\s+/).filter(Boolean));
	if (parsedArgs.invalid !== undefined) {
		return notify(ctx, "Hutao fork", [`Unsupported --git-branch mode: ${parsedArgs.invalid || "<missing>"}`], "warning");
	}
	const parts = parsedArgs.parts;
	let sourceType = parts[0] as "prompting" | "edit" | "commit" | undefined;
	let sourceId: string | undefined = parts[1];
	let modeFlag = parts[2] ?? "--after";
	if (parts.length < 2) {
		sourceType = await selectAction(ctx, repoRoot, "fork.menu.source.title", [
			{ id: "prompting", labelKey: "fork.menu.source.prompting" },
			{ id: "edit", labelKey: "fork.menu.source.edit" },
			{ id: "commit", labelKey: "fork.menu.source.commit" },
		]);
		if (!sourceType) return notify(ctx, "Hutao fork", [t(repoRoot, "menu.cancelled")]);
		if (sourceType === "prompting") {
			const selected = await selectItem(
				ctx,
				t(repoRoot, "prompting.select.title"),
				events.filter((event) => event.type === "prompting").slice(-30),
				(event) => `${shortId(event.id)} ${eventTitle(event)}`,
			);
			sourceId = selected ? String(selected.id) : undefined;
		} else if (sourceType === "edit") {
			const selected = await selectItem(
				ctx,
				t(repoRoot, "edit.select.title"),
				events.filter((event) => event.type === "edit").slice(-30),
				(event) => `${shortId(event.id)} ${stringArray(event.files).join(", ") || firstLine(event.summary)}`,
			);
			sourceId = selected ? String(selected.id) : undefined;
		} else {
			sourceId = await ctx.ui.input(t(repoRoot, "fork.input.commit"));
		}
		if (!sourceId) return notify(ctx, "Hutao fork", [t(repoRoot, "menu.cancelled")]);
		const modeChoices =
			sourceType === "prompting"
				? [
						{ id: "before" as const, labelKey: "fork.menu.mode.before" as const },
						{ id: "retry" as const, labelKey: "fork.menu.mode.retry" as const },
						{ id: "after" as const, labelKey: "fork.menu.mode.after" as const },
					]
				: [
						{ id: "before" as const, labelKey: "fork.menu.mode.before" as const },
						{ id: "after" as const, labelKey: "fork.menu.mode.after" as const },
					];
		const selectedMode = await selectAction(ctx, repoRoot, "fork.menu.mode.title", modeChoices);
		modeFlag = selectedMode ? `--${selectedMode}` : "";
		if (!modeFlag) return notify(ctx, "Hutao fork", [t(repoRoot, "menu.cancelled")]);
	}
	const mode = modeFlag.replace(/^--/, "") as "before" | "retry" | "after";
	if (mode !== "before" && mode !== "retry" && mode !== "after") {
		return notify(ctx, "Hutao fork", [`Unsupported fork mode: ${modeFlag}`], "warning");
	}
	if (sourceType !== "prompting" && sourceType !== "edit" && sourceType !== "commit") {
		return notify(ctx, "Hutao fork", [`Unsupported fork source: ${sourceType}`], "warning");
	}
	if (!sourceId) return notify(ctx, "Hutao fork", [t(repoRoot, "menu.cancelled")]);
	const result = await runCoordinatedFork(repoRoot, ctx, sourceType, sourceId, mode, "Hutao fork");
	if (!result.ok || !result.sessionId) return;
	const branchResult = await new GitBranchPolicy().apply({
		repoRoot,
		ctx,
		modeOverride: parsedArgs.mode,
		forkSessionId: result.sessionId,
		sourceType,
		sourceId,
		forkMode: mode,
	});
	if (branchResult.action === "created") {
		return notify(ctx, "Hutao Git branch", [
			t(repoRoot, "gitBranch.notice.created"),
			`branch: ${branchResult.branchName}`,
			`forkSession: ${result.sessionId}`,
		]);
	}
	if (branchResult.action === "failed") {
		return notify(ctx, "Hutao Git branch", [
			t(repoRoot, "gitBranch.notice.failed"),
			`branch: ${branchResult.branchName ?? "unknown"}`,
			branchResult.reason ?? "unknown failure",
		], "warning");
	}
	if (branchResult.mode !== "never") {
		return notify(ctx, "Hutao Git branch", [
			t(repoRoot, "gitBranch.notice.skipped"),
			branchResult.reason ?? "skipped",
		]);
	}
}

export async function mergeCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao merge", ["Not in a Git repository."], "warning");
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length > 0 && parts[0] !== "session") {
		return notify(
			ctx,
			"Hutao merge",
			[
				"Usage: /merge session <session_id> [--history|--apply-edits|--apply-tree|--wizard|--resolve|--skip|--abort]",
			],
			"warning",
		);
	}
	let sourceIdPrefix = parts[1];
	let flags = parts.slice(2);
	if (!sourceIdPrefix || sourceIdPrefix.startsWith("--")) {
		flags = sourceIdPrefix?.startsWith("--") ? parts.slice(1) : parts.slice(2);
		const selected = await selectSession(repoRoot, ctx, "merge.select.source");
		if (!selected) return notify(ctx, "Hutao merge", [t(repoRoot, "menu.cancelled")]);
		sourceIdPrefix = selected.id;
	}
	const sessions = new SessionRegistry(repoRoot).readSessions();
	const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
	if (flags.includes("--wizard") || parts.length <= 1) return runMergeWizard(sourceIdPrefix, repoRoot, ctx);
	if (flags.includes("--skip")) {
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
	if (flags.includes("--resolve")) {
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
	const mode: MergeMode = flags.includes("--abort")
		? "abort"
		: flags.includes("--history")
			? "history_only"
			: flags.includes("--apply-edits")
				? "apply_edits"
				: flags.includes("--apply-tree")
					? "apply_tree"
					: "preview";
	const manager = new MergeManager(repoRoot);
	if (!(await confirmMergeOperation(repoRoot, ctx, manager, sourceIdPrefix, mode))) {
		return notify(ctx, "Hutao merge", [t(repoRoot, "menu.cancelled")]);
	}
	const result = await manager.mergeSession(sourceIdPrefix, mode);
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
			if (await confirmMergeOperation(repoRoot, ctx, manager, sourceIdPrefix, "apply_edits")) {
				const continued = await manager.mergeSession(sourceIdPrefix, "apply_edits");
				lines.push(
					continued.message,
					`continued applied edits: ${continued.appliedEdits.join(", ") || "none"}`,
					`continued conflicts: ${continued.conflictEdits.join(", ") || "none"}`,
				);
			} else {
				lines.push(t(repoRoot, "menu.cancelled"));
			}
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
	if (!(await confirmMergeOperation(repoRoot, ctx, manager, sourceIdPrefix, mode))) {
		return notify(ctx, "Hutao merge wizard", [t(repoRoot, "menu.cancelled")]);
	}
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
				if (await confirmMergeOperation(repoRoot, ctx, manager, sourceIdPrefix, "apply_edits")) {
					const continued = await manager.mergeSession(sourceIdPrefix, "apply_edits");
					lines.push(
						continued.message,
						`continued applied edits: ${continued.appliedEdits.join(", ") || "none"}`,
						`continued conflicts: ${continued.conflictEdits.join(", ") || "none"}`,
					);
				} else {
					lines.push(t(repoRoot, "menu.cancelled"));
				}
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
	if (!kind) {
		const choice = await selectAction(ctx, repoRoot, "main.menu.title", [
			{ id: "sessions", labelKey: "main.menu.sessions" },
			{ id: "promptings", labelKey: "main.menu.promptings" },
			{ id: "edits", labelKey: "main.menu.edits" },
			{ id: "runs", labelKey: "main.menu.runs" },
			{ id: "git", labelKey: "main.menu.git" },
			{ id: "fork", labelKey: "main.menu.fork" },
			{ id: "merge", labelKey: "main.menu.merge" },
			{ id: "doctor", labelKey: "main.menu.doctor" },
			{ id: "language", labelKey: "main.menu.language" },
		]);
		if (choice === "sessions") return sessionCommand("", ctx);
		if (choice === "promptings") return promptingCommand("", ctx);
		if (choice === "edits") return editCommand("", ctx);
		if (choice === "runs") return runCommand("", ctx);
		if (choice === "git") return gitCommand("", ctx);
		if (choice === "fork") return forkCommand("", ctx);
		if (choice === "merge") return mergeCommand("session", ctx);
		if (choice === "doctor") return doctorCommand("", ctx);
		if (choice === "language") return languageCommand("", ctx);
		return notify(ctx, "Hutao action", [t(repoRoot, "menu.cancelled")]);
	}
	if (kind === "edit") {
		if (!idPrefix) return editCommand("", ctx);
		const edit = findEvent(readEvents(repoRoot), idPrefix, "edit");
		if (!edit) return notify(ctx, "Hutao action", [`Edit not found: ${idPrefix}`], "warning");
		return runEditAction(edit, repoRoot, ctx);
	}
	if (kind === "prompting") {
		if (!idPrefix) return promptingCommand("", ctx);
		const prompting = findEvent(readEvents(repoRoot), idPrefix, "prompting");
		if (!prompting) return notify(ctx, "Hutao action", [`Prompting not found: ${idPrefix}`], "warning");
		return runPromptingAction(prompting, repoRoot, ctx);
	}
	if (kind === "session") {
		if (!idPrefix) return sessionCommand("", ctx);
		return runSessionAction(idPrefix, repoRoot, ctx);
	}
	if (kind === "run") return runCommand(idPrefix ?? "", ctx);
	if (kind === "subagent") return subagentCommand(idPrefix ?? "", ctx);
	if (kind === "git") return gitCommand(idPrefix ?? "", ctx);
	if (kind === "fork") return forkCommand(idPrefix ?? "", ctx);
	if (kind === "merge") return mergeCommand(idPrefix ? `session ${idPrefix}` : "session", ctx);
	if (kind === "doctor") return doctorCommand(idPrefix ?? "", ctx);
	if (kind === "language") return languageCommand(idPrefix ?? "", ctx);
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
