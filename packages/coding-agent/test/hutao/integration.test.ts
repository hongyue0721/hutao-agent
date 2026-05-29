import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { editCommand, promptingCommand } from "../../src/hutao/commands.ts";
import { CommitLinker } from "../../src/hutao/commit-linker.ts";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "../../src/hutao/event-store.ts";
import { ForkSessionManager } from "../../src/hutao/fork-session-manager.ts";
import { GitAdapter } from "../../src/hutao/git-adapter.ts";
import { MergeManager } from "../../src/hutao/merge-manager.ts";
import { RevertManager } from "../../src/hutao/revert-manager.ts";
import { SessionRegistry } from "../../src/hutao/session-registry.ts";
import { TraceRecorder } from "../../src/hutao/trace-recorder.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hutao-integration-"));
	tempDirs.push(dir);
	return dir;
}

async function initRepo(repo: string): Promise<GitAdapter> {
	const git = new GitAdapter(repo);
	await git.run(["init"]);
	await git.run(["config", "user.email", "a@example.com"]);
	await git.run(["config", "user.name", "A"]);
	writeFileSync(join(repo, "file.txt"), "base\n", "utf-8");
	await git.run(["add", "file.txt"]);
	await git.run(["commit", "-m", "init"]);
	return git;
}

async function recordFileEdit(repo: string, text: string): Promise<{ recorder: TraceRecorder; editId: string }> {
	const recorder = new TraceRecorder(repo);
	await recorder.init();
	await recorder.recordPrompting(`change to ${text}`, repo);
	await recorder.startRun("write", `tool_${text}`, { path: "file.txt" }, repo);
	writeFileSync(join(repo, "file.txt"), `${text}\n`, "utf-8");
	await recorder.finishRun(
		{
			type: "tool_result",
			toolName: "write",
			toolCallId: `tool_${text}`,
			input: { path: "file.txt" },
			content: [{ type: "text", text: "ok" }],
			details: undefined,
			isError: false,
		},
		repo,
	);
	const edits = JSON.parse(readFileSync(join(repo, ".hutao", "index", "edits.json"), "utf-8")) as Array<{
		id: string;
	}>;
	return { recorder, editId: edits[edits.length - 1].id };
}

function readSessionEvents(repo: string, sessionId: string): HutaoEvent[] {
	return readFileSync(join(repo, ".hutao", "sessions", sessionId, "events.jsonl"), "utf-8")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as HutaoEvent);
}

function makeCommandContext(repo: string): Parameters<typeof promptingCommand>[1] {
	return {
		cwd: repo,
		waitForIdle: async () => undefined,
		ui: {
			notify: (message: string) => {
				commandNotifications.push(message);
			},
			confirm: async () => true,
			select: async () => undefined,
			input: async () => undefined,
		},
	} as unknown as Parameters<typeof promptingCommand>[1];
}

const commandNotifications: string[] = [];

afterEach(() => {
	commandNotifications.length = 0;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Hutao integration safety", () => {
	it("refuses revert when working tree is dirty", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const { recorder, editId } = await recordFileEdit(repo, "changed");
		writeFileSync(join(repo, "other.txt"), "dirty\n", "utf-8");
		const result = await new RevertManager(repo).revertEdit(editId, recorder.getSessionId());
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("dirty");
	});

	it("does not persist plain API keys in trace output", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting(`test sk-${"x".repeat(48)}`, repo);
		const contents = readFileSync(join(repo, ".hutao", "sessions", recorder.getSessionId(), "events.jsonl"), "utf-8");
		expect(contents).not.toContain("sk-");
		expect(contents).toContain("[secret-redacted]");
	});
	it("filters prompting and edit lists", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const { recorder, editId } = await recordFileEdit(repo, "filtered");
		await promptingCommand(`--session ${recorder.getSessionId()}`, makeCommandContext(repo));
		expect(commandNotifications.at(-1)).toContain("change to filtered");
		await promptingCommand("search filtered", makeCommandContext(repo));
		expect(commandNotifications.at(-1)).toContain("change to filtered");
		await editCommand("--file file.txt", makeCommandContext(repo));
		expect(commandNotifications.at(-1)).toContain(editId.slice(0, 20));
	});
});

