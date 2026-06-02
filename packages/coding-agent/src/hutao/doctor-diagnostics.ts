import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ConversationStore } from "./conversation-store.ts";
import type { HutaoSessionMetadata } from "./event-store.ts";

export interface HutaoDoctorDiagnostics {
	jsonlLines: number;
	corruptJsonl: number;
	absoluteRepoLeak: boolean;
	absolutePathLeakExamples: string[];
	protectedTextLeak: boolean;
	rawOnlyHistories: string[];
	incompleteNativeHistories: Array<{ sessionId: string; status: string; reason?: string }>;
	lines: string[];
	hasWarnings: boolean;
}

function readJsonlDiagnostics(path: string): { lines: number; corrupt: number } {
	if (!existsSync(path)) return { lines: 0, corrupt: 0 };
	let lines = 0;
	let corrupt = 0;
	for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
		if (!line.trim()) continue;
		lines += 1;
		try {
			JSON.parse(line);
		} catch {
			corrupt += 1;
		}
	}
	return { lines, corrupt };
}

function listSessionIds(sessionsDir: string): string[] {
	if (!existsSync(sessionsDir)) return [];
	return readdirSync(sessionsDir).filter((entry) => {
		try {
			return statSync(join(sessionsDir, entry)).isDirectory();
		} catch {
			return false;
		}
	});
}

function collectTraceText(sessionsDir: string): string {
	return listSessionIds(sessionsDir)
		.map((session) =>
			["events.jsonl", "raw.jsonl", "session.json"]
				.map((file) => {
					const path = join(sessionsDir, session, file);
					return existsSync(path) ? readFileSync(path, "utf-8") : "";
				})
				.join("\n"),
		)
		.join("\n");
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function findAbsolutePathLeakExamples(traceText: string, repoRoot: string): string[] {
	const examples: string[] = [];
	const repoRootPosix = repoRoot.replace(/\\/g, "/");
	if (traceText.includes(repoRoot)) examples.push(repoRoot);
	if (repoRootPosix !== repoRoot && traceText.includes(repoRootPosix)) examples.push(repoRootPosix);
	const absolutePattern = /(?:[A-Za-z]:[\\/][^\s"'`<>)]*|\/(?:Users|home|mnt|Volumes|OneDrive)\/[^\s"'`<>)]*)/g;
	for (const match of traceText.matchAll(absolutePattern)) {
		examples.push(match[0]);
		if (examples.length >= 8) break;
	}
	return unique(examples).slice(0, 8);
}

function rawOnlyHistories(sessionsDir: string): string[] {
	return listSessionIds(sessionsDir).filter((sessionId) => {
		const sessionDir = join(sessionsDir, sessionId);
		return existsSync(join(sessionDir, "raw.jsonl")) && !existsSync(join(sessionDir, "events.jsonl"));
	});
}

function incompleteNativeHistories(
	repoRoot: string,
	sessions: HutaoSessionMetadata[],
): Array<{
	sessionId: string;
	status: string;
	reason?: string;
}> {
	const store = new ConversationStore(repoRoot);
	const diagnostics: Array<{ sessionId: string; status: string; reason?: string }> = [];
	for (const session of sessions) {
		const snapshot = store.load(session.id);
		if (snapshot.status === "complete") continue;
		diagnostics.push({ sessionId: session.id, status: snapshot.status, reason: snapshot.reason });
	}
	return diagnostics;
}

export function collectHutaoDoctorDiagnostics(
	repoRoot: string,
	sessions: HutaoSessionMetadata[],
): HutaoDoctorDiagnostics {
	const sessionsDir = join(repoRoot, ".hutao", "sessions");
	let corruptJsonl = 0;
	let jsonlLines = 0;
	for (const session of listSessionIds(sessionsDir)) {
		for (const file of ["events.jsonl", "raw.jsonl"]) {
			const diagnostics = readJsonlDiagnostics(join(sessionsDir, session, file));
			jsonlLines += diagnostics.lines;
			corruptJsonl += diagnostics.corrupt;
		}
	}
	const traceText = collectTraceText(sessionsDir);
	const absolutePathLeakExamples = findAbsolutePathLeakExamples(traceText, repoRoot);
	const absoluteRepoLeak = traceText.includes(repoRoot) || traceText.includes(repoRoot.replace(/\\/g, "/"));
	const protectedTextLeak = /(?:sk-[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY)/.test(traceText);
	const rawOnly = rawOnlyHistories(sessionsDir);
	const incompleteNative = incompleteNativeHistories(repoRoot, sessions);
	const lines = [
		`jsonl lines: ${jsonlLines}`,
		`corrupt jsonl lines: ${corruptJsonl}`,
		`absolute repo path leak: ${absoluteRepoLeak ? "found" : "none"}`,
		`absolute path leak examples: ${absolutePathLeakExamples.length ? absolutePathLeakExamples.join(", ") : "none"}`,
		`secret-looking trace leak: ${protectedTextLeak ? "found" : "none"}`,
		`raw-only histories: ${rawOnly.length}`,
		...(rawOnly.length ? [`  raw-only examples: ${rawOnly.slice(0, 5).join(", ")}`] : []),
		`incomplete native histories: ${incompleteNative.length}`,
		...(incompleteNative.length
			? [
					`  incomplete examples: ${incompleteNative
						.slice(0, 5)
						.map((entry) => `${entry.sessionId}:${entry.status}`)
						.join(", ")}`,
					"  recommendation: use /session <id> --conversation for degraded/raw evidence; do not fabricate full chat replay.",
				]
			: []),
		`clone-safety: ${absolutePathLeakExamples.length || absoluteRepoLeak ? "check path leaks before sharing" : "ok"}`,
	];
	return {
		jsonlLines,
		corruptJsonl,
		absoluteRepoLeak,
		absolutePathLeakExamples,
		protectedTextLeak,
		rawOnlyHistories: rawOnly,
		incompleteNativeHistories: incompleteNative,
		lines,
		hasWarnings:
			corruptJsonl > 0 ||
			absoluteRepoLeak ||
			absolutePathLeakExamples.length > 0 ||
			protectedTextLeak ||
			rawOnly.length > 0 ||
			incompleteNative.length > 0,
	};
}
