import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HutaoEvent, HutaoSessionMetadata } from "./event-store.ts";

export function readAllEvents(repoRoot: string): HutaoEvent[] {
	const sessionsDir = join(repoRoot, ".hutao", "sessions");
	if (!existsSync(sessionsDir)) return [];
	const events: HutaoEvent[] = [];
	for (const sessionName of readdirSync(sessionsDir)) {
		const eventsPath = join(sessionsDir, sessionName, "events.jsonl");
		if (!existsSync(eventsPath)) continue;
		for (const line of readFileSync(eventsPath, "utf-8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				events.push(JSON.parse(line) as HutaoEvent);
			} catch {}
		}
	}
	return events.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

export function readSessions(repoRoot: string): HutaoSessionMetadata[] {
	const sessionsPath = join(repoRoot, ".hutao", "refs", "sessions.json");
	if (!existsSync(sessionsPath)) return [];
	try {
		return JSON.parse(readFileSync(sessionsPath, "utf-8")) as HutaoSessionMetadata[];
	} catch {
		return [];
	}
}
