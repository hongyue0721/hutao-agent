import { relative } from "node:path";
import type { ExtensionCommandContext, ReplacedSessionContext } from "../core/extensions/types.ts";
import {
	type ForkMode,
	ForkSessionManager,
	type ForkSourceType,
	type NativeForkEventInfo,
} from "./fork-session-manager.ts";
import { type ForkTargetResolution, ForkTargetResolver } from "./fork-target-resolver.ts";
import { GitAdapter } from "./git-adapter.ts";
import { createHutaoId } from "./ids.ts";
import { NativeForkManager, type NativeForkResult } from "./native-fork-manager.ts";

export interface HutaoForkRequest {
	sourceType: ForkSourceType;
	sourceIdPrefix: string;
	mode: ForkMode;
	onCompleted?: (ctx: ReplacedSessionContext, result: HutaoForkResult) => Promise<void>;
}

export interface HutaoForkResult {
	ok: boolean;
	sessionId?: string;
	nativeStatus?: NativeForkResult["status"];
	nativeSessionFile?: string;
	degradedReason?: string;
	retryText?: string;
	reason?: string;
}

function toRepoRelative(repoRoot: string, path: string | undefined): string | undefined {
	if (!path) return undefined;
	return relative(repoRoot, path).replaceAll("\\", "/");
}

function nativeForkEventInfo(
	repoRoot: string,
	sessionId: string,
	resolution: ForkTargetResolution,
	nativeResult: NativeForkResult,
): NativeForkEventInfo {
	return {
		status: nativeResult.status,
		source_session_id: typeof resolution.source?.session_id === "string" ? resolution.source.session_id : undefined,
		source_session_file:
			typeof resolution.source?.native_session_file === "string" ? resolution.source.native_session_file : undefined,
		target_entry_id: nativeResult.targetEntryId ?? resolution.targetNativeEntryId,
		position: nativeResult.position ?? resolution.nativeForkPosition,
		forked_session_id: sessionId,
		forked_session_file: toRepoRelative(repoRoot, nativeResult.sessionFile),
		degraded_reason: nativeResult.degradedReason ?? resolution.degradedReason,
	};
}

export class HutaoForkCoordinator {
	private readonly repoRoot: string;
	private readonly resolver: ForkTargetResolver;
	private readonly nativeForkManager: NativeForkManager;
	private readonly forkSessionManager: ForkSessionManager;

	constructor(repoRoot: string, ctx: ExtensionCommandContext) {
		this.repoRoot = repoRoot;
		this.resolver = new ForkTargetResolver(repoRoot);
		this.nativeForkManager = new NativeForkManager(ctx);
		this.forkSessionManager = new ForkSessionManager(repoRoot);
	}

	async fork(request: HutaoForkRequest): Promise<HutaoForkResult> {
		const sessionId = createHutaoId("fs");
		if ((await new GitAdapter(this.repoRoot).getStatusSummary()) !== "clean") {
			return {
				ok: false,
				sessionId,
				reason: "Working tree is dirty. Commit, stash, or clean before forking from history.",
			};
		}
		const resolution = this.resolver.resolve(request);
		if (!resolution.ok) {
			return { ok: false, sessionId, reason: resolution.degradedReason ?? "Fork target resolution failed." };
		}

		let freshContext: ReplacedSessionContext | undefined;
		const nativeResult = await this.nativeForkManager.forkNativeSession({
			sessionId,
			targetEntryId: resolution.targetNativeEntryId,
			position: resolution.nativeForkPosition,
			degradedReason: resolution.degradedReason,
			onForked: async (ctx) => {
				freshContext = ctx;
			},
		});
		if (nativeResult.status === "cancelled") {
			return { ok: false, sessionId, nativeStatus: "cancelled", reason: "Native fork was cancelled." };
		}

		const forkEvent = nativeForkEventInfo(this.repoRoot, sessionId, resolution, nativeResult);
		const hutaoFork = await this.forkSessionManager.createFork(
			request.sourceType,
			request.sourceIdPrefix,
			request.mode,
			{
				sessionId,
				nativeFork: forkEvent,
			},
		);
		if (!hutaoFork.ok) {
			return {
				ok: false,
				sessionId,
				nativeStatus: nativeResult.status,
				nativeSessionFile: forkEvent.forked_session_file,
				degradedReason: nativeResult.degradedReason ?? resolution.degradedReason,
				reason: hutaoFork.reason,
			};
		}
		const finalResult: HutaoForkResult = {
			ok: true,
			sessionId,
			nativeStatus: nativeResult.status,
			nativeSessionFile: forkEvent.forked_session_file,
			degradedReason: nativeResult.degradedReason ?? resolution.degradedReason,
			retryText: resolution.retryText,
		};
		if (freshContext && request.onCompleted) {
			await request.onCompleted(freshContext, finalResult);
		}
		return finalResult;
	}
}
