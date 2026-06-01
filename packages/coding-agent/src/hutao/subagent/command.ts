import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { HutaoEvent } from "../event-store.ts";
import { GitAdapter } from "../git-adapter.ts";
import { readAllEvents } from "../read-model.ts";
import { getEditsForSubagent, getRunsForSubagent, stringArray } from "../trace-relations.ts";
import { findSubagentRecord, getSubagentRecords } from "./read-model.ts";
import type { SubagentRecord } from "./schema.ts";

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function firstLine(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

function getFlagValue(parts: string[], flag: string): string | undefined {
	const index = parts.indexOf(flag);
	return index === -1 ? undefined : parts[index + 1];
}

function notify(
	ctx: ExtensionCommandContext,
	title: string,
	lines: string[],
	type: "info" | "warning" | "error" = "info",
): void {
	ctx.ui.notify(`${title}\n${lines.join("\n")}`, type);
}

async function getRepoRoot(ctx: ExtensionCommandContext): Promise<string | undefined> {
	return new GitAdapter(ctx.cwd).getRepoRoot();
}

async function selectItem<T>(
	ctx: ExtensionCommandContext,
	title: string,
	items: T[],
	render: (item: T, index: number) => string,
): Promise<T | undefined> {
	if (items.length === 0) return undefined;
	const labels = items.map((item, index) => `${String(index + 1).padStart(2, "0")}. ${render(item, index)}`);
	const choice = await ctx.ui.select(title, labels);
	if (!choice) return undefined;
	const index = labels.indexOf(choice);
	return index === -1 ? undefined : items[index];
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

function subagentListLabel(record: SubagentRecord): string {
	return `${shortId(record.id)} ${record.name ?? record.role ?? "subagent"} ${record.status} ${firstLine(record.task ?? record.summary ?? "")}`;
}

export async function subagentCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	const repoRoot = await getRepoRoot(ctx);
	if (!repoRoot) return notify(ctx, "Hutao subagent", ["Not in a Git repository."], "warning");
	const events = readAllEvents(repoRoot);
	const resolvers = { getRunsForSubagent, getEditsForSubagent };
	let subagents = getSubagentRecords(events, resolvers);
	const query = args.trim();
	const parts = query.split(/\s+/).filter(Boolean);
	const sessionFilter = getFlagValue(parts, "--session");
	const promptingFilter = getFlagValue(parts, "--prompting");
	if (sessionFilter) subagents = subagents.filter((record) => record.sessionId.startsWith(sessionFilter));
	if (promptingFilter)
		subagents = subagents.filter((record) => String(record.parentPrompting).startsWith(promptingFilter));
	if (!query || query.startsWith("--")) {
		const selected = await selectItem(ctx, "Select Hutao subagent", subagents.slice(-40), subagentListLabel);
		if (!selected)
			return notify(ctx, "Hutao subagent", [subagents.length ? "No subagent selected." : "No subagents found."]);
		return subagentCommand(selected.id, ctx);
	}
	const subagent = findSubagentRecord(events, query, resolvers);
	if (!subagent) return notify(ctx, "Hutao subagent", [`Not found: ${query}`], "warning");
	const runs = getRunsForSubagent(events, subagent.id);
	const edits = getEditsForSubagent(events, subagent.id);
	const lines = [
		`session: ${subagent.sessionId}`,
		`parent prompting: ${subagent.parentPrompting ?? "none"}`,
		`name: ${subagent.name}`,
		`role: ${subagent.role ?? "unknown"}`,
		`status: ${subagent.status}`,
		`started_at: ${subagent.startedAt ?? "unknown"}`,
		`ended_at: ${subagent.endedAt ?? "unknown"}`,
		`task: ${firstLine(subagent.task ?? "")}`,
		`summary: ${firstLine(subagent.summary ?? "")}`,
		`degraded: ${subagent.degraded}`,
		"",
	];
	pushEventList(
		lines,
		"Runs",
		runs,
		(run) =>
			`${shortId(run.id)} ${run.tool ?? "tool"} ${run.status ?? "started"} ${firstLine(run.output_summary ?? run.input_summary)}`,
	);
	pushEventList(lines, "Edits", edits, (edit) => `${shortId(edit.id)} ${stringArray(edit.files).join(",")}`);
	lines.push("actions: /prompting <parent>, /run <id>, /edit <id>");
	notify(ctx, `Subagent ${subagent.id}`, lines);
}
