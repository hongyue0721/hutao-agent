import { relative } from "node:path";
import type { HutaoEvent } from "./event-store.ts";
import type { ForkMode, ForkSourceType } from "./fork-session-manager.ts";
import { readAllEvents } from "./read-model.ts";

export type NativeForkPosition = "before" | "at";

export interface ForkTargetRequest {
	sourceType: ForkSourceType;
	sourceIdPrefix: string;
	mode: ForkMode;
}

export interface ForkTargetResolution {
	ok: boolean;
	source?: HutaoEvent;
	targetNativeEntryId?: string;
	nativeForkPosition?: NativeForkPosition;
	degradedReason?: string;
	retryText?: string;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function findSource(events: HutaoEvent[], request: ForkTargetRequest): HutaoEvent | undefined {
	if (request.sourceType === "commit") {
		return undefined;
	}
	return events.find(
		(event) => event.type === request.sourceType && String(event.id).startsWith(request.sourceIdPrefix),
	);
}

function nativeSessionRelPath(repoRoot: string, nativeSessionFile: string | undefined): string | undefined {
	if (!nativeSessionFile) return undefined;
	return relative(repoRoot, nativeSessionFile).replaceAll("\\", "/");
}

function nativeEntryLinkMatchesSource(event: HutaoEvent, source: HutaoEvent, request: ForkTargetRequest): boolean {
	if (event.type !== "native_entry_link") return false;
	if (request.sourceType === "prompting") return event.related_prompting === source.id;
	if (request.sourceType === "edit") return event.related_edit === source.id;
	return false;
}

function findPromptingNativeTarget(
	events: HutaoEvent[],
	source: HutaoEvent,
	mode: ForkMode,
): Pick<ForkTargetResolution, "targetNativeEntryId" | "nativeForkPosition" | "degradedReason"> {
	const links = events.filter((event) =>
		nativeEntryLinkMatchesSource(event, source, { sourceType: "prompting", sourceIdPrefix: String(source.id), mode }),
	);
	const userLink = links.find(
		(event) => event.native_entry_type === "message" && event.native_message_role === "user",
	);
	if ((mode === "before" || mode === "retry") && userLink) {
		return { targetNativeEntryId: stringValue(userLink.native_entry_id), nativeForkPosition: "before" };
	}
	const lastLinkedEntry = [...links].reverse().find((event) => stringValue(event.native_entry_id));
	const anchor = stringValue(source.native_anchor_entry_id);
	const targetNativeEntryId = stringValue(lastLinkedEntry?.native_entry_id) ?? anchor;
	if (targetNativeEntryId) return { targetNativeEntryId, nativeForkPosition: "at" };
	return { degradedReason: `No native entry mapping found for prompting ${source.id}.` };
}

function findPromptingUserLink(events: HutaoEvent[], promptingId: string): HutaoEvent | undefined {
	return events.find(
		(event) =>
			event.type === "native_entry_link" &&
			event.related_prompting === promptingId &&
			event.native_entry_type === "message" &&
			event.native_message_role === "user" &&
			stringValue(event.native_entry_id),
	);
}

function findEditNativeTarget(
	events: HutaoEvent[],
	source: HutaoEvent,
	mode: ForkMode,
): Pick<ForkTargetResolution, "targetNativeEntryId" | "nativeForkPosition" | "degradedReason"> {
	const parentPrompting = stringValue(source.parent_prompting);
	if (mode === "before" && parentPrompting) {
		const promptingUserLink = findPromptingUserLink(events, parentPrompting);
		const promptingUserEntryId = stringValue(promptingUserLink?.native_entry_id);
		if (promptingUserEntryId) return { targetNativeEntryId: promptingUserEntryId, nativeForkPosition: "at" };
	}
	const editLinks = events.filter((event) =>
		nativeEntryLinkMatchesSource(event, source, { sourceType: "edit", sourceIdPrefix: String(source.id), mode }),
	);
	const editLink = [...editLinks].reverse().find((event) => stringValue(event.native_entry_id));
	const parentRun = stringValue(source.parent_run);
	const runLinks = parentRun
		? events.filter((event) => event.type === "native_entry_link" && event.related_run === parentRun)
		: [];
	const runLink = [...runLinks].reverse().find((event) => stringValue(event.native_entry_id));
	const anchor = stringValue(source.native_anchor_entry_id);
	const targetNativeEntryId =
		stringValue(editLink?.native_entry_id) ?? stringValue(runLink?.native_entry_id) ?? anchor;
	if (targetNativeEntryId) return { targetNativeEntryId, nativeForkPosition: "at" };
	return { degradedReason: `No native entry mapping found for edit ${source.id}.` };
}

export class ForkTargetResolver {
	private readonly repoRoot: string;

	constructor(repoRoot: string) {
		this.repoRoot = repoRoot;
	}

	resolve(request: ForkTargetRequest): ForkTargetResolution {
		if (request.sourceType === "commit") {
			return {
				ok: true,
				degradedReason: "Commit forks do not have a native chat entry target yet.",
			};
		}
		const events = readAllEvents(this.repoRoot);
		const source = findSource(events, request);
		if (!source) return { ok: false, degradedReason: `Source not found: ${request.sourceIdPrefix}` };
		const nativeTarget =
			request.sourceType === "prompting"
				? findPromptingNativeTarget(events, source, request.mode)
				: findEditNativeTarget(events, source, request.mode);
		return {
			ok: true,
			source,
			...nativeTarget,
			retryText:
				request.sourceType === "prompting" && request.mode === "retry" ? stringValue(source.text) : undefined,
		};
	}

	toRepoRelativeNativeSessionFile(nativeSessionFile: string | undefined): string | undefined {
		return nativeSessionRelPath(this.repoRoot, nativeSessionFile);
	}
}
