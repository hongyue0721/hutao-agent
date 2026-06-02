import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import { GitAdapter, type GitCommandResult } from "./git-adapter.ts";
import { type TranslationKey, t } from "./i18n.ts";

export type GitBranchPolicyMode = "ask" | "always" | "never";

export interface GitBranchPolicyConfig {
	mode: GitBranchPolicyMode;
}

export interface GitBranchPolicyRequest {
	repoRoot: string;
	ctx: ExtensionCommandContext;
	modeOverride?: GitBranchPolicyMode;
	forkSessionId: string;
	sourceType: string;
	sourceId: string;
	forkMode: string;
}

export interface GitBranchPolicyResult {
	action: "created" | "skipped" | "failed";
	mode: GitBranchPolicyMode;
	branchName?: string;
	reason?: string;
	git?: GitCommandResult;
}

interface HutaoConfigFile {
	git_branch_policy?: GitBranchPolicyMode | { mode?: GitBranchPolicyMode };
}

const VALID_MODES = new Set<GitBranchPolicyMode>(["ask", "always", "never"]);

function asMode(value: unknown): GitBranchPolicyMode | undefined {
	return typeof value === "string" && VALID_MODES.has(value as GitBranchPolicyMode)
		? (value as GitBranchPolicyMode)
		: undefined;
}

function readRepoConfig(repoRoot: string): GitBranchPolicyConfig | undefined {
	const path = join(repoRoot, ".hutao", "config.json");
	if (!existsSync(path)) return undefined;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8")) as HutaoConfigFile;
		const raw = data.git_branch_policy;
		const mode = asMode(raw) ?? (raw && typeof raw === "object" ? asMode(raw.mode) : undefined);
		return mode ? { mode } : undefined;
	} catch {
		return undefined;
	}
}

export function resolveGitBranchPolicyMode(repoRoot: string, modeOverride?: GitBranchPolicyMode): GitBranchPolicyMode {
	if (modeOverride) return modeOverride;
	const envMode = asMode(process.env.HUTAO_GIT_BRANCH_POLICY);
	if (envMode) return envMode;
	return readRepoConfig(repoRoot)?.mode ?? "never";
}

export function parseGitBranchPolicyMode(value: string | undefined): GitBranchPolicyMode | undefined {
	return asMode(value);
}

export function sanitizeGitBranchNamePart(value: string): string {
	return value
		.trim()
		.replace(/^refs\/heads\//, "")
		.replace(/[^A-Za-z0-9._/-]+/g, "-")
		.replace(/\/+/g, "/")
		.replace(/\.\.+/g, ".")
		.replace(/(^[./-]+|[./-]+$)/g, "")
		.slice(0, 80);
}

export function defaultForkBranchName(
	request: Pick<GitBranchPolicyRequest, "forkSessionId" | "sourceType" | "sourceId">,
): string {
	const source = sanitizeGitBranchNamePart(`${request.sourceType}-${request.sourceId.slice(0, 12)}`) || "history";
	const session = sanitizeGitBranchNamePart(request.forkSessionId.slice(0, 20)) || "fork";
	return `hutao/${session}-${source}`;
}

function label(repoRoot: string, key: TranslationKey): string {
	return t(repoRoot, key);
}

export class GitBranchPolicy {
	async apply(request: GitBranchPolicyRequest): Promise<GitBranchPolicyResult> {
		const mode = resolveGitBranchPolicyMode(request.repoRoot, request.modeOverride);
		if (mode === "never") return { action: "skipped", mode, reason: "policy=never" };
		const branchName = defaultForkBranchName(request);
		if (mode === "ask") {
			const confirmed = await request.ctx.ui.confirm(
				label(request.repoRoot, "gitBranch.confirm.title"),
				[
					label(request.repoRoot, "gitBranch.confirm.message"),
					"",
					`forkSession: ${request.forkSessionId}`,
					`source: ${request.sourceType} ${request.sourceId}`,
					`mode: ${request.forkMode}`,
					`branch: ${branchName}`,
					"",
					"This switches the current Git branch but does not commit changes.",
				].join("\n"),
			);
			if (!confirmed) return { action: "skipped", mode, branchName, reason: "user declined" };
		}
		const git = new GitAdapter(request.repoRoot);
		if (await git.refExists(`refs/heads/${branchName}`)) {
			return { action: "failed", mode, branchName, reason: "branch already exists" };
		}
		const result = await git.createAndSwitchBranch(branchName);
		return result.ok
			? { action: "created", mode, branchName, git: result }
			: { action: "failed", mode, branchName, reason: result.stderr || result.stdout, git: result };
	}
}
