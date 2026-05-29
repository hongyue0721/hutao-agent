import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";

export type HutaoLanguage = "zh-CN" | "en";

export interface HutaoMenuAction<TId extends string = string> {
	id: TId;
	label: string;
}

type TranslationKey = keyof typeof TRANSLATIONS.en;

const TRANSLATIONS = {
	en: {
		"language.select.title": "Select language",
		"language.option.zhCN": "简体中文",
		"language.option.en": "English",
		"language.saved": "Language preference saved.",
		"language.none": "No language selected.",
		"session.select.title": "Select Hutao session",
		"session.action.title": "Hutao session actions",
		"session.action.viewDetails": "View details",
		"session.action.viewPromptings": "View promptings",
		"session.action.viewRuns": "View runs",
		"session.action.viewEdits": "View edits",
		"session.action.mergeWizard": "Merge wizard",
		"session.action.mergePreview": "Merge preview",
		"session.action.importHistory": "Import history",
		"session.action.applyEdits": "Apply edits",
		"session.action.applyFinalSnapshot": "Apply final snapshot",
		"session.noneSelected": "No session selected.",
		"session.noneFound": "No Hutao sessions found.",
		"prompting.select.title": "Select Hutao prompting",
		"prompting.action.title": "Hutao prompting actions",
		"prompting.action.viewDetail": "View detail",
		"prompting.action.viewEdits": "View edits",
		"prompting.action.forkBefore": "Fork before this prompting",
		"prompting.action.retry": "Retry this prompting",
		"prompting.action.forkAfter": "Fork after this prompting",
		"prompting.noneSelected": "No prompting selected.",
		"prompting.noneFound": "No promptings found.",
		"edit.select.title": "Select Hutao edit",
		"edit.action.title": "Hutao edit actions",
		"edit.action.viewPatch": "View patch",
		"edit.action.viewParentPrompting": "View parent prompting",
		"edit.action.continueAfter": "Continue from after this edit",
		"edit.action.tryBefore": "Try another way from before this edit",
		"edit.action.previewRevert": "Preview revert this edit",
		"edit.noneSelected": "No edit selected.",
		"edit.noneFound": "No edits found.",
		"menu.noAction": "No action selected.",
	},
	"zh-CN": {
		"language.select.title": "选择语言",
		"language.option.zhCN": "简体中文",
		"language.option.en": "English",
		"language.saved": "语言偏好已保存。",
		"language.none": "未选择语言。",
		"session.select.title": "选择 Hutao 会话",
		"session.action.title": "Hutao 会话操作",
		"session.action.viewDetails": "查看详情",
		"session.action.viewPromptings": "查看提示",
		"session.action.viewRuns": "查看运行记录",
		"session.action.viewEdits": "查看修改",
		"session.action.mergeWizard": "合并向导",
		"session.action.mergePreview": "预览合并",
		"session.action.importHistory": "导入历史",
		"session.action.applyEdits": "应用修改",
		"session.action.applyFinalSnapshot": "应用最终快照",
		"session.noneSelected": "未选择会话。",
		"session.noneFound": "没有找到 Hutao 会话。",
		"prompting.select.title": "选择 Hutao 提示",
		"prompting.action.title": "Hutao 提示操作",
		"prompting.action.viewDetail": "查看详情",
		"prompting.action.viewEdits": "查看关联修改",
		"prompting.action.forkBefore": "从此提示前创建分支",
		"prompting.action.retry": "重试此提示",
		"prompting.action.forkAfter": "从此提示后创建分支",
		"prompting.noneSelected": "未选择提示。",
		"prompting.noneFound": "没有找到提示。",
		"edit.select.title": "选择 Hutao 修改",
		"edit.action.title": "Hutao 修改操作",
		"edit.action.viewPatch": "查看补丁",
		"edit.action.viewParentPrompting": "查看父提示",
		"edit.action.continueAfter": "从此修改后继续",
		"edit.action.tryBefore": "从此修改前尝试另一种方案",
		"edit.action.previewRevert": "预览撤销此修改",
		"edit.noneSelected": "未选择修改。",
		"edit.noneFound": "没有找到修改。",
		"menu.noAction": "未选择操作。",
	},
} satisfies Record<HutaoLanguage, Record<string, string>>;

function normalizeLanguage(value: string | undefined): HutaoLanguage | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "en" || normalized === "en-us" || normalized === "en_us") return "en";
	if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_cn" || normalized === "zh-hans") return "zh-CN";
	return undefined;
}

function preferencesPath(repoRoot: string): string {
	return join(repoRoot, ".hutao", "cache", "preferences.json");
}

export function getHutaoLanguage(repoRoot: string): HutaoLanguage {
	const envLanguage = normalizeLanguage(process.env.HUTAO_LANG);
	if (envLanguage) return envLanguage;
	const path = preferencesPath(repoRoot);
	if (existsSync(path)) {
		try {
			const data = JSON.parse(readFileSync(path, "utf-8")) as { language?: string };
			const savedLanguage = normalizeLanguage(data.language);
			if (savedLanguage) return savedLanguage;
		} catch {}
	}
	return "zh-CN";
}

export function saveHutaoLanguage(repoRoot: string, language: HutaoLanguage): void {
	const path = preferencesPath(repoRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ language }, null, "\t")}\n`, "utf-8");
}

export function t(repoRoot: string, key: TranslationKey): string {
	const language = getHutaoLanguage(repoRoot);
	return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
}

export async function selectAction<TId extends string>(
	ctx: ExtensionCommandContext,
	repoRoot: string,
	titleKey: TranslationKey,
	actions: Array<{ id: TId; labelKey: TranslationKey }>,
): Promise<TId | undefined> {
	const rendered = actions.map((action) => ({ id: action.id, label: t(repoRoot, action.labelKey) }));
	const choice = await ctx.ui.select(
		t(repoRoot, titleKey),
		rendered.map((action) => action.label),
	);
	return rendered.find((action) => action.label === choice)?.id;
}
