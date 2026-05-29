import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_PATTERNS = [
	".env",
	".env.*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"id_rsa",
	"id_ed25519",
	".git/**",
	".hutaoignore",
	".hutao/**",
	"node_modules/**",
	"dist/**",
	"build/**",
	"coverage/**",
];

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function appendEscapedRegexChar(parts: string[], char: string): void {
	parts.push(/[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char);
}

function patternToRegExp(pattern: string): RegExp {
	const normalized = normalizePath(pattern).replace(/^\//, "");
	const parts: string[] = ["^"];
	for (let index = 0; index < normalized.length; index += 1) {
		const char = normalized[index];
		const next = normalized[index + 1];
		if (char === "*" && next === "*") {
			parts.push(".*");
			index += 1;
			continue;
		}
		if (char === "*") {
			parts.push("[^/]*");
			continue;
		}
		if (char === "?") {
			parts.push("[^/]");
			continue;
		}
		appendEscapedRegexChar(parts, char);
	}
	parts.push("$");
	return new RegExp(parts.join(""));
}

export class HutaoIgnore {
	private patterns: string[];
	private regexes: RegExp[];

	constructor(patterns: string[] = DEFAULT_PATTERNS) {
		this.patterns = patterns.map(normalizePath);
		this.regexes = this.patterns.map(patternToRegExp);
	}

	static load(repoRoot: string): HutaoIgnore {
		const ignorePath = join(repoRoot, ".hutaoignore");
		if (!existsSync(ignorePath)) return new HutaoIgnore();
		const customPatterns = readFileSync(ignorePath, "utf-8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
		return new HutaoIgnore([...DEFAULT_PATTERNS, ...customPatterns]);
	}

	isIgnored(path: string): boolean {
		const normalized = normalizePath(path);
		return this.regexes.some((regex) => regex.test(normalized));
	}

	toGitPathspecExcludes(): string[] {
		return this.patterns.map((pattern) => `:!${pattern}`);
	}
}
