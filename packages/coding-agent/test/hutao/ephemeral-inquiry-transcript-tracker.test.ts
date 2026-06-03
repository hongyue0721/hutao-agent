import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import type { SessionAppendListener, SessionEntry } from "../../src/core/session-manager.ts";
import { captureInquiryTranscript } from "../../src/hutao/ephemeral-inquiry/transcript-tracker.ts";

function assistantEntry(id: string, text: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
		},
	} as SessionEntry;
}

function userEntry(id: string, text: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: text, timestamp: Date.now() },
	} as SessionEntry;
}

function fakeContext(
	entries: SessionEntry[] = [],
): ExtensionCommandContext & { append(entry: SessionEntry): void; setIdle(idle: boolean): void } {
	let idle = true;
	const listeners = new Set<SessionAppendListener>();
	return {
		cwd: "/repo",
		isIdle: () => idle,
		hasPendingMessages: () => false,
		waitForIdle: vi.fn(async () => {
			while (!idle) await new Promise((resolve) => setTimeout(resolve, 1));
		}),
		sessionManager: {
			getEntries: () => entries,
			onAppendEntry: (listener: SessionAppendListener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		append(entry: SessionEntry): void {
			entries.push(entry);
			for (const listener of [...listeners]) listener(entry);
		},
		setIdle(next: boolean): void {
			idle = next;
		},
	} as unknown as ExtensionCommandContext & { append(entry: SessionEntry): void; setIdle(idle: boolean): void };
}

describe("captureInquiryTranscript", () => {
	it("captures an assistant answer appended after fire-and-forget send", async () => {
		const ctx = fakeContext([userEntry("u_before", "before")]);
		const send = vi.fn(() => {
			ctx.setIdle(false);
			setTimeout(() => {
				ctx.append(assistantEntry("a_after", "The answer arrived asynchronously."));
				ctx.setIdle(true);
			}, 5);
		});

		const transcript = await captureInquiryTranscript({
			ctx,
			question: "why?",
			send,
			turnStartGraceMs: 20,
			timeoutMs: 200,
		});

		expect(send).toHaveBeenCalledTimes(1);
		expect(ctx.waitForIdle).toHaveBeenCalledTimes(1);
		expect(transcript).toMatchObject({
			question: "why?",
			answer: "The answer arrived asynchronously.",
			assistantEntryId: "a_after",
		});
	});

	it("ignores assistant messages that existed before the inquiry", async () => {
		const ctx = fakeContext([assistantEntry("a_before", "old answer")]);

		const transcript = await captureInquiryTranscript({
			ctx,
			question: "new question?",
			send: () => undefined,
			turnStartGraceMs: 1,
			timeoutMs: 5,
		});

		expect(transcript).toBeUndefined();
	});

	it("safely degrades when session manager support is unavailable", async () => {
		const ctx = {
			isIdle: () => true,
			hasPendingMessages: () => false,
			waitForIdle: vi.fn(async () => undefined),
		} as unknown as ExtensionCommandContext;

		const transcript = await captureInquiryTranscript({
			ctx,
			question: "why?",
			send: () => undefined,
			turnStartGraceMs: 1,
			timeoutMs: 5,
		});

		expect(transcript).toBeUndefined();
		expect(ctx.waitForIdle).not.toHaveBeenCalled();
	});
});
