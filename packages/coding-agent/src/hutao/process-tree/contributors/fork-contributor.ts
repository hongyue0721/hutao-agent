import type { HutaoEvent } from "../../event-store.ts";
import {
	forkParentSessionId,
	forkSessionId,
	forkSourceId,
	forkSourceType,
	getVisibleForkEvents,
} from "../fork-model.ts";
import { firstLine, processTreeNodeId, shortId } from "../helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode, HutaoProcessTreeNodeKind } from "../types.ts";

function forkLabel(fork: Record<string, unknown>): string {
	const sourceType = String(fork.fork_from_type ?? "unknown");
	const sourceId = shortId(fork.fork_from_id);
	const mode = String(fork.fork_mode ?? "unknown");
	const parent = shortId(fork.parent_session);
	return [
		`Fork ${shortId(fork.id)}`,
		`${sourceType}:${sourceId || "unknown"}`,
		mode,
		parent ? `parent=${parent}` : "parent=none",
	]
		.filter(Boolean)
		.join(" ");
}

function relationSessionNode(
	forkId: unknown,
	role: "parent" | "fork",
	sessionId: unknown,
	order: number,
): HutaoProcessTreeNode | undefined {
	const id = String(sessionId ?? "");
	if (!id) return undefined;
	return {
		kind: "session",
		id,
		nodeId: processTreeNodeId("fork-session", `${forkId}:${role}:${id}`),
		parentNodeId: processTreeNodeId("fork", forkId),
		label: `${role === "parent" ? "Parent" : "Fork"} session ${shortId(id)}`,
		depth: 2,
		order,
	};
}

function sourceKind(sourceType: string): HutaoProcessTreeNodeKind | undefined {
	if (sourceType === "prompting") return "prompting";
	if (sourceType === "edit") return "edit";
	if (sourceType === "session") return "session";
	return undefined;
}

export const forkContributor: HutaoProcessTreeContributor = {
	kind: "fork",
	collect(context): HutaoProcessTreeNode[] {
		const eventsByTypeAndId = new Map<string, HutaoEvent>(
			context.events.map((event) => [`${event.type}:${String(event.id)}`, event]),
		);
		const nodes: HutaoProcessTreeNode[] = [];
		for (const [forkIndex, fork] of getVisibleForkEvents(context).entries()) {
			const id = String(fork.id);
			const parentSession = forkParentSessionId(fork);
			const sessionId = forkSessionId(fork);
			const parentNodeSession = parentSession || sessionId;
			nodes.push({
				kind: "fork",
				id,
				nodeId: processTreeNodeId("fork", id),
				parentNodeId: parentNodeSession ? processTreeNodeId("session", parentNodeSession) : undefined,
				label: forkLabel(fork),
				depth: parentNodeSession ? 1 : 0,
				event: fork,
				order: 8000 + forkIndex,
			});

			const parent = relationSessionNode(id, "parent", parentSession, 10);
			const forkSession = relationSessionNode(id, "fork", sessionId, 20);
			if (parent) nodes.push(parent);
			if (forkSession && forkSession.id !== parent?.id) nodes.push(forkSession);

			const sourceTypeValue = String(forkSourceType(fork));
			const sourceIdValue = forkSourceId(fork);
			if (sourceTypeValue === "commit" && sourceIdValue) {
				nodes.push({
					kind: "commit",
					id: sourceIdValue,
					nodeId: processTreeNodeId("fork-source", `${id}:commit:${sourceIdValue}`),
					parentNodeId: processTreeNodeId("fork", id),
					label: `Source commit ${shortId(sourceIdValue)}`,
					depth: 2,
					order: 30,
				});
				continue;
			}

			const kind = sourceKind(sourceTypeValue);
			if (!kind || !sourceIdValue) continue;
			const sourceEvent = eventsByTypeAndId.get(`${kind}:${sourceIdValue}`);
			nodes.push({
				kind,
				id: sourceIdValue,
				nodeId: processTreeNodeId("fork-source", `${id}:${kind}:${sourceIdValue}`),
				parentNodeId: processTreeNodeId("fork", id),
				label: sourceEvent
					? `Source ${kind} ${shortId(sourceIdValue)} ${firstLine(sourceEvent.text ?? sourceEvent.summary ?? sourceEvent.title ?? "")}`
					: `Source ${kind} ${shortId(sourceIdValue)} [missing source event]`,
				depth: 2,
				event: sourceEvent,
				order: 30,
			});
		}
		return nodes;
	},
};
