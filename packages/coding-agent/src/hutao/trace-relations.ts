import type { HutaoEvent } from "./event-store.ts";
import { getSubagentEvents } from "./subagent/read-model.ts";

export function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export { isSubagentEvent } from "./subagent/schema.ts";

export function getSubagents(events: HutaoEvent[]): HutaoEvent[] {
	return getSubagentEvents(events);
}

export function getPromptingsForSession(events: HutaoEvent[], sessionId: unknown): HutaoEvent[] {
	const value = String(sessionId ?? "");
	return events.filter((event) => event.type === "prompting" && event.session_id === value);
}

export function getSubagentsForPrompting(events: HutaoEvent[], promptingId: unknown): HutaoEvent[] {
	const value = String(promptingId ?? "");
	return getSubagents(events).filter((event) => event.parent_prompting === value);
}

export function getRuns(events: HutaoEvent[]): HutaoEvent[] {
	const runsById = new Map<string, HutaoEvent>();
	for (const event of events.filter((entry) => entry.type === "run_finished" || entry.type === "run_started")) {
		const id = String(event.id ?? "");
		if (!id) continue;
		const existing = runsById.get(id);
		if (!existing || event.type === "run_finished") runsById.set(id, event);
	}
	return [...runsById.values()];
}

export function getRunsForPrompting(events: HutaoEvent[], promptingId: unknown): HutaoEvent[] {
	const value = String(promptingId ?? "");
	return getRuns(events).filter((event) => event.parent_prompting === value);
}

export function getRunsForSubagent(events: HutaoEvent[], subagentId: unknown): HutaoEvent[] {
	const value = String(subagentId ?? "");
	return getRuns(events).filter((event) => event.parent_subagent === value);
}

export function getEditsForRun(events: HutaoEvent[], runId: unknown): HutaoEvent[] {
	const value = String(runId ?? "");
	const explicit = events.filter((event) => event.type === "edit" && event.parent_run === value);
	if (explicit.length > 0) return explicit;
	return events.filter((event) => event.type === "edit" && stringArray(event.produced_edit_ids).includes(value));
}

export function getEditsForPrompting(events: HutaoEvent[], promptingId: unknown): HutaoEvent[] {
	const value = String(promptingId ?? "");
	return events.filter((event) => event.type === "edit" && event.parent_prompting === value);
}

export function getEditsForSubagent(events: HutaoEvent[], subagentId: unknown): HutaoEvent[] {
	const value = String(subagentId ?? "");
	return events.filter((event) => event.type === "edit" && event.parent_subagent === value);
}

export function getCommitsForId(
	events: HutaoEvent[],
	id: unknown,
	field: "prompting_ids" | "edit_ids" | "run_ids",
): string[] {
	const value = String(id ?? "");
	return events
		.filter((event) => event.type === "commit_link" && stringArray(event[field]).includes(value))
		.map((event) => String(event.commit));
}

export function getCommitsForPrompting(events: HutaoEvent[], promptingId: unknown): string[] {
	return getCommitsForId(events, promptingId, "prompting_ids");
}

export function getCommitsForRun(events: HutaoEvent[], runId: unknown): string[] {
	return getCommitsForId(events, runId, "run_ids");
}

export function getCommitsForEdit(events: HutaoEvent[], editId: unknown): string[] {
	return getCommitsForId(events, editId, "edit_ids");
}

export function getCommitLinkedIds(
	events: HutaoEvent[],
	commit: string,
	field: "prompting_ids" | "edit_ids" | "run_ids",
): Set<string> {
	const ids = new Set<string>();
	for (const event of events.filter(
		(entry) => entry.type === "commit_link" && String(entry.commit).startsWith(commit),
	)) {
		for (const id of stringArray(event[field])) ids.add(id);
	}
	return ids;
}

export function getMergesForEdit(events: HutaoEvent[], editId: unknown): HutaoEvent[] {
	const value = String(editId ?? "");
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

export function getForksForSession(events: HutaoEvent[], sessionId: unknown): HutaoEvent[] {
	const value = String(sessionId ?? "");
	return events.filter((event) => event.type === "fork_session" && event.parent_session === value);
}
