import { join } from "node:path";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
import { PatchStore } from "./patch-store.ts";
import { readAllEvents } from "./read-model.ts";

export interface RevertResult {
	ok: boolean;
	revertEditId?: string;
	revertEventId?: string;
	reason?: string;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export class RevertManager {
	private repoRoot: string;
	private git: GitAdapter;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
		this.git = new GitAdapter(repoRoot);
	}

	async revertEdit(editIdPrefix: string, targetSessionId: string): Promise<RevertResult> {
		if ((await this.git.getStatusSummary()) !== "clean") {
			return { ok: false, reason: "Working tree is dirty. Commit, stash, or clean before reverting an edit." };
		}
		const events = readAllEvents(this.repoRoot);
		const edit = events.find((event) => event.type === "edit" && String(event.id).startsWith(editIdPrefix));
		if (!edit) return { ok: false, reason: `Edit not found: ${editIdPrefix}` };
		if (edit.status === "reverted") return { ok: false, reason: `Edit already reverted: ${edit.id}` };
		const patch = typeof edit.patch === "string" ? edit.patch : undefined;
		if (!patch) return { ok: false, reason: `Edit has no patch: ${edit.id}` };
		const patchPath = join(this.repoRoot, ".hutao", "sessions", String(edit.session_id), patch);
		const check = await this.git.applyReversePatchCheck(patchPath);
		if (!check.ok)
			return { ok: false, reason: check.stderr || check.stdout || "Reverse patch does not apply cleanly." };
		const beforeHead = await this.git.getHead();
		const beforeTree = await this.git.getTree();
		const apply = await this.git.applyReversePatch(patchPath);
		if (!apply.ok) return { ok: false, reason: apply.stderr || apply.stdout || "Reverse patch failed." };
		const reversePatch = await this.git.getWorktreeDiff();
		const files = stringArray(edit.files);
		const revertEditId = createHutaoId("e");
		const patchStore = new PatchStore(join(this.repoRoot, ".hutao", "sessions", targetSessionId));
		const storedPatch = patchStore.writePatch(revertEditId, reversePatch);
		const store = new EventStore(this.repoRoot, targetSessionId);
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit",
			id: revertEditId,
			session_id: targetSessionId,
			parent_prompting: edit.parent_prompting,
			parent_run: null,
			actor: "human",
			tool: "revert",
			files,
			patch: storedPatch.relativePath,
			patch_hash: storedPatch.hash,
			before_head: beforeHead,
			after_head: await this.git.getHead(),
			before_tree: beforeTree,
			after_tree: await this.git.getTree(),
			created_at: new Date().toISOString(),
			status: "active",
			reverts_edit: edit.id,
			summary: `Reverted edit ${edit.id}`,
		});
		const revertEventId = createHutaoId("er");
		store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit_reverted",
			id: revertEventId,
			session_id: targetSessionId,
			edit_id: edit.id,
			revert_edit_id: revertEditId,
			created_at: new Date().toISOString(),
		} as HutaoEvent);
		rebuildIndex(this.repoRoot);
		return { ok: true, revertEditId, revertEventId };
	}
}
