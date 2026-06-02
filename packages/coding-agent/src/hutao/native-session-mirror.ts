import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { FileEntry, ReadonlySessionManager, SessionEntry, SessionHeader } from "../core/session-manager.ts";
import { loadEntriesFromFile } from "../core/session-manager.ts";
import { redactSecrets } from "./secret-guard.ts";

const HUTAO_NATIVE_SESSION_FILE = "native-session.jsonl";
const REPO_PLACEHOLDER = "$" + "{REPO}";

export interface NativeSessionMirrorSnapshot {
	repoRoot: string;
	traceSessionId: string;
	nativeSessionId: string;
	nativeSessionFile?: string;
	nativeHeader?: SessionHeader;
	nativeEntries: SessionEntry[];
}

function repoLocalNativePath(repoRoot: string, traceSessionId: string): string {
	return join(repoRoot, ".hutao", "sessions", traceSessionId, HUTAO_NATIVE_SESSION_FILE);
}

function normalizePath(value: string): string {
	return resolve(value);
}

function isInside(parent: string, child: string): boolean {
	const rel = relative(normalizePath(parent), normalizePath(child));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isRepoLocalNativeSessionFile(repoRoot: string, filePath: string | undefined): boolean {
	if (!filePath || basename(filePath) !== HUTAO_NATIVE_SESSION_FILE) return false;
	return isInside(join(repoRoot, ".hutao", "sessions"), filePath);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeRepoLocalText(text: string, repoRoot: string): string {
	const resolvedRepoRoot = normalizePath(repoRoot);
	const variants = [...new Set([resolvedRepoRoot, resolvedRepoRoot.replace(/\\/g, "/")])]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
	let result = text;
	for (const variant of variants) {
		result = result.replace(
			new RegExp(`${escapeRegExp(variant)}([\\\\/][^\\s"'\`<>)]*)?`, "g"),
			(_match, suffix: string | undefined) => {
				if (!suffix) return REPO_PLACEHOLDER;
				const repoRelative = suffix.replace(/^[\\/]+/, "").replace(/\\/g, "/");
				return repoRelative ? `${REPO_PLACEHOLDER}/${repoRelative}` : REPO_PLACEHOLDER;
			},
		);
	}
	result = result.replace(/[A-Za-z]:[\\/][^\s"'`<>)]*/g, "[external-path-redacted]");
	result = result.replace(/(?:^|\s)\/(?:Users|home|mnt|Volumes|OneDrive)\/[^\s"'`<>)]*/g, (match) => {
		const prefix = match.startsWith(" ") ? " " : "";
		return `${prefix}[external-path-redacted]`;
	});
	return redactSecrets(result);
}

function sanitizeRepoLocalEntry<T>(entry: T, repoRoot: string): T {
	if (typeof entry === "string") return sanitizeRepoLocalText(entry, repoRoot) as T;
	if (Array.isArray(entry)) return entry.map((item) => sanitizeRepoLocalEntry(item, repoRoot)) as T;
	if (entry && typeof entry === "object") {
		const copy: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(entry)) {
			copy[key] = sanitizeRepoLocalEntry(value, repoRoot);
		}
		return copy as T;
	}
	return entry;
}

function buildMirroredHeader(snapshot: NativeSessionMirrorSnapshot): SessionHeader {
	return {
		type: "session",
		version: snapshot.nativeHeader?.version ?? 3,
		id: snapshot.traceSessionId,
		timestamp: snapshot.nativeHeader?.timestamp ?? new Date().toISOString(),
		cwd: ".",
		parentSession: snapshot.nativeHeader?.parentSession,
	};
}

function readExistingIds(path: string): Set<string> {
	if (!existsSync(path)) return new Set();
	return new Set(
		loadEntriesFromFile(path)
			.filter((entry): entry is SessionEntry => entry.type !== "session")
			.map((entry) => entry.id),
	);
}

function writeInitialMirror(path: string, snapshot: NativeSessionMirrorSnapshot): void {
	mkdirSync(dirname(path), { recursive: true });
	const header = sanitizeRepoLocalEntry(buildMirroredHeader(snapshot), snapshot.repoRoot);
	const entries = snapshot.nativeEntries.map((entry) => sanitizeRepoLocalEntry(entry, snapshot.repoRoot));
	writeFileSync(path, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
}

function appendMissingEntries(path: string, snapshot: NativeSessionMirrorSnapshot): void {
	const existingIds = readExistingIds(path);
	const missing = snapshot.nativeEntries.filter((entry) => !existingIds.has(entry.id));
	if (missing.length === 0) return;
	appendFileSync(
		path,
		missing.map((entry) => JSON.stringify(sanitizeRepoLocalEntry(entry, snapshot.repoRoot))).join("\n") + "\n",
		"utf-8",
	);
}

export function mirrorNativeSessionSnapshot(snapshot: NativeSessionMirrorSnapshot): string | undefined {
	if (!snapshot.traceSessionId || !snapshot.nativeSessionId) return undefined;
	if (isRepoLocalNativeSessionFile(snapshot.repoRoot, snapshot.nativeSessionFile)) return snapshot.nativeSessionFile;
	const target = repoLocalNativePath(snapshot.repoRoot, snapshot.traceSessionId);
	if (!existsSync(target)) writeInitialMirror(target, snapshot);
	else appendMissingEntries(target, snapshot);
	return target;
}

export function mirrorNativeSessionEntry(snapshot: NativeSessionMirrorSnapshot, entry: SessionEntry): string | undefined {
	const target = mirrorNativeSessionSnapshot(snapshot);
	if (!target || isRepoLocalNativeSessionFile(snapshot.repoRoot, snapshot.nativeSessionFile)) return target;
	const existingIds = readExistingIds(target);
	if (existingIds.has(entry.id)) return target;
	appendFileSync(target, `${JSON.stringify(sanitizeRepoLocalEntry(entry, snapshot.repoRoot))}\n`, "utf-8");
	return target;
}

export function snapshotFromSessionManager(
	repoRoot: string,
	traceSessionId: string,
	sessionManager: ReadonlySessionManager,
): NativeSessionMirrorSnapshot {
	return {
		repoRoot,
		traceSessionId,
		nativeSessionId: sessionManager.getSessionId(),
		nativeSessionFile: sessionManager.getSessionFile(),
		nativeHeader: sessionManager.getHeader() ?? undefined,
		nativeEntries: sessionManager.getEntries(),
	};
}

export function readMirroredNativeSession(repoRoot: string, traceSessionId: string): FileEntry[] {
	const target = repoLocalNativePath(repoRoot, traceSessionId);
	if (!existsSync(target)) return [];
	return readFileSync(target, "utf-8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as FileEntry);
}
