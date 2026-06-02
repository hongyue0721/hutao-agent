import type { HutaoEvent } from "../event-store.ts";
import type { HutaoProcessTreeNode } from "../process-tree/types.ts";
import { isProcessActionUnavailable } from "./menu.ts";
import type { HutaoProcessAction, HutaoProcessActionExecutionContext, HutaoProcessActionTarget } from "./types.ts";

function targetFromNode(node: HutaoProcessTreeNode): HutaoProcessActionTarget {
	return { kind: node.kind, id: node.id, event: node.event, node };
}

function requireEvent(target: HutaoProcessActionTarget, events: HutaoEvent[]): HutaoEvent | undefined {
	return target.event ?? events.find((event) => event.type === target.kind && String(event.id) === target.id);
}

export class HutaoProcessActionExecutor {
	private readonly context: HutaoProcessActionExecutionContext;

	constructor(context: HutaoProcessActionExecutionContext) {
		this.context = context;
	}

	async executeNodeDefault(node: HutaoProcessTreeNode): Promise<void> {
		const handlers = this.context.handlers;
		if (node.kind === "session") return handlers.openSession(node.id);
		if (node.kind === "prompting") return handlers.openPrompting(node.id);
		if (node.kind === "subagent") return handlers.openSubagent(node.id);
		if (node.kind === "run") return handlers.openRun(node.id);
		if (node.kind === "edit") return handlers.openEdit(node.id);
		if (node.kind === "commit") return handlers.openCommit(node.id);
		if (node.kind === "merge") return handlers.openMerge(node.id);
		if (node.kind === "fork") return handlers.openFork(node.id);
		if (node.kind === "revert") return handlers.openRevert(node.id);
		if (node.kind === "conflict") return handlers.openConflict(node.id);
		return handlers.noAction(`Hutao ${node.kind}`);
	}

