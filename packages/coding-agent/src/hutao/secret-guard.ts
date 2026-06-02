const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|(?:sk-ant|sk-proj|ghp|github_pat)_[A-Za-z0-9_-]{16,})\b/g;
const MASKED_TOKEN_PATTERN = /(?:ghp|gho|github_pat|sk-ant|sk-proj)_[A-Za-z0-9_*_-]{8,}/g;

const DEFAULT_IGNORED_PATHS = [
	".env",
	".env.",
	".git/",
	".hutaoignore",
	".hutao/",
	"node_modules/",
	"dist/",
	"build/",
	"coverage/",
];

export function isProtectedRepoPath(path: string): boolean {
	const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
	if (normalized === ".git" || normalized === "node_modules" || normalized === "dist" || normalized === "build") {
		return true;
	}
	if (normalized === ".env" || normalized.startsWith(".env.")) return true;
	if (/\.(pem|key|p12|pfx)$/i.test(normalized)) return true;
	if (normalized.endsWith("/id_rsa") || normalized.endsWith("/id_ed25519")) return true;
	return DEFAULT_IGNORED_PATHS.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`));
}

export function redactSecrets(text: string): string {
	return text
		.replace(PRIVATE_KEY_PATTERN, "[private-key-redacted]")
		.replace(TOKEN_PATTERN, "[secret-redacted]")
		.replace(MASKED_TOKEN_PATTERN, "[secret-redacted]");
}

export interface SanitizedText {
	text: string;
	originalSize: number;
	truncated: boolean;
}

export function sanitizeText(text: string, maxLength: number): SanitizedText {
	const redacted = redactSecrets(text);
	if (redacted.length <= maxLength) {
		return { text: redacted, originalSize: text.length, truncated: false };
	}
	return { text: redacted.slice(-maxLength), originalSize: text.length, truncated: true };
}
