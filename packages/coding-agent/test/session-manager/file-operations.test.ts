import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	countResumeSessionSources,
	findMostRecentSession,
	getCurrentFolderResumeSessionDir,
	getRepoLocalSessionDir,
	loadEntriesFromFile,
	SessionManager,
} from "../../src/core/session-manager.ts";

describe("loadEntriesFromFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent file", () => {
		const entries = loadEntriesFromFile(join(tempDir, "nonexistent.jsonl"));
		expect(entries).toEqual([]);
	});

	it("returns empty array for empty file", () => {
		const file = join(tempDir, "empty.jsonl");
		writeFileSync(file, "");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for file without valid session header", () => {
		const file = join(tempDir, "no-header.jsonl");
		writeFileSync(file, '{"type":"message","id":"1"}\n');
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for malformed JSON", () => {
		const file = join(tempDir, "malformed.jsonl");
		writeFileSync(file, "not json\n");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("loads valid session file", () => {
		const file = join(tempDir, "valid.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
		expect(entries[0].type).toBe("session");
		expect(entries[1].type).toBe("message");
	});

	it("skips malformed lines but keeps valid ones", () => {
		const file = join(tempDir, "mixed.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				"not valid json\n" +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
	});
});

describe("findMostRecentSession", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for empty directory", () => {
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns null for non-existent directory", () => {
		expect(findMostRecentSession(join(tempDir, "nonexistent"))).toBeNull();
	});

	it("ignores non-jsonl files", () => {
		writeFileSync(join(tempDir, "file.txt"), "hello");
		writeFileSync(join(tempDir, "file.json"), "{}");
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("ignores jsonl files without valid session header", () => {
		writeFileSync(join(tempDir, "invalid.jsonl"), '{"type":"message"}\n');
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns single valid session file", () => {
		const file = join(tempDir, "session.jsonl");
		writeFileSync(file, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		expect(findMostRecentSession(tempDir)).toBe(file);
	});

	it("returns most recently modified session", async () => {
		const file1 = join(tempDir, "older.jsonl");
		const file2 = join(tempDir, "newer.jsonl");

		writeFileSync(file1, '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		// Small delay to ensure different mtime
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(file2, '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(file2);
	});

	it("skips invalid files and returns valid one", async () => {
		const invalid = join(tempDir, "invalid.jsonl");
		const valid = join(tempDir, "valid.jsonl");

		writeFileSync(invalid, '{"type":"not-session"}\n');
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(valid, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(valid);
	});

	it("filters most recent session by cwd", async () => {
		const projectA = join(tempDir, "project-a");
		const projectB = join(tempDir, "project-b");
		const fileA = join(tempDir, "a.jsonl");
		const fileB = join(tempDir, "b.jsonl");

		writeFileSync(
			fileA,
			`${JSON.stringify({ type: "session", id: "a", timestamp: "2025-01-01T00:00:00Z", cwd: projectA })}\n`,
		);
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(
			fileB,
			`${JSON.stringify({ type: "session", id: "b", timestamp: "2025-01-01T00:00:00Z", cwd: projectB })}\n`,
		);

		expect(findMostRecentSession(tempDir, projectA)).toBe(fileA);
		expect(findMostRecentSession(tempDir, projectB)).toBe(fileB);
	});
});

describe("SessionManager custom flat session directory", () => {
	let tempDir: string;
	let projectA: string;
	let projectB: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		projectA = join(tempDir, "project-a");
		projectB = join(tempDir, "project-b");
		mkdirSync(projectA, { recursive: true });
		mkdirSync(projectB, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function createPersistedSession(cwd: string, label: string): string {
		const session = SessionManager.create(cwd, tempDir);
		session.appendMessage({ role: "user", content: label, timestamp: Date.now() });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `reply to ${label}` }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
		const sessionFile = session.getSessionFile();
		if (!sessionFile) {
			throw new Error("Expected persisted session file");
		}
		return sessionFile;
	}

	it("scopes current-folder APIs by cwd while listing all flat sessions", async () => {
		const sessionA = createPersistedSession(projectA, "from A");
		await new Promise((r) => setTimeout(r, 10));
		const sessionB = createPersistedSession(projectB, "from B");

		const currentA = await SessionManager.list(projectA, tempDir);
		expect(currentA.map((session) => session.path)).toEqual([sessionA]);

		const all = await SessionManager.listAll(tempDir);
		expect(new Set(all.map((session) => session.path))).toEqual(new Set([sessionA, sessionB]));

		const continuedA = SessionManager.continueRecent(projectA, tempDir);
		expect(continuedA.getSessionFile()).toBe(sessionA);
	});
});

describe("SessionManager append listeners", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("notifies append listeners after entries are persisted", () => {
		const sm = SessionManager.create(tempDir);
		const seen: string[] = [];
		const unsubscribe = sm.onAppendEntry((entry) => {
			seen.push(entry.id);
		});
		const first = sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		unsubscribe();
		const second = sm.appendMessage({ role: "user", content: "ignored", timestamp: Date.now() });

		expect(seen).toEqual([first]);
		expect(sm.getEntry(first)?.id).toBe(first);
		expect(sm.getEntry(second)?.id).toBe(second);
	});

	it("handles append listener errors without breaking persistence", () => {
		const sm = SessionManager.create(tempDir);
		sm.onAppendEntry(() => {
			throw new Error("listener failed");
		});
		const entryId = sm.appendMessage({ role: "user", content: "still persisted", timestamp: Date.now() });
		expect(sm.getEntry(entryId)?.id).toBe(entryId);
	});
});

describe("SessionManager repo-local Hutao native session directory", () => {
	let tempDir: string;
	let repo: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		repo = join(tempDir, "repo");
		mkdirSync(repo, { recursive: true });
		execFileSync("git", ["-C", repo, "init"], { stdio: "ignore" });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function appendRound(session: SessionManager, text: string): void {
		session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `reply to ${text}` }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});
	}

	it("prefers repo-local sessions for the current-folder resume picker even when the active session dir is global", async () => {
		const repoLocalSessionDir = getRepoLocalSessionDir(repo)!;
		const activeGlobalSessionDir = join(tempDir, "global-sessions");
		mkdirSync(activeGlobalSessionDir, { recursive: true });

		expect(getCurrentFolderResumeSessionDir(repo, activeGlobalSessionDir)).toBe(repoLocalSessionDir);

		const session = SessionManager.create(repo, repoLocalSessionDir);
		appendRound(session, "repo-local should be resumable");

		const activeOnly = await SessionManager.listForResume(repo, activeGlobalSessionDir);
		const currentFolder = await SessionManager.listForResume(
			repo,
			getCurrentFolderResumeSessionDir(repo, activeGlobalSessionDir),
		);

		expect(activeOnly).toEqual([]);
		expect(currentFolder).toHaveLength(1);
		expect(currentFolder[0]?.source).toBe("repo-local");
		expect(currentFolder[0]?.firstMessage).toBe("repo-local should be resumable");
	});

	it("stores native sessions under .hutao/sessions/<id>/native-session.jsonl without absolute cwd", async () => {
		const sessionDir = getRepoLocalSessionDir(repo);
		expect(sessionDir).toBe(join(repo, ".hutao", "sessions"));
		const session = SessionManager.create(repo, sessionDir);
		appendRound(session, "repo local hello");

		const sessionFile = session.getSessionFile();
		expect(session.getSessionId().startsWith("sess_")).toBe(true);
		expect(sessionFile).toBe(join(sessionDir!, session.getSessionId(), "native-session.jsonl"));
		const header = JSON.parse(readFileSync(sessionFile!, "utf-8").split(/\r?\n/)[0]!);
		expect(header.cwd).toBe(".");

		const listed = await SessionManager.list(repo, sessionDir);
		expect(listed.map((entry) => entry.path)).toEqual([sessionFile]);
		expect(listed[0]?.firstMessage).toBe("repo local hello");

		const opened = SessionManager.open(sessionFile!, sessionDir);
		expect(opened.getCwd()).toBe(repo);
		expect(opened.buildSessionContext().messages).toHaveLength(2);
	});

	it("continues writing opened repo-local native sessions back to .hutao", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		appendRound(session, "initial repo-local turn");
		const sessionFile = session.getSessionFile()!;
		const originalSessionId = session.getSessionId();

		const reopened = SessionManager.open(sessionFile);
		expect(reopened.getSessionId()).toBe(originalSessionId);
		expect(reopened.getSessionFile()).toBe(sessionFile);
		expect(reopened.getSessionDir()).toBe(sessionDir);
		expect(reopened.getCwd()).toBe(repo);
		appendRound(reopened, "continued after resume");

		const onDisk = readFileSync(sessionFile, "utf-8");
		expect(onDisk).toContain("initial repo-local turn");
		expect(onDisk).toContain("continued after resume");
		expect(JSON.parse(onDisk.split(/\r?\n/)[0]!).cwd).toBe(".");

		const listed = await SessionManager.list(repo, sessionDir);
		expect(listed.map((entry) => entry.path)).toEqual([sessionFile]);
		expect(listed[0]?.source).toBe("repo-local");
		expect(listed[0]?.firstMessage).toBe("initial repo-local turn");
		expect(listed[0]?.allMessagesText).toContain("continued after resume");
	});

	it("resumes repo-local native sessions after clone path changes without leaking the old repo root", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		const oldRepoFile = join(repo, "src", "old-path.ts");
		appendRound(session, `read ${oldRepoFile}`);
		const originalSessionId = session.getSessionId();
		const originalSessionFile = session.getSessionFile()!;
		const originalOnDisk = readFileSync(originalSessionFile, "utf-8");
		expect(originalOnDisk).toContain("$" + "{REPO}/src/old-path.ts");
		expect(originalOnDisk).not.toContain("$" + "{REPO}\\src\\old-path.ts");
		expect(originalOnDisk).not.toContain(repo);

		const clonedRepo = join(tempDir, "cloned", "project");
		cpSync(repo, clonedRepo, { recursive: true });
		const clonedSessionDir = getRepoLocalSessionDir(clonedRepo)!;
		const clonedSessionFile = join(clonedSessionDir, originalSessionId, "native-session.jsonl");

		const listed = await SessionManager.listForResume(clonedRepo, clonedSessionDir);
		const repoLocal = listed.find((entry) => entry.id === originalSessionId);
		expect(repoLocal?.source).toBe("repo-local");
		expect(repoLocal?.path).toBe(clonedSessionFile);

		const opened = SessionManager.open(clonedSessionFile);
		expect(opened.getSessionId()).toBe(originalSessionId);
		expect(opened.getSessionFile()).toBe(clonedSessionFile);
		expect(opened.getSessionDir()).toBe(clonedSessionDir);
		expect(opened.getCwd()).toBe(clonedRepo);
		const resumedMessages = opened.buildSessionContext().messages;
		const expectedClonedPath = join(clonedRepo, "src", "old-path.ts");
		expect((resumedMessages[0] as { content?: unknown })?.content).toBe(`read ${expectedClonedPath}`);
		expect((resumedMessages[1] as { content?: Array<{ text?: string }> })?.content?.[0]?.text).toBe(
			`reply to read ${expectedClonedPath}`,
		);
		expect((resumedMessages[0] as { content?: unknown })?.content).not.toContain(repo);
		expect((resumedMessages[1] as { content?: Array<{ text?: string }> })?.content?.[0]?.text).not.toContain(repo);

		appendRound(opened, "continued in cloned repo");
		const clonedOnDisk = readFileSync(clonedSessionFile, "utf-8");
		expect(clonedOnDisk).toContain("continued in cloned repo");
		expect(clonedOnDisk).toContain("$" + "{REPO}/src/old-path.ts");
		expect(clonedOnDisk).not.toContain("$" + "{REPO}\\src\\old-path.ts");
		expect(clonedOnDisk).not.toContain(repo);
		expect(clonedOnDisk).not.toContain(clonedRepo);
	});

	it("keeps repo-local resume sessions when progress callbacks fail", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		appendRound(session, "progress callback should not hide me");
		const sessionFile = session.getSessionFile()!;

		const listed = await SessionManager.listForResume(repo, sessionDir, () => {
			throw new Error("render progress failed");
		});

		expect(listed.map((entry) => entry.path)).toEqual([sessionFile]);
		expect(listed[0]?.source).toBe("repo-local");
		expect(listed[0]?.firstMessage).toBe("progress callback should not hide me");
	});

	it("forks repo-local native sessions into fs_ directories with repo-relative parent refs", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		appendRound(session, "root");
		const originalFile = session.getSessionFile()!;
		const forkedFile = session.createBranchedSession(session.getLeafId()!)!;
		appendRound(session, "fork");

		expect(session.getSessionId().startsWith("fs_")).toBe(true);
		expect(forkedFile).toBe(join(sessionDir, session.getSessionId(), "native-session.jsonl"));
		const header = JSON.parse(readFileSync(forkedFile, "utf-8").split(/\r?\n/)[0]!);
		expect(header.cwd).toBe(".");
		expect(header.parentSession).toBe(`.hutao/sessions/${originalFile.split(/[\\/]/).at(-2)}/native-session.jsonl`);

		const listed = await SessionManager.list(repo, sessionDir);
		expect(new Set(listed.map((entry) => entry.path))).toEqual(new Set([originalFile, forkedFile]));
		const forkInfo = listed.find((entry) => entry.path === forkedFile);
		expect(forkInfo?.source).toBe("repo-local");
		expect(forkInfo?.parentSessionPath).toBe(originalFile);
		expect(findMostRecentSession(sessionDir, repo)).toBe(forkedFile);
	});

	it("forks repo-local native sessions with a coordinator-provided fs id", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		appendRound(session, "root");
		const originalFile = session.getSessionFile()!;
		const forkedId = "fs_01J00000000000000000000000";
		const forkedFile = session.createBranchedSession(session.getLeafId()!, { id: forkedId })!;

		expect(session.getSessionId()).toBe(forkedId);
		expect(forkedFile).toBe(join(sessionDir, forkedId, "native-session.jsonl"));
		const header = JSON.parse(readFileSync(forkedFile, "utf-8").split(/\r?\n/)[0]!);
		expect(header.id).toBe(forkedId);
		expect(header.cwd).toBe(".");
		expect(header.parentSession).toBe(`.hutao/sessions/${originalFile.split(/[\\/]/).at(-2)}/native-session.jsonl`);
	});

	it("redacts repo-local native session absolute paths on disk while preserving in-memory context", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const session = SessionManager.create(repo, sessionDir);
		const absoluteFile = join(repo, "src", "App.tsx");
		session.appendMessage({ role: "user", content: `read ${absoluteFile}`, timestamp: Date.now() });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: `I read ${absoluteFile}` }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});

		const onDisk = readFileSync(session.getSessionFile()!, "utf-8");
		expect(onDisk).toContain("$" + "{REPO}/src/App.tsx");
		expect(onDisk).not.toContain("$" + "{REPO}\\src\\App.tsx");
		expect(onDisk).not.toContain(repo);
		expect((session.buildSessionContext().messages[0] as { content?: unknown })?.content).toContain(repo);
		const opened = SessionManager.open(session.getSessionFile()!, sessionDir);
		expect((opened.buildSessionContext().messages[0] as { content?: unknown })?.content).toContain(repo);
	});

	it("counts resume session sources while excluding the current session", () => {
		const current = join(repo, ".hutao", "sessions", "sess_current", "native-session.jsonl");
		const sessions = [
			{
				path: current,
				id: "sess_current",
				source: "repo-local" as const,
				cwd: ".",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 1,
				firstMessage: "current",
				allMessagesText: "current",
			},
			{
				path: join(repo, ".hutao", "sessions", "sess_other", "native-session.jsonl"),
				id: "sess_other",
				source: "repo-local" as const,
				cwd: ".",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 1,
				firstMessage: "other",
				allMessagesText: "other",
			},
			{
				path: join(repo, ".hutao", "sessions", "sess_raw", "session.json"),
				id: "sess_raw",
				source: "raw-only" as const,
				cwd: ".",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 0,
				firstMessage: "raw",
				allMessagesText: "raw",
			},
			{
				path: join(tempDir, "global.jsonl"),
				id: "global",
				source: "global" as const,
				cwd: repo,
				created: new Date(0),
				modified: new Date(0),
				messageCount: 1,
				firstMessage: "global",
				allMessagesText: "global",
			},
		];

		expect(countResumeSessionSources(sessions, current)).toEqual({ repoLocal: 1, global: 1, rawOnly: 1 });
	});

	it("includes legacy current-folder sessions in repo-local resume lists without changing repo-local creation", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const repoLocal = SessionManager.create(repo, sessionDir);
		appendRound(repoLocal, "repo local");
		const legacy = SessionManager.create(repo);
		appendRound(legacy, "legacy");

		const listed = await SessionManager.listForResume(repo, sessionDir);
		expect(new Set(listed.map((entry) => entry.path))).toEqual(
			new Set([repoLocal.getSessionFile(), legacy.getSessionFile()]),
		);
		expect(listed.find((entry) => entry.path === repoLocal.getSessionFile())?.source).toBe("repo-local");
		expect(listed.find((entry) => entry.path === legacy.getSessionFile())?.source).toBe("global");
		expect(SessionManager.create(repo, sessionDir).getSessionFile()).toContain(`${join(".hutao", "sessions")}`);
	});

	it("orders repo-local native sessions before newer raw-only and legacy global resume entries", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const repoLocal = SessionManager.create(repo, sessionDir);
		appendRound(repoLocal, "repo local");

		const rawDir = join(sessionDir, "sess_raw_newer");
		mkdirSync(rawDir, { recursive: true });
		writeFileSync(
			join(rawDir, "session.json"),
			`${JSON.stringify({
				id: "sess_raw_newer",
				kind: "session",
				title: "Newer raw-only trace",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-03T00:00:00.000Z",
			})}\n`,
		);
		writeFileSync(join(rawDir, "events.jsonl"), `${JSON.stringify({ type: "prompting", text: "raw" })}\n`);

		const legacy = SessionManager.create(repo);
		appendRound(legacy, "legacy");

		const listed = await SessionManager.listForResume(repo, sessionDir);
		expect(listed.map((entry) => entry.source)).toEqual(["repo-local", "raw-only", "global"]);
		expect(listed[0].path).toBe(repoLocal.getSessionFile());
	});

	it("includes raw-only Hutao trace sessions in resume lists without treating them as native sessions", async () => {
		const sessionDir = getRepoLocalSessionDir(repo)!;
		const rawDir = join(sessionDir, "sess_raw_only");
		mkdirSync(rawDir, { recursive: true });
		writeFileSync(
			join(rawDir, "session.json"),
			`${JSON.stringify({
				id: "sess_raw_only",
				kind: "session",
				title: "Raw-only imported trace",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
			})}\n`,
		);
		writeFileSync(
			join(rawDir, "events.jsonl"),
			`${JSON.stringify({
				type: "prompting",
				id: "p_raw",
				session_id: "sess_raw_only",
				text: "raw prompt evidence",
			})}\n`,
		);

		const nativeOnly = await SessionManager.list(repo, sessionDir);
		expect(nativeOnly.find((entry) => entry.id === "sess_raw_only")).toBeUndefined();

		const listed = await SessionManager.listForResume(repo, sessionDir);
		const raw = listed.find((entry) => entry.id === "sess_raw_only");
		expect(raw?.source).toBe("raw-only");
		expect(raw?.path).toBe(join(rawDir, "session.json"));
		expect(raw?.firstMessage).toBe("Raw-only imported trace");
		expect(raw?.messageCount).toBe(1);
		expect(raw?.allMessagesText).toContain("raw prompt evidence");
	});
});

