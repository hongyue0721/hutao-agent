import { firstLine, processTreeNodeId, shortId, stringArray } from "../helpers.ts";
import { getVisibleMergeEvents, mergeEditRoleConfigs, primaryMergeSessionId } from "../merge-model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function mergeLabel(merge: Record<string, unknown>): string {
	const imported = stringArray(merge.imported_edits).length;
	const applied = stringArray(merge.applied_edits).length;
	const conflicts = stringArray(merge.conflict_edits).length;
	const skipped = stringArray(merge.skipped_edits).length;
	const resolutions = stringArray(merge.resolution_edits).length;
	const source = shortId(merge.source_session);
	const target = shortId(merge.target_session ?? merge.session_id);
	return [
		`Merge ${shortId(merge.id)}`,
		String(merge.mode ?? "unknown"),
		String(merge.status ?? "unknown"),
		`source=${source || "none"}`,
		`target=${target || "none"}`,
		`imported=${imported}`,
		`applied=${applied}`,
		`conflicts=${conflicts}`,
		`skipped=${skipped}`,
		`resolutions=${resolutions}`,
	]
		.filter(Boolean)
		.join(" ");
}

function sessionNode(
	mergeId: unknown,
	role: "source" | "target",
	sessionId: unknown,
	order: number,
): HutaoProcessTreeNode | undefined {
	const id = String(sessionId ?? "");
	if (!id) return undefined;
	return {
		kind: "session",
		id,
		nodeId: processTreeNodeId("merge-session", `${mergeId}:${role}:${id}`),
		parentNodeId: processTreeNodeId("merge", mergeId),
		label: `${role === "source" ? "Source" : "Target"} session ${shortId(id)}`,
		depth: 2,
		order,
	};
}

function editLabel(prefix: string, edit: Record<string, unknown>): string {
	return `${prefix} ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`;
}

export const mergeContributor: HutaoProcessTreeContributor = {
	kind: "merge",
	collect(context): HutaoProcessTreeNode[] {
		const editsById = new Map(
			context.events.filter((event) => event.type === "edit").map((edit) => [String(edit.id), edit]),
		);
		const nodes: HutaoProcessTreeNode[] = [];
		for (const [mergeIndex, merge] of getVisibleMergeEvents(context).entries()) {
			const mergeId = String(merge.id);
			const parentSession = primaryMergeSessionId(merge);
			nodes.push({
				kind: "merge",
				id: mergeId,
				nodeId: processTreeNodeId("merge", mergeId),
				parentNodeId: parentSession ? processTreeNodeId("session", parentSession) : undefined,
				label: mergeLabel(merge),
				depth: parentSession ? 1 : 0,
				event: merge,
				order: 9000 + mergeIndex,
			});

			const source = sessionNode(mergeId, "source", merge.source_session, 10);
			const target = sessionNode(mergeId, "target", merge.target_session ?? merge.session_id, 20);
			if (source) nodes.push(source);
			if (target && target.id !== source?.id) nodes.push(target);

			for (const config of mergeEditRoleConfigs) {
				for (const [editIndex, editId] of stringArray(merge[config.field]).entries()) {
					const edit = editsById.get(editId);
					nodes.push({
						kind: "edit",
						id: editId,
						nodeId: processTreeNodeId("merge-edit", `${mergeId}:${config.role}:${editId}`),
						parentNodeId: processTreeNodeId("merge", mergeId),
						label: edit
							? editLabel(config.label, edit)
							: `${config.label} ${shortId(editId)} [missing edit event]`,
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
