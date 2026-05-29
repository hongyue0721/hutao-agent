import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoEvent } from "./event-store.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
import { PatchStore } from "./patch-store.ts";
import { readAllEvents } from "./read-model.ts";
import { SessionRegistry } from "./session-registry.ts";

export type MergeMode = "preview" | "history_only" | "apply_edits" | "apply_tree";

export interface MergeResult {
	ok: boolean;
	mode: MergeMode;
	message: string;
	appliedEdits: string[];
	skippedEdits: string[];
	conflictEdits: string[];
	resolutionEdits: string[];
	changedFiles: string[];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function patchPath(repoRoot: string, edit: HutaoEvent): string | undefined {
	return typeof edit.patch === "string"
		? join(repoRoot, ".hutao", "sessions", String(edit.session_id), edit.patch)
		: undefined;
}

export class MergeManager {
	private repoRoot: string;
	private git: GitAdapter;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
		this.git = new GitAdapter(repoRoot);
	}

	async mergeSession(sourceIdPrefix: string, mode: MergeMode): Promise<MergeResult> {
		const sessions = new SessionRegistry(this.repoRoot).readSessions();
		const source = sessions.find((session) => session.id.startsWith(sourceIdPrefix));
		if (!source) return this.empty(mode, `Source session not found: ${sourceIdPrefix}`, false);
		const targetSession =
			sessions.find((session) => session.id !== source.id)?.id ?? sessions[sessions.length - 1]?.id ?? source.id;
		const events = readAllEvents(this.repoRoot);
		const sourceEvents = events.filter((event) => event.session_id === source.id);
		const sourceEdits = sourceEvents.filter((event) => event.type === "edit");
		const changedFiles = [...new Set(sourceEdits.flatMap((edit) => stringArray(edit.files)))].sort();
		if (mode === "preview")
			return this.empty(mode, "Merge preview only. No code changes were applied.", true, changedFiles);
		if (mode === "history_only")
			return this.historyOnly(targetSession, source.id, sourceEvents, sourceEdits, changedFiles);
		if ((await this.git.getStatusSummary()) !== "clean") {
			return this.empty(
				mode,
				"Working tree is dirty. Commit, stash, or clean before applying merge.",
				false,
				changedFiles,
			);
		}
		return mode === "apply_tree"
			? this.applyTree(targetSession, source.id, sourceEdits, changedFiles)
			: this.applyEdits(targetSession, source.id, events, sourceEdits, changedFiles);
	}

	private empty(mode: MergeMode, message: string, ok: boolean, changedFiles: string[] = []): MergeResult {
		return {
			ok,
			mode,
			message,
			appliedEdits: [],
			skippedEdits: [],
			conflictEdits: [],
			resolutionEdits: [],
			changedFiles,
		};
	}

