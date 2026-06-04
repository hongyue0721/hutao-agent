import { treePrefix } from "./helpers.ts";
import type { HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "./types.ts";

const ansi = {
	reset: "\x1b[0m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	blue: "\x1b[34m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	brightCyan: "\x1b[96m",
	brightMagenta: "\x1b[95m",
} as const;

const processTreeKindColors: Record<HutaoProcessTreeNodeKind, string> = {
	session: ansi.cyan,
	prompting: ansi.magenta,
	subagent: ansi.brightMagenta,
	run: ansi.blue,
	edit: ansi.green,
	commit: ansi.yellow,
	merge: ansi.brightCyan,
	fork: ansi.brightMagenta,
	revert: ansi.yellow,
	conflict: ansi.red,
};

function colorizeProcessTreeLabel(kind: HutaoProcessTreeNodeKind, label: string): string {
	return `${processTreeKindColors[kind] ?? ""}${label}${ansi.reset}`;
}

function nodeStateGlyph(node: HutaoCollapsibleProcessTreeNode): string {
	if (node.hasChildren) return node.expanded ? "▾ " : "▸ ";
	return "• ";
}

export type HutaoProcessTreeSummaryScope = "children" | "descendants";

export interface HutaoProcessTreeSummaryContext {
	node: HutaoProcessTreeNode;
	children: HutaoProcessTreeNode[];
	descendantCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
	childCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
}

export interface HutaoProcessTreeSummaryRule {
	kind: HutaoProcessTreeNodeKind;
	countKinds?: readonly HutaoProcessTreeNodeKind[];
	scope?: HutaoProcessTreeSummaryScope;
	summarize?: (context: HutaoProcessTreeSummaryContext) => readonly string[];
}

export interface HutaoProcessTreeExpansionPolicy {
	/**
	 * Kinds that should show their children on the initial render.
	 * Non-collapsible kinds are always expanded regardless of this set.
	 */
	defaultExpandedKinds?: ReadonlySet<HutaoProcessTreeNodeKind>;
	/**
	 * Kinds that can hide children behind the first Enter expansion behavior.
	 */
	collapsibleKinds?: ReadonlySet<HutaoProcessTreeNodeKind>;
}

export interface HutaoCollapsibleProcessTreeOptions {
	expandedNodeIds?: ReadonlySet<string>;
	summaryRules?: readonly HutaoProcessTreeSummaryRule[];
	expansionPolicy?: HutaoProcessTreeExpansionPolicy;
}

export interface HutaoCollapsibleProcessTreeNode extends HutaoProcessTreeNode {
	nodeId: string;
	hasChildren: boolean;
	childCount: number;
	hiddenChildCount: number;
	expandable: boolean;
	expanded: boolean;
	collapsed: boolean;
	originalLabel: string;
	summary: string;
	descendantCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
	childCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
}

export interface HutaoCollapsibleProcessTreeSelectionInput {
	title: string;
	nodes: HutaoProcessTreeNode[];
	select: (title: string, labels: string[]) => Promise<string | undefined>;
	render?: (node: HutaoCollapsibleProcessTreeNode, index: number) => string;
	options?: HutaoCollapsibleProcessTreeOptions;
}

export type HutaoCollapsibleProcessTreeSelectionResult =
	| {
			status: "selected";
			node: HutaoCollapsibleProcessTreeNode;
			expandedNodeIds: ReadonlySet<string>;
			visibleNodes: HutaoCollapsibleProcessTreeNode[];
	  }
	| {
			status: "cancelled" | "invalid";
			expandedNodeIds: ReadonlySet<string>;
			visibleNodes: HutaoCollapsibleProcessTreeNode[];
	  };

const defaultCountKinds: readonly HutaoProcessTreeNodeKind[] = [
	"prompting",
	"subagent",
	"run",
	"edit",
	"commit",
	"merge",
	"fork",
	"revert",
	"conflict",
];

export const defaultProcessTreeSummaryRules: readonly HutaoProcessTreeSummaryRule[] = [
	{ kind: "prompting", countKinds: ["subagent", "run", "edit", "commit", "merge", "fork", "revert", "conflict"] },
	{ kind: "subagent", countKinds: ["run", "edit", "commit"] },
	{ kind: "run", countKinds: ["edit", "commit"] },
	{ kind: "merge", countKinds: ["edit", "commit", "conflict", "revert", "fork"] },
	{ kind: "fork", countKinds: ["session", "prompting", "edit", "commit"] },
	{ kind: "revert", countKinds: ["edit", "commit"] },
	{ kind: "conflict", countKinds: ["edit", "merge", "commit"] },
];

const defaultDefaultExpandedKinds = new Set<HutaoProcessTreeNodeKind>(["session"]);
const defaultCollapsibleKinds = new Set<HutaoProcessTreeNodeKind>([
	"prompting",
	"subagent",
	"run",
	"merge",
	"fork",
	"revert",
	"conflict",
]);

export const defaultProcessTreeExpansionPolicy: Required<HutaoProcessTreeExpansionPolicy> = {
	defaultExpandedKinds: defaultDefaultExpandedKinds,
	collapsibleKinds: defaultCollapsibleKinds,
};

function nodeKey(node: HutaoProcessTreeNode): string {
	return node.nodeId ?? `${node.kind}:${node.id}`;
}

function rawLabel(label: string): string {
	return label.replace(/^[│├└─\s]+/, "");
}

function pluralLabel(kind: HutaoProcessTreeNodeKind): string {
	if (kind === "prompting") return "promptings";
	if (kind === "subagent") return "subagents";
	return `${kind}s`;
}

function increment(counts: Map<HutaoProcessTreeNodeKind, number>, kind: HutaoProcessTreeNodeKind): void {
	counts.set(kind, (counts.get(kind) ?? 0) + 1);
}

function buildCounts(
	node: HutaoProcessTreeNode,
	childrenByParent: Map<string | undefined, HutaoProcessTreeNode[]>,
	scope: HutaoProcessTreeSummaryScope,
): Map<HutaoProcessTreeNodeKind, number> {
	const counts = new Map<HutaoProcessTreeNodeKind, number>();
	const children = childrenByParent.get(nodeKey(node)) ?? [];
	for (const child of children) {
		increment(counts, child.kind);
		if (scope === "children") continue;
		for (const [kind, count] of buildCounts(child, childrenByParent, "descendants")) {
			counts.set(kind, (counts.get(kind) ?? 0) + count);
		}
	}
	return counts;
}

function normalizePolicy(policy?: HutaoProcessTreeExpansionPolicy): Required<HutaoProcessTreeExpansionPolicy> {
	return {
		defaultExpandedKinds: policy?.defaultExpandedKinds ?? defaultProcessTreeExpansionPolicy.defaultExpandedKinds,
		collapsibleKinds: policy?.collapsibleKinds ?? defaultProcessTreeExpansionPolicy.collapsibleKinds,
	};
}

function normalizedNodes(nodes: HutaoProcessTreeNode[]): HutaoProcessTreeNode[] {
	return nodes.map((node) => ({ ...node, nodeId: nodeKey(node) }));
}

function buildChildrenByParent(nodes: HutaoProcessTreeNode[]): Map<string | undefined, HutaoProcessTreeNode[]> {
	const childrenByParent = new Map<string | undefined, HutaoProcessTreeNode[]>();
	for (const node of nodes) {
		const children = childrenByParent.get(node.parentNodeId) ?? [];
		children.push(node);
		childrenByParent.set(node.parentNodeId, children);
	}
	for (const children of childrenByParent.values()) {
		children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}
	return childrenByParent;
}

function ruleForNode(
	node: HutaoProcessTreeNode,
	rules: readonly HutaoProcessTreeSummaryRule[],
): HutaoProcessTreeSummaryRule | undefined {
	return rules.find((rule) => rule.kind === node.kind);
}

function defaultSummaryParts(
	rule: HutaoProcessTreeSummaryRule,
	context: HutaoProcessTreeSummaryContext,
): readonly string[] {
	const counts = rule.scope === "children" ? context.childCounts : context.descendantCounts;
	const kinds = rule.countKinds ?? defaultCountKinds;
	return kinds
		.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }))
		.filter((entry) => entry.count > 0)
		.map((entry) => `${pluralLabel(entry.kind)}=${entry.count}`);
}

