import type { HutaoEvent } from "../event-store.ts";
import { stringArray } from "./helpers.ts";
import type { HutaoProcessTreeBuildContext } from "./types.ts";

export function getConflictEvents(events: HutaoEvent[]): HutaoEvent[] {
	return events.filter(
		(event) =>
			event.type === "merge" &&
			(String(event.status ?? "") === "conflict" ||
				stringArray(event.conflict_edits).length > 0 ||
				stringArray(event.skipped_edits).length > 0),
	);
}

function stringField(event: HutaoEvent | undefined, field: string): string {
	const value = event?.[field];
	return typeof value === "string" ? value : "";
}

function visiblePromptingSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	return new Set(
		context.promptings.map((event) => String(event.session_id ?? "")).filter((sessionId) => sessionId.length > 0),
	);
}

function hasAnyPromptings(context: HutaoProcessTreeBuildContext): boolean {
	return context.events.some((event) => event.type === "prompting");
}

export function conflictMergeId(conflict: HutaoEvent): string {
	return String(conflict.id ?? "");
}

export function conflictSourceSessionId(conflict: HutaoEvent): string {
	return stringField(conflict, "source_session");
}

export function conflictTargetSessionId(conflict: HutaoEvent): string {
	return stringField(conflict, "target_session") || stringField(conflict, "session_id");
}

export function conflictParticipantSessionIds(conflict: HutaoEvent): string[] {
	return [conflictTargetSessionId(conflict), conflictSourceSessionId(conflict)]
		.filter(Boolean)
		.filter((id, index, ids) => ids.indexOf(id) === index);
}

export function primaryConflictSessionId(conflict: HutaoEvent): string {
	return conflictTargetSessionId(conflict) || conflictSourceSessionId(conflict);
}

export function conflictTouchesVisiblePromptings(conflict: HutaoEvent, context: HutaoProcessTreeBuildContext): boolean {
	const visibleSessions = visiblePromptingSessionIds(context);
	if (visibleSessions.size === 0) return !hasAnyPromptings(context);
	return conflictParticipantSessionIds(conflict).some((sessionId) => visibleSessions.has(sessionId));
}

export function getVisibleConflictEvents(context: HutaoProcessTreeBuildContext): HutaoEvent[] {
	return getConflictEvents(context.events).filter((conflict) => conflictTouchesVisiblePromptings(conflict, context));
}

export function conflictVisibleSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	const ids = visiblePromptingSessionIds(context);
	for (const conflict of getVisibleConflictEvents(context)) {
		for (const sessionId of conflictParticipantSessionIds(conflict)) ids.add(sessionId);
	}
	return ids;
}

export type HutaoConflictEditRole = "conflict" | "skipped" | "resolution";

export interface HutaoConflictEditRoleConfig {
	role: HutaoConflictEditRole;
	field: "conflict_edits" | "skipped_edits" | "resolution_edits";
	label: string;
	order: number;
}

export const conflictEditRoleConfigs: HutaoConflictEditRoleConfig[] = [
	{ role: "conflict", field: "conflict_edits", label: "Conflicting edit", order: 30 },
	{ role: "skipped", field: "skipped_edits", label: "Skipped edit", order: 40 },
	{ role: "resolution", field: "resolution_edits", label: "Resolution edit", order: 50 },
];

export function conflictRelatedEditIds(conflict: HutaoEvent): string[] {
	const ids = new Set<string>();
	for (const config of conflictEditRoleConfigs) {
		for (const editId of stringArray(conflict[config.field])) ids.add(editId);
	}
	return [...ids];
}
