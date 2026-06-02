import { conflictVisibleSessionIds, getConflictEvents } from "../conflict-model.ts";
import { forkVisibleSessionIds } from "../fork-model.ts";
import { processTreeNodeId, shortId } from "../helpers.ts";
import { mergeVisibleSessionIds } from "../merge-model.ts";
import { revertVisibleSessionIds } from "../revert-model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

export const sessionContributor: HutaoProcessTreeContributor = {
	kind: "session",
	collect(context): HutaoProcessTreeNode[] {
		const sessionIds = new Set([
			...mergeVisibleSessionIds(context),
			...forkVisibleSessionIds(context),
			...revertVisibleSessionIds(context),
			...conflictVisibleSessionIds(context),
		]);
		const knownSessions = context.sessions.filter((session) => sessionIds.has(session.id));
		const orphanSessionIds = [...sessionIds].filter(
			(id) => id && !knownSessions.some((session) => session.id === id),
		);
		const sessionEntries = [
			...knownSessions.map((session) => ({ id: session.id, kind: session.kind, status: session.status })),
			...orphanSessionIds.map((id) => ({ id, kind: "session", status: "unknown" })),
		];
		return sessionEntries
			.filter((session) => sessionIds.has(session.id))
			.map((session, order) => {
				const sessionPromptings = context.promptings.filter((event) => event.session_id === session.id);
				const sessionMerges = context.events.filter(
					(event) =>
						event.type === "merge" &&
						(event.session_id === session.id ||
							event.target_session === session.id ||
							event.source_session === session.id),
				);
				const sessionForks = context.events.filter(
					(event) =>
						event.type === "fork_session" &&
						(event.session_id === session.id || event.parent_session === session.id),
				);
				const sessionReverts = context.events.filter((event) => {
					if (event.type !== "edit_reverted") return false;
					const original = context.events.find(
						(candidate) => candidate.type === "edit" && candidate.id === event.edit_id,
					);
					const revertEdit = context.events.find(
						(candidate) => candidate.type === "edit" && candidate.id === event.revert_edit_id,
					);
					return (
						event.session_id === session.id ||
						original?.session_id === session.id ||
						revertEdit?.session_id === session.id
					);
				});
				const sessionConflicts = getConflictEvents(context.events).filter(
					(event) =>
						event.session_id === session.id ||
						event.target_session === session.id ||
						event.source_session === session.id,
				);
				return {
					kind: "session",
					id: session.id,
					nodeId: processTreeNodeId("session", session.id),
					label: `Session ${shortId(session.id)} ${session.kind} ${session.status} promptings=${sessionPromptings.length} forks=${sessionForks.length} merges=${sessionMerges.length} reverts=${sessionReverts.length} conflicts=${sessionConflicts.length}`,
					depth: 0,
					order,
				};
			});
	},
};
