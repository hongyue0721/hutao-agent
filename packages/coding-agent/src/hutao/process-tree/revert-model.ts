import type { HutaoEvent } from "../event-store.ts";
import { stringArray } from "./helpers.ts";
import type { HutaoProcessTreeBuildContext } from "./types.ts";

export function getRevertEvents(events: HutaoEvent[]): HutaoEvent[] {
	return events.filter((event) => event.type === "edit_reverted");
}

function stringField(event: HutaoEvent | undefined, field: string): string {
	const value = event?.[field];
	return typeof value === "string" ? value : "";
}

function editById(events: HutaoEvent[], id: string): HutaoEvent | undefined {
	return events.find((event) => event.type === "edit" && String(event.id) === id);
}

function visiblePromptingSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	return new Set(
		context.promptings.map((event) => String(event.session_id ?? "")).filter((sessionId) => sessionId.length > 0),
	);
}

function hasAnyPromptings(context: HutaoProcessTreeBuildContext): boolean {
	return context.events.some((event) => event.type === "prompting");
}

export function revertedEditId(revert: HutaoEvent): string {
	return stringField(revert, "edit_id");
}

export function revertEditId(revert: HutaoEvent): string {
	return stringField(revert, "revert_edit_id");
}

export function revertParticipantSessionIds(revert: HutaoEvent, events: HutaoEvent[]): string[] {
	const original = editById(events, revertedEditId(revert));
	const revertEdit = editById(events, revertEditId(revert));
	return [
		stringField(revert, "session_id"),
		stringField(original, "session_id"),
		stringField(revertEdit, "session_id"),
	]
		.filter(Boolean)
		.filter((id, index, ids) => ids.indexOf(id) === index);
}

export function primaryRevertSessionId(revert: HutaoEvent, events: HutaoEvent[]): string {
	return revertParticipantSessionIds(revert, events)[0] ?? "";
}

export function revertTouchesVisiblePromptings(revert: HutaoEvent, context: HutaoProcessTreeBuildContext): boolean {
	const visibleSessions = visiblePromptingSessionIds(context);
	if (visibleSessions.size === 0) return !hasAnyPromptings(context);
	return revertParticipantSessionIds(revert, context.events).some((sessionId) => visibleSessions.has(sessionId));
}

export function getVisibleRevertEvents(context: HutaoProcessTreeBuildContext): HutaoEvent[] {
	return getRevertEvents(context.events).filter((revert) => revertTouchesVisiblePromptings(revert, context));
}

export function revertVisibleSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	const ids = visiblePromptingSessionIds(context);
	for (const revert of getVisibleRevertEvents(context)) {
		for (const sessionId of revertParticipantSessionIds(revert, context.events)) ids.add(sessionId);
	}
	return ids;
}

export function revertRelatedEditIds(revert: HutaoEvent): string[] {
	return [revertedEditId(revert), revertEditId(revert)].filter(Boolean);
}

export function editSummary(edit: HutaoEvent | undefined): string {
	if (!edit) return "missing edit event";
	return stringArray(edit.files).join(", ") || String(edit.summary ?? "no files");
}
