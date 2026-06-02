import type { SessionEntry } from "../core/session-manager.ts";
import type { ConversationSnapshot, ConversationTimelineItem } from "./conversation-store.ts";

type MessageLike = Record<string, unknown>;

function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

function firstLine(value: unknown, maxLength = 160): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const record = block as Record<string, unknown>;
			if (record.type === "text" || record.type === "thinking") return String(record.text ?? record.content ?? "");
			if (record.type === "toolCall") return `tool call ${record.name ?? "tool"} ${record.id ?? ""}`.trim();
			if (record.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function renderEntryLabel(entry: SessionEntry): string {
	if (entry.type === "message") {
		const message = entry.message as unknown as MessageLike;
		const role = String(message.role ?? "message");
		if (role === "toolResult") {
			return `tool result ${message.toolName ?? "tool"} ${message.isError ? "failed" : "ok"}`;
		}
		if (role === "bashExecution") return `bash ${firstLine(message.command)}`;
		if (role === "custom") return `custom ${message.customType ?? "message"}`;
		return role;
	}
	if (entry.type === "custom") return `custom ${entry.customType}`;
	if (entry.type === "custom_message") return `custom message ${entry.customType}`;
	return entry.type;
}

function renderEntryBody(entry: SessionEntry): string[] {
	if (entry.type === "message") {
		const message = entry.message as unknown as MessageLike;
		if (message.role === "bashExecution") {
			return [
				`command: ${firstLine(message.command, 240)}`,
				`exit: ${message.exitCode ?? "unknown"} cancelled=${message.cancelled ?? false} truncated=${message.truncated ?? false}`,
				firstLine(message.output, 240),
			].filter(Boolean);
		}
		if (message.role === "toolResult") {
			return [
				`tool_call_id: ${message.toolCallId ?? "unknown"}`,
				firstLine(textContent(message.content), 260),
			].filter(Boolean);
		}
		return [firstLine(textContent(message.content), 320)].filter(Boolean);
	}
	if (entry.type === "custom") return [firstLine(JSON.stringify(entry.data), 320)].filter(Boolean);
	if (entry.type === "custom_message") return [firstLine(textContent(entry.content), 320)].filter(Boolean);
	if (entry.type === "compaction") return [firstLine(entry.summary, 320)];
	if (entry.type === "branch_summary") return [firstLine(entry.summary, 320)];
	if (entry.type === "model_change") return [`${entry.provider}/${entry.modelId}`];
	if (entry.type === "thinking_level_change") return [`thinking: ${entry.thinkingLevel}`];
	if (entry.type === "session_info") return [`name: ${entry.name ?? ""}`];
	if (entry.type === "label") return [`label ${entry.targetId}: ${entry.label ?? "cleared"}`];
	return [];
}

function renderLinks(item: ConversationTimelineItem): string | undefined {
	const links = item.links;
	const parts = [
		links.promptingIds.length ? `prompting=${links.promptingIds.map(shortId).join(",")}` : undefined,
		links.runIds.length ? `run=${links.runIds.map(shortId).join(",")}` : undefined,
		links.editIds.length ? `edit=${links.editIds.map(shortId).join(",")}` : undefined,
		links.mergeIds.length ? `merge=${links.mergeIds.map(shortId).join(",")}` : undefined,
		links.revertEventIds.length ? `revert=${links.revertEventIds.map(shortId).join(",")}` : undefined,
		links.toolCallIds.length ? `tool_call=${links.toolCallIds.map(shortId).join(",")}` : undefined,
	].filter(Boolean);
	return parts.length ? parts.join(" ") : undefined;
}

export function renderConversationTimeline(snapshot: ConversationSnapshot, options: { limit?: number } = {}): string[] {
	const limit = options.limit ?? 80;
	const lines = [
		`conversation status: ${snapshot.status}`,
		`snapshot source: ${snapshot.nativeSessionPath ?? "none"}`,
		`entries: ${snapshot.items.length}`,
		`trace events: ${snapshot.events.length}`,
	];
	if (snapshot.reason) lines.push(`reason: ${snapshot.reason}`);
	if (snapshot.header) {
		lines.push(`native id: ${snapshot.header.id}`, `native cwd: ${snapshot.header.cwd || "unknown"}`);
		if (snapshot.header.parentSession) lines.push(`native parent: ${snapshot.header.parentSession}`);
	}
	lines.push("");
	if (snapshot.items.length === 0) {
		lines.push("No native conversation entries are available. This history can only be shown as trace/raw evidence.");
		return lines;
	}
	const items = snapshot.items.slice(-limit);
	if (snapshot.items.length > items.length)
		lines.push(`... ${snapshot.items.length - items.length} older entries omitted`);
	for (const item of items) {
		const entry = item.entry;
		lines.push(
			`- ${entry.timestamp} ${shortId(entry.id)} ${renderEntryLabel(entry)} parent=${shortId(entry.parentId) || "root"}`,
		);
		const linkLine = renderLinks(item);
		if (linkLine) lines.push(`  links: ${linkLine}`);
		for (const body of renderEntryBody(entry)) {
			if (body) lines.push(`  ${body}`);
		}
	}
	return lines;
}
