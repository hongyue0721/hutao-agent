import { describe, expect, it } from "vitest";
import { defaultProcessActionRegistrations } from "../../src/hutao/process-actions/default-actions.ts";
import { HutaoProcessActionExecutor } from "../../src/hutao/process-actions/executor.ts";
import { processActionLabel } from "../../src/hutao/process-actions/menu.ts";
import { HutaoProcessActionRegistry } from "../../src/hutao/process-actions/registry.ts";
import type { HutaoProcessActionCommandHandlers } from "../../src/hutao/process-actions/types.ts";
import type { HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "../../src/hutao/process-tree/types.ts";

function node(kind: HutaoProcessTreeNodeKind, id = `${kind}_test`): HutaoProcessTreeNode {
	return {
		kind,
		id,
		label: `${kind} ${id}`,
		depth: 1,
	};
}

describe("HutaoProcessActionRegistry", () => {
	const registry = new HutaoProcessActionRegistry(defaultProcessActionRegistrations);

	it("returns ordered prompting actions with disabled related-data slots", () => {
		const actions = registry.getActions(node("prompting", "p_test"), { repoRoot: ".", events: [] });

		expect(actions.map((action) => action.id)).toEqual([
			"viewOriginal",
			"viewRuns",
			"viewEdits",
			"viewCommits",
			"readOnlyInquiry",
			"forkBefore",
			"retry",
			"forkAfter",
		]);
		expect(actions.find((action) => action.id === "viewRuns")?.state).toBe("disabled");
		expect(actions.find((action) => action.id === "forkAfter")?.previewFirst).toBe(true);
		expect(registry.getTitleKey(node("prompting", "p_test"))).toBe("prompting.action.title");
	});

	it("returns edit actions with preview-first dangerous revert", () => {
		const actions = registry.getActions(node("edit", "e_test"), { repoRoot: ".", events: [] });

		expect(actions.map((action) => action.id)).toEqual([
			"viewPatch",
			"viewChangedFiles",
			"viewParentPrompting",
			"viewParentRun",
			"viewRelations",
			"readOnlyInquiry",
			"forkBefore",
			"forkAfter",
			"previewRevert",
		]);
		expect(actions.find((action) => action.id === "viewParentPrompting")?.state).toBe("disabled");
		expect(actions.find((action) => action.id === "previewRevert")).toMatchObject({
			state: "preview",
			previewFirst: true,
			dangerous: true,
		});
		expect(registry.getTitleKey(node("edit", "e_test"))).toBe("edit.action.title");
	});

	it("enables commit actions through projected edit links", () => {
		const actions = registry.getActions(node("commit", "abc123"), {
			repoRoot: ".",
			events: [
				{
					schema_version: "0.1.0",
					type: "prompting",
					id: "p_commit",
					session_id: "sess_test",
				},
				{
					schema_version: "0.1.0",
					type: "run_finished",
					id: "r_commit",
					session_id: "sess_test",
					parent_prompting: "p_commit",
				},
				{
					schema_version: "0.1.0",
					type: "edit",
					id: "e_commit",
					session_id: "sess_test",
					parent_prompting: "p_commit",
					parent_run: "r_commit",
				},
				{
					schema_version: "0.1.0",
					type: "commit_link",
					id: "cl_commit",
					session_id: "sess_test",
					commit: "abc123",
					edit_ids: ["e_commit"],
					link_method: "patch_match",
				},
			],
		});

		expect(actions.map((action) => action.id)).toEqual(["viewDetails", "viewPromptings", "viewRuns", "viewEdits"]);
		expect(actions.find((action) => action.id === "viewPromptings")?.state).toBeUndefined();
		expect(actions.find((action) => action.id === "viewRuns")?.state).toBeUndefined();
		expect(actions.find((action) => action.id === "viewEdits")?.state).toBeUndefined();
	});

	it("has an extensible action shell for every current and planned process node kind", () => {
		const kinds: HutaoProcessTreeNodeKind[] = [
			"session",
			"prompting",
			"run",
			"edit",
			"commit",
			"subagent",
			"merge",
			"fork",
			"revert",
			"conflict",
		];

		for (const kind of kinds) {
			expect(registry.hasActions(kind), kind).toBe(true);
			expect(registry.getTitleKey(node(kind)), kind).toBeDefined();
			expect(registry.getActions(node(kind), { repoRoot: ".", events: [] }).length, kind).toBeGreaterThan(0);
		}
	});

	it("enables implemented relation node actions while keeping future runtime actions explicit", () => {
		const forkActions = registry.getActions(
			{
				...node("fork", "fs_test"),
				event: {
					schema_version: "0.1.0",
					type: "fork_session",
					id: "fs_test",
					session_id: "fs_test",
					parent_session: "sess_parent",
					fork_from_type: "edit",
					fork_from_id: "e_source",
				},
			},
			{ repoRoot: ".", events: [] },
		);
		const revertActions = registry.getActions(
			{
				...node("revert", "er_test"),
				event: {
					schema_version: "0.1.0",
					type: "edit_reverted",
					id: "er_test",
					session_id: "sess_target",
					edit_id: "e_original",
					revert_edit_id: "e_revert",
				},
			},
			{ repoRoot: ".", events: [] },
		);
		const conflictActions = registry.getActions(
			{
				...node("conflict", "m_conflict"),
				event: {
					schema_version: "0.1.0",
					type: "merge",
					id: "m_conflict",
					session_id: "sess_target",
					source_session: "sess_source",
					target_session: "sess_target",
					status: "conflict",
					conflict_edits: ["e_conflict"],
					skipped_edits: ["e_skip"],
					resolution_edits: ["e_resolution"],
				},
			},
			{ repoRoot: ".", events: [] },
		);
		const subagentActions = registry.getActions(node("subagent", "sa_test"), { repoRoot: ".", events: [] });

		expect(forkActions.map((action) => action.id)).toEqual([
			"viewDetails",
			"viewSource",
			"viewParentSession",
			"resume",
		]);
		expect(forkActions.find((action) => action.id === "viewSource")?.state).toBeUndefined();
		expect(forkActions.find((action) => action.id === "viewParentSession")?.state).toBeUndefined();
		expect(forkActions.find((action) => action.id === "resume")).toMatchObject({
			state: "preview",
			previewFirst: true,
		});
		expect(revertActions.map((action) => action.id)).toEqual([
			"viewDetails",
			"viewOriginalEdit",
			"viewRevertEdit",
			"viewRelations",
		]);
		expect(revertActions.every((action) => action.state !== "future")).toBe(true);
		expect(conflictActions.map((action) => action.id)).toEqual([
			"viewDetails",
			"viewMerge",
			"viewSourceSession",
			"viewTargetSession",
			"viewConflictEdits",
			"viewSkippedEdits",
			"viewResolutionEdits",
			"captureResolution",
		]);
		expect(conflictActions.find((action) => action.id === "captureResolution")).toMatchObject({
			state: "preview",
			previewFirst: true,
			dangerous: true,
		});
		expect(subagentActions.find((action) => action.id === "runSubagent")).toMatchObject({
			state: "future",
			reasonKey: "process.action.disabled.futureRuntime",
		});
	});

	it("renders unavailable actions with explicit state while preserving enabled labels", () => {
		const runActions = registry.getActions(node("run", "r_test"), { repoRoot: ".", events: [] });
		const details = runActions.find((action) => action.id === "viewDetails");
		const edits = runActions.find((action) => action.id === "viewEdits");

		expect(details).toBeDefined();
		expect(edits).toBeDefined();
		const previousLanguage = process.env.HUTAO_LANG;
		process.env.HUTAO_LANG = "en";
		try {
			expect(processActionLabel(".", details!)).toBe("View details");
			expect(processActionLabel(".", edits!)).toContain("no related data");
		} finally {
			if (previousLanguage === undefined) delete process.env.HUTAO_LANG;
			else process.env.HUTAO_LANG = previousLanguage;
		}
	});

	it("routes unavailable actions to a safe handler without executing real behavior", async () => {
		const runNode = node("run", "r_test");
		const action = registry
			.getActions(runNode, { repoRoot: ".", events: [] })
			.find((candidate) => candidate.id === "viewEdits");
		expect(action?.state).toBe("disabled");

		const calls: string[] = [];
		const noop = async () => undefined;
		const handlers: HutaoProcessActionCommandHandlers = {
			openSession: noop,
			viewSessionConversation: noop,
			previewSessionHydration: noop,
			queueSessionHydration: noop,
			resumeSession: noop,
			viewSessionPromptings: noop,
			viewSessionRuns: noop,
			viewSessionEdits: noop,
			mergeSessionWizard: noop,
			previewMergeSession: noop,
			importSessionHistory: noop,
			applySessionEdits: noop,
			applySessionFinalSnapshot: noop,
			openPrompting: noop,
			openSubagent: noop,
			openRun: noop,
			openEdit: noop,
			openCommit: noop,
			openMerge: noop,
			openFork: noop,
			openRevert: noop,
			openConflict: noop,
			viewPromptingEdits: noop,
			viewPromptingRuns: noop,
			viewPromptingCommits: noop,
			viewRunPrompting: noop,
			viewRunEdits: async (runId) => {
				calls.push(`viewRunEdits:${runId}`);
			},
			viewRunCommits: noop,
			viewCommitPromptings: noop,
			viewCommitRuns: noop,
			viewCommitEdits: noop,
			viewSubagentPrompting: noop,
			viewSubagentRuns: noop,
			viewSubagentEdits: noop,
			viewEditChangedFiles: noop,
			viewEditParentRun: noop,
			viewEditRelations: noop,
			viewMergeSourceSession: noop,
			viewMergeTargetSession: noop,
			viewMergeAppliedEdits: noop,
			viewMergeConflictEdits: noop,
			viewMergeResolutionEdits: noop,
			previewMergeSource: noop,
			captureMergeResolution: noop,
			viewForkSource: noop,
			viewForkParentSession: noop,
			resumeForkSession: noop,
			viewRevertOriginalEdit: noop,
			viewRevertEdit: noop,
			viewRevertRelations: noop,
			viewConflictMerge: noop,
			viewConflictSourceSession: noop,
			viewConflictTargetSession: noop,
			viewConflictEdits: noop,
			viewConflictSkippedEdits: noop,
			viewConflictResolutionEdits: noop,
			captureConflictResolution: noop,
			resumePromptingAfter: noop,
			resumeEditAfter: noop,
			forkPrompting: noop,
			forkEdit: noop,
			previewRevertEdit: noop,
			openReadOnlyInquiry: noop,
			unavailableAction: (candidate, target) => {
				calls.push(`unavailable:${candidate.id}:${target.kind}:${target.id}`);
			},
			noAction: (title) => {
				calls.push(`noAction:${title}`);
			},
		};
		const executor = new HutaoProcessActionExecutor({
			repoRoot: ".",
			events: [],
			ctx: {} as never,
			handlers,
		});

		await executor.execute(action!, { kind: "run", id: "r_test", node: runNode });

		expect(calls).toEqual(["unavailable:viewEdits:run:r_test"]);
	});
});