describe("ForkSessionManager", () => {
	it("restores before and after edit states", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		const { editId } = await recordFileEdit(repo, "changed");
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "changed"]);
		const before = await new ForkSessionManager(repo).createFork("edit", editId, "before");
		expect(before.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf-8").replace(/\r\n/g, "\n")).toBe("base\n");
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "before fork state"]);
		const after = await new ForkSessionManager(repo).createFork("edit", editId, "after");
		expect(after.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf-8").replace(/\r\n/g, "\n")).toBe("changed\n");
	});
	it("forks from commits", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		const base = await git.getHead();
		writeFileSync(join(repo, "file.txt"), "commit-target\n", "utf-8");
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "target"]);
		const result = await new ForkSessionManager(repo).createFork("commit", base ?? "HEAD~1", "after");
		expect(result.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf-8").replace(/\r\n/g, "\n")).toBe("base\n");
	});
});

describe("MergeManager", () => {
	it("applies final source snapshot with apply-tree", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		const { recorder } = await recordFileEdit(repo, "source-final");
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "source final"]);
		const sourceSession = recorder.getSessionId();
		const targetMetadata = await new SessionRegistry(repo).createSessionMetadata("sess_target");
		new EventStore(repo, "sess_target").init(targetMetadata);
		const editsIndex = readFileSync(join(repo, ".hutao", "index", "edits.json"), "utf-8");
		const editId = editsIndex.match(/e_[A-Z0-9]+/)?.[0];
		expect(editId).toBeDefined();
		await git.run(["apply", "-R", join(repo, ".hutao", "sessions", sourceSession, "patches", `${editId}.patch`)]);
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "target base"]);
		const result = await new MergeManager(repo).mergeSession(sourceSession, "apply_tree");
		expect(result.ok).toBe(true);
		expect(result.resolutionEdits).toHaveLength(1);
		expect(readFileSync(join(repo, "file.txt"), "utf-8").replace(/\r\n/g, "\n")).toBe("source-final\n");
	});
	it("records abort and captures resolution edits", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const { recorder } = await recordFileEdit(repo, "resolution-source");
		const sourceSession = recorder.getSessionId();
		const targetMetadata = await new SessionRegistry(repo).createSessionMetadata("sess_resolution_target");
		new EventStore(repo, "sess_resolution_target").init(targetMetadata);
		const abortResult = await new MergeManager(repo).mergeSession(sourceSession, "abort");
		expect(abortResult.ok).toBe(true);
		writeFileSync(join(repo, "file.txt"), "manual-resolution\n", "utf-8");
		const resolution = await new MergeManager(repo).captureResolutionEdit("sess_resolution_target", sourceSession);
		expect(resolution.ok).toBe(true);
		expect(resolution.resolutionEdits).toHaveLength(1);
	});
});

describe("CommitLinker", () => {
	it("links committed edits by patch/file match", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		await recordFileEdit(repo, "linked");
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "linked"]);
		const result = await new CommitLinker(repo).scanRecentCommits();
		expect(result.linked).toBeGreaterThan(0);
		const commits = JSON.parse(readFileSync(join(repo, ".hutao", "index", "commits.json"), "utf-8")) as unknown[];
		expect(commits.length).toBeGreaterThan(0);
	});
});

describe("Hutao merge event semantics", () => {
	it("can represent duplicate skipped edits in merge events", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const targetMetadata = await new SessionRegistry(repo).createSessionMetadata("sess_target");
		const sourceMetadata = {
			...(await new SessionRegistry(repo).createSessionMetadata("fs_source")),
			id: "fs_source",
			kind: "forkSession" as const,
			parent_session: "sess_target",
			fork_from: { type: "edit", id: "e_parent", mode: "after_edit" },
		};
		new EventStore(repo, "sess_target").init(targetMetadata);
		const sourceStore = new EventStore(repo, "fs_source");
		sourceStore.init(sourceMetadata);
		sourceStore.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit",
			id: "e_source",
			session_id: "fs_source",
			files: ["file.txt"],
			patch: "patches/e_source.patch",
			created_at: new Date().toISOString(),
		});
		const targetStore = new EventStore(repo, "sess_target");
		targetStore.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "merge",
			id: "m_test",
			session_id: "sess_target",
			source_session: "fs_source",
			target_session: "sess_target",
			mode: "apply_edits",
			status: "completed",
			imported_edits: ["e_source"],
			applied_edits: [],
			conflict_edits: [],
			skipped_edits: ["e_source"],
			resolution_edits: [],
			created_at: new Date().toISOString(),
		});
		const events = readSessionEvents(repo, "sess_target");
		const merge = events.find((event) => event.type === "merge");
		expect(merge?.skipped_edits).toEqual(["e_source"]);
	});
});
