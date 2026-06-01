import type { HutaoEvent } from "../event-store.ts";

export type SubagentEventType =
	| "subagent"
	| "subagent_started"
	| "subagent_finished"
	| "subagent_message"
	| "subagent_tool_call"
	| "subagent_tool_result"
	| "subagent_run_linked"
	| "subagent_edit_linked"
	| "subagent_failed";

export type SubagentStatus = "started" | "completed" | "failed" | "unknown";

export interface SubagentRecord {
	id: string;
	sessionId: string;
	parentPrompting?: string;
	parentRun?: string;
	name: string;
	role?: string;
	task?: string;
	status: SubagentStatus;
	summary?: string;
	runIds: string[];
	editIds: string[];
	messageIds: string[];
	startedAt?: string;
	endedAt?: string;
	degraded: boolean;
	event: HutaoEvent;
}

export function isSubagentEvent(event: HutaoEvent): boolean {
	return event.type === "subagent" || event.type === "subagent_started" || event.type === "subagent_finished";
}
