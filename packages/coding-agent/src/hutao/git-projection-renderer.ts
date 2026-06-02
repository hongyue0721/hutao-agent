import type { HutaoEvent } from "./event-store.ts";
import { applyTreeDisplayLabel, buildGitCommitProjection, type HutaoGitProjection } from "./git-projection.ts";
import { renderPromptingTree } from "./prompting-tree.ts";
import { stringArray } from "./trace-relations.ts";

export interface HutaoGitCommitRenderInput {
	events: HutaoEvent[];
	commit: string;
	query?: string;
	subject: string;
	tree?: string;
	parents: string[];
	status: string;
}

export interface HutaoGitGraphRenderInput {
	events: HutaoEvent[];
	head: string;
	status: string;
	range: string;
	fileFilter?: string;
	graphLines: string[];
	commitLimit?: number;
}

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function eventTouchesFile(event: HutaoEvent, file: string): boolean {
	return stringArray(event.files).some((entry) => entry === file || entry.endsWith(`/${file}`));
}

function eventsByType(events: HutaoEvent[], type: string): HutaoEvent[] {
	return events.filter((event) => event.type === type);
}

function runEvents(events: HutaoEvent[]): HutaoEvent[] {
	return events.filter((event) => event.type === "run_finished" || event.type === "run_started");
}

function renderMergeLine(event: HutaoEvent): string {
	return `${shortId(event.id)} ${event.mode ?? ""} ${event.status ?? ""} source=${shortId(event.source_session)} applied=${stringArray(event.applied_edits).length} conflicts=${stringArray(event.conflict_edits).length} resolutions=${stringArray(event.resolution_edits).join(",") || "none"}`;
}

function pushEventList(
	lines: string[],
	title: string,
	events: HutaoEvent[],
	render: (event: HutaoEvent) => string,
): void {
	lines.push(`${title}: ${events.length}`);
	for (const event of events.slice(-12)) lines.push(`  ${render(event)}`);
	if (events.length > 12) lines.push(`  ... ${events.length - 12} more`);
}

export function gitProjectionGraphSummary(projection: HutaoGitProjection): string {
	const methods = [...new Set(projection.evidence.map((entry) => entry.method))].join("+") || "none";
	const confidences = [...new Set(projection.evidence.map((entry) => entry.confidence))].join("+") || "unknown";
	return `links=${projection.links.length} method=${methods} confidence=${confidences} promptings=${projection.promptingIds.size} runs=${projection.runIds.size} edits=${projection.editIds.size} merges=${projection.relations.merges.length} conflicts=${projection.relations.conflicts.length} reverts=${projection.relations.reverts.length} forks=${projection.relations.forks.length}`;
}

export function renderGitCommitProjection(input: HutaoGitCommitRenderInput): string[] {
	const projection = buildGitCommitProjection(input.events, input.commit, input.query ?? input.commit);
	const promptings = eventsByType(input.events, "prompting").filter((event) =>
		projection.promptingIds.has(String(event.id)),
	);
	const runs = runEvents(input.events).filter((event) => projection.runIds.has(String(event.id)));
	const edits = eventsByType(input.events, "edit").filter((event) => projection.editIds.has(String(event.id)));
	const lines = [
		`commit: ${input.commit}`,
		`subject: ${input.subject || "unknown"}`,
		`git type: ${input.parents.length > 1 ? "merge commit" : "normal commit"}`,
		`tree: ${input.tree ?? "unknown"}`,
		`parents: ${input.parents.join(" ") || "none"}`,
		`status: ${input.status}`,
		`Hutao commit_link events: ${projection.links.length}`,
		"",
	];
	if (projection.evidence.length > 0) {
		lines.push("Link evidence:");
		for (const evidence of projection.evidence) {
			lines.push(
				`  ${String(evidence.link.id ?? "commit_link")} method=${evidence.method} confidence=${evidence.confidence} confirmed=${evidence.confirmed ? "yes" : "inferred"}`,
			);
			lines.push(`    reason: ${evidence.reason}`);
		}
		lines.push("");
	} else {
		lines.push("No confirmed Hutao commit_link found for this commit.");
		lines.push("Hutao provenance: unconfirmed; /git will not attribute this commit to AI without a link.");
		lines.push("Run /git scan to attempt conservative patch_match linking for recent commits.", "");
	}
	lines.push(`Promptings: ${promptings.length}`);
	renderPromptingTree(lines, input.events, promptings);
	pushEventList(lines, "Runs", runs, (event) => `${shortId(event.id)} ${event.tool ?? "tool"} ${event.status ?? "unknown"}`);
	pushEventList(lines, "Edits", edits, (event) => `${shortId(event.id)} ${stringArray(event.files).join(", ")}`);
	pushEventList(lines, "Related merges", projection.relations.merges, renderMergeLine);
	pushEventList(
		lines,
		"Related conflicts",
		projection.relations.conflicts,
		(event) =>
			`${shortId(event.id)} derived_from=merge mode=${applyTreeDisplayLabel(event.mode)} status=${event.status ?? "unknown"} conflicts=${stringArray(event.conflict_edits).join(",") || "none"} skipped=${stringArray(event.skipped_edits).join(",") || "none"} resolutions=${stringArray(event.resolution_edits).join(",") || "none"}`,
	);
	pushEventList(
		lines,
		"Related reverts",
		projection.relations.reverts,
		(event) => `${shortId(event.id)} original=${shortId(event.edit_id)} revert=${shortId(event.revert_edit_id)}`,
	);
	pushEventList(
		lines,
		"Related forks",
		projection.relations.forks,
		(event) =>
			`${shortId(event.id)} session=${shortId(event.session_id)} source=${event.fork_from_type ?? "unknown"}:${shortId(event.fork_from_id)}`,
	);
	return lines;
}

export function renderGitGraphProjection(input: HutaoGitGraphRenderInput): string[] {
	const commitLinks = eventsByType(input.events, "commit_link");
	const edits = eventsByType(input.events, "edit");
	const promptings = eventsByType(input.events, "prompting");
	const lines = [
		`HEAD: ${input.head}`,
		`status: ${input.status}`,
		`range: ${input.range}`,
		`file: ${input.fileFilter ?? "all"}`,
		"",
		...input.graphLines.slice(0, 60),
		"",
		"Hutao commit links:",
	];
	const commits = [
		...new Set(
			commitLinks
				.slice(-(input.commitLimit ?? 30))
				.map((link) => String(link.commit))
				.filter(Boolean),
		),
	];
	for (const commit of commits) {
		const projection = buildGitCommitProjection(input.events, commit);
		const linkedPromptings = promptings.filter((event) => projection.promptingIds.has(String(event.id)));
		const linkedEdits = edits.filter((event) => projection.editIds.has(String(event.id)));
		if (input.fileFilter && !linkedEdits.some((edit) => eventTouchesFile(edit, input.fileFilter!))) continue;
		lines.push(`Commit ${commit.slice(0, 12)} ${gitProjectionGraphSummary(projection)}`);
		renderPromptingTree(lines, input.events, linkedPromptings);
		for (const edit of linkedEdits.filter(
			(edit) => !linkedPromptings.some((prompting) => edit.parent_prompting === prompting.id),
		)) {
			lines.push(`└─ Edit ${shortId(edit.id)} ${stringArray(edit.files).join(", ") || "no files"}`);
		}
	}
	return lines;
}
