import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoSessionMetadata } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";

export class SessionRegistry {
	private repoRoot: string;
	private git: GitAdapter;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
		this.git = new GitAdapter(repoRoot);
	}

	async createSessionMetadata(id = createHutaoId("sess")): Promise<HutaoSessionMetadata> {
		const existing = this.readSession(id);
		if (existing) return existing;
		const now = new Date().toISOString();
		return {
			schema_version: HUTAO_SCHEMA_VERSION,
			id,
			kind: "session",
			title: "Hutao session",
			created_at: now,
			updated_at: now,
			base_git_head: await this.git.getHead(),
			base_tree: await this.git.getTree(),
			current_git_head_at_last_write: await this.git.getHead(),
			current_tree_at_last_write: await this.git.getTree(),
			status: "active",
			parent_session: null,
			fork_from: null,
			summary: "",
		};
	}

	readCurrentSessionId(): string | undefined {
		const currentPath = join(this.repoRoot, ".hutao", "refs", "current-session");
		if (!existsSync(currentPath)) return undefined;
		const value = readFileSync(currentPath, "utf-8").trim();
		return value || undefined;
	}

	setCurrentSession(id: string): void {
		// EventStore.init() owns atomic writing for this file during session creation.
		// This lightweight setter is used only when switching among known Hutao sessions.
		mkdirSync(join(this.repoRoot, ".hutao", "refs"), { recursive: true });
		writeFileSync(join(this.repoRoot, ".hutao", "refs", "current-session"), `${id}\n`, "utf-8");
	}

	readSession(id: string): HutaoSessionMetadata | undefined {
		const sessionPath = join(this.repoRoot, ".hutao", "sessions", id, "session.json");
		if (!existsSync(sessionPath)) return undefined;
		try {
			return JSON.parse(readFileSync(sessionPath, "utf-8")) as HutaoSessionMetadata;
		} catch {
			return undefined;
		}
	}

	readSessions(): HutaoSessionMetadata[] {
		const sessionsPath = join(this.repoRoot, ".hutao", "refs", "sessions.json");
		if (!existsSync(sessionsPath)) return [];
		try {
			return JSON.parse(readFileSync(sessionsPath, "utf-8")) as HutaoSessionMetadata[];
		} catch {
			return [];
		}
	}

	async createContinuationSession(parentSessionId: string): Promise<HutaoSessionMetadata | undefined> {
		const parent = this.readSession(parentSessionId);
		if (!parent) return undefined;
		const now = new Date().toISOString();
		const id = createHutaoId("fs");
		const metadata: HutaoSessionMetadata = {
			schema_version: HUTAO_SCHEMA_VERSION,
			id,
			kind: "forkSession",
			title: `Resume from ${parent.id}`,
			created_at: now,
			updated_at: now,
			base_git_head: parent.current_git_head_at_last_write ?? parent.base_git_head,
			base_tree: parent.current_tree_at_last_write ?? parent.base_tree,
			current_git_head_at_last_write: await this.git.getHead(),
			current_tree_at_last_write: await this.git.getTree(),
			status: "active",
			parent_session: parent.id,
			fork_from: { type: "session", id: parent.id, mode: "after_session" },
			summary: `Continuation session created from ${parent.id}`,
		};
		const store = new EventStore(this.repoRoot, id);
		store.init(metadata);
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "fork_session",
			id,
			session_id: id,
			parent_session: parent.id,
			fork_from_type: "session",
			fork_from_id: parent.id,
			fork_mode: "after_session",
			base_git_head: metadata.base_git_head,
			base_tree: metadata.base_tree,
			created_by: "human",
			reason: metadata.summary,
			created_at: now,
		});
		return metadata;
	}
}
