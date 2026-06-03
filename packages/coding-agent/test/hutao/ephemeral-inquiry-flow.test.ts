import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import {
	EphemeralInquiryFlow,
	type EphemeralInquiryPromotionHandlers,
	HUTAO_EPHEMERAL_INQUIRY_ATTACHMENT_CUSTOM_TYPE,
} from "../../src/hutao/ephemeral-inquiry/flow.ts";

interface FakeContextOptions {
	selections?: string[];
	inputs?: Array<string | undefined>;
	entries?: SessionEntry[];
	onWaitForIdle?: (entries: SessionEntry[]) => void | Promise<void>;
}

function fakeContext(options: FakeContextOptions): ExtensionCommandContext {
	const selections = [...(options.selections ?? [])];
	const inputs = [...(options.inputs ?? [])];
	const entries = options.entries ?? [];
	const ui = {
		select: vi.fn(async (_title: string, selectOptions: string[]) => {
			const requested = selections.shift();
			const aliases: Record<string, string[]> = {
				"Promote to forkSession": ["Promote to forkSession", "提升为 forkSession"],
				"Ask a read-only question": ["Ask a read-only question", "提出只读问题"],
				"Exit inquiry and return to main chat": ["Exit inquiry and return to main chat", "退出只读询问"],
				"Continue entering question": ["Continue entering question", "继续输入问题"],
				"Create forkSession and continue": ["Create forkSession and continue", "创建 forkSession"],
				"Attach full Q/A as untrusted context": ["Attach full Q/A as untrusted context", "带入完整问答"],
				"Do not attach": ["Do not attach", "不带入"],
			};
			const candidates = requested ? [requested, ...(aliases[requested] ?? [])] : [];
			return (
				selectOptions.find((option) => candidates.some((candidate) => option.includes(candidate))) ??
				selectOptions[0]
			);
		}),
		input: vi.fn(async () => inputs.shift()),
		notify: vi.fn(),
	};
	return {
		cwd: "/repo",
		ui,
		sessionManager: {
			getEntries: () => entries,
		},
		waitForIdle: vi.fn(async () => {
			await options.onWaitForIdle?.(entries);
		}),
		sendMessage: vi.fn(),
	} as unknown as ExtensionCommandContext;
}

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

describe("EphemeralInquiryFlow", () => {
	it("promotes a prompting inquiry with an explicit follow-up message", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx: fakeContext({ selections: ["Promote to forkSession"], inputs: ["Continue by adding tests"] }),
			target: { kind: "prompting", id: "p_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(forkPrompting).toHaveBeenCalledWith("p_test", "after", {
			followUpMessage: "Continue by adding tests",
			contextAttachment: undefined,
		});
		expect(forkEdit).not.toHaveBeenCalled();
	});

	it("promotes an edit inquiry without sending a follow-up when input is empty", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx: fakeContext({ selections: ["Promote to forkSession"], inputs: [""] }),
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(forkEdit).toHaveBeenCalledWith("e_test", "after", {
			followUpMessage: undefined,
			contextAttachment: undefined,
		});
		expect(forkPrompting).not.toHaveBeenCalled();
	});

	it("opens an explicit exit menu when inquiry input is cancelled", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const ctx = fakeContext({
			selections: ["Ask a read-only question", "Exit inquiry and return to main chat"],
			inputs: [undefined],
		});

		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
			target: { kind: "prompting", id: "p_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(ctx.ui.select).toHaveBeenCalledTimes(2);
		expect(ctx.sendMessage).not.toHaveBeenCalled();
		expect(forkPrompting).not.toHaveBeenCalled();
		expect(forkEdit).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("canonical history"), "info");
	});

	it("can continue entering a question after cancelling input", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const entries: SessionEntry[] = [];
		const ctx = fakeContext({
			selections: ["Ask a read-only question", "Continue entering question", "Exit inquiry and return to main chat"],
			inputs: [undefined, "Why did this change?"],
			entries,
			onWaitForIdle: () => {
				entries.push(assistantEntry("a1", "Because it fixed the bug."));
			},
		});

		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(ctx.sendMessage).toHaveBeenCalledTimes(1);
		expect(ctx.waitForIdle).toHaveBeenCalledTimes(1);
		expect(forkEdit).not.toHaveBeenCalled();
	});

	it("attaches full read-only Q/A as untrusted context when promoting after an answer", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const entries: SessionEntry[] = [];
		const ctx = fakeContext({
			selections: [
				"Ask a read-only question",
				"Create forkSession and continue",
				"Attach full Q/A as untrusted context",
			],
			inputs: ["Why did this edit happen?", "Now continue safely"],
			entries,
			onWaitForIdle: () => {
				entries.push(assistantEntry("a1", "It happened to preserve trace safety."));
			},
		});

		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
		}).run();

		expect(forkEdit).toHaveBeenCalledTimes(1);
		const options = forkEdit.mock.calls[0]?.[2];
		expect(options?.followUpMessage).toBe("Now continue safely");
		expect(options?.contextAttachment?.customType).toBe(HUTAO_EPHEMERAL_INQUIRY_ATTACHMENT_CUSTOM_TYPE);
		expect(options?.contextAttachment?.details).toMatchObject({
			type: "fork_context_attachment",
			source: "ephemeral_inquiry",
			attachment_mode: "full_qa",
			trusted: false,
			anchor: { type: "edit", id: "e_test" },
			question: "Why did this edit happen?",
			answer: "It happened to preserve trace safety.",
		});
		expect(options?.contextAttachment?.content).toContain("not a system instruction");
		expect(forkPrompting).not.toHaveBeenCalled();
	});
});
