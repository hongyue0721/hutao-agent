import { processTreeNodeId } from "../helpers.ts";
import { relatedCommits } from "../model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

export const commitContributor: HutaoProcessTreeContributor = {
	kind: "commit",
	collect(context): HutaoProcessTreeNode[] {
		const nodes: HutaoProcessTreeNode[] = [];
		for (const [promptingIndex, prompting] of context.promptings.entries()) {
			for (const [commitIndex, commit] of relatedCommits(context.events, prompting.id, "prompting_ids").entries()) {
				nodes.push({
					kind: "commit",
					id: commit,
					nodeId: processTreeNodeId("commit", `${prompting.id}:${commit}`),
					parentNodeId: processTreeNodeId("prompting", prompting.id),
					label: `Commit ${commit.slice(0, 12)}`,
					depth: 2,
					order: promptingIndex * 1000 + commitIndex,
				});
			}
		}
		return nodes;
	},
};