function summaryForNode(
	node: HutaoProcessTreeNode,
	childrenByParent: Map<string | undefined, HutaoProcessTreeNode[]>,
	rules: readonly HutaoProcessTreeSummaryRule[],
): {
	summary: string;
	descendantCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
	childCounts: ReadonlyMap<HutaoProcessTreeNodeKind, number>;
} {
	const descendantCounts = buildCounts(node, childrenByParent, "descendants");
	const childCounts = buildCounts(node, childrenByParent, "children");
	const rule = ruleForNode(node, rules);
	if (!rule) return { summary: "", descendantCounts, childCounts };
	const context = {
		node,
		children: childrenByParent.get(nodeKey(node)) ?? [],
		descendantCounts,
		childCounts,
	};
	const parts = [...(rule.summarize?.(context) ?? defaultSummaryParts(rule, context))].filter(Boolean);
	return { summary: parts.length ? ` (${parts.join(" ")})` : "", descendantCounts, childCounts };
}

function shouldExpand(
	node: HutaoProcessTreeNode,
	hasChildren: boolean,
	expandedNodeIds: ReadonlySet<string>,
	policy: Required<HutaoProcessTreeExpansionPolicy>,
): boolean {
	if (!hasChildren) return false;
	if (!policy.collapsibleKinds.has(node.kind)) return true;
	return expandedNodeIds.has(nodeKey(node)) || policy.defaultExpandedKinds.has(node.kind);
}

