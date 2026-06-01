import { processTreeNodeId, shortId } from "../helpers.ts";
import type { HutaoProcessTreeContributor, HutaoProcessTreeNode } from "../types.ts";

export const sessionContributor: HutaoProcessTreeContributor = {
	kind: "session",
	collect(context): HutaoProcessTreeNode[] {
		const sessionIds = new Set(context.promptings.map((event) => String(event.session_id ?? "")));
		const knownSessions = context.sessions.filter((session) => sessionIds.has(session.id));
		const orphanSessionIds = [...sessionIds].filter(
			(id) => id && !knownSessions.some((session) => session.id === id),
		);
		const sessionEntries = [
			...knownSessions.map((session) => ({ id: session.id, kind: session.kind, status: session.status })),
			...orphanSessionIds.map((id) => ({ id, kind: "session", status: "unknown" })),
		];
		return sessionEntries
			.filter((session) => context.promptings.some((event) => event.session_id === session.id))
			.map((session, order) => {
				const sessionPromptings = context.promptings.filter((event) => event.session_id === session.id);
				return {
					kind: "session",
					id: session.id,
					nodeId: processTreeNodeId("session", session.id),
					label: `Session ${shortId(session.id)} ${session.kind} ${session.status} promptings=${sessionPromptings.length}`,
					depth: 0,
					order,
				};
			});
	},
};
