import type { HutaoEvent } from "../../event-store.ts";
import { processTreeNodeId, shortId } from "../helpers.ts";
import {
	editSummary,
	getVisibleRevertEvents,
	primaryRevertSessionId,
	revertEditId,
	revertedEditId,
} from "../revert-model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function revertLabel(revert: Record<string, unknown>): string {
	const original = shortId(revert.edit_id);
	const revertEdit = shortId(revert.revert_edit_id);
	return [
		`Revert ${shortId(revert.id)}`,
		original ? `original=${original}` : "original=unknown",
		revertEdit ? `revert_edit=${revertEdit}` : "revert_edit=unknown",
	]
		.filter(Boolean)
		.join(" ");
}

function editNode(
	revertId: string,
	role: "original" | "revert",
	editId: string,
	edit: HutaoEvent | undefined,
	order: number,
): HutaoProcessTreeNode | undefined {
	if (!editId) return undefined;
	return {
		kind: "edit",
		id: editId,
		nodeId: processTreeNodeId("revert-edit", `${revertId}:${role}:${editId}`),
		parentNodeId: processTreeNodeId("revert", revertId),
		label: `${role === "original" ? "Original edit" : "Revert edit"} ${shortId(editId)} ${
			edit ? editSummary(edit) : "[missing edit event]"
		}`,
		depth: 2,
		event: edit,
		order,
	};
}

export const revertContributor: HutaoProcessTreeContributor = {
	kind: "revert",
	collect(context): HutaoProcessTreeNode[] {
		const editsById = new Map(
			context.events.filter((event) => event.type === "edit").map((edit) => [String(edit.id), edit]),
		);
		const nodes: HutaoProcessTreeNode[] = [];
		for (const [revertIndex, revert] of getVisibleRevertEvents(context).entries()) {
			const revertId = String(revert.id);
			const parentSession = primaryRevertSessionId(revert, context.events);
			nodes.push({
				kind: "revert",
				id: revertId,
				nodeId: processTreeNodeId("revert", revertId),
				parentNodeId: parentSession ? processTreeNodeId("session", parentSession) : undefined,
				label: revertLabel(revert),
				depth: parentSession ? 1 : 0,
				event: revert,
				order: 8500 + revertIndex,
			});

			const originalId = revertedEditId(revert);
			const revertEdit = revertEditId(revert);
			const original = editNode(revertId, "original", originalId, editsById.get(originalId), 10);
			const reverted = editNode(revertId, "revert", revertEdit, editsById.get(revertEdit), 20);
			if (original) nodes.push(original);
			if (reverted && reverted.id !== original?.id) nodes.push(reverted);
		}
		return nodes;
	},
};
