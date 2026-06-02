import { describe, expect, it } from "vitest";
import type { HutaoEvent, HutaoSessionMetadata } from "../../src/hutao/event-store.ts";
import { flattenNodes } from "../../src/hutao/process-tree/builder.ts";
import { commitContributor } from "../../src/hutao/process-tree/contributors/commit-contributor.ts";
import { conflictContributor } from "../../src/hutao/process-tree/contributors/conflict-contributor.ts";
import { forkContributor } from "../../src/hutao/process-tree/contributors/fork-contributor.ts";
import { mergeContributor } from "../../src/hutao/process-tree/contributors/merge-contributor.ts";
import { promptingContributor } from "../../src/hutao/process-tree/contributors/prompting-contributor.ts";
import { revertContributor } from "../../src/hutao/process-tree/contributors/revert-contributor.ts";
import { sessionContributor } from "../../src/hutao/process-tree/contributors/session-contributor.ts";
import type { HutaoProcessTreeBuildContext } from "../../src/hutao/process-tree/types.ts";
import {
	getCommitLinkedIds,
	getCommitsForEdit,
	getEditsForRun,
	getMergesForEdit,
	getRuns,
	getRunsForSubagent,
	getSubagents,
} from "../../src/hutao/trace-relations.ts";

const session: HutaoSessionMetadata = {
	schema_version: "0.1.0",
	id: "sess_test",
	kind: "session",
	title: "test",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	status: "active",
	parent_session: null,
	fork_from: null,
	summary: "",
};

function event(type: HutaoEvent["type"], id: string, fields: Record<string, unknown> = {}): HutaoEvent {
	return { schema_version: "0.1.0", type, id, session_id: "sess_test", ...fields };
}

