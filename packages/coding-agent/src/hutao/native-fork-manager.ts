import type { ExtensionCommandContext, ReplacedSessionContext } from "../core/extensions/types.ts";
import type { NativeForkPosition } from "./fork-target-resolver.ts";

export interface NativeForkRequest {
	sessionId: string;
	targetEntryId?: string;
	position?: NativeForkPosition;
	degradedReason?: string;
	onForked?: (ctx: ReplacedSessionContext) => Promise<void>;
}

export interface NativeForkResult {
	status: "created" | "degraded" | "cancelled";
	sessionId: string;
	targetEntryId?: string;
	position?: NativeForkPosition;
	sessionFile?: string;
	degradedReason?: string;
}

export class NativeForkManager {
	private readonly ctx: ExtensionCommandContext;

	constructor(ctx: ExtensionCommandContext) {
		this.ctx = ctx;
	}

	async forkNativeSession(request: NativeForkRequest): Promise<NativeForkResult> {
		if (!request.targetEntryId || !request.position) {
			return {
				status: "degraded",
				sessionId: request.sessionId,
				degradedReason: request.degradedReason ?? "Native entry target is unavailable.",
			};
		}
		const result = await this.ctx.fork(request.targetEntryId, {
			position: request.position,
			sessionId: request.sessionId,
			withSession: request.onForked,
		});
		if (result.cancelled) {
			return {
				status: "cancelled",
				sessionId: request.sessionId,
				targetEntryId: request.targetEntryId,
				position: request.position,
			};
		}
		return {
			status: "created",
			sessionId: request.sessionId,
			targetEntryId: request.targetEntryId,
			position: request.position,
			sessionFile: result.sessionFile,
		};
	}
}
