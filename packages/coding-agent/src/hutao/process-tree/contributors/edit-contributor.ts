import { firstLine, processTreeNodeId, shortId, stringArray } from "../helpers.ts";
import { mergeRunEvents, mergeSubagentEvents } from "../model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function editLabel(edit: Record<string, unknown>): string {
	return `Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || firstLine(edit.summary) || "no files"}`;
}

export const editContributor: HutaoProcessTreeContributor = {
	kind: "edit",
	collect(context): HutaoProcessTreeNode[] {
		const runIds = new Set(mergeRunEvents(context.events).map((run) => String(run.id)));
		const subagentIds = new Set(mergeSubagentEvents(context.events).map((subagent) => String(subagent.id)));
		return context.events
			.filter((event) => event.type === "edit" && event.parent_prompting)
			.map((edit, order): HutaoProcessTreeNode => {
				const parentRun = String(edit.parent_run ?? "");
				const parentSubagent = String(edit.parent_subagent ?? "");
				let parentNodeId = processTreeNodeId("prompting", edit.parent_prompting);
				let depth = 2;
				if (parentRun && runIds.has(parentRun)) {
					parentNodeId = processTreeNodeId("run", parentRun);
					depth = parentSubagent && subagentIds.has(parentSubagent) ? 4 : 3;
				} else if (parentSubagent && subagentIds.has(parentSubagent)) {
					parentNodeId = processTreeNodeId("subagent", parentSubagent);
					depth = 3;
				}
				return {
					kind: "edit",
					id: String(edit.id),
					nodeId: processTreeNodeId("edit", edit.id),
					parentNodeId,
					label: editLabel(edit),
					depth,
					event: edit,
					order,
				};
			});
	},
};
