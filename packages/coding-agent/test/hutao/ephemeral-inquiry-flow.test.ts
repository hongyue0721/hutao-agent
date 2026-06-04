import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import {
	EphemeralInquiryFlow,
	type EphemeralInquiryPromotionHandlers,
	type EphemeralInquiryRunner,
	HUTAO_EPHEMERAL_INQUIRY_ATTACHMENT_CUSTOM_TYPE,
} from "../../src/hutao/ephemeral-inquiry/flow.ts";

interface FakeContextOptions {
	selections?: string[];
	inputs?: Array<string | undefined>;
	entries?: SessionEntry[];
}

interface FakeContext {
	ctx: ExtensionCommandContext;
	appendEntryMock: ReturnType<typeof vi.fn>;
	sendMessageMock: ReturnType<typeof vi.fn>;
	sendUserMessageMock: ReturnType<typeof vi.fn>;
	waitForIdleMock: ReturnType<typeof vi.fn>;
}

function fakeContext(options: FakeContextOptions): FakeContext {
	const selections = [...(options.selections ?? [])];
	const inputs = [...(options.inputs ?? [])];
	const entries = options.entries ?? [];
	let idle = true;
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
	const waitForIdleMock = vi.fn(async () => {
		idle = true;
	});
	const appendEntryMock = vi.fn();
	const sendUserMessageMock = vi.fn();
	const sendMessageMock = vi.fn(() => {
		idle = false;
	});
	const ctx = {
		cwd: "/repo",
		ui,
		isIdle: () => idle,
		hasPendingMessages: () => false,
		sessionManager: {
			getEntries: () => entries,
		},
		waitForIdle: waitForIdleMock,
		appendEntry: appendEntryMock,
		sendUserMessage: sendUserMessageMock,
		sendMessage: sendMessageMock,
	} as unknown as ExtensionCommandContext;
	return { ctx, appendEntryMock, sendMessageMock, sendUserMessageMock, waitForIdleMock };
}

describe("EphemeralInquiryFlow", () => {
	it("promotes a prompting inquiry with an explicit follow-up message", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const { ctx } = fakeContext({ selections: ["Promote to forkSession"], inputs: ["Continue by adding tests"] });
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
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
		const { ctx } = fakeContext({ selections: ["Promote to forkSession"], inputs: [""] });
		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
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
		const { ctx, sendMessageMock } = fakeContext({
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
		expect(sendMessageMock).not.toHaveBeenCalled();
		expect(forkPrompting).not.toHaveBeenCalled();
		expect(forkEdit).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("canonical history"), "info");
	});

	it("can continue entering a question after cancelling input", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const { ctx, appendEntryMock, sendMessageMock, sendUserMessageMock, waitForIdleMock } = fakeContext({
			selections: ["Ask a read-only question", "Continue entering question", "Exit inquiry and return to main chat"],
			inputs: [undefined, "Why did this change?"],
		});
		const inquiryRunner = vi.fn<EphemeralInquiryRunner>(async () => ({
			answer: "Because the edit preserves trace safety.",
			modelBacked: true,
		}));

		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
			inquiryRunner,
		}).run();

		expect(inquiryRunner).toHaveBeenCalledTimes(1);
		expect(inquiryRunner.mock.calls[0]?.[1]).toContain("Why did this change?");
		expect(sendMessageMock).not.toHaveBeenCalled();
		expect(sendUserMessageMock).not.toHaveBeenCalled();
		expect(appendEntryMock).not.toHaveBeenCalled();
		expect(waitForIdleMock).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("native resume: not written"), "info");
		expect(forkEdit).not.toHaveBeenCalled();
	});

	it("attaches full read-only Q/A as untrusted context when promoting after an answer", async () => {
		const forkPrompting = vi.fn<EphemeralInquiryPromotionHandlers["forkPrompting"]>(async () => undefined);
		const forkEdit = vi.fn<EphemeralInquiryPromotionHandlers["forkEdit"]>(async () => undefined);
		const entries: SessionEntry[] = [];
		const { ctx, appendEntryMock, sendMessageMock, sendUserMessageMock, waitForIdleMock } = fakeContext({
			selections: [
				"Ask a read-only question",
				"Create forkSession and continue",
				"Attach full Q/A as untrusted context",
			],
			inputs: ["Why did this edit happen?", "Now continue safely"],
			entries,
		});
		const inquiryRunner = vi.fn<EphemeralInquiryRunner>(async () => ({
			answer: "It happened to preserve trace safety.",
			modelBacked: true,
		}));

		await new EphemeralInquiryFlow({
			repoRoot: "/repo",
			ctx,
			target: { kind: "edit", id: "e_test" },
			events: [],
			promotion: { forkPrompting, forkEdit },
			inquiryRunner,
		}).run();

		expect(inquiryRunner).toHaveBeenCalledTimes(1);
		expect(sendMessageMock).not.toHaveBeenCalled();
		expect(sendUserMessageMock).not.toHaveBeenCalled();
		expect(appendEntryMock).not.toHaveBeenCalled();
		expect(waitForIdleMock).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("answer source: ephemeral model call"),
			"info",
		);
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
