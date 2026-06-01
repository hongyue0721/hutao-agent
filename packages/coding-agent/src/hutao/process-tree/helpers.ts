import type { HutaoEvent } from "../event-store.ts";

export function processTreeNodeId(kind: string, id: unknown): string {
	return `${kind}:${String(id ?? "")}`;
}

export function shortId(id: unknown): string {
	const value = String(id ?? "");
	return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}

export function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function firstLine(value: unknown, maxLength = 120): string {
	return String(value ?? "")
		.split(/\r?\n/)[0]
		?.slice(0, maxLength);
}

export function eventTitle(event: HutaoEvent): string {
	return firstLine(event.text ?? event.task ?? event.summary ?? event.name ?? event.tool ?? event.id);
}

export function treePrefix(depth: number, isLast: boolean): string {
	if (depth <= 0) return "";
	return `${"│  ".repeat(Math.max(0, depth - 1))}${isLast ? "└─ " : "├─ "}`;
}
