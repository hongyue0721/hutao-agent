import type { ExtensionCommandContext } from "../core/extensions/types.ts";
import type { CustomMessage } from "../core/messages.ts";

export interface ForkStartupContextOptions<TDetails = unknown> {
	contextAttachment?: Pick<CustomMessage<TDetails>, "customType" | "content" | "display" | "details">;
	followUpMessage?: string;
	retryText?: string;
}

export interface ForkStartupContextResult {
	wroteContextAttachment: boolean;
	sentFollowUpMessage: boolean;
	prefilledRetryText: boolean;
}

/**
 * Write startup context into a fresh fork native context without conflating
 * historical evidence with the user's follow-up prompting.
 *
 * Ordering is intentional:
 * 1. custom context attachment first (participates in native context, not a user prompting)
 * 2. explicit follow-up user message second (normal code-capable prompting)
 * 3. retry text only when no follow-up was sent and the editor is empty
 */
export async function applyForkStartupContext(
	ctx: ExtensionCommandContext,
	options: ForkStartupContextOptions = {},
): Promise<ForkStartupContextResult> {
	let wroteContextAttachment = false;
	let sentFollowUpMessage = false;
	let prefilledRetryText = false;
	if (options.contextAttachment) {
		await Promise.resolve(ctx.sendMessage(options.contextAttachment));
		wroteContextAttachment = true;
	}
	if (options.followUpMessage) {
		await Promise.resolve(ctx.sendUserMessage(options.followUpMessage));
		sentFollowUpMessage = true;
	} else if (options.retryText && !ctx.ui.getEditorText().trim()) {
		ctx.ui.setEditorText(options.retryText);
		prefilledRetryText = true;
	}
	return { wroteContextAttachment, sentFollowUpMessage, prefilledRetryText };
}
