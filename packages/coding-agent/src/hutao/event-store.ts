import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HUTAO_SCHEMA_VERSION = "0.1.0";

export type HutaoEventType =
	| "prompting"
	| "run_started"
	| "run_finished"
	| "edit"
	| "fork_session"
	| "merge"
	| "commit_link"
	| "edit_reverted"
	| "native_entry_link";

export interface HutaoEventBase {
	schema_version: string;
	type: HutaoEventType;
	id: string;
	session_id?: string;
	created_at?: string;
}

export type HutaoEvent = HutaoEventBase & Record<string, unknown>;

export interface HutaoSessionMetadata {
	schema_version: string;
	id: string;
	kind: "session" | "forkSession";
	title: string;
	created_at: string;
	updated_at: string;
	base_git_head?: string;
	base_tree?: string;
	current_git_head_at_last_write?: string;
	current_tree_at_last_write?: string;
	status: "active" | "abandoned" | "merged";
	parent_session: string | null;
	fork_from: Record<string, unknown> | null;
	summary: string;
}

const REPO_PLACEHOLDER = "$" + "{REPO}";

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, path);
}

export class EventStore {
	private sessionId: string;
	private hutaoDir: string;
	private sessionDir: string;
	private eventsPath: string;
	private rawPath: string;

	constructor(repoRoot: string, sessionId: string) {
		this.sessionId = sessionId;
		this.hutaoDir = join(repoRoot, ".hutao");
		this.sessionDir = join(this.hutaoDir, "sessions", sessionId);
		this.eventsPath = join(this.sessionDir, "events.jsonl");
		this.rawPath = join(this.sessionDir, "raw.jsonl");
	}

	getSessionDir(): string {
		return this.sessionDir;
	}

	init(metadata: HutaoSessionMetadata): void {
		mkdirSync(join(this.sessionDir, "patches"), { recursive: true });
		mkdirSync(join(this.hutaoDir, "refs"), { recursive: true });
		mkdirSync(join(this.hutaoDir, "index"), { recursive: true });
		mkdirSync(join(this.hutaoDir, "cache"), { recursive: true });
		mkdirSync(join(this.hutaoDir, "tmp"), { recursive: true });
		this.writeManifest();
		const sessionPath = join(this.sessionDir, "session.json");
		if (!existsSync(sessionPath)) atomicWrite(sessionPath, `${JSON.stringify(metadata, null, "\t")}\n`);
		if (!existsSync(this.eventsPath)) atomicWrite(this.eventsPath, "");
		if (!existsSync(this.rawPath)) atomicWrite(this.rawPath, "");
		atomicWrite(join(this.hutaoDir, "refs", "current-session"), `${this.sessionId}\n`);
		this.updateSessionsRef(metadata);
	}

	append(event: HutaoEvent): void {
		writeFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf-8", flag: "a" });
	}

	appendRaw(event: Record<string, unknown>): void {
		writeFileSync(this.rawPath, `${JSON.stringify(event)}\n`, { encoding: "utf-8", flag: "a" });
	}

	readEvents(): HutaoEvent[] {
		if (!existsSync(this.eventsPath)) return [];
		const events: HutaoEvent[] = [];
		for (const line of readFileSync(this.eventsPath, "utf-8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				events.push(JSON.parse(line) as HutaoEvent);
			} catch {}
		}
		return events;
	}

	private writeManifest(): void {
		const now = new Date().toISOString();
		const manifestPath = join(this.hutaoDir, "manifest.json");
		let createdAt = now;
		if (existsSync(manifestPath)) {
			try {
				const current = JSON.parse(readFileSync(manifestPath, "utf-8")) as { created_at?: string };
				createdAt = current.created_at ?? now;
			} catch {
				createdAt = now;
			}
		}
		atomicWrite(
			manifestPath,
			`${JSON.stringify(
				{
					schema_version: HUTAO_SCHEMA_VERSION,
					agent_name: "hutao-agent",
					storage: "repo-local",
					repo_root_alias: REPO_PLACEHOLDER,
					created_at: createdAt,
					updated_at: now,
					sessions_dir: "sessions",
					path_policy: {
						canonical: "repo-relative-posix",
						repo_placeholder: REPO_PLACEHOLDER,
						redact_external_absolute_paths: true,
					},
					security: {
						treat_sessions_as_untrusted_data: true,
						store_full_provider_payloads_by_default: false,
						store_full_terminal_output_by_default: false,
					},
				},
				null,
				"\t",
			)}\n`,
		);
	}

	private updateSessionsRef(metadata: HutaoSessionMetadata): void {
		const sessionsPath = join(this.hutaoDir, "refs", "sessions.json");
		let sessions: HutaoSessionMetadata[] = [];
		if (existsSync(sessionsPath)) {
			try {
				sessions = JSON.parse(readFileSync(sessionsPath, "utf-8")) as HutaoSessionMetadata[];
			} catch {
				sessions = [];
			}
		}
		const next = [...sessions.filter((entry) => entry.id !== metadata.id), metadata].sort((a, b) =>
			a.created_at.localeCompare(b.created_at),
		);
		atomicWrite(sessionsPath, `${JSON.stringify(next, null, "\t")}\n`);
	}
}