describe("Hutao process tree", () => {
	it("composes contributor nodes into stable parent-child order", () => {
		const nodes = flattenNodes([
			{
				kind: "run",
				id: "r_1",
				label: "Run r_1",
				depth: 2,
				nodeId: "run:r_1",
				parentNodeId: "prompting:p_1",
				order: 20,
			},
			{
				kind: "prompting",
				id: "p_1",
				label: "Prompting p_1",
				depth: 1,
				nodeId: "prompting:p_1",
				parentNodeId: "session:sess_test",
				order: 1,
			},
			{
				kind: "session",
				id: "sess_test",
				label: "Session sess_test",
				depth: 0,
				nodeId: "session:sess_test",
				order: 0,
			},
			{
				kind: "edit",
				id: "e_1",
				label: "Edit e_1",
				depth: 3,
				nodeId: "edit:e_1",
				parentNodeId: "run:r_1",
				order: 1,
			},
		]);

		expect(nodes.map((node) => `${node.kind}:${node.id}`)).toEqual([
			"session:sess_test",
			"prompting:p_1",
			"run:r_1",
			"edit:e_1",
		]);
		expect(nodes[1].label).toBe("└─ Prompting p_1");
		expect(nodes[2].label).toBe("│  └─ Run r_1");
		expect(nodes[3].label).toBe("│  │  └─ Edit e_1");
	});

	it("adds fork sessions and contextual source nodes through reusable contributors", () => {
		const parentSession: HutaoSessionMetadata = {
			...session,
			id: "sess_parent",
			title: "parent",
		};
		const forkSession: HutaoSessionMetadata = {
			...session,
			id: "fs_child",
			kind: "forkSession",
			title: "child fork",
			parent_session: "sess_parent",
			fork_from: { type: "edit", id: "e_anchor", mode: "after" },
		};
		const events: HutaoEvent[] = [
			event("prompting", "p_parent", { session_id: "sess_parent", text: "parent work" }),
			event("edit", "e_anchor", { session_id: "sess_parent", files: ["src/anchor.ts"], summary: "anchor edit" }),
			event("fork_session", "fs_child", {
				session_id: "fs_child",
				parent_session: "sess_parent",
				fork_from_type: "edit",
				fork_from_id: "e_anchor",
				fork_mode: "after",
				base_git_head: "abc123",
				base_tree: "tree_after_anchor",
			}),
		];
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events,
			promptings: events.filter((entry) => entry.type === "prompting"),
			sessions: [parentSession, forkSession],
		};

		const nodes = flattenNodes([...sessionContributor.collect(context), ...forkContributor.collect(context)]);

		expect(nodes.map((node) => `${node.kind}:${node.id}:${node.nodeId}`)).toEqual([
			"session:sess_parent:session:sess_parent",
			"fork:fs_child:fork:fs_child",
			"session:sess_parent:fork-session:fs_child:parent:sess_parent",
			"session:fs_child:fork-session:fs_child:fork:fs_child",
			"edit:e_anchor:fork-source:fs_child:edit:e_anchor",
			"session:fs_child:session:fs_child",
		]);
		expect(nodes.find((node) => node.nodeId === "session:sess_parent")?.label).toContain("forks=1");
		expect(nodes.find((node) => node.nodeId === "fork:fs_child")?.label).toContain("edit:e_anchor");
		expect(nodes.find((node) => node.nodeId === "fork-source:fs_child:edit:e_anchor")?.label).toContain(
			"Source edit",
		);
	});

	it("adds revert events and contextual edit nodes through reusable contributors", () => {
		const events: HutaoEvent[] = [
			event("prompting", "p_revert", { session_id: "sess_test", text: "revert work" }),
			event("edit", "e_original", { session_id: "sess_test", files: ["src/original.ts"] }),
			event("edit", "e_revert", { session_id: "sess_test", files: ["src/original.ts"], reverts_edit: "e_original" }),
			event("edit_reverted", "er_1", {
				session_id: "sess_test",
				edit_id: "e_original",
				revert_edit_id: "e_revert",
			}),
		];
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events,
			promptings: events.filter((entry) => entry.type === "prompting"),
			sessions: [session],
		};

		const nodes = flattenNodes([...sessionContributor.collect(context), ...revertContributor.collect(context)]);

		expect(nodes.map((node) => `${node.kind}:${node.id}:${node.nodeId}`)).toEqual([
			"session:sess_test:session:sess_test",
			"revert:er_1:revert:er_1",
			"edit:e_original:revert-edit:er_1:original:e_original",
			"edit:e_revert:revert-edit:er_1:revert:e_revert",
		]);
		expect(nodes.find((node) => node.nodeId === "session:sess_test")?.label).toContain("reverts=1");
		expect(nodes.find((node) => node.nodeId === "revert:er_1")?.label).toContain("original=e_original");
		expect(nodes.find((node) => node.nodeId === "revert-edit:er_1:revert:e_revert")?.label).toContain("Revert edit");
	});

	it("adds conflict events and contextual relation nodes through reusable contributors", () => {
		const sourceSession: HutaoSessionMetadata = {
			...session,
			id: "sess_source",
			title: "source",
		};
		const targetSession: HutaoSessionMetadata = {
			...session,
			id: "sess_target",
			title: "target",
		};
		const events: HutaoEvent[] = [
			event("prompting", "p_target", { session_id: "sess_target", text: "target work" }),
			event("edit", "e_conflict", { session_id: "sess_source", files: ["src/conflict.ts"] }),
			event("edit", "e_skipped", { session_id: "sess_source", files: ["src/skipped.ts"] }),
			event("edit", "e_resolution", { session_id: "sess_target", files: ["src/resolution.ts"] }),
			event("merge", "m_conflict", {
				session_id: "sess_target",
				target_session: "sess_target",
				source_session: "sess_source",
				mode: "apply_edits",
				status: "conflict",
				conflict_edits: ["e_conflict"],
				skipped_edits: ["e_skipped"],
				resolution_edits: ["e_resolution"],
			}),
		];
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events,
			promptings: events.filter((entry) => entry.type === "prompting"),
			sessions: [sourceSession, targetSession],
		};

		const nodes = flattenNodes([...sessionContributor.collect(context), ...conflictContributor.collect(context)]);

		expect(nodes.map((node) => `${node.kind}:${node.id}:${node.nodeId}`)).toEqual([
			"session:sess_source:session:sess_source",
			"session:sess_target:session:sess_target",
			"conflict:m_conflict:conflict:m_conflict",
			"session:sess_source:conflict-session:m_conflict:source:sess_source",
			"session:sess_target:conflict-session:m_conflict:target:sess_target",
			"merge:m_conflict:conflict-merge:m_conflict",
			"edit:e_conflict:conflict-edit:m_conflict:conflict:e_conflict",
			"edit:e_skipped:conflict-edit:m_conflict:skipped:e_skipped",
			"edit:e_resolution:conflict-edit:m_conflict:resolution:e_resolution",
		]);
		expect(nodes.find((node) => node.nodeId === "session:sess_source")?.label).toContain("conflicts=1");
		expect(nodes.find((node) => node.nodeId === "conflict:m_conflict")?.label).toContain("conflicts=1");
		expect(nodes.find((node) => node.nodeId === "conflict-edit:m_conflict:skipped:e_skipped")?.label).toContain(
			"Skipped edit",
		);
	});

	it("projects commit nodes through linked edit facts instead of only prompting ids", () => {
		const events: HutaoEvent[] = [
			event("prompting", "p_commit", { text: "commit projection source" }),
			event("run_finished", "r_commit", { parent_prompting: "p_commit", status: "completed" }),
			event("edit", "e_commit", {
				parent_prompting: "p_commit",
				parent_run: "r_commit",
				files: ["src/commit.ts"],
			}),
			event("commit_link", "cl_commit", {
				commit: "abc123",
				edit_ids: ["e_commit"],
				link_method: "patch_match",
			}),
			event("merge", "m_commit", {
				mode: "apply_tree",
				status: "conflict",
				conflict_edits: ["e_commit"],
				skipped_edits: ["e_commit"],
				resolution_edits: [],
			}),
		];
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events,
			promptings: events.filter((entry) => entry.type === "prompting"),
			sessions: [session],
		};

		const nodes = flattenNodes([
			...sessionContributor.collect(context),
			...promptingContributor.collect(context),
			...commitContributor.collect(context),
		]);

		const commitNode = nodes.find((node) => node.kind === "commit" && node.id === "abc123");
		expect(commitNode?.parentNodeId).toBe("prompting:p_commit");
		expect(commitNode?.label).toContain("Commit abc123");
		expect(commitNode?.label).toContain("method=patch_match");
		expect(commitNode?.label).toContain("confidence=medium");
		expect(commitNode?.label).toContain("merges=1");
		expect(commitNode?.label).toContain("conflicts=1");
	});

	it("adds merge sessions and contextual relation nodes through reusable contributors", () => {
		const sourceSession: HutaoSessionMetadata = {
			...session,
			id: "sess_source",
			title: "source",
		};
		const targetSession: HutaoSessionMetadata = {
			...session,
			id: "sess_target",
			title: "target",
		};
		const events: HutaoEvent[] = [
			event("prompting", "p_target", { session_id: "sess_target", text: "target work" }),
			event("edit", "e_applied", { session_id: "sess_source", files: ["src/applied.ts"] }),
			event("edit", "e_conflict", { session_id: "sess_source", files: ["src/conflict.ts"] }),
			event("edit", "e_resolution", { session_id: "sess_target", files: ["src/resolution.ts"] }),
			event("merge", "m_1", {
				session_id: "sess_target",
				target_session: "sess_target",
				source_session: "sess_source",
				mode: "apply_edits",
				status: "conflict_resolved",
				imported_edits: ["e_applied", "e_conflict"],
				applied_edits: ["e_applied"],
				conflict_edits: ["e_conflict"],
				resolution_edits: ["e_resolution"],
			}),
		];
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events,
			promptings: events.filter((entry) => entry.type === "prompting"),
			sessions: [sourceSession, targetSession],
		};

		const nodes = flattenNodes([...sessionContributor.collect(context), ...mergeContributor.collect(context)]);

		expect(nodes.map((node) => `${node.kind}:${node.id}:${node.nodeId}`)).toEqual([
			"session:sess_source:session:sess_source",
			"session:sess_target:session:sess_target",
			"merge:m_1:merge:m_1",
			"session:sess_source:merge-session:m_1:source:sess_source",
			"session:sess_target:merge-session:m_1:target:sess_target",
			"edit:e_applied:merge-edit:m_1:imported:e_applied",
			"edit:e_conflict:merge-edit:m_1:imported:e_conflict",
			"edit:e_applied:merge-edit:m_1:applied:e_applied",
			"edit:e_conflict:merge-edit:m_1:conflict:e_conflict",
			"edit:e_resolution:merge-edit:m_1:resolution:e_resolution",
		]);
		expect(nodes.find((node) => node.nodeId === "session:sess_source")?.label).toContain("promptings=0");
		expect(nodes.find((node) => node.nodeId === "merge:m_1")?.label).toContain("source=sess_source");
		expect(nodes.find((node) => node.nodeId === "merge:m_1")?.label).toContain("resolutions=1");
		expect(nodes.find((node) => node.nodeId === "merge-edit:m_1:conflict:e_conflict")?.label).toContain(
			"Conflict edit",
		);
	});
});

