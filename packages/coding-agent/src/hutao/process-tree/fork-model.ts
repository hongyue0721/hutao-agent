import type { HutaoEvent } from "../event-store.ts";
import type { HutaoProcessTreeBuildContext } from "./types.ts";

export type HutaoForkSourceType = "prompting" | "edit" | "commit" | "session" | (string & {});

export function getForkEvents(events: HutaoEvent[]): HutaoEvent[] {
	return events.filter((event) => event.type === "fork_session");
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

export function forkSessionId(fork: HutaoEvent): string {
	return stringField(fork, "session_id") || String(fork.id ?? "");
}

export function forkParentSessionId(fork: HutaoEvent): string {
	return stringField(fork, "parent_session");
}

export function forkSourceType(fork: HutaoEvent): HutaoForkSourceType {
	return stringField(fork, "fork_from_type") || "unknown";
}

export function forkSourceId(fork: HutaoEvent): string {
	return stringField(fork, "fork_from_id");
}

export function forkParticipantSessionIds(fork: HutaoEvent): string[] {
	return [forkParentSessionId(fork), forkSessionId(fork)]
		.filter(Boolean)
		.filter((id, index, ids) => ids.indexOf(id) === index);
}

function anchorSessionId(fork: HutaoEvent, events: HutaoEvent[]): string {
	const type = forkSourceType(fork);
	const sourceId = forkSourceId(fork);
	if (!sourceId) return "";
	if (type === "session") return sourceId;
	if (type === "prompting") {
		return stringField(
			events.find((event) => event.type === "prompting" && String(event.id) === sourceId),
			"session_id",
		);
	}
	if (type === "edit") {
		const edit = events.find((event) => event.type === "edit" && String(event.id) === sourceId);
		return stringField(edit, "session_id");
	}
	return "";
}

export function forkTouchesVisiblePromptings(fork: HutaoEvent, context: HutaoProcessTreeBuildContext): boolean {
	const visibleSessions = visiblePromptingSessionIds(context);
	if (visibleSessions.size === 0) return !hasAnyPromptings(context);
	return [...forkParticipantSessionIds(fork), anchorSessionId(fork, context.events)].some((sessionId) =>
		visibleSessions.has(sessionId),
	);
}

export function getVisibleForkEvents(context: HutaoProcessTreeBuildContext): HutaoEvent[] {
	return getForkEvents(context.events).filter((fork) => forkTouchesVisiblePromptings(fork, context));
}

export function forkVisibleSessionIds(context: HutaoProcessTreeBuildContext): Set<string> {
	const ids = visiblePromptingSessionIds(context);
	for (const fork of getVisibleForkEvents(context)) {
		for (const sessionId of forkParticipantSessionIds(fork)) ids.add(sessionId);
		const anchorSession = anchorSessionId(fork, context.events);
		if (anchorSession) ids.add(anchorSession);
	}
	return ids;
}
