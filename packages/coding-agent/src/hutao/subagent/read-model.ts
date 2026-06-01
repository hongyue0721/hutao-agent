import type { HutaoEvent } from "../event-store.ts";
import { isSubagentEvent, type SubagentRecord, type SubagentStatus } from "./schema.ts";

export interface SubagentRecordLinkResolvers {
	getRunsForSubagent?: (events: HutaoEvent[], subagentId: string) => HutaoEvent[];
	getEditsForSubagent?: (events: HutaoEvent[], subagentId: string) => HutaoEvent[];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function statusFor(event: HutaoEvent): SubagentStatus {
	if (event.status === "completed" || event.status === "failed" || event.status === "started") return event.status;
	if (event.type === "subagent_finished") return "completed";
	if (event.type === "subagent_started") return "started";
	return "unknown";
}

function mergeSubagentLifecycle(existing: HutaoEvent | undefined, event: HutaoEvent): HutaoEvent {
	if (!existing) return event;
	return { ...existing, ...event };
}

function fallbackRunsForSubagent(events: HutaoEvent[], subagentId: string): HutaoEvent[] {
	return events.filter(
		(event) =>
			(event.type === "run_started" || event.type === "run_finished") && event.parent_subagent === subagentId,
	);
}

function fallbackEditsForSubagent(events: HutaoEvent[], subagentId: string): HutaoEvent[] {
	return events.filter((event) => event.type === "edit" && event.parent_subagent === subagentId);
}

export function getSubagentEvents(events: HutaoEvent[]): HutaoEvent[] {
	const subagentsById = new Map<string, HutaoEvent>();
	for (const event of events.filter(isSubagentEvent)) {
		const id = String(event.id ?? "");
		if (!id) continue;
		subagentsById.set(id, mergeSubagentLifecycle(subagentsById.get(id), event));
	}
	return [...subagentsById.values()];
}

export function getSubagentRecords(
	events: HutaoEvent[],
	resolvers: SubagentRecordLinkResolvers = {},
): SubagentRecord[] {
	const getRuns = resolvers.getRunsForSubagent ?? fallbackRunsForSubagent;
	const getEdits = resolvers.getEditsForSubagent ?? fallbackEditsForSubagent;
	return getSubagentEvents(events).map((event) => {
		const id = String(event.id);
		const runs = getRuns(events, id);
		const edits = getEdits(events, id);
		const messageIds = stringArray(event.message_ids);
		const hasStarted = events.some((entry) => entry.id === id && entry.type === "subagent_started");
		const hasFinished = events.some((entry) => entry.id === id && entry.type === "subagent_finished");
		const lifecycleDegraded = event.type !== "subagent" && (!hasStarted || !hasFinished);
		return {
			id,
			sessionId: String(event.session_id ?? "unknown"),
			parentPrompting: text(event.parent_prompting),
			parentRun: text(event.parent_run),
			name: text(event.name) ?? text(event.role) ?? "subagent",
			role: text(event.role),
			task: text(event.task),
			status: statusFor(event),
			summary: text(event.summary),
			runIds: runs.map((run) => String(run.id)),
			editIds: edits.map((edit) => String(edit.id)),
			messageIds,
			startedAt: text(event.started_at) ?? text(event.created_at),
			endedAt: text(event.ended_at),
			degraded: lifecycleDegraded,
			event,
		};
	});
}

export function getSubagentRecordsForPrompting(
	events: HutaoEvent[],
	promptingId: unknown,
	resolvers: SubagentRecordLinkResolvers = {},
): SubagentRecord[] {
	const value = String(promptingId ?? "");
	return getSubagentRecords(events, resolvers).filter((record) => record.parentPrompting === value);
}

export function findSubagentRecord(
	events: HutaoEvent[],
	idPrefix: string,
	resolvers: SubagentRecordLinkResolvers = {},
): SubagentRecord | undefined {
	return getSubagentRecords(events, resolvers).find((record) => record.id.startsWith(idPrefix));
}
