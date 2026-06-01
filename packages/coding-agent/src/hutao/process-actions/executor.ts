import type { HutaoEvent } from "../event-store.ts";
import type { HutaoProcessTreeNode } from "../process-tree/types.ts";
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
		return handlers.noAction(`Hutao ${node.kind}`);
	}

	async execute(action: HutaoProcessAction, target: HutaoProcessActionTarget): Promise<void> {
		const handlers = this.context.handlers;
		const event = requireEvent(target, this.context.events);
		if (action.id === "openDetail" || action.id === "viewOriginal" || action.id === "viewPatch") {
			if (target.kind === "prompting") return handlers.openPrompting(target.id);
			if (target.kind === "edit") return handlers.openEdit(target.id);
			return this.executeNodeDefault(target.node ?? { kind: target.kind, id: target.id, label: target.id, depth: 0 });
		}
		if (action.id === "viewRuns" && target.kind === "prompting") return handlers.viewPromptingRuns(target.id);
		if (action.id === "viewEdits" && target.kind === "prompting") return handlers.viewPromptingEdits(target.id);
		if (action.id === "viewCommits" && target.kind === "prompting") return handlers.viewPromptingCommits(target.id);
		if (action.id === "viewChangedFiles" && target.kind === "edit") return handlers.viewEditChangedFiles(target.id);
		if (action.id === "viewParentPrompting" && target.kind === "edit") {
			const parentPrompting = String(event?.parent_prompting ?? "");
			return parentPrompting ? handlers.openPrompting(parentPrompting) : handlers.noAction("Hutao edit");
		}
		if (action.id === "viewParentRun" && target.kind === "edit") {
			const parentRun = String(event?.parent_run ?? "");
			return parentRun ? handlers.viewEditParentRun(parentRun) : handlers.noAction("Hutao edit");
		}
		if (action.id === "viewRelations" && target.kind === "edit") return handlers.viewEditRelations(target.id);
		if (action.id === "readOnlyInquiry") return handlers.openReadOnlyInquiry(target);
		if (action.id === "resumeAfter" && target.kind === "prompting" && event) return handlers.resumePromptingAfter(event);
		if (action.id === "resumeAfter" && target.kind === "edit" && event) return handlers.resumeEditAfter(event);
		if (action.id === "forkBefore" && target.kind === "prompting") return handlers.forkPrompting(target.id, "before");
		if (action.id === "forkBefore" && target.kind === "edit") return handlers.forkEdit(target.id, "before");
		if (action.id === "retry" && target.kind === "prompting") return handlers.forkPrompting(target.id, "retry");
		if (action.id === "forkAfter" && target.kind === "prompting") return handlers.forkPrompting(target.id, "after");
		if (action.id === "forkAfter" && target.kind === "edit") return handlers.forkEdit(target.id, "after");
		if (action.id === "previewRevert" && target.kind === "edit") return handlers.previewRevertEdit(target.id);
		return handlers.noAction(`Hutao ${target.kind}`);
	}
}

export function processActionTargetFromNode(node: HutaoProcessTreeNode): HutaoProcessActionTarget {
	return targetFromNode(node);
}
