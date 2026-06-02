import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import { GitAdapter } from "../../src/hutao/git-adapter.ts";
import {
	defaultForkBranchName,
	GitBranchPolicy,
	parseGitBranchPolicyMode,
	resolveGitBranchPolicyMode,
	sanitizeGitBranchNamePart,
} from "../../src/hutao/git-branch-policy.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hutao-git-branch-policy-"));
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

function fakeContext(repo: string, confirm = true): ExtensionCommandContext {
	return {
		cwd: repo,
		ui: {
			confirm: async () => confirm,
			notify: () => undefined,
		},
	} as unknown as ExtensionCommandContext;
}

afterEach(() => {
	delete process.env.HUTAO_GIT_BRANCH_POLICY;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GitBranchPolicy", () => {
	it("parses and sanitizes policy inputs", () => {
		expect(parseGitBranchPolicyMode("ask")).toBe("ask");
		expect(parseGitBranchPolicyMode("always")).toBe("always");
		expect(parseGitBranchPolicyMode("never")).toBe("never");
		expect(parseGitBranchPolicyMode("sometimes")).toBeUndefined();
		expect(sanitizeGitBranchNamePart("refs/heads/bad branch@name..")).toBe("bad-branch-name");
		expect(
			defaultForkBranchName({
				forkSessionId: "fs_1234567890abcdef",
				sourceType: "edit",
				sourceId: "e_abcdef123456789",
			}),
		).toBe("hutao/fs_1234567890abcdef-edit-e_abcdef1234");
	});

	it("resolves mode from override, env, repo config, then default never", () => {
		const repo = makeTempDir();
		expect(resolveGitBranchPolicyMode(repo)).toBe("never");

		mkdirSync(join(repo, ".hutao"), { recursive: true });
		writeFileSync(join(repo, ".hutao", "config.json"), '{"git_branch_policy":{"mode":"ask"}}\n', "utf-8");
		expect(resolveGitBranchPolicyMode(repo)).toBe("ask");

		process.env.HUTAO_GIT_BRANCH_POLICY = "always";
		expect(resolveGitBranchPolicyMode(repo)).toBe("always");
		expect(resolveGitBranchPolicyMode(repo, "never")).toBe("never");
	});

	it("skips branch creation when policy is never or ask is declined", async () => {
		const repo = makeTempDir();
		await initRepo(repo);
		const policy = new GitBranchPolicy();

		await expect(
			policy.apply({
				repoRoot: repo,
				ctx: fakeContext(repo),
				modeOverride: "never",
				forkSessionId: "fs_never",
				sourceType: "prompting",
				sourceId: "p_never",
				forkMode: "after",
			}),
		).resolves.toMatchObject({ action: "skipped", mode: "never" });

		await expect(
			policy.apply({
				repoRoot: repo,
				ctx: fakeContext(repo, false),
				modeOverride: "ask",
				forkSessionId: "fs_ask",
				sourceType: "prompting",
				sourceId: "p_ask",
				forkMode: "after",
			}),
		).resolves.toMatchObject({ action: "skipped", mode: "ask", reason: "user declined" });
	});

	it("creates and switches to a branch when policy allows it", async () => {
		const repo = makeTempDir();
		const git = await initRepo(repo);
		const result = await new GitBranchPolicy().apply({
			repoRoot: repo,
			ctx: fakeContext(repo),
			modeOverride: "always",
			forkSessionId: "fs_branch",
			sourceType: "edit",
			sourceId: "e_branch_source",
			forkMode: "after",
		});

		expect(result).toMatchObject({ action: "created", mode: "always" });
		expect(result.branchName).toBe("hutao/fs_branch-edit-e_branch_sou");
		expect(await git.getCurrentBranch()).toBe(result.branchName);
	});
});
