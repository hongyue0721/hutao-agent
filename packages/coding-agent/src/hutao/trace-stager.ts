import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GitAdapter, type GitCommandResult } from "./git-adapter.ts";
import { redactSecrets } from "./secret-guard.ts";

export interface StageTraceResult {
	ok: boolean;
	staged: string[];
	warnings: string[];
	error?: string;
}

const TRACE_PATHS = [".hutao/manifest.json", ".hutao/refs", ".hutao/sessions"];
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

function isGitCommitCommand(command: string): boolean {
	return /(?:^|[;&|()\s])git\s+(?:-[^\s]+\s+)*commit(?:\s|$)/i.test(command);
}

function isTextTraceFile(path: string): boolean {
	return /(?:\.json|\.jsonl|\.patch|current-session)$/i.test(path);
}

function hasAbsolutePathLeak(text: string): boolean {
	return /[A-Za-z]:[\\/][^\s"'`<>)]*/.test(text) || /(?:^|\s)\/(?:Users|home|mnt|Volumes|OneDrive)\/[^\s"'`<>)]*/.test(text);
}

async function listCandidateTraceFiles(git: GitAdapter): Promise<string[]> {
	const result = await git.run([
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"--",
		...TRACE_PATHS,
	]);
	if (!result.ok) return [];
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim().replace(/\\/g, "/"))
		.filter((line) => line.startsWith(".hutao/"))
		.filter((line) => !line.startsWith(".hutao/cache/"))
		.filter((line) => !line.startsWith(".hutao/tmp/"))
		.filter((line) => !line.startsWith(".hutao/index/"));
}

function scanTraceFiles(repoRoot: string, files: string[]): string[] {
	const warnings: string[] = [];
	for (const file of files) {
		if (!isTextTraceFile(file)) continue;
		const absolutePath = join(repoRoot, file);
		if (!existsSync(absolutePath)) continue;
		const stat = statSync(absolutePath);
		if (!stat.isFile()) continue;
		if (stat.size > MAX_SCAN_BYTES) {
			warnings.push(`${file}: skipped scan because file is larger than ${MAX_SCAN_BYTES} bytes`);
			continue;
		}
		const text = readFileSync(absolutePath, "utf-8");
		if (redactSecrets(text) !== text) warnings.push(`${file}: contains text that looks like a secret`);
		if (hasAbsolutePathLeak(text)) warnings.push(`${file}: contains text that looks like an absolute path`);
	}
	return warnings;
}

export function commandNeedsTraceStage(command: string): boolean {
	return isGitCommitCommand(command);
}

export async function stageHutaoTrace(repoRoot: string): Promise<StageTraceResult> {
	const git = new GitAdapter(repoRoot);
	if (!existsSync(join(repoRoot, ".hutao"))) return { ok: true, staged: [], warnings: [] };
	const files = await listCandidateTraceFiles(git);
	const warnings = scanTraceFiles(repoRoot, files);
	if (warnings.length > 0) {
		return {
			ok: false,
			staged: [],
			warnings,
			error: "Hutao trace was not staged because safety scan found possible sensitive local data.",
		};
	}
	const result: GitCommandResult = await git.run(["add", "--", ...TRACE_PATHS]);
	if (!result.ok) {
		return {
			ok: false,
			staged: [],
			warnings,
			error: result.stderr || "git add failed",
		};
	}
	return { ok: true, staged: files, warnings };
}
