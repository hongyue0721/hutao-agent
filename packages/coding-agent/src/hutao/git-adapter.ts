import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { HutaoIgnore } from "./hutao-ignore.ts";

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export interface FileHashEntry {
	path: string;
	hash: string;
}

export interface WorktreeFileState {
	path: string;
	status: string;
	hash?: string;
}

export interface WorktreeSnapshot {
	files: Record<string, WorktreeFileState>;
}

export class GitAdapter {
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async run(args: string[], options?: { maxBuffer?: number }): Promise<GitCommandResult> {
		try {
			const result = await execFileAsync("git", args, {
				cwd: this.cwd,
				maxBuffer: options?.maxBuffer ?? 20 * 1024 * 1024,
			});
			return { ok: true, stdout: result.stdout, stderr: result.stderr };
		} catch (error: unknown) {
			const execError = error as { stdout?: string; stderr?: string; message?: string };
			return {
				ok: false,
				stdout: execError.stdout ?? "",
				stderr: execError.stderr ?? execError.message ?? String(error),
			};
		}
	}

	async getRepoRoot(): Promise<string | undefined> {
		const result = await this.run(["rev-parse", "--show-toplevel"]);
		return result.ok ? result.stdout.trim() || undefined : undefined;
	}

	async getHead(): Promise<string | undefined> {
		const result = await this.run(["rev-parse", "HEAD"]);
		return result.ok ? result.stdout.trim() || undefined : undefined;
	}

	async getTree(): Promise<string | undefined> {
		const result = await this.run(["rev-parse", "HEAD^{tree}"]);
		return result.ok ? result.stdout.trim() || undefined : undefined;
	}

	async getStatusSummary(): Promise<string> {
		const ignore = HutaoIgnore.load(this.cwd);
		const result = await this.run([
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
			"--",
			".",
			...ignore.toGitPathspecExcludes(),
		]);
		if (!result.stdout.trim()) return "clean";
		const lines = result.stdout.trim().split(/\r?\n/);
		return `${lines.length} changed path${lines.length === 1 ? "" : "s"}`;
	}

	async getWorktreeDiff(): Promise<string> {
		return this.getWorktreeDiffForFiles();
	}

	async getWorktreeSnapshot(): Promise<WorktreeSnapshot> {
		const ignore = HutaoIgnore.load(this.cwd);
		const result = await this.run([
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
			"--",
			".",
			...ignore.toGitPathspecExcludes(),
		]);
		const files: Record<string, WorktreeFileState> = {};
		for (const rawLine of result.stdout.split(/\r?\n/)) {
			if (!rawLine.trim()) continue;
			const status = rawLine.slice(0, 2);
			let file = rawLine.slice(3).trim().replace(/\\/g, "/");
			const rename = file.match(/^(.*?)\s+->\s+(.*)$/);
			if (rename) file = rename[2];
			if (!file || ignore.isIgnored(file)) continue;
			const hashResult = await this.run(["hash-object", "--", file]);
			files[file] = {
				path: file,
				status,
				hash: hashResult.ok && hashResult.stdout.trim() ? `sha1:${hashResult.stdout.trim()}` : undefined,
			};
		}
		return { files };
	}

	getChangedFilesBetweenSnapshots(before: WorktreeSnapshot, after: WorktreeSnapshot): string[] {
		const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
		return [...paths]
			.filter((path) => {
				const beforeState = before.files[path];
				const afterState = after.files[path];
				return beforeState?.status !== afterState?.status || beforeState?.hash !== afterState?.hash;
			})
			.sort();
	}