	async execute(action: HutaoProcessAction, target: HutaoProcessActionTarget): Promise<void> {
		const handlers = this.context.handlers;
		if (isProcessActionUnavailable(action)) return handlers.unavailableAction(action, target);
		const event = requireEvent(target, this.context.events);

		if (
			action.id === "openDetail" ||
			action.id === "viewDetails" ||
			action.id === "viewOriginal" ||
			action.id === "viewPatch"
		) {
			return this.executeNodeDefault(
				target.node ?? { kind: target.kind, id: target.id, label: target.id, depth: 0 },
			);
		}

		if (target.kind === "session") {
			if (action.id === "viewConversation") return handlers.viewSessionConversation(target.id);
			if (action.id === "previewHydration") return handlers.previewSessionHydration(target.id);
			if (action.id === "queueHydration") return handlers.queueSessionHydration(target.id);
			if (action.id === "resume") return handlers.resumeSession(target.id);
			if (action.id === "viewPromptings") return handlers.viewSessionPromptings(target.id);
			if (action.id === "viewRuns") return handlers.viewSessionRuns(target.id);
			if (action.id === "viewEdits") return handlers.viewSessionEdits(target.id);
			if (action.id === "mergeWizard") return handlers.mergeSessionWizard(target.id);
			if (action.id === "mergePreview") return handlers.previewMergeSession(target.id);
			if (action.id === "importHistory") return handlers.importSessionHistory(target.id);
			if (action.id === "applyEdits") return handlers.applySessionEdits(target.id);
			if (action.id === "applyFinalSnapshot") return handlers.applySessionFinalSnapshot(target.id);
		}

		if (target.kind === "prompting") {
			if (action.id === "viewRuns") return handlers.viewPromptingRuns(target.id);
			if (action.id === "viewEdits") return handlers.viewPromptingEdits(target.id);
			if (action.id === "viewCommits") return handlers.viewPromptingCommits(target.id);
			if (action.id === "readOnlyInquiry") return handlers.openReadOnlyInquiry(target);
			if (action.id === "resumeAfter" && event) return handlers.resumePromptingAfter(event);
			if (action.id === "forkBefore") return handlers.forkPrompting(target.id, "before");
			if (action.id === "retry") return handlers.forkPrompting(target.id, "retry");
			if (action.id === "forkAfter") return handlers.forkPrompting(target.id, "after");
		}

		if (target.kind === "run") {
			if (action.id === "viewParentPrompting") return handlers.viewRunPrompting(target.id);
			if (action.id === "viewEdits") return handlers.viewRunEdits(target.id);
			if (action.id === "viewCommits") return handlers.viewRunCommits(target.id);
		}

		if (target.kind === "edit") {
			if (action.id === "viewChangedFiles") return handlers.viewEditChangedFiles(target.id);
			if (action.id === "viewParentPrompting") {
				const parentPrompting = String(event?.parent_prompting ?? "");
				return parentPrompting ? handlers.openPrompting(parentPrompting) : handlers.noAction("Hutao edit");
			}
			if (action.id === "viewParentRun") {
				const parentRun = String(event?.parent_run ?? "");
				return parentRun ? handlers.viewEditParentRun(parentRun) : handlers.noAction("Hutao edit");
			}
			if (action.id === "viewRelations") return handlers.viewEditRelations(target.id);
			if (action.id === "readOnlyInquiry") return handlers.openReadOnlyInquiry(target);
			if (action.id === "resumeAfter" && event) return handlers.resumeEditAfter(event);
			if (action.id === "forkBefore") return handlers.forkEdit(target.id, "before");
			if (action.id === "forkAfter") return handlers.forkEdit(target.id, "after");
			if (action.id === "previewRevert") return handlers.previewRevertEdit(target.id);
		}

		if (target.kind === "commit") {
			if (action.id === "viewPromptings") return handlers.viewCommitPromptings(target.id);
			if (action.id === "viewRuns") return handlers.viewCommitRuns(target.id);
			if (action.id === "viewEdits") return handlers.viewCommitEdits(target.id);
		}

		if (target.kind === "subagent") {
			if (action.id === "viewParentPrompting") return handlers.viewSubagentPrompting(target.id);
			if (action.id === "viewRuns") return handlers.viewSubagentRuns(target.id);
			if (action.id === "viewEdits") return handlers.viewSubagentEdits(target.id);
			if (action.id === "runSubagent") return handlers.unavailableAction(action, target);
		}

		if (target.kind === "merge") {
			if (action.id === "viewSourceSession") return handlers.viewMergeSourceSession(target.id);
			if (action.id === "viewTargetSession") return handlers.viewMergeTargetSession(target.id);
			if (action.id === "viewAppliedEdits") return handlers.viewMergeAppliedEdits(target.id);
			if (action.id === "viewConflictEdits") return handlers.viewMergeConflictEdits(target.id);
			if (action.id === "viewResolutionEdits") return handlers.viewMergeResolutionEdits(target.id);
			if (action.id === "mergePreview") return handlers.previewMergeSource(target.id);
			if (action.id === "captureResolution") return handlers.captureMergeResolution(target.id);
		}

		if (target.kind === "fork") {
			if (action.id === "viewSource") return handlers.viewForkSource(target.id);
			if (action.id === "viewParentSession") return handlers.viewForkParentSession(target.id);
			if (action.id === "resume") return handlers.resumeForkSession(target.id);
		}

		if (target.kind === "revert") {
			if (action.id === "viewOriginalEdit") return handlers.viewRevertOriginalEdit(target.id);
			if (action.id === "viewRevertEdit") return handlers.viewRevertEdit(target.id);
			if (action.id === "viewRelations") return handlers.viewRevertRelations(target.id);
		}

		if (target.kind === "conflict") {
			if (action.id === "viewMerge") return handlers.viewConflictMerge(target.id);
			if (action.id === "viewSourceSession") return handlers.viewConflictSourceSession(target.id);
			if (action.id === "viewTargetSession") return handlers.viewConflictTargetSession(target.id);
			if (action.id === "viewConflictEdits") return handlers.viewConflictEdits(target.id);
			if (action.id === "viewSkippedEdits") return handlers.viewConflictSkippedEdits(target.id);
			if (action.id === "viewResolutionEdits") return handlers.viewConflictResolutionEdits(target.id);
			if (action.id === "captureResolution") return handlers.captureConflictResolution(target.id);
		}

		return handlers.noAction(`Hutao ${target.kind}`);
	}
}

export function processActionTargetFromNode(node: HutaoProcessTreeNode): HutaoProcessActionTarget {
	return targetFromNode(node);
}