describe("SessionManager.setSessionFile with corrupted files", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("truncates and rewrites empty file with valid header", () => {
		const emptyFile = join(tempDir, "empty.jsonl");
		writeFileSync(emptyFile, "");

		const sm = SessionManager.open(emptyFile, tempDir);

		// Should have created a new session with valid header
		expect(sm.getSessionId()).toBeTruthy();
		expect(sm.getHeader()).toBeTruthy();
		expect(sm.getHeader()?.type).toBe("session");

		// File should now contain a valid header
		const content = readFileSync(emptyFile, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(1);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("session");
		expect(header.id).toBe(sm.getSessionId());
	});

	it("truncates and rewrites file without valid header", () => {
		const noHeaderFile = join(tempDir, "no-header.jsonl");
		// File with messages but no session header (corrupted state)
		writeFileSync(
			noHeaderFile,
			'{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n',
		);

		const sm = SessionManager.open(noHeaderFile, tempDir);

		// Should have created a new session with valid header
		expect(sm.getSessionId()).toBeTruthy();
		expect(sm.getHeader()).toBeTruthy();
		expect(sm.getHeader()?.type).toBe("session");

		// File should now contain only a valid header (old content truncated)
		const content = readFileSync(noHeaderFile, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(1);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("session");
		expect(header.id).toBe(sm.getSessionId());
	});

	it("preserves explicit session file path when recovering from corrupted file", () => {
		const explicitPath = join(tempDir, "my-session.jsonl");
		writeFileSync(explicitPath, "");

		const sm = SessionManager.open(explicitPath, tempDir);

		// The session file path should be preserved
		expect(sm.getSessionFile()).toBe(explicitPath);
	});

	it("subsequent loads of recovered file work correctly", () => {
		const corruptedFile = join(tempDir, "corrupted.jsonl");
		writeFileSync(corruptedFile, "garbage content\n");

		// First open recovers the file
		const sm1 = SessionManager.open(corruptedFile, tempDir);
		const sessionId = sm1.getSessionId();

		// Second open should load the recovered file successfully
		const sm2 = SessionManager.open(corruptedFile, tempDir);
		expect(sm2.getSessionId()).toBe(sessionId);
		expect(sm2.getHeader()?.type).toBe("session");
	});
});
