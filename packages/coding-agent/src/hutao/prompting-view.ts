import type { HutaoEvent } from "./event-store.ts";
import { forkSourceId, forkSourceType } from "./process-tree/fork-model.ts";
import { firstLine, shortId } from "./process-tree/helpers.ts";
import { getEditsForPrompting, getRunsForPrompting, stringArray } from "./trace-relations.ts";

export interface PromptingSessionViewOptions {
	currentSessionId?: string;
	sessionFilter?: string;
	allMode?: boolean;
	limit?: number;
	promptings?: HutaoEvent[];
}

export interface PromptingSessionViewItem {
	prompting: HutaoEvent;
	forks: HutaoEvent[];
	merges: HutaoEvent[];
	runs: HutaoEvent[];
	edits: HutaoEvent[];
}

export interface PromptingSessionView {
	sessionId?: string;
	scope: "current_session" | "filtered_session" | "all_promptings";
	promptings: HutaoEvent[];
	items: PromptingSessionViewItem[];
	allPromptings: HutaoEvent[];
}

function eventId(event: HutaoEvent): string {
	return String(event.id ?? "");
}

function eventSessionId(event: HutaoEvent): string {
	return String(event.session_id ?? "");
}

function forkReferencesPrompting(fork: HutaoEvent, prompting: HutaoEvent, events: HutaoEvent[]): boolean {
	const promptingId = eventId(prompting);
	if (!promptingId) return false;
	const sourceType = String(forkSourceType(fork));
	const sourceId = forkSourceId(fork);
	if (sourceType === "prompting" && sourceId === promptingId) return true;
	if (sourceType !== "edit" || !sourceId) return false;
	const sourceEdit = events.find((event) => event.type === "edit" && eventId(event) === sourceId);
	return String(sourceEdit?.parent_prompting ?? "") === promptingId;
}

function mergeReferencesPrompting(merge: HutaoEvent, prompting: HutaoEvent, events: HutaoEvent[]): boolean {
	const promptingId = eventId(prompting);
	if (!promptingId) return false;
	if (stringArray(merge.imported_promptings).includes(promptingId)) return true;
	return promptingIdsFromMergeEditRefs(merge, events).includes(promptingId);
}

function resolveDefaultSessionId(promptings: HutaoEvent[], options: PromptingSessionViewOptions): string | undefined {
	if (options.sessionFilter || options.allMode) return undefined;
	if (options.currentSessionId) return options.currentSessionId;
	return eventSessionId(promptings[promptings.length - 1] ?? {}) || undefined;
}

export function buildPromptingSessionView(
	events: HutaoEvent[],
	options: PromptingSessionViewOptions = {},
): PromptingSessionView {
	const allPromptings = options.promptings ?? events.filter((event) => event.type === "prompting");
	let promptings = allPromptings;
	let scope: PromptingSessionView["scope"] = "all_promptings";
	let sessionId: string | undefined;

	if (options.sessionFilter) {
		promptings = allPromptings.filter((event) => eventSessionId(event).startsWith(options.sessionFilter ?? ""));
		sessionId = options.sessionFilter;
		scope = "filtered_session";
	} else {
		const defaultSessionId = resolveDefaultSessionId(allPromptings, options);
		if (defaultSessionId) {
			promptings = allPromptings.filter((event) => eventSessionId(event) === defaultSessionId);
			sessionId = defaultSessionId;
			scope = "current_session";
		}
	}

	const limited = options.limit && options.limit > 0 ? promptings.slice(-options.limit) : promptings;
	const items = limited.map((prompting) => {
		const promptingId = eventId(prompting);
		return {
			prompting,
			forks: events.filter(
				(event) => event.type === "fork_session" && forkReferencesPrompting(event, prompting, events),
			),
			merges: events.filter((event) => event.type === "merge" && mergeReferencesPrompting(event, prompting, events)),
			runs: getRunsForPrompting(events, promptingId),
			edits: getEditsForPrompting(events, promptingId),
		};
	});

	return { sessionId, scope, promptings: limited, items, allPromptings };
}

function forkSummary(fork: HutaoEvent): string {
	const mode = String(fork.fork_mode ?? "unknown");
	const sessionId = String(fork.session_id ?? fork.id ?? "");
	return `${shortId(sessionId)} ${mode}`;
}

function mergeSummary(merge: HutaoEvent): string {
	return `${shortId(merge.id)} ${String(merge.mode ?? "unknown")} ${String(merge.status ?? "unknown")}`;
}

export function renderPromptingSessionViewLabel(item: PromptingSessionViewItem): string {
	const prompting = item.prompting;
	const parts = [
		shortId(prompting.id),
		String(prompting.created_at ?? ""),
		firstLine(prompting.text),
		`runs=${item.runs.length}`,
		`edits=${item.edits.length}`,
	];
	if (item.forks.length > 0) parts.push(`forks=${item.forks.map(forkSummary).join("|")}`);
	if (item.merges.length > 0) parts.push(`merges=${item.merges.map(mergeSummary).join("|")}`);
	return parts.filter(Boolean).join(" ").slice(0, 240);
}

export function renderPromptingSessionViewEmptyLines(view: PromptingSessionView): string[] {
	if (view.scope === "current_session" && view.sessionId) {
		return [
			`No promptings found in current session ${view.sessionId}.`,
			"Use /prompting --all to list all repository promptings or /session to switch/resume a session.",
		];
	}
	if (view.scope === "filtered_session" && view.sessionId) {
		return [`No promptings found for session filter ${view.sessionId}.`];
	}
	return ["No promptings found."];
}

export function renderPromptingSessionViewHeader(view: PromptingSessionView): string[] {
	const scopeLabel =
		view.scope === "current_session"
			? `Current session: ${view.sessionId}`
			: view.scope === "filtered_session"
				? `Filtered session: ${view.sessionId}`
				: "All repository promptings";
	return [
		scopeLabel,
		`promptings: ${view.promptings.length}`,
		"forkSessions are shown as lightweight references; use /prompting --tree for the full causality tree.",
	];
}

export function promptingIdsFromMergeEditRefs(merge: HutaoEvent, events: HutaoEvent[]): string[] {
	const editIds = new Set([
		...stringArray(merge.imported_edits),
		...stringArray(merge.applied_edits),
		...stringArray(merge.conflict_edits),
		...stringArray(merge.skipped_edits),
		...stringArray(merge.resolution_edits),
	]);
	return events
		.filter((event) => event.type === "edit" && editIds.has(eventId(event)))
		.map((event) => String(event.parent_prompting ?? ""))
		.filter(Boolean);
}
