import { createHash } from "node:crypto";
import type { ToolResultEvent } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";
import { EventStore, HUTAO_SCHEMA_VERSION, type HutaoSessionMetadata } from "./event-store.ts";
import { GitAdapter, type WorktreeSnapshot } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { rebuildIndex } from "./index-builder.ts";
import { PatchStore } from "./patch-store.ts";
import { PathMapper } from "./path-mapper.ts";
import { isProtectedRepoPath, sanitizeText } from "./secret-guard.ts";
import { SessionRegistry } from "./session-registry.ts";

interface NativeTraceContext {
	sessionId: string;
	sessionFile?: string;
	leafEntryId?: string | null;
}

type NativeTraceContextProvider = () => NativeTraceContext | undefined;

interface RunState {
	id: string;
	tool: string;
	toolCallId: string;
	inputSummary: string;
	command?: string;
	cwd: string;
	beforeHead?: string;
	beforeTree?: string;
	beforePatchHash: string;
	beforeSnapshot: WorktreeSnapshot;
	startedAt: string;
}

function textFromToolResult(event: ToolResultEvent): string {
	return event.content
		.filter((item) => item.type === "text")
		.map((item) => item.text ?? "")
		.join("\n");
}

function summarizeInput(tool: string, input: unknown): { summary: string; command?: string } {
	if (!input || typeof input !== "object") return { summary: tool };
	const record = input as Record<string, unknown>;
	if (tool === "bash" && typeof record.command === "string") {
		return { summary: record.command.slice(0, 500), command: record.command };
	}
	if (typeof record.path === "string") return { summary: `${tool} ${record.path}` };
	return { summary: JSON.stringify(Object.fromEntries(Object.entries(record).slice(0, 6))).slice(0, 500) };
}

function hashText(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function uniqueStrings(values: unknown[]): string[] {
	return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function getNativeMessageRole(entry: SessionEntry): string | undefined {
	return entry.type === "message" ? String(entry.message.role) : undefined;
}

function getNativeToolCallIds(entry: SessionEntry): string[] {
	if (entry.type !== "message") return [];
	const message = entry.message as { toolCallId?: unknown; content?: unknown };
	const ids: string[] = [];
	if (typeof message.toolCallId === "string") ids.push(message.toolCallId);
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (!block || typeof block !== "object") continue;
			const record = block as { type?: unknown; id?: unknown };
			if (record.type === "toolCall" && typeof record.id === "string") ids.push(record.id);
		}
	}
	return [...new Set(ids)];
}

function getNativeCustomType(entry: SessionEntry): string | undefined {
	if (entry.type !== "custom" && entry.type !== "custom_message") return undefined;
	return entry.customType;
}

export class TraceRecorder {
	private repoRoot: string;
	private sessionId: string;
	private store: EventStore;
	private patches: PatchStore;
	private git: GitAdapter;
	private paths: PathMapper;
	private activePromptingId?: string;
	private runs: Map<string, RunState>;
	private toolCallRunIds: Map<string, string>;
	private nativeContextProvider?: NativeTraceContextProvider;

	constructor(
		repoRoot: string,
		metadata?: HutaoSessionMetadata,
		sessionId?: string,
		nativeContextProvider?: NativeTraceContextProvider,
	) {
		this.repoRoot = repoRoot;
		this.sessionId = metadata?.id ?? sessionId ?? createHutaoId("sess");
		this.store = new EventStore(repoRoot, this.sessionId);
		this.patches = new PatchStore(this.store.getSessionDir());
		this.git = new GitAdapter(repoRoot);
		this.paths = new PathMapper(repoRoot);
		this.runs = new Map();
		this.toolCallRunIds = new Map();
		this.nativeContextProvider = nativeContextProvider;
	}

	setNativeContextProvider(nativeContextProvider?: NativeTraceContextProvider): void {
		this.nativeContextProvider = nativeContextProvider;
	}

	private nativeTraceFields(): Record<string, unknown> {
		const native = this.nativeContextProvider?.();
		if (!native) return {};
		return {
			native_session_id: native.sessionId,
			native_session_file: native.sessionFile ? this.paths.toRepoRelative(native.sessionFile) : undefined,
			native_anchor_entry_id: native.leafEntryId ?? null,
			native_anchor_relation: "current_leaf_at_trace_event",
		};
	}

