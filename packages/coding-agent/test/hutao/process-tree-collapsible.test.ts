import { describe, expect, it } from "vitest";
import { flattenNodes } from "../../src/hutao/process-tree/builder.ts";
import {
	buildCollapsibleProcessTree,
	selectCollapsibleProcessTreeNode,
} from "../../src/hutao/process-tree/collapsible.ts";
import type { HutaoProcessTreeNode } from "../../src/hutao/process-tree/types.ts";

function node(
	fields: Partial<HutaoProcessTreeNode> & Pick<HutaoProcessTreeNode, "kind" | "id" | "label">,
): HutaoProcessTreeNode {
	return {
		depth: 0,
		nodeId: `${fields.kind}:${fields.id}`,
		...fields,
	};
}

describe("collapsible process tree", () => {
	const fullTree = flattenNodes([
		node({ kind: "session", id: "sess_test", label: "Session sess_test", order: 0 }),
		node({
			kind: "prompting",
			id: "p_1",
			label: "Prompting p_1 fix auth",
			parentNodeId: "session:sess_test",
			order: 10,
		}),
		node({
			kind: "run",
			id: "r_1",
			label: "Run r_1 write completed",
			parentNodeId: "prompting:p_1",
			order: 10,
		}),
		node({
			kind: "edit",
			id: "e_1",
			label: "Edit e_1 src/auth.ts",
			parentNodeId: "run:r_1",
			order: 10,
		}),
		node({
			kind: "commit",
			id: "abc123",
			label: "Commit abc123",
			parentNodeId: "prompting:p_1",
			order: 20,
		}),
		node({
			kind: "merge",
			id: "m_1",
			label: "Merge m_1 apply_edits completed",
			parentNodeId: "session:sess_test",
			order: 20,
		}),
		node({
			kind: "edit",
			id: "e_2",
			label: "Applied edit e_2 src/merge.ts",
			nodeId: "merge-edit:m_1:applied:e_2",
			parentNodeId: "merge:m_1",
			order: 10,
		}),
	]);

	it("defaults sessions to expanded and process nodes to collapsed with derived counts", () => {
		const visible = buildCollapsibleProcessTree(fullTree);

		expect(visible.map((entry) => `${entry.kind}:${entry.id}:${entry.collapsed}`)).toEqual([
			"session:sess_test:false",
			"prompting:p_1:true",
			"merge:m_1:true",
		]);
		expect(visible.find((entry) => entry.id === "p_1")?.label).toContain(
			"Prompting p_1 fix auth (runs=1 edits=1 commits=1)",
		);
		expect(visible.find((entry) => entry.id === "m_1")?.label).toContain("Merge m_1 apply_edits completed (edits=1)");
	});

	it("reveals expanded descendants one level at a time", () => {
		const promptingExpanded = buildCollapsibleProcessTree(fullTree, {
			expandedNodeIds: new Set(["prompting:p_1"]),
		});

		expect(promptingExpanded.map((entry) => `${entry.kind}:${entry.id}:${entry.collapsed}`)).toEqual([
			"session:sess_test:false",
			"prompting:p_1:false",
			"run:r_1:true",
			"commit:abc123:false",
			"merge:m_1:true",
		]);
		expect(promptingExpanded.find((entry) => entry.id === "r_1")?.label).toContain(
			"Run r_1 write completed (edits=1)",
		);

		const runExpanded = buildCollapsibleProcessTree(fullTree, {
			expandedNodeIds: new Set(["prompting:p_1", "run:r_1"]),
		});

		expect(runExpanded.map((entry) => `${entry.kind}:${entry.id}:${entry.collapsed}`)).toEqual([
			"session:sess_test:false",
			"prompting:p_1:false",
			"run:r_1:false",
			"edit:e_1:false",
			"commit:abc123:false",
			"merge:m_1:true",
		]);
		expect(runExpanded.find((entry) => entry.id === "e_1")).toMatchObject({
			hasChildren: false,
			hiddenChildCount: 0,
			collapsed: false,
		});
	});

	it("uses contextual node ids as expansion keys", () => {
		const visible = buildCollapsibleProcessTree(fullTree, {
			expandedNodeIds: new Set(["merge:m_1"]),
		});

		expect(visible.map((entry) => entry.nodeId)).toContain("merge-edit:m_1:applied:e_2");
		expect(visible.find((entry) => entry.nodeId === "merge-edit:m_1:applied:e_2")?.label).toContain(
			"Applied edit e_2 src/merge.ts",
		);
	});

	it("selects collapsed nodes by expanding first and returning on the second selection", async () => {
		const selectCalls: string[][] = [];
		const selections = ["Prompting p_1", "Prompting p_1"];

		const result = await selectCollapsibleProcessTreeNode({
			title: "test tree",
			nodes: fullTree,
			select: async (_title, labels) => {
				selectCalls.push(labels);
				const requested = selections.shift();
				return labels.find((label) => label.includes(requested ?? ""));
			},
		});

		expect(result.status).toBe("selected");
		if (result.status !== "selected") throw new Error("expected selected result");
		expect(result.node.nodeId).toBe("prompting:p_1");
		expect(selectCalls).toHaveLength(2);
		expect(selectCalls[0].join("\n")).not.toContain("Run r_1");
		expect(selectCalls[1].join("\n")).toContain("Run r_1 write completed (edits=1)");
	});

	it("returns leaf nodes without requiring a second selection", async () => {
		const result = await selectCollapsibleProcessTreeNode({
			title: "test tree",
			nodes: fullTree,
			options: { expandedNodeIds: new Set(["prompting:p_1", "run:r_1"]) },
			select: async (_title, labels) => labels.find((label) => label.includes("Edit e_1")),
		});

		expect(result.status).toBe("selected");
		if (result.status !== "selected") throw new Error("expected selected result");
		expect(result.node.nodeId).toBe("edit:e_1");
		expect(result.node.expandable).toBe(false);
	});
});
