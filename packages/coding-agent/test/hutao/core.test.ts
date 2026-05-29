import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore, HUTAO_SCHEMA_VERSION } from "../../src/hutao/event-store.ts";
import { GitAdapter } from "../../src/hutao/git-adapter.ts";
import { HutaoIgnore } from "../../src/hutao/hutao-ignore.ts";
import { rebuildIndex } from "../../src/hutao/index-builder.ts";
import { PathMapper } from "../../src/hutao/path-mapper.ts";
import { RevertManager } from "../../src/hutao/revert-manager.ts";
import { isProtectedRepoPath, sanitizeText } from "../../src/hutao/secret-guard.ts";
import { SessionRegistry } from "../../src/hutao/session-registry.ts";
import { TraceRecorder } from "../../src/hutao/trace-recorder.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hutao-test-"));
	tempDirs.push(dir);
	return dir;
}

async function initRepo(repo: string): Promise<GitAdapter> {
	const git = new GitAdapter(repo);
	await git.run(["init"]);
	await git.run(["config", "user.email", "a@example.com"]);
	await git.run(["config", "user.name", "A"]);
	writeFileSync(join(repo, "file.txt"), "before\n", "utf-8");
	await git.run(["add", "file.txt"]);
	await git.run(["commit", "-m", "init"]);
	return git;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("PathMapper", () => {
	it("maps paths to repo-relative POSIX paths", () => {
		const repo = makeTempDir();
		const mapper = new PathMapper(repo);
		expect(mapper.toRepoRelative(join(repo, "src", "auth.ts"))).toBe("src/auth.ts");
		expect(mapper.toRepoRelative("packages/api/src/index.ts")).toBe("packages/api/src/index.ts");
	});

	it("redacts repo absolute paths and external absolute paths", () => {
		const repo = makeTempDir();
		const mapper = new PathMapper(repo);
		const text = mapper.redactText(`repo ${join(repo, "src", "auth.ts")} external /tmp/secret.txt`);
		expect(text).toContain(`${"$"}{REPO}/src/auth.ts`);
		expect(text).toContain("[external-path-redacted]");
	});
});

describe("EventStore", () => {
	it("writes manifest, session metadata, and append-only events", async () => {
		const repo = makeTempDir();
		const metadata = await new SessionRegistry(repo).createSessionMetadata("sess_test");
		const store = new EventStore(repo, "sess_test");
		store.init(metadata);
		store.append({ schema_version: HUTAO_SCHEMA_VERSION, type: "prompting", id: "p_test", session_id: "sess_test" });
		expect(readFileSync(join(repo, ".hutao", "manifest.json"), "utf-8")).toContain("hutao-agent");
		expect(store.readEvents()).toHaveLength(1);
	});
});

describe("GitAdapter", () => {
	it("detects worktree diff changed files", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		writeFileSync(join(repo, "file.txt"), "after\n", "utf-8");
		const diff = await git.getWorktreeDiff();
		expect(git.getChangedFiles(diff)).toEqual(["file.txt"]);
		expect(git.computePatchHash(diff)).toMatch(/^sha256:/);
	});

	it("does not include Hutao trace files in worktree diffs", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		const metadata = await new SessionRegistry(repo).createSessionMetadata("sess_test");
		new EventStore(repo, "sess_test").init(metadata);
		expect(await git.getWorktreeDiff()).toBe("");
		expect(await git.getStatusSummary()).toBe("clean");
	});

	it("honors .hutaoignore", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		writeFileSync(join(repo, ".hutaoignore"), "ignored.txt\nsecret/**\n", "utf-8");
		writeFileSync(join(repo, "ignored.txt"), "ignore\n", "utf-8");
		writeFileSync(join(repo, "kept.txt"), "keep\n", "utf-8");
		const diff = await git.getWorktreeDiff();
		expect(git.getChangedFiles(diff)).toEqual(["kept.txt"]);
		expect(diff).not.toContain("diff --git a/ignored.txt");
	});
});

describe("HutaoIgnore", () => {
	it("matches default and custom ignore patterns", () => {
		const repo = makeTempDir();
		writeFileSync(join(repo, ".hutaoignore"), "tmp/**\n", "utf-8");
		const ignore = HutaoIgnore.load(repo);
		expect(ignore.isIgnored(".env")).toBe(true);
		expect(ignore.isIgnored("tmp/a.txt")).toBe(true);
		expect(ignore.isIgnored("src/index.ts")).toBe(false);
	});
});