	async recordNativeEntryLink(entry: SessionEntry): Promise<void> {
		const native = this.nativeContextProvider?.();
		if (!native) return;
		const toolCallIds = getNativeToolCallIds(entry);
		const toolCallId = toolCallIds[0];
		this.store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "native_entry_link",
			id: createHutaoId("nel"),
			session_id: this.sessionId,
			related_prompting: this.activePromptingId,
			related_run: toolCallId ? this.toolCallRunIds.get(toolCallId) : undefined,
			tool_call_id: toolCallId,
			tool_call_ids: toolCallIds,
			native_session_id: native.sessionId,
			native_session_file: native.sessionFile ? this.paths.toRepoRelative(native.sessionFile) : undefined,
			native_entry_id: entry.id,
			native_parent_entry_id: entry.parentId,
			native_entry_type: entry.type,
			native_message_role: getNativeMessageRole(entry),
			native_custom_type: getNativeCustomType(entry),
			created_at: new Date().toISOString(),
		});
	}

	async init(): Promise<void> {
		const metadata = await new SessionRegistry(this.repoRoot).createSessionMetadata(this.sessionId);
		this.store.init(metadata);
	}

	getSessionId(): string {
		return this.sessionId;
	}

	async recordPrompting(text: string, cwd: string): Promise<string> {
		const id = createHutaoId("p");
		const sanitized = sanitizeText(this.paths.redactText(text), 12_000);
		this.activePromptingId = id;
		this.store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "prompting",
			id,
			session_id: this.sessionId,
			...this.nativeTraceFields(),
			actor: "human",
			text: sanitized.text,
			text_truncated: sanitized.truncated,
			original_size: sanitized.originalSize,
			cwd: this.paths.toRepoRelative(cwd) ?? ".",
			git_head: await this.git.getHead(),
			git_tree: await this.git.getTree(),
			git_status_summary: await this.git.getStatusSummary(),
			anchor: null,
			created_at: new Date().toISOString(),
			status: "active",
		});
		this.store.appendRaw({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "user_message",
			prompting_id: id,
			text: sanitized.text,
			truncated: sanitized.truncated,
			created_at: new Date().toISOString(),
		});
		return id;
	}

	async recordToolCall(tool: string, toolCallId: string, input: unknown): Promise<void> {
		const inputSummary = summarizeInput(tool, input);
		const sanitized = sanitizeText(this.paths.redactText(inputSummary.summary), 2000);
		this.store.appendRaw({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "tool_call_summary",
			tool,
			tool_call_id: toolCallId,
			input_summary: sanitized.text,
			truncated: sanitized.truncated,
			created_at: new Date().toISOString(),
		});
	}

	async startRun(tool: string, toolCallId: string, input: unknown, cwd: string): Promise<void> {
		if (!this.activePromptingId) return;
		const id = createHutaoId("r");
		const beforePatch = await this.git.getWorktreeDiff();
		const beforeSnapshot = await this.git.getWorktreeSnapshot();
		const inputSummary = summarizeInput(tool, input);
		const run: RunState = {
			id,
			tool,
			toolCallId,
			inputSummary: sanitizeText(this.paths.redactText(inputSummary.summary), 1000).text,
			command: inputSummary.command
				? sanitizeText(this.paths.redactText(inputSummary.command), 2000).text
				: undefined,
			cwd: this.paths.toRepoRelative(cwd) ?? ".",
			beforeHead: await this.git.getHead(),
			beforeTree: await this.git.getTree(),
			beforePatchHash: hashText(beforePatch),
			beforeSnapshot,
			startedAt: new Date().toISOString(),
		};
		this.runs.set(toolCallId, run);
		this.toolCallRunIds.set(toolCallId, id);
		this.store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "run_started",
			id,
			session_id: this.sessionId,
			parent_prompting: this.activePromptingId,
			...this.nativeTraceFields(),
			actor: "agent",
			tool,
			tool_call_id: toolCallId,
			input_summary: run.inputSummary,
			command: run.command,
			cwd: run.cwd,
			before_head: run.beforeHead,
			before_tree: run.beforeTree,
			before_worktree_diff_hash: run.beforePatchHash,
			started_at: run.startedAt,
			created_at: run.startedAt,
		});
	}

	async finishRun(event: ToolResultEvent, cwd: string): Promise<void> {
		const run = this.runs.get(event.toolCallId);
		if (!run || !this.activePromptingId) return;
		this.runs.delete(event.toolCallId);
		const output = sanitizeText(this.paths.redactText(textFromToolResult(event)), 20_000);
		this.store.appendRaw({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "tool_result_summary",
			tool: event.toolName,
			tool_call_id: event.toolCallId,
			is_error: event.isError,
			output_summary: output.text.split(/\r?\n/).find(Boolean)?.slice(0, 300) ?? "",
			output_tail: output.text,
			truncated: output.truncated,
			created_at: new Date().toISOString(),
		});
		const afterPatch = await this.git.getWorktreeDiff();
		const afterSnapshot = await this.git.getWorktreeSnapshot();
		const deltaFiles = this.git.getChangedFilesBetweenSnapshots(run.beforeSnapshot, afterSnapshot);
		const runPatch = deltaFiles.length > 0 ? await this.git.getWorktreeDiffForFiles(deltaFiles) : "";
		const afterHead = await this.git.getHead();
		const afterTree = await this.git.getTree();
		const producedEditIds: string[] = [];
		if (!event.isError && runPatch.trim()) {
			const editId = await this.recordEdit(run, event, runPatch, afterHead, afterTree);
			if (editId) producedEditIds.push(editId);
		}
		if (!event.isError && run.tool === "bash" && run.beforeHead && afterHead && run.beforeHead !== afterHead) {
			const events = this.store.readEvents();
			const existingLinkedEditIds = new Set(
				events.filter((entry) => entry.type === "commit_link").flatMap((entry) => stringArray(entry.edit_ids)),
			);
			const unlinkedEdits = events.filter(
				(entry) =>
					entry.type === "edit" &&
					entry.session_id === this.sessionId &&
					!existingLinkedEditIds.has(String(entry.id)),
			);
			const editIds = uniqueStrings([...unlinkedEdits.map((entry) => entry.id), ...producedEditIds]);
			const runIds = uniqueStrings([...unlinkedEdits.map((entry) => entry.parent_run), run.id]);
			const promptingIds = uniqueStrings([
				...unlinkedEdits.map((entry) => entry.parent_prompting),
				this.activePromptingId,
			]);
			this.store.append({
				schema_version: HUTAO_SCHEMA_VERSION,
				type: "commit_link",
				id: createHutaoId("cl"),
				session_id: this.sessionId,
				commit: afterHead,
				tree: afterTree,
				prompting_ids: promptingIds,
				run_ids: runIds,
				edit_ids: editIds,
				link_method: "observed_git_commit",
				created_at: new Date().toISOString(),
			});
		}
		this.store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "run_finished",
			id: run.id,
			session_id: this.sessionId,
			parent_prompting: this.activePromptingId,
			...this.nativeTraceFields(),
			actor: "agent",
			tool: run.tool,
			tool_call_id: run.toolCallId,
			status: event.isError ? "failed" : "completed",
			output_summary: output.text.split(/\r?\n/).find(Boolean)?.slice(0, 300) ?? "",
			output_tail: output.text,
			output_truncated: output.truncated,
			output_hash: hashText(textFromToolResult(event)),
			after_head: afterHead,
			after_tree: afterTree,
			after_worktree_diff_hash: hashText(afterPatch),
			produced_edit_ids: producedEditIds,
			cwd: this.paths.toRepoRelative(cwd) ?? ".",
			started_at: run.startedAt,
			ended_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		});
		rebuildIndex(this.repoRoot);
	}

	private async recordEdit(
		run: RunState,
		event: ToolResultEvent,
		fallbackPatch: string,
		afterHead: string | undefined,
		afterTree: string | undefined,
	): Promise<string | undefined> {
		let patch = fallbackPatch;
		if (event.toolName === "edit" && event.details && typeof event.details === "object") {
			const details = event.details as { patch?: unknown };
			if (typeof details.patch === "string" && details.patch.trim()) patch = details.patch;
		}
		const sanitizedPatch = sanitizeText(this.paths.redactText(patch), 2_000_000).text;
		const files = this.git.getChangedFiles(sanitizedPatch).filter((file) => !isProtectedRepoPath(file));
		if (files.length === 0) return undefined;
		const id = createHutaoId("e");
		if (this.git.isBinaryPatch(sanitizedPatch)) {
			this.store.append({
				schema_version: HUTAO_SCHEMA_VERSION,
				type: "edit",
				id,
				session_id: this.sessionId,
				parent_prompting: this.activePromptingId,
				parent_run: run.id,
				...this.nativeTraceFields(),
				actor: "agent",
				tool: event.toolName,
				files,
				binary: true,
				file_hashes_after: await this.git.getFileHashes(files),
				patch: null,
				patch_hash: this.git.computePatchHash(sanitizedPatch),
				before_head: run.beforeHead,
				after_head: afterHead,
				before_tree: run.beforeTree,
				after_tree: afterTree,
				created_at: new Date().toISOString(),
				status: "active",
				summary: `${event.toolName} changed binary files ${files.join(", ")}`,
			});
			return id;
		}
		const stored = this.patches.writePatch(id, sanitizedPatch);
		this.store.append({
			schema_version: HUTAO_SCHEMA_VERSION,
			type: "edit",
			id,
			session_id: this.sessionId,
			parent_prompting: this.activePromptingId,
			parent_run: run.id,
			...this.nativeTraceFields(),
			actor: "agent",
			tool: event.toolName,
			files,
			patch: stored.relativePath,
			patch_hash: stored.hash,
			before_head: run.beforeHead,
			after_head: afterHead,
			before_tree: run.beforeTree,
			after_tree: afterTree,
			created_at: new Date().toISOString(),
			status: "active",
			summary: `${event.toolName} changed ${files.join(", ")}`,
		});
		return id;
	}
}