describe("Hutao trace relations", () => {
	it("aggregates lifecycle-style subagents and runs", () => {
		const events: HutaoEvent[] = [
			event("subagent_started", "sa_1", { parent_prompting: "p_1", name: "reviewer", status: "started" }),
			event("subagent_finished", "sa_1", { parent_prompting: "p_1", summary: "done", status: "completed" }),
			event("run_started", "r_1", { parent_prompting: "p_1", parent_subagent: "sa_1", status: "started" }),
			event("run_finished", "r_1", { parent_prompting: "p_1", parent_subagent: "sa_1", status: "completed" }),
		];

		expect(getSubagents(events)).toEqual([
			expect.objectContaining({ id: "sa_1", name: "reviewer", summary: "done", status: "completed" }),
		]);
		expect(getRuns(events)).toEqual([expect.objectContaining({ id: "r_1", status: "completed" })]);
		expect(getRunsForSubagent(events, "sa_1")).toHaveLength(1);
	});

	it("links edits, commits, and merge events without command-specific filters", () => {
		const events: HutaoEvent[] = [
			event("run_finished", "r_1", { parent_prompting: "p_1" }),
			event("edit", "e_1", { parent_prompting: "p_1", parent_run: "r_1", files: ["src/auth.ts"] }),
			event("commit_link", "cl_1", { commit: "abc123", edit_ids: ["e_1"], run_ids: ["r_1"] }),
			event("merge", "m_1", { applied_edits: ["e_1"], conflict_edits: [], resolution_edits: [] }),
		];

		expect(getEditsForRun(events, "r_1").map((edit) => edit.id)).toEqual(["e_1"]);
		expect(getCommitsForEdit(events, "e_1")).toEqual(["abc123"]);
		expect([...getCommitLinkedIds(events, "abc", "edit_ids")]).toEqual(["e_1"]);
		expect(getMergesForEdit(events, "e_1").map((merge) => merge.id)).toEqual(["m_1"]);
	});
});
