import { buildGitCommitProjection } from "../git-projection.ts";
import { conflictRelatedEditIds } from "../process-tree/conflict-model.ts";
import { revertEditId, revertedEditId, revertRelatedEditIds } from "../process-tree/revert-model.ts";
import {
	getCommitsForEdit,
	getCommitsForPrompting,
	getCommitsForRun,
	getEditsForRun,
	getRunsForPrompting,
	getRunsForSubagent,
	stringArray,
} from "../trace-relations.ts";
import type { HutaoProcessAction, HutaoProcessActionRegistration } from "./types.ts";

const disabled = <T extends HutaoProcessAction>(
	action: T,
	reasonKey = "process.action.disabled.noRelatedData" as const,
): T => ({ ...action, state: "disabled", reasonKey });

export const defaultProcessActionRegistrations: HutaoProcessActionRegistration[] = [
	{
		kind: "session",
		titleKey: "session.action.title",
		getActions: () => [
			{ id: "viewDetails", labelKey: "session.action.viewDetails", order: 10 },
			{ id: "viewConversation", labelKey: "session.action.viewConversation", order: 20 },
			{
				id: "previewHydration",
				labelKey: "session.action.previewHydration",
				order: 30,
				state: "preview",
				previewFirst: true,
			},
			{
				id: "queueHydration",
				labelKey: "session.action.queueHydration",
				order: 40,
				state: "preview",
				previewFirst: true,
			},
			{ id: "resume", labelKey: "session.action.resume", order: 50 },
			{ id: "viewPromptings", labelKey: "session.action.viewPromptings", order: 60 },
			{ id: "viewRuns", labelKey: "session.action.viewRuns", order: 70 },
			{ id: "viewEdits", labelKey: "session.action.viewEdits", order: 80 },
			{ id: "mergeWizard", labelKey: "session.action.mergeWizard", order: 90, state: "preview", previewFirst: true },
			{
				id: "mergePreview",
				labelKey: "session.action.mergePreview",
				order: 100,
				state: "preview",
				previewFirst: true,
			},
			{
				id: "importHistory",
				labelKey: "session.action.importHistory",
				order: 110,
				state: "preview",
				previewFirst: true,
			},
			{
				id: "applyEdits",
				labelKey: "session.action.applyEdits",
				order: 120,
				state: "preview",
				previewFirst: true,
				dangerous: true,
			},
			{
				id: "applyFinalSnapshot",
				labelKey: "session.action.applyFinalSnapshot",
				order: 130,
				state: "preview",
				previewFirst: true,
				dangerous: true,
			},
		],
	},
	{
		kind: "prompting",
		titleKey: "prompting.action.title",
		getActions: (node, context) => {
			const hasRuns = getRunsForPrompting(context.events, node.id).length > 0;
			const hasEdits = context.events.some((event) => event.type === "edit" && event.parent_prompting === node.id);
			const hasCommits = getCommitsForPrompting(context.events, node.id).length > 0;
			return [
				{ id: "viewOriginal", labelKey: "prompting.action.viewOriginal", order: 10 },
				hasRuns
					? { id: "viewRuns", labelKey: "prompting.action.viewRuns", order: 20 }
					: disabled({ id: "viewRuns", labelKey: "prompting.action.viewRuns", order: 20 }),
				hasEdits
					? { id: "viewEdits", labelKey: "prompting.action.viewEdits", order: 30 }
					: disabled({ id: "viewEdits", labelKey: "prompting.action.viewEdits", order: 30 }),
				hasCommits
					? { id: "viewCommits", labelKey: "prompting.action.viewCommits", order: 40 }
					: disabled({ id: "viewCommits", labelKey: "prompting.action.viewCommits", order: 40 }),
				{ id: "readOnlyInquiry", labelKey: "prompting.action.readOnlyInquiry", order: 50 },
				{
					id: "forkBefore",
					labelKey: "prompting.action.forkBefore",
					order: 60,
					state: "preview",
					previewFirst: true,
				},
				{ id: "retry", labelKey: "prompting.action.retry", order: 70, state: "preview", previewFirst: true },
				{
					id: "forkAfter",
					labelKey: "prompting.action.forkAfter",
					order: 80,
					state: "preview",
					previewFirst: true,
				},
			];
		},
	},
	{
		kind: "run",
		titleKey: "run.action.title",
		getActions: (node, context) => {
			const run = node.event ?? context.events.find((event) => String(event.id) === node.id);
			const parentPrompting = String(run?.parent_prompting ?? "");
			const hasEdits = getEditsForRun(context.events, node.id).length > 0;
			const hasCommits = getCommitsForRun(context.events, node.id).length > 0;
			return [
				{ id: "viewDetails", labelKey: "run.action.viewDetails", order: 10 },
				parentPrompting
					? { id: "viewParentPrompting", labelKey: "run.action.viewParentPrompting", order: 20 }
					: disabled({ id: "viewParentPrompting", labelKey: "run.action.viewParentPrompting", order: 20 }),
				hasEdits
					? { id: "viewEdits", labelKey: "run.action.viewEdits", order: 30 }
					: disabled({ id: "viewEdits", labelKey: "run.action.viewEdits", order: 30 }),
				hasCommits
					? { id: "viewCommits", labelKey: "run.action.viewCommits", order: 40 }
					: disabled({ id: "viewCommits", labelKey: "run.action.viewCommits", order: 40 }),
			];
		},
	},
	{
		kind: "edit",
		titleKey: "edit.action.title",
		getActions: (node, context) => {
			const edit =
				node.event ?? context.events.find((event) => event.type === "edit" && String(event.id) === node.id);
			const hasParentPrompting = Boolean(edit?.parent_prompting);
			const hasParentRun = Boolean(edit?.parent_run);
			const hasRelations =
				getCommitsForEdit(context.events, node.id).length > 0 ||
				context.events.some(
					(event) =>
						event.type === "merge" &&
						["imported_edits", "applied_edits", "conflict_edits", "skipped_edits", "resolution_edits"].some(
							(field) => stringArray(event[field]).includes(node.id),
						),
				) ||
				context.events.some((event) => event.type === "edit_reverted" && event.edit_id === node.id);
			return [
				{ id: "viewPatch", labelKey: "edit.action.viewPatch", order: 10 },
				{ id: "viewChangedFiles", labelKey: "edit.action.viewChangedFiles", order: 20 },
				hasParentPrompting
					? { id: "viewParentPrompting", labelKey: "edit.action.viewParentPrompting", order: 30 }
					: disabled({ id: "viewParentPrompting", labelKey: "edit.action.viewParentPrompting", order: 30 }),
				hasParentRun
					? { id: "viewParentRun", labelKey: "edit.action.viewParentRun", order: 40 }
					: disabled({ id: "viewParentRun", labelKey: "edit.action.viewParentRun", order: 40 }),
				hasRelations
					? { id: "viewRelations", labelKey: "edit.action.viewRelations", order: 50 }
					: disabled({ id: "viewRelations", labelKey: "edit.action.viewRelations", order: 50 }),
				{ id: "readOnlyInquiry", labelKey: "edit.action.readOnlyInquiry", order: 60 },
				{ id: "forkBefore", labelKey: "edit.action.forkBefore", order: 70, state: "preview", previewFirst: true },
				{ id: "forkAfter", labelKey: "edit.action.forkAfter", order: 80, state: "preview", previewFirst: true },
				{
					id: "previewRevert",
					labelKey: "edit.action.previewRevert",
					order: 90,
					state: "preview",
					previewFirst: true,
					dangerous: true,
				},
			];
		},
	},
	{
		kind: "commit",
		titleKey: "commit.action.title",
		getActions: (node, context) => {
			const projection = buildGitCommitProjection(context.events, node.id, node.id);
			const hasPromptings = projection.promptingIds.size > 0;
			const hasRuns = projection.runIds.size > 0;
			const hasEdits = projection.editIds.size > 0;
			return [
				{ id: "viewDetails", labelKey: "commit.action.viewDetails", order: 10 },
				hasPromptings
					? { id: "viewPromptings", labelKey: "commit.action.viewPromptings", order: 20 }
					: disabled({ id: "viewPromptings", labelKey: "commit.action.viewPromptings", order: 20 }),
				hasRuns
					? { id: "viewRuns", labelKey: "commit.action.viewRuns", order: 30 }
					: disabled({ id: "viewRuns", labelKey: "commit.action.viewRuns", order: 30 }),
				hasEdits
					? { id: "viewEdits", labelKey: "commit.action.viewEdits", order: 40 }
					: disabled({ id: "viewEdits", labelKey: "commit.action.viewEdits", order: 40 }),
			];
		},
	},
	{
		kind: "subagent",
		titleKey: "subagent.action.title",
		getActions: (node, context) => {
			const subagent = node.event ?? context.events.find((event) => String(event.id) === node.id);
			const parentPrompting = String(subagent?.parent_prompting ?? "");
			const hasRuns = getRunsForSubagent(context.events, node.id).length > 0;
			const hasEdits = context.events.some((event) => event.type === "edit" && event.parent_subagent === node.id);
			return [
				{ id: "viewDetails", labelKey: "subagent.action.viewDetails", order: 10 },
				parentPrompting
					? { id: "viewParentPrompting", labelKey: "subagent.action.viewParentPrompting", order: 20 }
					: disabled({ id: "viewParentPrompting", labelKey: "subagent.action.viewParentPrompting", order: 20 }),
				hasRuns
					? { id: "viewRuns", labelKey: "subagent.action.viewRuns", order: 30 }
					: disabled({ id: "viewRuns", labelKey: "subagent.action.viewRuns", order: 30 }),
				hasEdits
					? { id: "viewEdits", labelKey: "subagent.action.viewEdits", order: 40 }
					: disabled({ id: "viewEdits", labelKey: "subagent.action.viewEdits", order: 40 }),
				{
					id: "runSubagent",
					labelKey: "subagent.action.run",
					order: 50,
					state: "future",
					reasonKey: "process.action.disabled.futureRuntime",
				},
			];
		},
	},
	{
		kind: "merge",
		titleKey: "merge.action.title",
		getActions: (node) => {
			const merge = node.event;
			const sourceSession = String(merge?.source_session ?? "");
			const targetSession = String(merge?.target_session ?? merge?.session_id ?? "");
			const hasApplied = stringArray(merge?.applied_edits).length > 0;
			const hasConflicts = stringArray(merge?.conflict_edits).length > 0;
			const hasResolutions = stringArray(merge?.resolution_edits).length > 0;
			return [
				{ id: "viewDetails", labelKey: "merge.action.viewDetails", order: 10 },
				sourceSession
					? { id: "viewSourceSession", labelKey: "merge.action.viewSourceSession", order: 20 }
					: disabled({ id: "viewSourceSession", labelKey: "merge.action.viewSourceSession", order: 20 }),
				targetSession
					? { id: "viewTargetSession", labelKey: "merge.action.viewTargetSession", order: 30 }
					: disabled({ id: "viewTargetSession", labelKey: "merge.action.viewTargetSession", order: 30 }),
				hasApplied
					? { id: "viewAppliedEdits", labelKey: "merge.action.viewAppliedEdits", order: 40 }
					: disabled({ id: "viewAppliedEdits", labelKey: "merge.action.viewAppliedEdits", order: 40 }),
				hasConflicts
					? { id: "viewConflictEdits", labelKey: "merge.action.viewConflictEdits", order: 50 }
					: disabled({ id: "viewConflictEdits", labelKey: "merge.action.viewConflictEdits", order: 50 }),
				hasResolutions
					? { id: "viewResolutionEdits", labelKey: "merge.action.viewResolutionEdits", order: 60 }
					: disabled({ id: "viewResolutionEdits", labelKey: "merge.action.viewResolutionEdits", order: 60 }),
				{
					id: "mergePreview",
					labelKey: "merge.action.previewSource",
					order: 70,
					state: "preview",
					previewFirst: true,
				},
				{
					id: "captureResolution",
					labelKey: "merge.action.captureResolution",
					order: 80,
					state: hasConflicts ? "preview" : "disabled",
					reasonKey: hasConflicts ? undefined : "process.action.disabled.noConflict",
					previewFirst: true,
					dangerous: true,
				},
			];
		},
	},
	{
		kind: "fork",
		titleKey: "fork.action.title",
		getActions: (node) => {
			const fork = node.event;
			const hasSource = Boolean(fork?.fork_from_type && fork?.fork_from_id);
			const hasParent = Boolean(fork?.parent_session);
			const forkSession = String(fork?.session_id ?? fork?.id ?? "");
			return [
				{ id: "viewDetails", labelKey: "fork.action.viewDetails", order: 10 },
				hasSource
					? { id: "viewSource", labelKey: "fork.action.viewSource", order: 20 }
					: disabled({ id: "viewSource", labelKey: "fork.action.viewSource", order: 20 }),
				hasParent
					? { id: "viewParentSession", labelKey: "fork.action.viewParentSession", order: 30 }
					: disabled({ id: "viewParentSession", labelKey: "fork.action.viewParentSession", order: 30 }),
				forkSession
					? { id: "resume", labelKey: "fork.action.resume", order: 40, state: "preview", previewFirst: true }
					: disabled({ id: "resume", labelKey: "fork.action.resume", order: 40 }),
			];
		},
	},
	{
		kind: "revert",
		titleKey: "revert.action.title",
		getActions: (node) => {
			const revert = node.event;
			const originalEdit = revert ? revertedEditId(revert) : "";
			const reverseEdit = revert ? revertEditId(revert) : "";
			const hasRelations = revert ? revertRelatedEditIds(revert).length > 0 : false;
			return [
				{ id: "viewDetails", labelKey: "revert.action.viewDetails", order: 10 },
				originalEdit
					? { id: "viewOriginalEdit", labelKey: "revert.action.viewOriginalEdit", order: 20 }
					: disabled({ id: "viewOriginalEdit", labelKey: "revert.action.viewOriginalEdit", order: 20 }),
				reverseEdit
					? { id: "viewRevertEdit", labelKey: "revert.action.viewRevertEdit", order: 30 }
					: disabled({ id: "viewRevertEdit", labelKey: "revert.action.viewRevertEdit", order: 30 }),
				hasRelations
					? { id: "viewRelations", labelKey: "revert.action.viewRelations", order: 40 }
					: disabled({ id: "viewRelations", labelKey: "revert.action.viewRelations", order: 40 }),
			];
		},
	},
	{
		kind: "conflict",
		titleKey: "conflict.action.title",
		getActions: (node) => {
			const conflict = node.event;
			const sourceSession = String(conflict?.source_session ?? "");
			const targetSession = String(conflict?.target_session ?? conflict?.session_id ?? "");
			const hasConflicts = stringArray(conflict?.conflict_edits).length > 0;
			const hasSkipped = stringArray(conflict?.skipped_edits).length > 0;
			const hasResolutions = stringArray(conflict?.resolution_edits).length > 0;
			const hasRelatedEdits = conflict ? conflictRelatedEditIds(conflict).length > 0 : false;
			return [
				{ id: "viewDetails", labelKey: "conflict.action.viewDetails", order: 10 },
				{ id: "viewMerge", labelKey: "conflict.action.viewMerge", order: 20 },
				sourceSession
					? { id: "viewSourceSession", labelKey: "conflict.action.viewSourceSession", order: 30 }
					: disabled({ id: "viewSourceSession", labelKey: "conflict.action.viewSourceSession", order: 30 }),
				targetSession
					? { id: "viewTargetSession", labelKey: "conflict.action.viewTargetSession", order: 40 }
					: disabled({ id: "viewTargetSession", labelKey: "conflict.action.viewTargetSession", order: 40 }),
				hasConflicts
					? { id: "viewConflictEdits", labelKey: "conflict.action.viewConflictEdits", order: 50 }
					: disabled({ id: "viewConflictEdits", labelKey: "conflict.action.viewConflictEdits", order: 50 }),
				hasSkipped
					? { id: "viewSkippedEdits", labelKey: "conflict.action.viewSkippedEdits", order: 60 }
					: disabled({ id: "viewSkippedEdits", labelKey: "conflict.action.viewSkippedEdits", order: 60 }),
				hasResolutions
					? { id: "viewResolutionEdits", labelKey: "conflict.action.viewResolutionEdits", order: 70 }
					: disabled({ id: "viewResolutionEdits", labelKey: "conflict.action.viewResolutionEdits", order: 70 }),
				{
					id: "captureResolution",
					labelKey: "conflict.action.captureResolution",
					order: 80,
					state: hasRelatedEdits ? "preview" : "disabled",
					reasonKey: hasRelatedEdits ? undefined : "process.action.disabled.noConflict",
					previewFirst: true,
					dangerous: true,
				},
			];
		},
	},
];
