import { processTreeNodeId } from "../process-tree/helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../process-tree/types.ts";
import { getSubagentRecords } from "./read-model.ts";
import type { SubagentRecord } from "./schema.ts";

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function firstLine(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

function subagentLabel(record: SubagentRecord): string {
	const task = firstLine(record.task ?? record.summary ?? "");
	return `Subagent ${shortId(record.id)} ${record.name} ${record.status}${task ? ` ${task}` : ""}`;
}

export const subagentContributor: HutaoProcessTreeContributor = {
	kind: "subagent",
	collect(context): HutaoProcessTreeNode[] {
		return getSubagentRecords(context.events)
			.filter((record) => record.parentPrompting)
			.map((record, order) => ({
				kind: "subagent",
				id: record.id,
				nodeId: processTreeNodeId("subagent", record.id),
				parentNodeId: processTreeNodeId("prompting", record.parentPrompting),
				label: subagentLabel(record),
				depth: 2,
				event: record.event,
				order,
			}));
	},
};
