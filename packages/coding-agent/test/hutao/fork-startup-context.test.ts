import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import { applyForkStartupContext } from "../../src/hutao/fork-startup-context.ts";

function fakeContext(editorText = ""): ExtensionCommandContext {
	let text = editorText;
	return {
		ui: {
			getEditorText: () => text,
			setEditorText: (value: string) => {
				text = value;
			},
		},
		sendMessage: vi.fn(async () => undefined),
		sendUserMessage: vi.fn(async () => undefined),
	} as unknown as ExtensionCommandContext;
}

describe("applyForkStartupContext", () => {
	it("writes context attachment before sending follow-up user message", async () => {
		const ctx = fakeContext();
		const attachment = {
			customType: "hutao_ephemeral_inquiry_context_attachment",
			content: "untrusted historical evidence",
			display: true,
			details: { trusted: false },
		};

		const result = await applyForkStartupContext(ctx, {
			contextAttachment: attachment,
			followUpMessage: "continue with implementation",
			retryText: "retry original",
		});

		expect(result).toEqual({
			wroteContextAttachment: true,
			sentFollowUpMessage: true,
			prefilledRetryText: false,
		});
		expect(ctx.sendMessage).toHaveBeenCalledWith(attachment);
		expect(ctx.sendUserMessage).toHaveBeenCalledWith("continue with implementation");
		expect(ctx.ui.getEditorText()).toBe("");
		const sendMessageOrder = vi.mocked(ctx.sendMessage).mock.invocationCallOrder[0];
		const sendUserOrder = vi.mocked(ctx.sendUserMessage).mock.invocationCallOrder[0];
		expect(sendMessageOrder).toBeLessThan(sendUserOrder);
	});

	it("prefills retry text only when no follow-up exists and editor is empty", async () => {
		const ctx = fakeContext();

		const result = await applyForkStartupContext(ctx, { retryText: "original prompting" });

		expect(result).toEqual({
			wroteContextAttachment: false,
			sentFollowUpMessage: false,
			prefilledRetryText: true,
		});
		expect(ctx.sendMessage).not.toHaveBeenCalled();
		expect(ctx.sendUserMessage).not.toHaveBeenCalled();
		expect(ctx.ui.getEditorText()).toBe("original prompting");
	});

	it("does not overwrite existing editor text with retry text", async () => {
		const ctx = fakeContext("draft already here");

		const result = await applyForkStartupContext(ctx, { retryText: "original prompting" });

		expect(result).toEqual({
			wroteContextAttachment: false,
			sentFollowUpMessage: false,
			prefilledRetryText: false,
		});
		expect(ctx.ui.getEditorText()).toBe("draft already here");
	});
});
