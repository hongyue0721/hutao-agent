import { describe, expect, it } from "vitest";
import type { HutaoEvent, HutaoSessionMetadata } from "../../src/hutao/event-store.ts";
import { flattenNodes } from "../../src/hutao/process-tree/builder.ts";
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

	it("allows independent contributors to compose without hard-coded node kinds", () => {
		const context: HutaoProcessTreeBuildContext = {
			repoRoot: "/repo",
			events: [],
			promptings: [],
			sessions: [session],
		};
		const contributor = {
			kind: "test",
			collect: (ctx: HutaoProcessTreeBuildContext) => [
				{
					kind: "merge" as const,
					id: ctx.sessions[0].id,
					label: "Merge synthetic",
					depth: 0,
					nodeId: "merge:synthetic",
					order: 0,
				},
			],
		};

		expect(contributor.collect(context)[0]).toMatchObject({ kind: "merge", id: "sess_test" });
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
