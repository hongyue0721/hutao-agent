import type { HutaoEvent } from "./event-store.ts";
import { SessionRegistry } from "./session-registry.ts";

export type PromptingTreeNodeKind = "session" | "prompting" | "subagent" | "run" | "edit" | "commit" | "merge";

export interface PromptingTreeNode {
	kind: PromptingTreeNodeKind;
	id: string;
	label: string;
	depth: number;
	event?: HutaoEvent;
}

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
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
	return firstLine(event.text ?? event.task ?? event.summary ?? event.name ?? event.tool ?? event.id);
}

function relatedCommits(events: HutaoEvent[], id: unknown, field: "prompting_ids" | "edit_ids" | "run_ids"): string[] {
	const value = String(id ?? "");
	return events
		.filter((event) => event.type === "commit_link" && stringArray(event[field]).includes(value))
		.map((event) => String(event.commit));
}

function relatedEditsForRun(events: HutaoEvent[], runId: unknown): HutaoEvent[] {
	const value = String(runId ?? "");
	const explicit = events.filter((event) => event.type === "edit" && event.parent_run === value);
	if (explicit.length > 0) return explicit;
	return events.filter((event) => event.type === "edit" && stringArray(event.produced_edit_ids).includes(value));
}

function treePrefix(depth: number, isLast: boolean): string {
	if (depth <= 0) return "";
	return `${"│  ".repeat(Math.max(0, depth - 1))}${isLast ? "└─ " : "├─ "}`;
}

function pushPromptingTreeNode(
	nodes: PromptingTreeNode[],
	kind: PromptingTreeNodeKind,
	id: string,
	label: string,
	depth: number,
	event?: HutaoEvent,
): void {
	nodes.push({ kind, id, label, depth, event });
}

function isSubagentEvent(event: HutaoEvent): boolean {
	return event.type === "subagent" || event.type === "subagent_started" || event.type === "subagent_finished";
}

function mergeSubagentEvents(events: HutaoEvent[]): HutaoEvent[] {
	const subagentsById = new Map<string, HutaoEvent>();
	for (const event of events.filter(isSubagentEvent)) {
		const id = String(event.id ?? "");
		if (!id) continue;
		const existing = subagentsById.get(id);
		if (!existing || event.type === "subagent_finished" || existing.type === "subagent_started") {
			subagentsById.set(id, { ...existing, ...event });
		}
	}
	return [...subagentsById.values()];
}

function subagentLabel(event: HutaoEvent): string {
	const name = firstLine(event.name ?? event.role ?? "subagent", 80);
	const status = event.status ?? (event.type === "subagent_started" ? "started" : "unknown");
	const task = firstLine(event.task ?? event.summary ?? "");
	return `Subagent ${shortId(event.id)} ${name} ${status}${task ? ` ${task}` : ""}`;
}

