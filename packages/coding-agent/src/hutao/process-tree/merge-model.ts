import type { HutaoEvent } from "../event-store.ts";
import { stringArray } from "./helpers.ts";
import type { HutaoProcessTreeBuildContext } from "./types.ts";

export type HutaoMergeEditRole = "imported" | "applied" | "conflict" | "skipped" | "resolution";

export interface HutaoMergeEditRoleConfig {
	role: HutaoMergeEditRole;
	field: "imported_edits" | "applied_edits" | "conflict_edits" | "skipped_edits" | "resolution_edits";
	label: string;
	order: number;
}

export const mergeEditRoleConfigs: HutaoMergeEditRoleConfig[] = [
	{ role: "imported", field: "imported_edits", label: "Imported edit", order: 30 },
	{ role: "applied", field: "applied_edits", label: "Applied edit", order: 40 },
	{ role: "conflict", field: "conflict_edits", label: "Conflict edit", order: 50 },
	{ role: "skipped", field: "skipped_edits", label: "Skipped edit", order: 60 },
	{ role: "resolution", field: "resolution_edits", label: "Resolution edit", order: 70 },
];

export function getMergeEvents(events: HutaoEvent[]): HutaoEvent[] {
	return events.filter((event) => event.type === "merge");
}

function stringField(event: HutaoEvent, field: string): string {
	const value = event[field];
	return typeof value === "string" ? value : "";
}

export function mergeParticipantSessionIds(merge: HutaoEvent): string[] {
	return [stringField(merge, "target_session"), stringField(merge, "session_id"), stringField(merge, "source_session")]
		.filter(Boolean)
		.filter((id, index, ids) => ids.indexOf(id) === index);
}

export function primaryMergeSessionId(merge: HutaoEvent): string {
	return (
		stringField(merge, "target_session") || stringField(merge, "session_id") || stringField(merge, "source_session")
	);
}

function visiblePromptingSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	return new Set(
		context.promptings.map((event) => String(event.session_id ?? "")).filter((sessionId) => sessionId.length > 0),
	);
}

function hasAnyPromptings(context: HutaoProcessTreeBuildContext): boolean {
	return context.events.some((event) => event.type === "prompting");
}

export function mergeTouchesVisiblePromptings(merge: HutaoEvent, context: HutaoProcessTreeBuildContext): boolean {
	const visibleSessions = visiblePromptingSessionIds(context);
	if (visibleSessions.size === 0) return !hasAnyPromptings(context);
	return mergeParticipantSessionIds(merge).some((sessionId) => visibleSessions.has(sessionId));
}

export function getVisibleMergeEvents(context: HutaoProcessTreeBuildContext): HutaoEvent[] {
	return getMergeEvents(context.events).filter((merge) => mergeTouchesVisiblePromptings(merge, context));
}

export function mergeVisibleSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	const ids = visiblePromptingSessionIds(context);
	for (const merge of getVisibleMergeEvents(context)) {
		for (const sessionId of mergeParticipantSessionIds(merge)) ids.add(sessionId);
	}
	return ids;
}

export function mergePrimaryRelationEditIds(merge: HutaoEvent): Set<string> {
	const ids = new Set<string>();
	for (const config of mergeEditRoleConfigs.filter((config) => config.role !== "imported")) {
		for (const editId of stringArray(merge[config.field])) ids.add(editId);
	}
	return ids;
}
