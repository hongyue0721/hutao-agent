import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { SessionEntry } from "../../core/session-manager.ts";

export interface EphemeralInquiryTranscript {
	question: string;
	answer: string;
	assistantEntryId?: string;
}

export interface InquiryTranscriptCaptureOptions {
	ctx: ExtensionCommandContext;
	question: string;
	send: () => void | Promise<void>;
	/** Maximum time to wait once the agent turn is observed. */
	timeoutMs?: number;
	/** Short grace window for fire-and-forget sendMessage to leave idle state or append an answer. */
	turnStartGraceMs?: number;
}

interface AssistantCapture {
	entryId: string;
	text: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TURN_START_GRACE_MS = 250;
const POLL_MS = 10;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function entryTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const record = part as Record<string, unknown>;
			if (record.type === "text") return typeof record.text === "string" ? record.text : "";
			if (record.type === "tool_call") return `[tool_call ${String(record.name ?? record.id ?? "unknown")}]`;
			if (record.type === "tool_result") return `[tool_result ${String(record.toolCallId ?? "unknown")}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function assistantCaptureFromEntry(entry: SessionEntry): AssistantCapture | undefined {
	if (entry.type !== "message" || entry.message.role !== "assistant") return undefined;
	const text = entryTextContent(entry.message.content).trim();
	return text ? { entryId: entry.id, text } : undefined;
}

function safeSessionEntries(ctx: ExtensionCommandContext): SessionEntry[] {
	try {
		return ctx.sessionManager?.getEntries?.() ?? [];
	} catch {
		return [];
	}
}

function safeSubscribeToEntries(ctx: ExtensionCommandContext, listener: (entry: SessionEntry) => void): () => void {
	try {
		return ctx.sessionManager?.onAppendEntry?.(listener) ?? (() => undefined);
	} catch {
		return () => undefined;
	}
}

function newestAssistantCapture(entries: SessionEntry[], beforeEntryIds: Set<string>): AssistantCapture | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (beforeEntryIds.has(entry.id)) continue;
		const capture = assistantCaptureFromEntry(entry);
		if (capture) return capture;
	}
	return undefined;
}

function safeBool(call: (() => boolean) | undefined, fallback: boolean): boolean {
	try {
		return call?.() ?? fallback;
	} catch {
		return fallback;
	}
}

async function waitForTurnStartOrAssistant(
	ctx: ExtensionCommandContext,
	getAssistant: () => AssistantCapture | undefined,
	turnStartGraceMs: number,
): Promise<boolean> {
	const deadline = Date.now() + Math.max(0, turnStartGraceMs);
	while (Date.now() <= deadline) {
		if (getAssistant()) return true;
		if (!safeBool(() => ctx.isIdle(), true)) return true;
		if (safeBool(() => ctx.hasPendingMessages(), false)) return true;
		await sleep(POLL_MS);
	}
	return Boolean(getAssistant());
}

async function safeWaitForIdle(ctx: ExtensionCommandContext, timeoutMs: number): Promise<void> {
	if (typeof ctx.waitForIdle !== "function") return;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			ctx.waitForIdle(),
			new Promise<void>((resolve) => {
				timeout = setTimeout(resolve, Math.max(0, timeoutMs));
			}),
		]);
	} catch {
		// Degraded runtimes or mocks may throw. Transcript capture must not change
		// canonical trace behavior; it can safely fall back to entry scanning.
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

/**
 * Capture the assistant answer produced by one ephemeral inquiry turn.
 *
 * This intentionally listens to native session entries in addition to waiting
 * for idle, because ExtensionCommandContext.sendMessage() is fire-and-forget in
 * the normal command context. A short grace window prevents the flow from
 * showing post-answer actions before the agent has left idle state.
 */
export async function captureInquiryTranscript(
	options: InquiryTranscriptCaptureOptions,
): Promise<EphemeralInquiryTranscript | undefined> {
	const { ctx, question, send } = options;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const turnStartGraceMs = options.turnStartGraceMs ?? DEFAULT_TURN_START_GRACE_MS;
	const beforeEntryIds = new Set(safeSessionEntries(ctx).map((entry) => entry.id));
	let appendedAssistant: AssistantCapture | undefined;
	const unsubscribe = safeSubscribeToEntries(ctx, (entry) => {
		if (beforeEntryIds.has(entry.id)) return;
		const capture = assistantCaptureFromEntry(entry);
		if (capture) appendedAssistant = capture;
	});
	try {
		await send();
		const turnObserved = await waitForTurnStartOrAssistant(ctx, () => appendedAssistant, turnStartGraceMs);
		if (turnObserved && !appendedAssistant) await safeWaitForIdle(ctx, timeoutMs);
		const capture = appendedAssistant ?? newestAssistantCapture(safeSessionEntries(ctx), beforeEntryIds);
		return capture ? { question, answer: capture.text, assistantEntryId: capture.entryId } : undefined;
	} finally {
		unsubscribe();
	}
}

export const __test__ = {
	assistantCaptureFromEntry,
	entryTextContent,
	newestAssistantCapture,
};
