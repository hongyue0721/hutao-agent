import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionEntry, SessionHeader } from "../core/session-manager.ts";
import { loadEntriesFromFile } from "../core/session-manager.ts";
import type { HutaoEvent } from "./event-store.ts";
import { readAllEvents } from "./read-model.ts";

export type ConversationStatus = "complete" | "degraded" | "missing";

export interface ConversationTraceLinks {
	promptingIds: string[];
	runIds: string[];
	editIds: string[];
	toolCallIds: string[];
	eventIds: string[];
}

export interface ConversationTimelineItem {
	entry: SessionEntry;
	links: ConversationTraceLinks;
}

export interface ConversationSnapshot {
	sessionId: string;
	status: ConversationStatus;
	reason?: string;
	nativeSessionPath?: string;
	header?: SessionHeader;
	items: ConversationTimelineItem[];
	events: HutaoEvent[];
}

function unique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function nativeSessionPath(repoRoot: string, sessionId: string): string {
	return join(repoRoot, ".hutao", "sessions", sessionId, "native-session.jsonl");
}

function readHeader(path: string): SessionHeader | undefined {
	const header = loadEntriesFromFile(path).find((entry) => entry.type === "session");
	return header?.type === "session" ? header : undefined;
}

function relatedToolCallIds(entry: SessionEntry): string[] {
	if (entry.type !== "message") return [];
	const message = entry.message as unknown as Record<string, unknown>;
	const direct = stringValue(message.toolCallId);
	const content = Array.isArray(message.content) ? message.content : [];
	const fromBlocks = content
		.map((block) => (block && typeof block === "object" ? stringValue((block as Record<string, unknown>).id) : undefined))
		.filter((id): id is string => Boolean(id));
	return unique([direct, ...fromBlocks]);
}

function linksForEntry(entry: SessionEntry, events: HutaoEvent[]): ConversationTraceLinks {
	const links = events.filter((event) => event.type === "native_entry_link" && event.native_entry_id === entry.id);
	const toolCallIds = unique([...links.map((event) => stringValue(event.tool_call_id)), ...relatedToolCallIds(entry)]);
	const runIds = unique([
		...links.map((event) => stringValue(event.related_run)),
		...events
			.filter((event) =>
				(event.type === "run_started" || event.type === "run_finished") &&
				toolCallIds.includes(String(event.tool_call_id ?? "")),
			)
			.map((event) => stringValue(event.id)),
	]);
	const promptingIds = unique([
		...links.map((event) => stringValue(event.related_prompting)),
		...runIds.flatMap((runId) =>
			events
				.filter((event) =>
					(event.type === "run_started" || event.type === "run_finished") && String(event.id) === runId,
				)
				.map((event) => stringValue(event.parent_prompting)),
		),
	]);
	const editIds = unique([
		...links.map((event) => stringValue(event.related_edit)),
		...events
			.filter(
				(event) =>
					event.type === "edit" &&
					(runIds.includes(String(event.parent_run ?? "")) ||
						promptingIds.includes(String(event.parent_prompting ?? ""))),
			)
			.map((event) => stringValue(event.id)),
		...events
			.filter((event) => event.type === "run_finished" && runIds.includes(String(event.id)))
			.flatMap((event) => stringArray(event.produced_edit_ids)),
	]);
	return {
		promptingIds,
		runIds,
		editIds,
		toolCallIds,
		eventIds: unique(links.map((event) => stringValue(event.id))),
	};
}

export class ConversationStore {
	private readonly repoRoot: string;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
	}

	load(sessionId: string): ConversationSnapshot {
		const path = nativeSessionPath(this.repoRoot, sessionId);
		const events = readAllEvents(this.repoRoot).filter((event) => event.session_id === sessionId);
		if (!existsSync(path)) {
			const rawPath = join(this.repoRoot, ".hutao", "sessions", sessionId, "raw.jsonl");
			return {
				sessionId,
				status: existsSync(rawPath) ? "degraded" : "missing",
				reason: existsSync(rawPath)
					? "native-session.jsonl is missing; raw evidence exists but cannot be rendered as full chat history."
					: "native-session.jsonl is missing.",
				nativeSessionPath: path,
				items: [],
				events,
			};
		}
		const entries = loadEntriesFromFile(path);
		const header = readHeader(path);
		const nativeEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
		return {
			sessionId,
			status: nativeEntries.length > 0 ? "complete" : "degraded",
			reason: nativeEntries.length > 0 ? undefined : "native-session.jsonl contains no conversation entries.",
			nativeSessionPath: path,
			header,
			items: nativeEntries.map((entry) => ({ entry, links: linksForEntry(entry, events) })),
			events,
		};
	}

	readRawEvidenceLineCount(sessionId: string): number {
		const rawPath = join(this.repoRoot, ".hutao", "sessions", sessionId, "raw.jsonl");
		if (!existsSync(rawPath)) return 0;
		return readFileSync(rawPath, "utf-8")
			.split(/\r?\n/)
			.filter((line) => line.trim()).length;
	}
}
