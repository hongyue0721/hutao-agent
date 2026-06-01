import type { HutaoEvent, HutaoSessionMetadata } from "../event-store.ts";

export type HutaoProcessTreeNodeKind = "session" | "prompting" | "subagent" | "run" | "edit" | "commit" | "merge";

export interface HutaoProcessTreeNode {
	kind: HutaoProcessTreeNodeKind;
	id: string;
	label: string;
	depth: number;
	event?: HutaoEvent;
	nodeId?: string;
	parentNodeId?: string;
	order?: number;
}

export interface HutaoProcessTreeBuildContext {
	repoRoot: string;
	events: HutaoEvent[];
	promptings: HutaoEvent[];
	sessions: HutaoSessionMetadata[];
}

export interface HutaoProcessTreeContributor {
	kind: string;
	collect(context: HutaoProcessTreeBuildContext): HutaoProcessTreeNode[];
}
