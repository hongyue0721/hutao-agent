import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HutaoEvent } from "./event-store.ts";
import { readAllEvents, readSessions } from "./read-model.ts";

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`, "utf-8");
}

export function rebuildIndex(repoRoot: string): void {
	const indexDir = join(repoRoot, ".hutao", "index");
	mkdirSync(indexDir, { recursive: true });
	const events = readAllEvents(repoRoot);
	const sessions = readSessions(repoRoot);
	const promptings = events.filter((event) => event.type === "prompting");
	const edits = events.filter((event) => event.type === "edit");
	const commits = events.filter((event) => event.type === "commit_link");
	const byFile = new Map<string, HutaoEvent[]>();
	for (const edit of edits) {
		for (const file of (edit.files as string[] | undefined) ?? []) {
			byFile.set(file, [...(byFile.get(file) ?? []), edit]);
		}
	}
	writeJson(join(indexDir, "sessions.json"), sessions);
	writeJson(join(indexDir, "promptings.json"), promptings);
	writeJson(join(indexDir, "edits.json"), edits);
	writeJson(join(indexDir, "commits.json"), commits);
	writeJson(
		join(indexDir, "files.json"),
		[...byFile.entries()].map(([file, fileEdits]) => ({ file, edit_ids: fileEdits.map((edit) => edit.id) })),
	);
}