export function buildCollapsibleProcessTree(
	nodes: HutaoProcessTreeNode[],
	options: HutaoCollapsibleProcessTreeOptions = {},
): HutaoCollapsibleProcessTreeNode[] {
	const expandedNodeIds = options.expandedNodeIds ?? new Set<string>();
	const policy = normalizePolicy(options.expansionPolicy);
	const rules = options.summaryRules ?? defaultProcessTreeSummaryRules;
	const normalized = normalizedNodes(nodes);
	const childrenByParent = buildChildrenByParent(normalized);
	const result: HutaoCollapsibleProcessTreeNode[] = [];
	const visit = (node: HutaoProcessTreeNode, depth: number, isLast: boolean): void => {
		const children = childrenByParent.get(nodeKey(node)) ?? [];
		const hasChildren = children.length > 0;
		const expandable = hasChildren && policy.collapsibleKinds.has(node.kind);
		const expanded = shouldExpand(node, hasChildren, expandedNodeIds, policy);
		const collapsed = expandable && !expanded;
		const originalLabel = rawLabel(node.label);
		const summary = summaryForNode(node, childrenByParent, rules);
		result.push({
			...node,
			nodeId: nodeKey(node),
			depth,
			label: `${treePrefix(depth, isLast)}${originalLabel}${summary.summary}`,
			hasChildren,
			childCount: children.length,
			hiddenChildCount: collapsed ? children.length : 0,
			expandable,
			expanded,
			collapsed,
			originalLabel,
			summary: summary.summary,
			descendantCounts: summary.descendantCounts,
			childCounts: summary.childCounts,
		});
		if (!expanded) return;
		for (const [index, child] of children.entries()) visit(child, depth + 1, index === children.length - 1);
	};
	const roots = childrenByParent.get(undefined) ?? [];
	for (const [index, root] of roots.entries()) visit(root, 0, index === roots.length - 1);
	return result;
}

export function isCollapsedProcessTreeNode(node: HutaoProcessTreeNode): node is HutaoCollapsibleProcessTreeNode {
	return "collapsed" in node && Boolean((node as HutaoCollapsibleProcessTreeNode).collapsed);
}

function defaultRenderOption(node: HutaoCollapsibleProcessTreeNode): string {
	const prefixMatch = node.label.match(/^[│├└─\s]*/)?.[0] ?? "";
	const body = node.label.slice(prefixMatch.length);
	return `${prefixMatch}${colorizeProcessTreeLabel(node.kind, `${nodeStateGlyph(node)}${body}`)}`;
}

export async function selectCollapsibleProcessTreeNode(
	input: HutaoCollapsibleProcessTreeSelectionInput,
): Promise<HutaoCollapsibleProcessTreeSelectionResult> {
	const expandedNodeIds = new Set(input.options?.expandedNodeIds ?? []);
	while (true) {
		const visibleNodes = buildCollapsibleProcessTree(input.nodes, {
			...input.options,
			expandedNodeIds,
		});
		if (visibleNodes.length === 0) return { status: "cancelled", expandedNodeIds, visibleNodes };
		const labels = visibleNodes.map(
			(node, index) =>
				`${String(index + 1).padStart(2, "0")}. ${(input.render ?? defaultRenderOption)(node, index)}`,
		);
		const choice = await input.select(input.title, labels);
		if (!choice) return { status: "cancelled", expandedNodeIds, visibleNodes };
		const index = labels.indexOf(choice);
		if (index === -1) return { status: "invalid", expandedNodeIds, visibleNodes };
		const selected = visibleNodes[index];
		if (!selected) return { status: "invalid", expandedNodeIds, visibleNodes };
		if (selected.expandable && selected.collapsed) {
			expandedNodeIds.add(selected.nodeId);
			continue;
		}
		return { status: "selected", node: selected, expandedNodeIds, visibleNodes };
	}
}
