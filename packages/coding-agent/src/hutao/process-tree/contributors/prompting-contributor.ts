import { eventTitle, processTreeNodeId, shortId } from "../helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

export const promptingContributor: HutaoProcessTreeContributor = {
	kind: "prompting",
	collect(context): HutaoProcessTreeNode[] {
		return context.promptings.map((prompting, order) => ({
			kind: "prompting",
			id: String(prompting.id),
			nodeId: processTreeNodeId("prompting", prompting.id),
			parentNodeId: processTreeNodeId("session", prompting.session_id),
			label: `Prompting ${shortId(prompting.id)} ${eventTitle(prompting)}`,
			depth: 1,
			event: prompting,
			order,
		}));
	},
};
