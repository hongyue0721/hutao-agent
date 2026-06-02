import {
	conflictEditRoleConfigs,
	conflictSourceSessionId,
	conflictTargetSessionId,
	getVisibleConflictEvents,
	primaryConflictSessionId,
} from "../conflict-model.ts";
import { firstLine, processTreeNodeId, shortId, stringArray } from "../helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function conflictLabel(conflict: Record<string, unknown>): string {
	const conflicts = stringArray(conflict.conflict_edits).length;
	const skipped = stringArray(conflict.skipped_edits).length;
	const resolutions = stringArray(conflict.resolution_edits).length;
	const source = shortId(conflict.source_session);
	const target = shortId(conflict.target_session ?? conflict.session_id);
	return [
		`Conflict ${shortId(conflict.id)}`,
		String(conflict.mode ?? "unknown"),
		String(conflict.status ?? "unknown"),
		`source=${source || "none"}`,
		`target=${target || "none"}`,
		`conflicts=${conflicts}`,
		`skipped=${skipped}`,
		`resolutions=${resolutions}`,
	]
		.filter(Boolean)
		.join(" ");
}

function sessionNode(
	conflictId: string,
	role: "source" | "target",
	sessionId: unknown,
	order: number,
): HutaoProcessTreeNode | undefined {
	const id = String(sessionId ?? "");
	if (!id) return undefined;
	return {
		kind: "session",
		id,
		nodeId: processTreeNodeId("conflict-session", `${conflictId}:${role}:${id}`),
		parentNodeId: processTreeNodeId("conflict", conflictId),
		label: `${role === "source" ? "Source" : "Target"} session ${shortId(id)}`,
		depth: 2,
		order,
	};
}

function editLabel(prefix: string, edit: Record<string, unknown> | undefined, editId: string): string {
	if (!edit) return `${prefix} ${shortId(editId)} [missing edit event]`;
	return `${prefix} ${shortId(editId)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`;
}

export const conflictContributor: HutaoProcessTreeContributor = {
	kind: "conflict",
	collect(context): HutaoProcessTreeNode[] {
		const editsById = new Map(
			context.events.filter((event) => event.type === "edit").map((edit) => [String(edit.id), edit]),
		);
		const nodes: HutaoProcessTreeNode[] = [];
		for (const [conflictIndex, conflict] of getVisibleConflictEvents(context).entries()) {
			const conflictId = String(conflict.id);
			const parentSession = primaryConflictSessionId(conflict);
			nodes.push({
				kind: "conflict",
				id: conflictId,
				nodeId: processTreeNodeId("conflict", conflictId),
				parentNodeId: parentSession ? processTreeNodeId("session", parentSession) : undefined,
				label: conflictLabel(conflict),
				depth: parentSession ? 1 : 0,
				event: conflict,
				order: 8800 + conflictIndex,
			});

			const source = sessionNode(conflictId, "source", conflictSourceSessionId(conflict), 10);
			const target = sessionNode(conflictId, "target", conflictTargetSessionId(conflict), 20);
			if (source) nodes.push(source);
			if (target && target.id !== source?.id) nodes.push(target);
			nodes.push({
				kind: "merge",
				id: conflictId,
				nodeId: processTreeNodeId("conflict-merge", conflictId),
				parentNodeId: processTreeNodeId("conflict", conflictId),
				label: `Merge event ${shortId(conflictId)} ${String(conflict.mode ?? "unknown")} ${String(
					conflict.status ?? "unknown",
				)}`,
				depth: 2,
				event: conflict,
				order: 25,
			});

			for (const config of conflictEditRoleConfigs) {
				for (const [editIndex, editId] of stringArray(conflict[config.field]).entries()) {
					const edit = editsById.get(editId);
					nodes.push({
						kind: "edit",
						id: editId,
						nodeId: processTreeNodeId("conflict-edit", `${conflictId}:${config.role}:${editId}`),
						parentNodeId: processTreeNodeId("conflict", conflictId),
						label: editLabel(config.label, edit, editId),
						depth: 2,
						event: edit,
						order: config.order * 1000 + editIndex,
					});
				}
			}
		}
		return nodes;
	},
};
