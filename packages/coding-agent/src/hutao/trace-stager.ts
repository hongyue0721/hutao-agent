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

export interface HutaoTraceStatus {
	exists: boolean;
	staged: string[];
	unstaged: string[];
	untracked: string[];
	clean: boolean;
	totalPending: number;
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
	return (
		/[A-Za-z]:[\\/][^\s"'`<>)]*/.test(text) ||
		/(?:^|\s)\/(?:Users|home|mnt|Volumes|OneDrive)\/[^\s"'`<>)]*/.test(text)
	);
}

async function listCandidateTraceFiles(git: GitAdapter): Promise<string[]> {
	const result = await git.run(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...TRACE_PATHS]);
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

export async function getHutaoTraceStatus(repoRoot: string): Promise<HutaoTraceStatus> {
	const git = new GitAdapter(repoRoot);
	if (!existsSync(join(repoRoot, ".hutao"))) {
		return { exists: false, staged: [], unstaged: [], untracked: [], clean: true, totalPending: 0 };
	}
	const result = await git.run(["status", "--porcelain=v1", "--", ...TRACE_PATHS]);
	const staged = new Set<string>();
	const unstaged = new Set<string>();
	const untracked = new Set<string>();
	if (result.ok) {
		for (const rawLine of result.stdout.split(/\r?\n/)) {
			if (!rawLine.trim()) continue;
			const x = rawLine[0] ?? " ";
			const y = rawLine[1] ?? " ";
			let file = rawLine.slice(3).trim().replace(/\\/g, "/");
			const rename = file.match(/^(.*?)\s+->\s+(.*)$/);
			if (rename) file = rename[2];
			if (!file.startsWith(".hutao/")) continue;
			if (file.startsWith(".hutao/cache/") || file.startsWith(".hutao/tmp/") || file.startsWith(".hutao/index/")) {
				continue;
			}
			if (x === "?" && y === "?") {
				untracked.add(file);
				continue;
			}
			if (x !== " " && x !== "?") staged.add(file);
			if (y !== " " && y !== "?") unstaged.add(file);
		}
	}
	const totalPending = staged.size + unstaged.size + untracked.size;
	return {
		exists: true,
		staged: [...staged].sort(),
		unstaged: [...unstaged].sort(),
		untracked: [...untracked].sort(),
		clean: totalPending === 0,
		totalPending,
	};
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
