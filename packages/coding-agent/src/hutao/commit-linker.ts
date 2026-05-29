import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
import { readAllEvents } from "./read-model.ts";
import { SessionRegistry } from "./session-registry.ts";

export interface CommitLinkResult {
	linked: number;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function patchesLikelyMatch(commitPatch: string, edit: HutaoEvent): boolean {
	for (const file of stringArray(edit.files)) {
		if (commitPatch.includes(` b/${file}`) || commitPatch.includes(` a/${file}`)) return true;
	}
	return false;
}

export class CommitLinker {
	private repoRoot: string;
	private git: GitAdapter;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
		this.git = new GitAdapter(repoRoot);
	}

	async scanRecentCommits(limit = 50): Promise<CommitLinkResult> {
		const log = await this.git.run(["log", `--max-count=${limit}`, "--format=%H"]);
		if (!log.ok) return { linked: 0 };
		const commits = log.stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const events = readAllEvents(this.repoRoot);
		const linkedCommits = new Set(
			events.filter((event) => event.type === "commit_link").map((event) => String(event.commit)),
		);
		const edits = events.filter((event) => event.type === "edit");
		const sessions = new SessionRegistry(this.repoRoot).readSessions();
		const targetSession = sessions[sessions.length - 1]?.id ?? String(edits[0]?.session_id ?? "");
		if (!targetSession) return { linked: 0 };
		let linked = 0;
		const store = new EventStore(this.repoRoot, targetSession);
		for (const commit of commits) {
			if (linkedCommits.has(commit)) continue;
			const patch = await this.git.getCommitPatch(commit);
			const matchedEdits = edits.filter((edit) => patchesLikelyMatch(patch, edit));
			if (matchedEdits.length === 0) continue;
			store.append({
				schema_version: HUTAO_SCHEMA_VERSION,
				type: "commit_link",
				id: createHutaoId("cl"),
				session_id: targetSession,
				commit,
				tree: await this.git.getCommitTree(commit),
				prompting_ids: [...new Set(matchedEdits.map((edit) => edit.parent_prompting).filter(Boolean))],
				run_ids: [...new Set(matchedEdits.map((edit) => edit.parent_run).filter(Boolean))],
				edit_ids: matchedEdits.map((edit) => edit.id),
				link_method: "patch_match",
				created_at: new Date().toISOString(),
			});
			linked += 1;
		}
		rebuildIndex(this.repoRoot);
		return { linked };
	}
}
