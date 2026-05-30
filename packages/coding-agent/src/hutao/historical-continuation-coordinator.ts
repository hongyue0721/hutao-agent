import type { ExtensionCommandContext, InputEvent, ReplacedSessionContext } from "../core/extensions/types.ts";
import {
	type ArmedContinuationStore,
	type ArmedHistoricalContinuation,
	type ContinuationSourceType,
	defaultArmedContinuationStore,
	describeArmedHistoricalContinuation,
} from "./continuation-store.ts";
import { HutaoForkCoordinator, type HutaoForkResult } from "./fork-coordinator.ts";
import type { ForkMode } from "./fork-session-manager.ts";

export interface ArmHistoricalContinuationRequest {
	repoRoot: string;
	sourceType: ContinuationSourceType;
	sourceId: string;
	mode: ForkMode;
	title?: string;
}

export type ContinuationInputDecision =
	| { action: "continue"; reason?: string }
	| { action: "handled"; result: HutaoForkResult }
	| { action: "blocked"; reason: string; result?: HutaoForkResult };

export class HistoricalContinuationCoordinator {
	private readonly store: ArmedContinuationStore;

	constructor(store: ArmedContinuationStore = defaultArmedContinuationStore) {
		this.store = store;
	}

	arm(request: ArmHistoricalContinuationRequest): ArmedHistoricalContinuation {
		return this.store.arm(request);
	}

	peek(repoRoot: string): ArmedHistoricalContinuation | undefined {
		return this.store.peek(repoRoot);
	}

	clear(repoRoot: string): void {
		this.store.clear(repoRoot);
	}

	async handleInput(
		repoRoot: string,
		event: InputEvent,
		ctx: ExtensionCommandContext,
	): Promise<ContinuationInputDecision> {
		if (event.source !== "interactive") return { action: "continue", reason: "input source is not interactive" };
		if (event.streamingBehavior) return { action: "continue", reason: "streaming queued input is not auto-forked" };
		if (event.text.trim().startsWith("/")) return { action: "continue", reason: "slash command does not auto-fork" };
		const armed = this.store.consume(repoRoot);
		if (!armed) return { action: "continue", reason: "no armed historical context" };

		let resent = false;
		const result = await new HutaoForkCoordinator(repoRoot, ctx).fork({
			sourceType: armed.sourceType,
			sourceIdPrefix: armed.sourceId,
			mode: armed.mode,
			onCompleted: async (freshCtx: ReplacedSessionContext, completed) => {
				freshCtx.ui.notify(
					`Hutao continuation\nCreated forkSession ${completed.sessionId}\nnative branch: ${completed.nativeStatus ?? "unknown"}\nYour message will be sent in the forkSession.`,
					completed.nativeStatus === "created" ? "info" : "warning",
				);
				await freshCtx.sendUserMessage(
					event.images ? [{ type: "text", text: event.text }, ...event.images] : event.text,
				);
				resent = true;
			},
		});

		if (!result.ok) {
			return {
				action: "blocked",
				reason: result.reason ?? `Could not auto-fork from ${describeArmedHistoricalContinuation(armed)}.`,
				result,
			};
		}
		if (resent) return { action: "handled", result };
		return {
			action: "blocked",
			reason:
				result.nativeStatus === "degraded"
					? "Auto-fork degraded because native session target is unavailable; refusing to record the input in the old native session. Use an explicit /fork action or retry after native mapping is available."
					: "Auto-fork completed without a fresh native context; refusing to record the input in the old session.",
			result,
		};
	}
}

export const defaultHistoricalContinuationCoordinator = new HistoricalContinuationCoordinator();
