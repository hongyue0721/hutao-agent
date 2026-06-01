import { describe, expect, it } from "vitest";
import { defaultProcessActionRegistrations } from "../../src/hutao/process-actions/default-actions.ts";
import { HutaoProcessActionRegistry } from "../../src/hutao/process-actions/registry.ts";
import type { HutaoProcessTreeNode } from "../../src/hutao/process-tree/types.ts";

describe("HutaoProcessActionRegistry", () => {
	const registry = new HutaoProcessActionRegistry(defaultProcessActionRegistrations);

	it("returns ordered prompting actions from the registry", () => {
		const node: HutaoProcessTreeNode = {
			kind: "prompting",
			id: "p_test",
			label: "Prompting p_test",
			depth: 1,
		};

		const actions = registry.getActions(node, { repoRoot: ".", events: [] });

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
		expect(registry.getTitleKey(node)).toBe("prompting.action.title");
	});

	it("returns edit actions without changing tree dispatch code", () => {
		const node: HutaoProcessTreeNode = {
			kind: "edit",
			id: "e_test",
			label: "Edit e_test",
			depth: 2,
		};

		const actions = registry.getActions(node, { repoRoot: ".", events: [] });

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
		expect(registry.getTitleKey(node)).toBe("edit.action.title");
	});

	it("leaves nodes without registered actions to default node dispatch", () => {
		const node: HutaoProcessTreeNode = {
			kind: "run",
			id: "r_test",
			label: "Run r_test",
			depth: 2,
		};

		expect(registry.hasActions("run")).toBe(false);
		expect(registry.getActions(node, { repoRoot: ".", events: [] })).toEqual([]);
		expect(registry.getTitleKey(node)).toBeUndefined();
	});
});