export function renderPromptingTree(lines: string[], events: HutaoEvent[], promptings: HutaoEvent[]): void {
	for (const prompting of promptings) {
		lines.push(`├─ Prompting ${shortId(prompting.id)} ${eventTitle(prompting)}`);
		const subagentIds = new Set(
			mergeSubagentEvents(events)
				.filter((event) => event.parent_prompting === prompting.id)
				.map((event) => String(event.id)),
		);
		const runs = events.filter(
			(event) =>
				event.type === "run_finished" &&
				event.parent_prompting === prompting.id &&
				!subagentIds.has(String(event.parent_subagent ?? "")),
		);
		for (const run of runs) {
			lines.push(`│  ├─ Run ${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "unknown"}`);
			for (const edit of relatedEditsForRun(events, run.id)) {
				lines.push(`│  │  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
		for (const edit of events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id)) {
			if (subagentIds.has(String(edit.parent_subagent ?? ""))) continue;
			if (!runs.some((run) => relatedEditsForRun(events, run.id).includes(edit))) {
				lines.push(`│  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
	}
}

export function buildPromptingTreeNodes(
	repoRoot: string,
	events: HutaoEvent[],
	promptings: HutaoEvent[],
): PromptingTreeNode[] {
	const registry = new SessionRegistry(repoRoot);
	const sessions = registry.readSessions();
	const sessionIds = new Set(promptings.map((event) => String(event.session_id ?? "")));
	const knownSessions = sessions.filter((session) => sessionIds.has(session.id));
	const orphanSessionIds = [...sessionIds].filter((id) => id && !knownSessions.some((session) => session.id === id));
	const sessionEntries = [
		...knownSessions.map((session) => ({ id: session.id, kind: session.kind, status: session.status })),
		...orphanSessionIds.map((id) => ({ id, kind: "session", status: "unknown" })),
	];
	const nodes: PromptingTreeNode[] = [];
	const subagents = mergeSubagentEvents(events);
	for (const session of sessionEntries) {
		const sessionPromptings = promptings.filter((event) => event.session_id === session.id);
		if (sessionPromptings.length === 0) continue;
		pushPromptingTreeNode(
			nodes,
			"session",
			session.id,
			`Session ${shortId(session.id)} ${session.kind} ${session.status} promptings=${sessionPromptings.length}`,
			0,
		);
		for (const [promptingIndex, prompting] of sessionPromptings.entries()) {
			const promptingSubagents = subagents.filter((event) => event.parent_prompting === prompting.id);
			const promptingSubagentIds = new Set(promptingSubagents.map((event) => String(event.id)));
			const runsById = new Map<string, HutaoEvent>();
			for (const event of events.filter(
				(entry) =>
					(entry.type === "run_finished" || entry.type === "run_started") &&
					entry.parent_prompting === prompting.id,
			)) {
				const existing = runsById.get(String(event.id));
				if (!existing || event.type === "run_finished") runsById.set(String(event.id), event);
			}
			const runs = [...runsById.values()];
			const topLevelRuns = runs.filter((run) => !promptingSubagentIds.has(String(run.parent_subagent ?? "")));
			const runIds = new Set(runs.map((run) => String(run.id)));
			const edits = events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id);
			const topLevelEdits = edits.filter(
				(edit) =>
					!runIds.has(String(edit.parent_run)) && !promptingSubagentIds.has(String(edit.parent_subagent ?? "")),
			);
			const commits = relatedCommits(events, prompting.id, "prompting_ids");
			const childCount = promptingSubagents.length + topLevelRuns.length + topLevelEdits.length + commits.length;
			pushPromptingTreeNode(
				nodes,
				"prompting",
				String(prompting.id),
				`${treePrefix(1, promptingIndex === sessionPromptings.length - 1)}Prompting ${shortId(prompting.id)} ${eventTitle(prompting)}`,
				1,
				prompting,
			);
			let childIndex = 0;
			for (const subagent of promptingSubagents) {
				const subagentId = String(subagent.id);
				const subagentRuns = runs.filter((run) => run.parent_subagent === subagentId);
				const subagentRunIds = new Set(subagentRuns.map((run) => String(run.id)));
				const subagentEdits = edits.filter(
					(edit) => edit.parent_subagent === subagentId && !subagentRunIds.has(String(edit.parent_run)),
				);
				const subagentIsLast = childIndex === childCount - 1;
				pushPromptingTreeNode(
					nodes,
					"subagent",
					subagentId,
					`${treePrefix(2, subagentIsLast)}${subagentLabel(subagent)}`,
					2,
					subagent,
				);
				childIndex += 1;
				for (const [runIndex, run] of subagentRuns.entries()) {
					const runEdits = relatedEditsForRun(events, run.id);
					pushPromptingTreeNode(
						nodes,
						"run",
						String(run.id),
						`${treePrefix(3, runIndex === subagentRuns.length - 1 && subagentEdits.length === 0)}Run ${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? (run.type === "run_started" ? "started" : "unknown")} ${firstLine(run.input_summary ?? run.output_summary ?? "")}`,
						3,
						run,
					);
					for (const [editIndex, edit] of runEdits.entries()) {
						pushPromptingTreeNode(
							nodes,
							"edit",
							String(edit.id),
							`${treePrefix(4, editIndex === runEdits.length - 1)}Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`,
							4,
							edit,
						);
					}
				}
				for (const [editIndex, edit] of subagentEdits.entries()) {
					pushPromptingTreeNode(
						nodes,
						"edit",
						String(edit.id),
						`${treePrefix(3, editIndex === subagentEdits.length - 1)}Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`,
						3,
						edit,
					);
				}
			}
			for (const run of topLevelRuns) {
				const runEdits = relatedEditsForRun(events, run.id);
				const runIsLast = childIndex === childCount - 1;
				pushPromptingTreeNode(
					nodes,
					"run",
					String(run.id),
					`${treePrefix(2, runIsLast)}Run ${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? (run.type === "run_started" ? "started" : "unknown")} ${firstLine(run.input_summary ?? run.output_summary ?? "")}`,
					2,
					run,
				);
				childIndex += 1;
				for (const [editIndex, edit] of runEdits.entries()) {
					pushPromptingTreeNode(
						nodes,
						"edit",
						String(edit.id),
						`${treePrefix(3, editIndex === runEdits.length - 1)}Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`,
						3,
						edit,
					);
				}
			}
			for (const edit of topLevelEdits) {
				const isLast = childIndex === childCount - 1;
				pushPromptingTreeNode(
					nodes,
					"edit",
					String(edit.id),
					`${treePrefix(2, isLast)}Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`,
					2,
					edit,
				);
				childIndex += 1;
			}
			for (const commit of commits) {
				const isLast = childIndex === childCount - 1;
				pushPromptingTreeNode(nodes, "commit", commit, `${treePrefix(2, isLast)}Commit ${commit.slice(0, 12)}`, 2);
				childIndex += 1;
			}
		}
	}
	return nodes;
}
