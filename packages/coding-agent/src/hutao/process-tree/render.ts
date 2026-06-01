import type { HutaoEvent } from "../event-store.ts";
import { eventTitle, shortId, stringArray } from "./helpers.ts";
import { mergeSubagentEvents, relatedEditsForRun } from "./model.ts";

export function renderPromptingTree(lines: string[], events: HutaoEvent[], promptings: HutaoEvent[]): void {
	for (const prompting of promptings) {
		lines.push(`├─ Prompting ${shortId(prompting.id)} ${eventTitle(prompting)}`);
		const subagentIds = new Set(
			mergeSubagentEvents(events)
				.filter((event) => event.parent_prompting === prompting.id)
				.map((event) => String(event.id)),
		);
		const runs = events.filter(
			(event) =>
				event.type === "run_finished" &&
				event.parent_prompting === prompting.id &&
				!subagentIds.has(String(event.parent_subagent ?? "")),
		);
		for (const run of runs) {
			lines.push(`│  ├─ Run ${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "unknown"}`);
			for (const edit of relatedEditsForRun(events, run.id)) {
				lines.push(`│  │  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
		for (const edit of events.filter((event) => event.type === "edit" && event.parent_prompting === prompting.id)) {
			if (subagentIds.has(String(edit.parent_subagent ?? ""))) continue;
			if (!runs.some((run) => relatedEditsForRun(events, run.id).includes(edit))) {
				lines.push(`│  └─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
			}
		}
	}
}
