import type { HutaoEvent } from "./event-store.ts";
import { forkSessionId, forkSourceId, forkSourceType } from "./process-tree/fork-model.ts";
import { revertRelatedEditIds } from "./process-tree/revert-model.ts";
import { stringArray } from "./trace-relations.ts";

export type HutaoCommitLinkConfidence = "high" | "medium" | "low" | "unknown";

export interface HutaoCommitLinkEvidence {
	link: HutaoEvent;
	method: string;
	confidence: HutaoCommitLinkConfidence;
	reason: string;
	confirmed: boolean;
}

export interface HutaoGitProjectionRelations {
	merges: HutaoEvent[];
	forks: HutaoEvent[];
	reverts: HutaoEvent[];
	conflicts: HutaoEvent[];
}

export interface HutaoGitProjection {
	links: HutaoEvent[];
	evidence: HutaoCommitLinkEvidence[];
	promptingIds: Set<string>;
	runIds: Set<string>;
	editIds: Set<string>;
	sessionIds: Set<string>;
	relations: HutaoGitProjectionRelations;
	hasCommitLink: boolean;
}

const mergeEditFields = [
	"imported_edits",
	"applied_edits",
	"conflict_edits",
	"skipped_edits",
	"resolution_edits",
] as const;

function stringField(event: HutaoEvent | undefined, field: string): string {
	const value = event?.[field];
	return typeof value === "string" ? value : "";
}

function uniqueEvents(events: HutaoEvent[]): HutaoEvent[] {
	const seen = new Set<string>();
	const result: HutaoEvent[] = [];
	for (const event of events) {
		const id = String(event.id ?? "");
		const key = `${event.type}:${id}`;
		if (!id || seen.has(key)) continue;
		seen.add(key);
		result.push(event);
	}
	return result;
}

function intersects(values: Iterable<string>, ids: Set<string>): boolean {
	for (const value of values) {
		if (ids.has(value)) return true;
	}
	return false;
}

function mergeRelatedEditIds(merge: HutaoEvent): string[] {
	const ids = new Set<string>();
	for (const field of mergeEditFields) {
		for (const id of stringArray(merge[field])) ids.add(id);
	}
	return [...ids];
}

function mergeHasConflictState(merge: HutaoEvent): boolean {
	return (
		String(merge.status ?? "") === "conflict" ||
		stringArray(merge.conflict_edits).length > 0 ||
		stringArray(merge.skipped_edits).length > 0
	);
}

function confidenceForMethod(method: string): HutaoCommitLinkConfidence {
	if (method === "explicit_command" || method === "observed_git_commit" || method === "manual") return "high";
	if (method === "patch_match") return "medium";
	if (method === "file_time_hint") return "low";
	return "unknown";
}

function reasonForMethod(method: string): string {
	if (method === "explicit_command") return "explicit command linked this commit to Hutao facts";
	if (method === "observed_git_commit") return "Hutao observed an agent/tool git commit transition";
	if (method === "manual") return "user manually linked this commit to Hutao facts";
	if (method === "patch_match") return "commit patch appears to match linked edit patch evidence";
	if (method === "file_time_hint") return "nearby file/time signal only; do not treat as confirmed provenance";
	return "existing commit_link event has no recognized link_method";
}

export function commitLinkEvidence(link: HutaoEvent): HutaoCommitLinkEvidence {
	const method = String(link.link_method ?? "unknown");
	const confidence = confidenceForMethod(method);
	return {
		link,
		method,
		confidence,
		reason: reasonForMethod(method),
		confirmed: confidence === "high",
	};
}

export function applyTreeDisplayLabel(mode: unknown): string {
	return mode === "apply_tree" ? "apply_tree (Apply Final Snapshot / snapshot-diff apply)" : String(mode ?? "unknown");
}

export function buildGitCommitProjection(events: HutaoEvent[], commit: string, query = commit): HutaoGitProjection {
	const links = events.filter(
		(event) => event.type === "commit_link" && (String(event.commit) === commit || String(event.commit).startsWith(query)),
	);
	const evidence = links.map(commitLinkEvidence);
	const promptingIds = new Set(links.flatMap((event) => stringArray(event.prompting_ids)));
	const runIds = new Set(links.flatMap((event) => stringArray(event.run_ids)));
	const editIds = new Set(links.flatMap((event) => stringArray(event.edit_ids)));
	const sessionIds = new Set(links.map((event) => stringField(event, "session_id")).filter(Boolean));

	for (const event of events) {
		if (event.type === "prompting" && promptingIds.has(String(event.id))) sessionIds.add(stringField(event, "session_id"));
		if ((event.type === "run_finished" || event.type === "run_started") && runIds.has(String(event.id))) {
			const parentPrompting = stringField(event, "parent_prompting");
			if (parentPrompting) promptingIds.add(parentPrompting);
			sessionIds.add(stringField(event, "session_id"));
		}
		if (event.type === "edit" && editIds.has(String(event.id))) {
			const parentPrompting = stringField(event, "parent_prompting");
			const parentRun = stringField(event, "parent_run");
			if (parentPrompting) promptingIds.add(parentPrompting);
			if (parentRun) runIds.add(parentRun);
			sessionIds.add(stringField(event, "session_id"));
		}
	}

	const merges = uniqueEvents(
		events.filter((event) => event.type === "merge" && intersects(mergeRelatedEditIds(event), editIds)),
	);
	const conflicts = uniqueEvents(merges.filter(mergeHasConflictState));
	const reverts = uniqueEvents(
		events.filter((event) => event.type === "edit_reverted" && intersects(revertRelatedEditIds(event), editIds)),
	);
	const forks = uniqueEvents(
		events.filter((event) => {
			if (event.type !== "fork_session") return false;
			const sourceId = forkSourceId(event);
			const sourceType = forkSourceType(event);
			return (
				sessionIds.has(forkSessionId(event)) ||
				(sourceType === "prompting" && promptingIds.has(sourceId)) ||
				(sourceType === "edit" && editIds.has(sourceId)) ||
				(sourceType === "commit" && Boolean(sourceId) && (commit.startsWith(sourceId) || sourceId.startsWith(query)))
			);
		}),
	);

	return {
		links,
		evidence,
		promptingIds,
		runIds,
		editIds,
		sessionIds,
		relations: { merges, forks, reverts, conflicts },
		hasCommitLink: links.length > 0,
	};
}
