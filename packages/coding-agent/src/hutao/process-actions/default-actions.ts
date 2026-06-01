import type { HutaoProcessActionRegistration } from "./types.ts";

export const defaultProcessActionRegistrations: HutaoProcessActionRegistration[] = [
	{
		kind: "prompting",
		titleKey: "prompting.action.title",
		getActions: () => [
			{ id: "viewOriginal", labelKey: "prompting.action.viewOriginal", order: 10 },
			{ id: "viewRuns", labelKey: "prompting.action.viewRuns", order: 20 },
			{ id: "viewEdits", labelKey: "prompting.action.viewEdits", order: 30 },
			{ id: "viewCommits", labelKey: "prompting.action.viewCommits", order: 40 },
			{ id: "readOnlyInquiry", labelKey: "prompting.action.readOnlyInquiry", order: 50, future: true },
			{ id: "forkBefore", labelKey: "prompting.action.forkBefore", order: 60 },
			{ id: "retry", labelKey: "prompting.action.retry", order: 70 },
			{ id: "forkAfter", labelKey: "prompting.action.forkAfter", order: 80 },
		],
	},
	{
		kind: "edit",
		titleKey: "edit.action.title",
		getActions: () => [
			{ id: "viewPatch", labelKey: "edit.action.viewPatch", order: 10 },
			{ id: "viewChangedFiles", labelKey: "edit.action.viewChangedFiles", order: 20 },
			{ id: "viewParentPrompting", labelKey: "edit.action.viewParentPrompting", order: 30 },
			{ id: "viewParentRun", labelKey: "edit.action.viewParentRun", order: 40 },
			{ id: "viewRelations", labelKey: "edit.action.viewRelations", order: 50 },
			{ id: "readOnlyInquiry", labelKey: "edit.action.readOnlyInquiry", order: 60, future: true },
			{ id: "forkBefore", labelKey: "edit.action.forkBefore", order: 70 },
			{ id: "forkAfter", labelKey: "edit.action.forkAfter", order: 80 },
			{ id: "previewRevert", labelKey: "edit.action.previewRevert", order: 90 },
		],
	},
];
