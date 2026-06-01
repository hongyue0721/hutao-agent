import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { HutaoEvent } from "../event-store.ts";
import type { TranslationKey } from "../i18n.ts";
import type { HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "../process-tree/types.ts";

export type HutaoProcessActionId =
	| "openDetail"
	| "viewOriginal"
	| "viewRuns"
	| "viewEdits"
	| "viewCommits"
	| "viewPatch"
	| "viewChangedFiles"
	| "viewParentPrompting"
	| "viewParentRun"
	| "viewRelations"
	| "readOnlyInquiry"
	| "resumeAfter"
	| "forkBefore"
	| "retry"
	| "forkAfter"
	| "previewRevert";

export interface HutaoProcessAction {
	id: HutaoProcessActionId;
	labelKey: TranslationKey;
	order?: number;
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
	openPrompting(id: string): Promise<void>;
	openSubagent(id: string): Promise<void>;
	openRun(id: string): Promise<void>;
	openEdit(id: string): Promise<void>;
	openCommit(id: string): Promise<void>;
	openMerge(id: string): Promise<void>;
	viewPromptingEdits(promptingId: string): Promise<void>;
	viewPromptingRuns(promptingId: string): Promise<void>;
	viewPromptingCommits(promptingId: string): Promise<void>;
	viewEditChangedFiles(editId: string): Promise<void>;
	viewEditParentRun(runId: string): Promise<void>;
	viewEditRelations(editId: string): Promise<void>;
	resumePromptingAfter(prompting: HutaoEvent): Promise<void>;
	resumeEditAfter(edit: HutaoEvent): Promise<void>;
	forkPrompting(promptingId: string, mode: "before" | "retry" | "after"): Promise<void>;
	forkEdit(editId: string, mode: "before" | "after"): Promise<void>;
	previewRevertEdit(editId: string): Promise<void>;
	openReadOnlyInquiry(target: HutaoProcessActionTarget): Promise<void>;
	noAction(title: string): void;
}

export interface HutaoProcessActionExecutionContext {
	repoRoot: string;
	events: HutaoEvent[];
	ctx: ExtensionCommandContext;
	handlers: HutaoProcessActionCommandHandlers;
}
