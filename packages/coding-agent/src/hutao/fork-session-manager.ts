import { join } from "node:path";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent, type HutaoSessionMetadata } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
import { readAllEvents } from "./read-model.ts";

export type ForkSourceType = "prompting" | "edit" | "commit";
export type ForkMode = "before" | "retry" | "after";

export interface ForkSessionResult {
	ok: boolean;
	sessionId?: string;
	reason?: string;
}

export interface NativeForkEventInfo {
	status: "created" | "degraded" | "cancelled" | "skipped";
	source_session_id?: string;
	source_session_file?: string;
	target_entry_id?: string;
	position?: "before" | "at";
	forked_session_id?: string;
	forked_session_file?: string;
	degraded_reason?: string;
}

export interface CreateForkOptions {
	sessionId?: string;
	nativeFork?: NativeForkEventInfo;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function editPatchPath(repoRoot: string, edit: HutaoEvent): string | undefined {
	return typeof edit.patch === "string"
		? join(repoRoot, ".hutao", "sessions", String(edit.session_id), edit.patch)
		: undefined;
}

export class ForkSessionManager {
	private repoRoot: string;
	private git: GitAdapter;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
		this.git = new GitAdapter(repoRoot);
	}

	async createFork(
		sourceType: ForkSourceType,
		sourceIdPrefix: string,
		mode: ForkMode,
		options: CreateForkOptions = {},
	): Promise<ForkSessionResult> {
		if ((await this.git.getStatusSummary()) !== "clean") {
			return { ok: false, reason: "Working tree is dirty. Commit, stash, or clean before forking from history." };
		}
		const events = readAllEvents(this.repoRoot);
		if (sourceType === "commit") return this.createCommitFork(sourceIdPrefix, options);
		const source = events.find((event) => event.type === sourceType && String(event.id).startsWith(sourceIdPrefix));
		if (!source) return { ok: false, reason: `Source not found: ${sourceIdPrefix}` };
		const restore = await this.restoreHistoryState(events, source, sourceType, mode);
		if (!restore.ok) return restore;
		const forkId = options.sessionId ?? createHutaoId("fs");
		const now = new Date().toISOString();
		const metadata: HutaoSessionMetadata = {
			schema_version: HUTAO_SCHEMA_VERSION,
			id: forkId,
			kind: "forkSession",
			title: `Fork from ${source.id}`,
			created_at: now,
			updated_at: now,
			base_git_head: stringValue(source.after_head) ?? stringValue(source.git_head) ?? (await this.git.getHead()),
			base_tree: stringValue(source.after_tree) ?? stringValue(source.git_tree) ?? (await this.git.getTree()),
			current_git_head_at_last_write: await this.git.getHead(),
			current_tree_at_last_write: await this.git.getTree(),
			status: "active",
			parent_session: String(source.session_id ?? ""),
			fork_from: { type: sourceType, id: source.id, mode },
			summary: `Fork created from ${sourceType} ${source.id}`,
		};
		const store = new EventStore(this.repoRoot, forkId);
		store.init(metadata);
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "fork_session",
			id: forkId,
			session_id: forkId,
			parent_session: metadata.parent_session,
			fork_from_type: sourceType,
			fork_from_id: source.id,
			fork_mode: mode,
			base_git_head: metadata.base_git_head,
			base_tree: metadata.base_tree,
			created_by: "human",
			reason: metadata.summary,
			native_fork: options.nativeFork,
			created_at: now,
		});
		rebuildIndex(this.repoRoot);
		return { ok: true, sessionId: forkId };
	}

	private async createCommitFork(commitPrefix: string, options: CreateForkOptions = {}): Promise<ForkSessionResult> {
		const resolved = await this.git.run(["rev-parse", "--verify", commitPrefix]);
		if (!resolved.ok) return { ok: false, reason: `Commit not found: ${commitPrefix}` };
		const commit = resolved.stdout.trim();
		const current = await this.git.getHead();
		if (current !== commit) {
			const patch = await this.git.getDiffBetweenRefs(current ?? "HEAD", commit);
			if (patch.trim()) {
				const apply = await this.git.applyPatchText(patch);
				if (!apply.ok) return { ok: false, reason: apply.stderr || apply.stdout };
			}
		}
		const forkId = options.sessionId ?? createHutaoId("fs");
		const now = new Date().toISOString();
		const metadata: HutaoSessionMetadata = {
			schema_version: HUTAO_SCHEMA_VERSION,
			id: forkId,
			kind: "forkSession",
			title: `Fork from commit ${commit.slice(0, 12)}`,
			created_at: now,
			updated_at: now,
			base_git_head: commit,
			base_tree: await this.git.getCommitTree(commit),
			current_git_head_at_last_write: await this.git.getHead(),
			current_tree_at_last_write: await this.git.getTree(),
			status: "active",
			parent_session: null,
			fork_from: { type: "commit", id: commit, mode: "commit" },
			summary: `Fork created from commit ${commit}`,
		};
		const store = new EventStore(this.repoRoot, forkId);
		store.init(metadata);
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "fork_session",
			id: forkId,
			session_id: forkId,
			parent_session: null,
			fork_from_type: "commit",
			fork_from_id: commit,
			fork_mode: "commit",
			base_git_head: metadata.base_git_head,
			base_tree: metadata.base_tree,
			created_by: "human",
			reason: metadata.summary,
			native_fork: options.nativeFork,
			created_at: now,
		});
		rebuildIndex(this.repoRoot);
		return { ok: true, sessionId: forkId };
	}

	private async restoreHistoryState(
		events: HutaoEvent[],
		source: HutaoEvent,
		sourceType: ForkSourceType,
		mode: ForkMode,
	): Promise<ForkSessionResult> {
		if (sourceType === "edit") return this.restoreEdit(source, mode === "before" ? "before" : "after");
		const promptingEdits = events.filter((event) => event.type === "edit" && event.parent_prompting === source.id);
		if (mode === "after") return this.applyEdits(promptingEdits);
		return this.reverseEdits([...promptingEdits].reverse());
	}

	private async restoreEdit(edit: HutaoEvent, target: "before" | "after"): Promise<ForkSessionResult> {
		const patchPath = editPatchPath(this.repoRoot, edit);
		if (!patchPath) return { ok: false, reason: `Edit ${edit.id} has no replayable patch.` };
		if (target === "after") {
			const check = await this.git.applyPatchCheck(patchPath);
			if (check.ok) {
				const apply = await this.git.applyPatch(patchPath);
				return apply.ok ? { ok: true } : { ok: false, reason: apply.stderr || apply.stdout };
			}
			const reverseCheck = await this.git.applyReversePatchCheck(patchPath);
			return reverseCheck.ok ? { ok: true } : { ok: false, reason: check.stderr || check.stdout };
		}
		const check = await this.git.applyReversePatchCheck(patchPath);
		if (check.ok) {
			const apply = await this.git.applyReversePatch(patchPath);
			return apply.ok ? { ok: true } : { ok: false, reason: apply.stderr || apply.stdout };
		}
		const forwardCheck = await this.git.applyPatchCheck(patchPath);
		return forwardCheck.ok ? { ok: true } : { ok: false, reason: check.stderr || check.stdout };
	}

	private async applyEdits(edits: HutaoEvent[]): Promise<ForkSessionResult> {
		for (const edit of edits) {
			const patchPath = editPatchPath(this.repoRoot, edit);
			if (!patchPath) continue;
			const check = await this.git.applyPatchCheck(patchPath);
			if (!check.ok) continue;
			const apply = await this.git.applyPatch(patchPath);
			if (!apply.ok) return { ok: false, reason: apply.stderr || apply.stdout };
		}
		return { ok: true };
	}

	private async reverseEdits(edits: HutaoEvent[]): Promise<ForkSessionResult> {
		for (const edit of edits) {
			const patchPath = editPatchPath(this.repoRoot, edit);
			if (!patchPath) continue;
			const check = await this.git.applyReversePatchCheck(patchPath);
			if (!check.ok) continue;
			const apply = await this.git.applyReversePatch(patchPath);
			if (!apply.ok) return { ok: false, reason: apply.stderr || apply.stdout };
		}
		return { ok: true };
	}
}
