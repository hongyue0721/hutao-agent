import type { HutaoEvent } from "../../event-store.ts";
import { firstLine, processTreeNodeId, shortId } from "../helpers.ts";
import { mergeSubagentEvents } from "../model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function subagentLabel(event: HutaoEvent): string {
	const name = firstLine(event.name ?? event.role ?? "subagent", 80);
	const status = event.status ?? (event.type === "subagent_started" ? "started" : "unknown");
	const task = firstLine(event.task ?? event.summary ?? "");
	return `Subagent ${shortId(event.id)} ${name} ${status}${task ? ` ${task}` : ""}`;
}

export const subagentContributor: HutaoProcessTreeContributor = {
	kind: "subagent",
	collect(context): HutaoProcessTreeNode[] {
		return mergeSubagentEvents(context.events)
			.filter((event) => event.parent_prompting)
			.map((event, order) => ({
				kind: "subagent",
				id: String(event.id),
				nodeId: processTreeNodeId("subagent", event.id),
				parentNodeId: processTreeNodeId("prompting", event.parent_prompting),
				label: subagentLabel(event),
				depth: 2,
				event,
				order,
			}));
	},
};