	async getWorktreeDiffForFiles(files?: string[]): Promise<string> {
		const ignore = HutaoIgnore.load(this.cwd);
		const selectedFiles = files?.filter((file) => !ignore.isIgnored(file));
		if (selectedFiles && selectedFiles.length === 0) return "";
		const pathspec =
			selectedFiles && selectedFiles.length > 0 ? selectedFiles : [".", ...ignore.toGitPathspecExcludes()];
		const tracked = await this.run(["diff", "--binary", "--", ...pathspec]);
		let patch = tracked.stdout;
		const untrackedResult = await this.run([
			"ls-files",
			"--others",
			"--exclude-standard",
			"--",
			...(selectedFiles && selectedFiles.length > 0 ? selectedFiles : ["."]),
		]);
		for (const file of untrackedResult.stdout
			.split(/\r?\n/)
			.map((line) => line.trim().replace(/\\/g, "/"))
			.filter(Boolean)) {
			if (ignore.isIgnored(file)) continue;
			if (selectedFiles && !selectedFiles.includes(file)) continue;
			const result = await this.run(["diff", "--binary", "--no-index", "--", "/dev/null", file]);
			patch += result.stdout;
		}
		return patch;
	}

	async applyPatchCheck(patchPath: string): Promise<GitCommandResult> {
		return this.run(["apply", "--check", patchPath]);
	}

	async applyPatch(patchPath: string): Promise<GitCommandResult> {
		return this.run(["apply", patchPath]);
	}

	async applyReversePatchCheck(patchPath: string): Promise<GitCommandResult> {
		return this.run(["apply", "-R", "--check", patchPath]);
	}

	async applyReversePatch(patchPath: string): Promise<GitCommandResult> {
		return this.run(["apply", "-R", patchPath]);
	}

	async getCommitTree(commit: string): Promise<string | undefined> {
		const result = await this.run(["rev-parse", `${commit}^{tree}`]);
		return result.ok ? result.stdout.trim() || undefined : undefined;
	}

	getChangedFiles(patch: string): string[] {
		const files = new Set<string>();
		for (const line of patch.split(/\r?\n/)) {
			const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
			if (match) files.add(match[2]);
		}
		return [...files].sort();
	}

	async applyPatchText(patch: string): Promise<GitCommandResult> {
		const patchPath = join(this.cwd, ".hutao", "tmp", `apply-${process.pid}-${Date.now()}.patch`);
		mkdirSync(join(this.cwd, ".hutao", "tmp"), { recursive: true });
		writeFileSync(patchPath, patch, "utf-8");
		return this.applyPatch(patchPath);
	}

	async applyReversePatchText(patch: string): Promise<GitCommandResult> {
		const patchPath = join(this.cwd, ".hutao", "tmp", `reverse-${process.pid}-${Date.now()}.patch`);
		mkdirSync(join(this.cwd, ".hutao", "tmp"), { recursive: true });
		writeFileSync(patchPath, patch, "utf-8");
		return this.applyReversePatchCheck(patchPath);
	}

	async getDiffBetweenRefs(fromRef: string, toRef: string): Promise<string> {
		const result = await this.run(["diff", "--binary", fromRef, toRef], { maxBuffer: 100 * 1024 * 1024 });
		return result.stdout;
	}

	async getCommitPatch(commit: string): Promise<string> {
		const result = await this.run(["show", "--format=", "--binary", commit], { maxBuffer: 100 * 1024 * 1024 });
		return result.stdout;
	}

	async refExists(ref: string): Promise<boolean> {
		const result = await this.run(["rev-parse", "--verify", ref]);
		return result.ok;
	}

	async getFileHashes(paths: string[]): Promise<FileHashEntry[]> {
		const entries: FileHashEntry[] = [];
		for (const path of paths) {
			const result = await this.run(["hash-object", "--", path]);
			if (result.ok && result.stdout.trim()) entries.push({ path, hash: `sha1:${result.stdout.trim()}` });
		}
		return entries;
	}

	isBinaryPatch(patch: string): boolean {
		return /(?:^|\n)(GIT binary patch|Binary files .* differ)(?:\n|$)/.test(patch);
	}

	computePatchHash(patch: string): string {
		return `sha256:${createHash("sha256").update(patch).digest("hex")}`;
	}
}
