import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import { t } from "../i18n.ts";
import type { HutaoProcessAction } from "./types.ts";

export function processActionLabel(repoRoot: string, action: HutaoProcessAction): string {
	const label = t(repoRoot, action.labelKey);
	if (action.state === "disabled") {
		const reason = action.reasonKey ? t(repoRoot, action.reasonKey) : t(repoRoot, "process.action.disabled.generic");
		return `${label} — ${reason}`;
	}
	if (action.state === "future") {
		const reason = action.reasonKey ? t(repoRoot, action.reasonKey) : t(repoRoot, "process.action.disabled.future");
		return `${label} — ${reason}`;
	}
	return label;
}

export async function selectProcessAction(
	ctx: ExtensionCommandContext,
	repoRoot: string,
	title: string,
	actions: HutaoProcessAction[],
): Promise<HutaoProcessAction | undefined> {
	const rendered = actions.map((action) => ({ action, label: processActionLabel(repoRoot, action) }));
	const choice = await ctx.ui.select(
		title,
		rendered.map((entry) => entry.label),
	);
	return rendered.find((entry) => entry.label === choice)?.action;
}

export function isProcessActionUnavailable(action: HutaoProcessAction): boolean {
	return action.state === "disabled" || action.state === "future";
}
