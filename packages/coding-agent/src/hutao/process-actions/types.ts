import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { HutaoEvent } from "../event-store.ts";
import type { TranslationKey } from "../i18n.ts";
import type { HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "../process-tree/types.ts";

export type HutaoProcessActionState = "enabled" | "preview" | "disabled" | "future";

export type HutaoProcessActionId =
	| "openDetail"
	| "viewDetails"
	| "viewConversation"
	| "previewHydration"
	| "queueHydration"
	| "resume"
	| "viewOriginal"
	| "viewPromptings"
	| "viewRuns"
	| "viewEdits"
	| "viewCommits"
	| "viewPatch"
	| "viewChangedFiles"
	| "viewParentPrompting"
	| "viewParentRun"
	| "viewRelations"
	| "viewOriginalEdit"
	| "viewRevertEdit"
	| "viewMerge"
	| "viewSource"
	| "viewSourceSession"
	| "viewTargetSession"
	| "viewParentSession"
	| "viewAppliedEdits"
	| "viewConflictEdits"
	| "viewSkippedEdits"
	| "viewResolutionEdits"
	| "readOnlyInquiry"
	| "resumeAfter"
	| "forkBefore"
	| "retry"
	| "forkAfter"
	| "mergeWizard"
	| "mergePreview"
	| "importHistory"
	| "applyEdits"
	| "applyFinalSnapshot"
	| "previewRevert"
	| "captureResolution"
	| "runSubagent"
	| "notImplemented";

export interface HutaoProcessAction {
	id: HutaoProcessActionId | (string & {});
	labelKey: TranslationKey;
	order?: number;
	/**
	 * Execution availability for menu rendering and dispatch.
	 * enabled: run immediately.
	 * preview: selectable, but expected to route through an existing preview/confirm flow.
	 * disabled/future: visible menu shell; selecting it reports why it is unavailable.
	 */
	state?: HutaoProcessActionState;
	reasonKey?: TranslationKey;
	/** Metadata for audits/tests. It does not by itself block execution. */
	previewFirst?: boolean;
	dangerous?: boolean;
	/** Kept as a non-blocking marker for older tests/docs that called some experimental actions future-facing. */
	future?: boolean;
}

export interface HutaoProcessActionRegistryContext {
	repoRoot: string;
	events: HutaoEvent[];
}

export interface HutaoProcessActionRegistration {
	kind: HutaoProcessTreeNodeKind;
	titleKey: TranslationKey;
	getActions(node: HutaoProcessTreeNode, context: HutaoProcessActionRegistryContext): HutaoProcessAction[];
}

export interface HutaoProcessActionTarget {
	kind: HutaoProcessTreeNodeKind;
	id: string;
	event?: HutaoEvent;
	node?: HutaoProcessTreeNode;
}

export interface HutaoProcessActionCommandHandlers {
	openSession(id: string): Promise<void>;
	viewSessionConversation(id: string): Promise<void>;
	previewSessionHydration(id: string): Promise<void>;
	queueSessionHydration(id: string): Promise<void>;
	resumeSession(id: string): Promise<void>;
	viewSessionPromptings(id: string): Promise<void>;
	viewSessionRuns(id: string): Promise<void>;
	viewSessionEdits(id: string): Promise<void>;
	mergeSessionWizard(id: string): Promise<void>;
	previewMergeSession(id: string): Promise<void>;
	importSessionHistory(id: string): Promise<void>;
	applySessionEdits(id: string): Promise<void>;
	applySessionFinalSnapshot(id: string): Promise<void>;
	openPrompting(id: string): Promise<void>;
	openSubagent(id: string): Promise<void>;
	openRun(id: string): Promise<void>;
	openEdit(id: string): Promise<void>;
	openCommit(id: string): Promise<void>;
	openMerge(id: string): Promise<void>;
	openRevert(id: string): Promise<void>;
	openConflict(id: string): Promise<void>;
	viewPromptingEdits(promptingId: string): Promise<void>;
	viewPromptingRuns(promptingId: string): Promise<void>;
	viewPromptingCommits(promptingId: string): Promise<void>;
	viewRunPrompting(runId: string): Promise<void>;
	viewRunEdits(runId: string): Promise<void>;
	viewRunCommits(runId: string): Promise<void>;
	viewCommitPromptings(commit: string): Promise<void>;
	viewCommitRuns(commit: string): Promise<void>;
	viewCommitEdits(commit: string): Promise<void>;
	viewSubagentPrompting(subagentId: string): Promise<void>;
	viewSubagentRuns(subagentId: string): Promise<void>;
	viewSubagentEdits(subagentId: string): Promise<void>;
	viewEditChangedFiles(editId: string): Promise<void>;
	viewEditParentRun(runId: string): Promise<void>;
	viewEditRelations(editId: string): Promise<void>;
	viewMergeSourceSession(mergeId: string): Promise<void>;
	viewMergeTargetSession(mergeId: string): Promise<void>;
	viewMergeAppliedEdits(mergeId: string): Promise<void>;
	viewMergeConflictEdits(mergeId: string): Promise<void>;
	viewMergeResolutionEdits(mergeId: string): Promise<void>;
	previewMergeSource(mergeId: string): Promise<void>;
	captureMergeResolution(mergeId: string): Promise<void>;
	openFork(id: string): Promise<void>;
	viewForkSource(forkId: string): Promise<void>;
	viewForkParentSession(forkId: string): Promise<void>;
	resumeForkSession(forkId: string): Promise<void>;
	viewRevertOriginalEdit(revertId: string): Promise<void>;
	viewRevertEdit(revertId: string): Promise<void>;
	viewRevertRelations(revertId: string): Promise<void>;
	viewConflictMerge(conflictId: string): Promise<void>;
	viewConflictSourceSession(conflictId: string): Promise<void>;
	viewConflictTargetSession(conflictId: string): Promise<void>;
	viewConflictEdits(conflictId: string): Promise<void>;
	viewConflictSkippedEdits(conflictId: string): Promise<void>;
	viewConflictResolutionEdits(conflictId: string): Promise<void>;
	captureConflictResolution(conflictId: string): Promise<void>;
	resumePromptingAfter(prompting: HutaoEvent): Promise<void>;
	resumeEditAfter(edit: HutaoEvent): Promise<void>;
	forkPrompting(promptingId: string, mode: "before" | "retry" | "after"): Promise<void>;
	forkEdit(editId: string, mode: "before" | "after"): Promise<void>;
	previewRevertEdit(editId: string): Promise<void>;
	openReadOnlyInquiry(target: HutaoProcessActionTarget): Promise<void>;
	unavailableAction(action: HutaoProcessAction, target: HutaoProcessActionTarget): void;
	noAction(title: string): void;
}

export interface HutaoProcessActionExecutionContext {
	repoRoot: string;
	events: HutaoEvent[];
	ctx: ExtensionCommandContext;
	handlers: HutaoProcessActionCommandHandlers;
}
