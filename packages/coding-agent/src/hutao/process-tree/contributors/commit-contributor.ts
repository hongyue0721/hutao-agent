import { buildGitCommitProjection } from "../../git-projection.ts";
import { processTreeNodeId } from "../helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function linkedCommits(events: HutaoProcessTreeNode["event"][]): string[] {
	return [
		...new Set(
			events
				.filter((event) => event?.type === "commit_link")
				.map((event) => String(event?.commit ?? ""))
				.filter(Boolean),
		),
	];
}

function evidenceSummary(projection: ReturnType<typeof buildGitCommitProjection>): string {
	const methods = [...new Set(projection.evidence.map((entry) => entry.method))].join("+") || "unknown";
	const confidences = [...new Set(projection.evidence.map((entry) => entry.confidence))].join("+") || "unknown";
	return `method=${methods} confidence=${confidences}`;
}

function relationSummary(projection: ReturnType<typeof buildGitCommitProjection>): string {
	return `merges=${projection.relations.merges.length} conflicts=${projection.relations.conflicts.length} reverts=${projection.relations.reverts.length} forks=${projection.relations.forks.length}`;
}

export const commitContributor: HutaoProcessTreeContributor = {
	kind: "commit",
	collect(context): HutaoProcessTreeNode[] {
		const nodes: HutaoProcessTreeNode[] = [];
		const commits = linkedCommits(context.events);
		for (const [promptingIndex, prompting] of context.promptings.entries()) {
			for (const [commitIndex, commit] of commits.entries()) {
				const projection = buildGitCommitProjection(context.events, commit);
				if (!projection.promptingIds.has(String(prompting.id))) continue;
				nodes.push({
					kind: "commit",
					id: commit,
					nodeId: processTreeNodeId("commit", `${prompting.id}:${commit}`),
					parentNodeId: processTreeNodeId("prompting", prompting.id),
					label: `Commit ${commit.slice(0, 12)} ${evidenceSummary(projection)} ${relationSummary(projection)}`,
					depth: 2,
					event: projection.links[0],
					order: promptingIndex * 1000 + commitIndex,
				});
			}
		}
		return nodes;
	},
};
