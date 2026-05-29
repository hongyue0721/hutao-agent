import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "../../src/hutao/event-store.ts";
import { GitAdapter } from "../../src/hutao/git-adapter.ts";
import { createHutaoId } from "../../src/hutao/ids.ts";
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

function readSessionEvents(repo: string, sessionId: string): HutaoEvent[] {
	return readFileSync(join(repo, ".hutao", "sessions", sessionId, "events.jsonl"), "utf-8")
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as HutaoEvent);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Hutao integration safety", () => {
	it("refuses revert when working tree is dirty", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const recorder = new TraceRecorder(repo);
		await recorder.init();
		await recorder.recordPrompting("change", repo);
		await recorder.startRun("write", "tool_1", { path: "file.txt" }, repo);
		writeFileSync(join(repo, "file.txt"), "changed\n", "utf-8");
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
		writeFileSync(join(repo, "other.txt"), "dirty\n", "utf-8");
		const result = await new RevertManager(repo).revertEdit(edits[0].id, recorder.getSessionId());
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
			id: createHutaoId("m"),
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
