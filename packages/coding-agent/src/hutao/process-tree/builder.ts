import { SessionRegistry } from "../session-registry.ts";
import { commitContributor } from "./contributors/commit-contributor.ts";
import { conflictContributor } from "./contributors/conflict-contributor.ts";
import { editContributor } from "./contributors/edit-contributor.ts";
import { forkContributor } from "./contributors/fork-contributor.ts";
import { mergeContributor } from "./contributors/merge-contributor.ts";
import { promptingContributor } from "./contributors/prompting-contributor.ts";
import { revertContributor } from "./contributors/revert-contributor.ts";
import { runContributor } from "./contributors/run-contributor.ts";
import { sessionContributor } from "./contributors/session-contributor.ts";
import { subagentContributor } from "./contributors/subagent-contributor.ts";
import { treePrefix } from "./helpers.ts";
import type { HutaoProcessTreeBuildContext, HutaoProcessTreeContributor, HutaoProcessTreeNode } from "./types.ts";

export const defaultProcessTreeContributors: HutaoProcessTreeContributor[] = [
	sessionContributor,
	promptingContributor,
	subagentContributor,
	runContributor,
	editContributor,
	commitContributor,
	forkContributor,
	revertContributor,
	conflictContributor,
	mergeContributor,
];

function normalizeNode(node: HutaoProcessTreeNode): HutaoProcessTreeNode {
	return {
		...node,
		nodeId: node.nodeId ?? `${node.kind}:${node.id}`,
	};
}

export function flattenNodes(nodes: HutaoProcessTreeNode[]): HutaoProcessTreeNode[] {
	const normalized = nodes.map(normalizeNode);
	const childrenByParent = new Map<string | undefined, HutaoProcessTreeNode[]>();
	for (const node of normalized) {
		const children = childrenByParent.get(node.parentNodeId) ?? [];
		children.push(node);
		childrenByParent.set(node.parentNodeId, children);
	}
	for (const children of childrenByParent.values()) {
		children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}
	const result: HutaoProcessTreeNode[] = [];
	const visit = (node: HutaoProcessTreeNode, depth: number, isLast: boolean): void => {
		const rawLabel = node.label.replace(/^[│├└─\s]+/, "");
		result.push({ ...node, depth, label: `${treePrefix(depth, isLast)}${rawLabel}` });
		const children = childrenByParent.get(node.nodeId) ?? [];
		for (const [index, child] of children.entries()) visit(child, depth + 1, index === children.length - 1);
	};
	const roots = childrenByParent.get(undefined) ?? [];
	for (const [index, root] of roots.entries()) visit(root, 0, index === roots.length - 1);
	return result;
}

export function buildProcessTreeNodes(
	repoRoot: string,
	events: HutaoProcessTreeBuildContext["events"],
	promptings: HutaoProcessTreeBuildContext["promptings"],
	contributors = defaultProcessTreeContributors,
): HutaoProcessTreeNode[] {
	const context: HutaoProcessTreeBuildContext = {
		repoRoot,
		events,
		promptings,
		sessions: new SessionRegistry(repoRoot).readSessions(),
	};
	return flattenNodes(contributors.flatMap((contributor) => contributor.collect(context)));
}
