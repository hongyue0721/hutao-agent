import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getRepoLocalSessionDir, SessionManager } from "../../src/core/session-manager.ts";
import { GitAdapter } from "../../src/hutao/git-adapter.ts";
import { resolveRuntimeSessionDir } from "../../src/main.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hutao-session-dir-policy-"));
	tempDirs.push(dir);
	return dir;
}

async function initRepo(repo: string): Promise<void> {
	await new GitAdapter(repo).run(["init"]);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Hutao runtime session directory policy", () => {
	it("prefers repo-local native sessions over configured settings sessionDir inside Git repos", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const configuredSessionDir = join(makeTempDir(), "legacy-settings-sessions");
		mkdirSync(configuredSessionDir, { recursive: true });

		const resolved = resolveRuntimeSessionDir({
			cwd: repo,
			settingsSessionDir: configuredSessionDir,
		});

		expect(resolved).toBe(getRepoLocalSessionDir(repo));

		const session = SessionManager.create(repo, resolved);
		session.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi" }],
			api: "test",
			provider: "test",
			model: "test-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "endTurn",
			timestamp: Date.now(),
		} as any);

		const expectedNativeFile = join(repo, ".hutao", "sessions", session.getSessionId(), "native-session.jsonl");
		expect(session.getSessionFile()).toBe(expectedNativeFile);
		expect(existsSync(expectedNativeFile)).toBe(true);
		expect(existsSync(configuredSessionDir)).toBe(true);
	});

	it("keeps explicit CLI and env session directories higher priority than repo-local defaults", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const cliSessionDir = join(makeTempDir(), "cli-sessions");
		const envSessionDir = join(makeTempDir(), "env-sessions");
		const settingsSessionDir = join(makeTempDir(), "settings-sessions");

		expect(
			resolveRuntimeSessionDir({
				cwd: repo,
				cliSessionDir,
				envSessionDir,
				settingsSessionDir,
			}),
		).toBe(cliSessionDir);

		expect(
			resolveRuntimeSessionDir({
				cwd: repo,
				envSessionDir,
				settingsSessionDir,
			}),
		).toBe(envSessionDir);
	});
});
