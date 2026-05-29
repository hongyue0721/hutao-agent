import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HUTAO_SCHEMA_VERSION, type HutaoSessionMetadata } from "./event-store.ts";
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

	readSessions(): HutaoSessionMetadata[] {
		const sessionsPath = join(this.repoRoot, ".hutao", "refs", "sessions.json");
		if (!existsSync(sessionsPath)) return [];
		try {
			return JSON.parse(readFileSync(sessionsPath, "utf-8")) as HutaoSessionMetadata[];
		} catch {
			return [];
		}
	}
}