	private historyOnly(
		targetSession: string,
		sourceSession: string,
		sourceEvents: HutaoEvent[],
		sourceEdits: HutaoEvent[],
		changedFiles: string[],
	): MergeResult {
		new EventStore(this.repoRoot, targetSession).append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "merge",
			id: createHutaoId("m"),
			session_id: targetSession,
			source_session: sourceSession,
			target_session: targetSession,
			mode: "history_only",
			status: "completed",
			imported_promptings: sourceEvents.filter((event) => event.type === "prompting").map((event) => event.id),
			imported_runs: sourceEvents.filter((event) => event.type === "run_finished").map((event) => event.id),
			imported_edits: sourceEdits.map((event) => event.id),
			applied_edits: [],
			conflict_edits: [],
			resolution_edits: [],
			created_at: new Date().toISOString(),
		});
		rebuildIndex(this.repoRoot);
		return this.empty("history_only", "History imported. No code changes were applied.", true, changedFiles);
	}

	private async applyEdits(
		targetSession: string,
		sourceSession: string,
		allEvents: HutaoEvent[],
		sourceEdits: HutaoEvent[],
		changedFiles: string[],
	): Promise<MergeResult> {
		const applied: string[] = [];
		const skipped: string[] = [];
		const conflicts: string[] = [];
		const previouslyApplied = new Set<string>();
		for (const merge of allEvents.filter((event) => event.type === "merge")) {
			for (const editId of stringArray(merge.applied_edits)) previouslyApplied.add(editId);
			for (const editId of stringArray(merge.skipped_edits)) previouslyApplied.add(editId);
		}
		const beforeTree = await this.git.getTree();
		for (const edit of sourceEdits) {
			if (previouslyApplied.has(String(edit.id))) {
				skipped.push(String(edit.id));
				continue;
			}
			const path = patchPath(this.repoRoot, edit);
			if (!path) {
				skipped.push(String(edit.id));
				continue;
			}
			const check = await this.git.applyPatchCheck(path);
			if (!check.ok) {
				conflicts.push(String(edit.id));
				break;
			}
			const apply = await this.git.applyPatch(path);
			if (!apply.ok) {
				conflicts.push(String(edit.id));
				break;
			}
			applied.push(String(edit.id));
		}
		this.writeMergeEvent(targetSession, sourceSession, "apply_edits", conflicts.length ? "conflict" : "completed", {
			importedEdits: sourceEdits.map((event) => event.id),
			appliedEdits: applied,
			skippedEdits: skipped,
			conflictEdits: conflicts,
			resolutionEdits: [],
			beforeTree,
			afterTree: await this.git.getTree(),
		});
		return {
			ok: conflicts.length === 0,
			mode: "apply_edits",
			message: conflicts.length ? "Merge stopped at conflicting edit." : "Applied source edits.",
			appliedEdits: applied,
			skippedEdits: skipped,
			conflictEdits: conflicts,
			resolutionEdits: [],
			changedFiles,
		};
	}

	private async applyTree(
		targetSession: string,
		sourceSession: string,
		sourceEdits: HutaoEvent[],
		changedFiles: string[],
	): Promise<MergeResult> {
		let finalDiff = await this.getSourceFinalDiff(sourceEdits);
		if (!finalDiff.trim()) finalDiff = this.getSourcePatchSequence(sourceEdits);
		if (!finalDiff.trim())
			return this.empty("apply_tree", "Source final tree has no replayable diff.", false, changedFiles);
		const beforeTree = await this.git.getTree();
		const check = await this.git.applyPatchText(finalDiff);
		if (!check.ok) {
			const reverseCheck = await this.git.applyReversePatchText(finalDiff);
			if (reverseCheck.ok) {
				this.writeMergeEvent(targetSession, sourceSession, "apply_tree", "completed", {
					importedEdits: sourceEdits.map((event) => event.id),
					appliedEdits: [],
					skippedEdits: sourceEdits.map((event) => String(event.id)),
					conflictEdits: [],
					resolutionEdits: [],
					beforeTree,
					afterTree: await this.git.getTree(),
				});
				return {
					ok: true,
					mode: "apply_tree",
					message: "Source final snapshot is already present. No code changes were applied.",
					appliedEdits: [],
					skippedEdits: sourceEdits.map((event) => String(event.id)),
					conflictEdits: [],
					resolutionEdits: [],
					changedFiles,
				};
			}
			this.writeMergeEvent(targetSession, sourceSession, "apply_tree", "conflict", {
				importedEdits: sourceEdits.map((event) => event.id),
				appliedEdits: [],
				skippedEdits: [],
				conflictEdits: sourceEdits.map((event) => String(event.id)),
				resolutionEdits: [],
				beforeTree,
				afterTree: await this.git.getTree(),
			});
			return this.empty("apply_tree", check.stderr || check.stdout || "Apply-tree failed.", false, changedFiles);
		}
		const patchStore = new PatchStore(join(this.repoRoot, ".hutao", "sessions", targetSession));
		const mergeEditId = createHutaoId("e");
		const stored = patchStore.writePatch(mergeEditId, finalDiff);
		new EventStore(this.repoRoot, targetSession).append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit",
			id: mergeEditId,
			session_id: targetSession,
			parent_prompting: null,
			parent_run: null,
			actor: "agent",
			tool: "merge_apply_tree",
			files: this.git.getChangedFiles(finalDiff),
			patch: stored.relativePath,
			patch_hash: stored.hash,
			before_head: await this.git.getHead(),
			after_head: await this.git.getHead(),
			before_tree: beforeTree,
			after_tree: await this.git.getTree(),
			created_at: new Date().toISOString(),
			status: "active",
			summary: `Applied final snapshot from ${sourceSession}`,
		});
		this.writeMergeEvent(targetSession, sourceSession, "apply_tree", "completed", {
			importedEdits: sourceEdits.map((event) => event.id),
			appliedEdits: [],
			skippedEdits: [],
			conflictEdits: [],
			resolutionEdits: [mergeEditId],
			beforeTree,
			afterTree: await this.git.getTree(),
		});
		return {
			ok: true,
			mode: "apply_tree",
			message: "Applied source final snapshot.",
			appliedEdits: [],
			skippedEdits: [],
			conflictEdits: [],
			resolutionEdits: [mergeEditId],
			changedFiles,
		};
	}

	private async getSourceFinalDiff(sourceEdits: HutaoEvent[]): Promise<string> {
		const baseRef = stringValue(sourceEdits[0]?.before_head);
		const finalRef = [...sourceEdits]
			.reverse()
			.map((edit) => stringValue(edit.after_head))
			.find(Boolean);
		if (!baseRef || !finalRef) return "";
		if (baseRef === finalRef) return "";
		if (!(await this.git.refExists(baseRef)) || !(await this.git.refExists(finalRef))) return "";
		return this.git.getDiffBetweenRefs(baseRef, finalRef);
	}

	private getSourcePatchSequence(sourceEdits: HutaoEvent[]): string {
		let patch = "";
		for (const edit of sourceEdits) {
			const path = patchPath(this.repoRoot, edit);
			if (!path) continue;
			try {
				patch += readFileSync(path, "utf-8");
				if (!patch.endsWith("\n")) patch += "\n";
			} catch {}
		}
		return patch;
	}

	private writeMergeEvent(
		targetSession: string,
		sourceSession: string,
		mode: "apply_edits" | "apply_tree",
		status: "completed" | "conflict",
		data: {
			importedEdits: unknown[];
			appliedEdits: string[];
			skippedEdits: string[];
			conflictEdits: string[];
			resolutionEdits: string[];
			beforeTree?: string;
			afterTree?: string;
		},
	): void {
		new EventStore(this.repoRoot, targetSession).append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "merge",
			id: createHutaoId("m"),
			session_id: targetSession,
			source_session: sourceSession,
			target_session: targetSession,
			mode,
			status,
			imported_edits: data.importedEdits,
			applied_edits: data.appliedEdits,
			conflict_edits: data.conflictEdits,
			skipped_edits: data.skippedEdits,
			resolution_edits: data.resolutionEdits,
			target_before_tree: data.beforeTree,
			target_after_tree: data.afterTree,
			created_at: new Date().toISOString(),
		});
		rebuildIndex(this.repoRoot);
	}
}