describe("TraceRecorder", () => {
	it("records edit patches and rebuilds indexes", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting("change file", repo);
		await recorder.startRun("write", "tool_1", { path: "file.txt" }, repo);
		writeFileSync(join(repo, "file.txt"), "after\n", "utf-8");
		await recorder.finishRun(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "tool_1",
				input: { path: "file.txt" },
				content: [{ type: "text", text: "ok" }],
				details: undefined,
				isError: false,
			},
			repo,
		);
		expect(existsSync(join(repo, ".hutao", "index", "edits.json"))).toBe(true);
		const edits = JSON.parse(readFileSync(join(repo, ".hutao", "index", "edits.json"), "utf-8")) as unknown[];
		expect(edits).toHaveLength(1);
	});

	it("links commits observed from bash runs", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting("commit file", repo);
		await recorder.startRun("bash", "tool_commit", { command: "git commit" }, repo);
		writeFileSync(join(repo, "file.txt"), "committed\n", "utf-8");
		const git = new GitAdapter(repo);
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "change"]);
		await recorder.finishRun(
			{
				type: "tool_result",
				toolName: "bash",
				toolCallId: "tool_commit",
				input: { command: "git commit" },
				content: [{ type: "text", text: "committed" }],
				details: undefined,
				isError: false,
			},
			repo,
		);
		const events = JSON.parse(
			`[${readFileSync(join(repo, ".hutao", "sessions", recorder.getSessionId(), "events.jsonl"), "utf-8")
				.trim()
				.split(/\r?\n/)
				.join(",")}]`,
		) as Array<{ type: string }>;
		expect(events.some((event) => event.type === "commit_link")).toBe(true);
	});
	it("records binary edits as hash-only events", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		writeFileSync(join(repo, "asset.bin"), Buffer.from([0, 1, 2, 3]));
		await git.run(["add", "asset.bin"]);
		await git.run(["commit", "-m", "binary"]);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting("change binary", repo);
		await recorder.startRun("write", "tool_bin", { path: "asset.bin" }, repo);
		writeFileSync(join(repo, "asset.bin"), Buffer.from([0, 1, 2, 4]));
		await recorder.finishRun(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "tool_bin",
				input: { path: "asset.bin" },
				content: [{ type: "text", text: "ok" }],
				details: undefined,
				isError: false,
			},
			repo,
		);
		const edits = JSON.parse(readFileSync(join(repo, ".hutao", "index", "edits.json"), "utf-8")) as Array<{
			binary?: boolean;
			patch?: string | null;
		}>;
		expect(edits[0].binary).toBe(true);
		expect(edits[0].patch).toBeNull();
	});
});

describe("Clone path safety", () => {
	it("stores canonical paths without the old absolute repo root", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting(`read ${join(repo, "file.txt")}`, repo);
		await recorder.startRun("write", "tool_1", { path: join(repo, "file.txt") }, repo);
		writeFileSync(join(repo, "file.txt"), "after\n", "utf-8");
		await recorder.finishRun(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "tool_1",
				input: { path: join(repo, "file.txt") },
				content: [{ type: "text", text: `changed ${join(repo, "file.txt")}` }],
				details: undefined,
				isError: false,
			},
			repo,
		);
		const clone = makeTempDir();
		mkdirSync(clone, { recursive: true });
		cpSync(join(repo, ".hutao"), join(clone, ".hutao"), { recursive: true });
		const stored = readFileSync(join(clone, ".hutao", "index", "promptings.json"), "utf-8");
		expect(stored).not.toContain(repo);
		expect(stored).toContain(`${"$"}{REPO}/file.txt`);
	});
});

describe("RevertManager", () => {
	it("reverse applies an edit and appends revert events", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting("change file", repo);
		await recorder.startRun("write", "tool_1", { path: "file.txt" }, repo);
		writeFileSync(join(repo, "file.txt"), "after\n", "utf-8");
		await recorder.finishRun(
			{
				type: "tool_result",
				toolName: "write",
				toolCallId: "tool_1",
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
		const git = new GitAdapter(repo);
		await git.run(["add", "file.txt"]);
		await git.run(["commit", "-m", "record edit"]);
		const result = await new RevertManager(repo).revertEdit(edits[0].id, recorder.getSessionId());
		expect(result.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf-8").replace(/\r\n/g, "\n")).toBe("before\n");
	});
});

describe("IndexBuilder", () => {
	it("rebuilds file indexes from events", async () => {
		const repo = makeTempDir();
		const metadata = await new SessionRegistry(repo).createSessionMetadata("sess_test");
		const store = new EventStore(repo, "sess_test");
		store.init(metadata);
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit",
			id: "e_test",
			session_id: "sess_test",
			files: ["src/a.ts"],
		});
		rebuildIndex(repo);
		expect(readFileSync(join(repo, ".hutao", "index", "files.json"), "utf-8")).toContain("src/a.ts");
	});
});

describe("SecretGuard", () => {
	it("protects env and generated paths", () => {
		expect(isProtectedRepoPath(".env")).toBe(true);
		expect(isProtectedRepoPath("node_modules/pkg/index.js")).toBe(true);
		expect(isProtectedRepoPath("src/index.ts")).toBe(false);
	});

	it("redacts tokens and truncates output", () => {
		const result = sanitizeText(`token ghp_${"a".repeat(40)} and sk-${"b".repeat(48)} end`, 20);
		expect(result.text).not.toContain("ghp_");
		expect(result.text).not.toContain("sk-");
		expect(result.truncated).toBe(true);
	});
});
