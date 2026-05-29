import { isAbsolute, relative, resolve, sep } from "node:path";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosixPath(value: string): string {
	return value.split(sep).join("/");
}

function looksLikeAbsolutePath(value: string): boolean {
	return value !== "/dev/null" && (/^\/[\w.-]/.test(value) || /^[A-Za-z]:[\\/]/.test(value));
}

const REPO_PLACEHOLDER = "$" + "{REPO}";

export class PathMapper {
	private repoRoot: string;

	constructor(repoRoot: string) {
		this.repoRoot = resolve(repoRoot);
	}

	getRepoRoot(): string {
		return this.repoRoot;
	}

	toRepoRelative(path: string): string | undefined {
		const absolutePath = isAbsolute(path) ? resolve(path) : resolve(this.repoRoot, path);
		const relativePath = relative(this.repoRoot, absolutePath);
		if (relativePath === "") return ".";
		if (relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
		return toPosixPath(relativePath);
	}

	redactText(text: string): string {
		let redacted = text;
		const repoPattern = new RegExp(`${escapeRegExp(this.repoRoot)}[\\\\/]*([^\\s"'\`<>)]*)`, "gi");
		redacted = redacted.replace(repoPattern, (_match, suffix: string) => {
			const normalized = String(suffix ?? "")
				.replace(/^[\\/]+/, "")
				.replace(/\\/g, "/");
			return normalized ? `${REPO_PLACEHOLDER}/${normalized}` : REPO_PLACEHOLDER;
		});
		return redacted.replace(
			/(?:^|\s)([A-Za-z]:[\\/][^\s"'`<>)]*|\/[A-Za-z0-9_.-][^\s"'`<>)]*)/g,
			(match, candidate: string) => {
				if (!looksLikeAbsolutePath(candidate)) return match;
				const prefix = match.slice(0, match.length - candidate.length);
				return `${prefix}[external-path-redacted]`;
			},
		);
	}
}
