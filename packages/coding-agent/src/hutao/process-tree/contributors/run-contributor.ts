import { firstLine, processTreeNodeId, shortId } from "../helpers.ts";
import { mergeRunEvents, mergeSubagentEvents } from "../model.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

function runLabel(run: Record<string, unknown>): string {
	const status = run.status ?? (run.type === "run_started" ? "started" : "unknown");
	return `Run ${shortId(run.id)} ${run.tool ?? "tool"} ${status} ${firstLine(run.input_summary ?? run.output_summary ?? "")}`;
}

export const runContributor: HutaoProcessTreeContributor = {
	kind: "run",
	collect(context): HutaoProcessTreeNode[] {
		const subagents = mergeSubagentEvents(context.events);
		const promptingSubagentIds = new Map<string, Set<string>>();
		for (const subagent of subagents) {
			const promptingId = String(subagent.parent_prompting ?? "");
			const subagentId = String(subagent.id ?? "");
			if (!promptingId || !subagentId) continue;
			const ids = promptingSubagentIds.get(promptingId) ?? new Set<string>();
			ids.add(subagentId);
			promptingSubagentIds.set(promptingId, ids);
		}

		return mergeRunEvents(context.events)
			.filter((run) => run.parent_prompting)
			.map((run, order): HutaoProcessTreeNode => {
				const parentSubagent = String(run.parent_subagent ?? "");
				const parentPrompting = String(run.parent_prompting ?? "");
				const belongsToPromptingSubagent = promptingSubagentIds.get(parentPrompting)?.has(parentSubagent) ?? false;
				return {
					kind: "run",
					id: String(run.id),
					nodeId: processTreeNodeId("run", run.id),
					parentNodeId: belongsToPromptingSubagent
						? processTreeNodeId("subagent", parentSubagent)
						: processTreeNodeId("prompting", parentPrompting),
					label: runLabel(run),
					depth: belongsToPromptingSubagent ? 3 : 2,
					event: run,
					order,
				};
			});
	},
};
