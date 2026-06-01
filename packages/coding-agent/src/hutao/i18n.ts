import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "../core/extensions/types.ts";

export type HutaoLanguage = "zh-CN" | "en";

export interface HutaoMenuAction<TId extends string = string> {
	id: TId;
	label: string;
}

export type TranslationKey = keyof typeof TRANSLATIONS.en;

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
		"session.action.viewConversation": "View conversation",
		"session.action.previewHydration": "Preview context hydration",
		"session.action.queueHydration": "Queue hydration for next turn",
		"session.action.resume": "Resume this session",
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
		"prompting.action.viewOriginal": "View original input",
		"prompting.action.resumeAfter": "Resume after this prompting",
		"prompting.action.viewRuns": "View related runs",
		"prompting.action.viewEdits": "View related edits",
		"prompting.action.viewCommits": "View related commits",
		"prompting.action.readOnlyInquiry": "Ask about this prompting in read-only mode",
		"prompting.action.forkBefore": "Fork before this prompting",
		"prompting.action.retry": "Retry this prompting",
		"prompting.action.forkAfter": "Fork after this prompting",
		"prompting.noneSelected": "No prompting selected.",
		"prompting.noneFound": "No promptings found.",
		"edit.select.title": "Select Hutao edit",
		"edit.action.title": "Hutao edit actions",
		"edit.action.viewPatch": "View patch",
		"edit.action.viewChangedFiles": "View changed files",
		"edit.action.viewParentPrompting": "View parent prompting",
		"edit.action.viewParentRun": "View parent run",
		"edit.action.viewRelations": "View related commit / merge / revert",
		"edit.action.readOnlyInquiry": "Ask about this edit in read-only mode",
		"edit.action.continueAfter": "Continue from after this edit",
		"edit.action.tryBefore": "Try another way from before this edit",
		"edit.action.forkBefore": "Fork before this edit",
		"edit.action.forkAfter": "Fork after this edit",
		"edit.action.previewRevert": "Preview revert this edit",
		"edit.noneSelected": "No edit selected.",
		"edit.noneFound": "No edits found.",
		"inquiry.menu.title": "Hutao read-only inquiry",
		"inquiry.action.ask": "Ask a read-only question",
		"inquiry.action.promoteFork": "Promote to forkSession",
		"inquiry.action.back": "Back without saving",
		"inquiry.input.question": "Question to ask in read-only mode",
		"inquiry.input.promoteQuestion": "Question/task to send after creating the forkSession (leave empty to only create the fork)",
		"inquiry.notice.discarded": "Read-only inquiry discarded. No canonical Hutao history was written.",
		"inquiry.notice.sent": "Read-only inquiry sent. No canonical Hutao history was written.",
		"inquiry.notice.cannotPromote": "This node cannot be promoted to a forkSession yet.",
		"git.menu.title": "Hutao Git actions",
		"git.menu.status": "Show status and links",
		"git.menu.graph": "Show recent graph",
		"git.menu.scan": "Scan recent commits",
		"git.menu.stageTrace": "Stage Hutao trace files",
		"git.menu.commitDetail": "View commit detail",
		"git.input.commit": "Commit hash/ref to inspect",
		"gitBranch.confirm.title": "Hutao Git branch policy",
		"gitBranch.confirm.message": "Create and switch to a Git branch for this forkSession?",
		"gitBranch.notice.created": "Git branch created for forkSession.",
		"gitBranch.notice.skipped": "Git branch creation skipped.",
		"gitBranch.notice.failed": "Git branch creation failed.",
		"fork.menu.source.title": "Select fork source type",
		"fork.menu.source.prompting": "Prompting",
		"fork.menu.source.edit": "Edit",
		"fork.menu.source.commit": "Commit",
		"fork.menu.mode.title": "Select fork mode",
		"fork.menu.mode.before": "Before this point",
		"fork.menu.mode.retry": "Retry this prompting",
		"fork.menu.mode.after": "After this point",
		"fork.input.commit": "Commit hash/ref to fork from",
		"merge.select.source": "Select source session to merge",
		"merge.confirm.apply.title": "Hutao merge confirmation",
		"merge.confirm.applyEdits": "Apply source edits to the current working tree?",
		"merge.confirm.applyTree": "Apply source final snapshot to the current working tree?",
		"merge.confirm.history": "Import source session history without code changes?",
		"main.menu.title": "Hutao menu",
		"main.menu.sessions": "Sessions",
		"main.menu.promptings": "Promptings",
		"main.menu.edits": "Edits",
		"main.menu.runs": "Runs",
		"main.menu.git": "Git",
		"main.menu.fork": "Fork",
		"main.menu.merge": "Merge",
		"main.menu.doctor": "Doctor",
		"main.menu.language": "Language",
		"menu.cancelled": "Cancelled.",
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
		"session.action.viewConversation": "查看完整对话",
		"session.action.previewHydration": "预览上下文注入",
		"session.action.queueHydration": "排队注入到下一轮",
		"session.action.resume": "继续此会话",
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
		"prompting.action.viewOriginal": "查看原始输入",
		"prompting.action.resumeAfter": "从此提示后继续",
		"prompting.action.viewRuns": "查看相关 runs",
		"prompting.action.viewEdits": "查看相关 edits",
		"prompting.action.viewCommits": "查看关联 commits",
		"prompting.action.readOnlyInquiry": "只读询问这个 prompting",
		"prompting.action.forkBefore": "在这个 prompting 之前分叉",
		"prompting.action.retry": "重新执行这个 prompting",
		"prompting.action.forkAfter": "在这个 prompting 之后分叉",
		"prompting.noneSelected": "未选择提示。",
		"prompting.noneFound": "没有找到提示。",
		"edit.select.title": "选择 Hutao 修改",
		"edit.action.title": "Hutao 修改操作",
		"edit.action.viewPatch": "查看 patch",
		"edit.action.viewChangedFiles": "查看变更文件",
		"edit.action.viewParentPrompting": "查看父 prompting",
		"edit.action.viewParentRun": "查看父 run",
		"edit.action.viewRelations": "查看关联 commit / merge / revert",
		"edit.action.readOnlyInquiry": "只读询问这个 edit",
		"edit.action.continueAfter": "从此修改后继续",
		"edit.action.tryBefore": "从此修改前尝试另一种方案",
		"edit.action.forkBefore": "在这个 edit 之前分叉",
		"edit.action.forkAfter": "在这个 edit 之后分叉",
		"edit.action.previewRevert": "预览撤销这个 edit",
		"edit.noneSelected": "未选择修改。",
		"edit.noneFound": "没有找到修改。",
		"inquiry.menu.title": "Hutao 只读询问",
		"inquiry.action.ask": "提出只读问题",
		"inquiry.action.promoteFork": "提升为 forkSession",
		"inquiry.action.back": "返回并不保存",
		"inquiry.input.question": "要以只读模式询问的问题",
		"inquiry.input.promoteQuestion": "创建 forkSession 后要发送的问题/任务（留空则只创建 fork）",
		"inquiry.notice.discarded": "已丢弃只读询问，没有写入 Hutao canonical history。",
		"inquiry.notice.sent": "已发送只读询问，没有写入 Hutao canonical history。",
		"inquiry.notice.cannotPromote": "这个节点暂时不能提升为 forkSession。",
		"git.menu.title": "Hutao Git 操作",
		"git.menu.status": "查看状态与关联",
		"git.menu.graph": "查看最近图谱",
		"git.menu.scan": "扫描最近提交",
		"git.menu.stageTrace": "暂存 Hutao trace 文件",
		"git.menu.commitDetail": "查看提交详情",
		"git.input.commit": "要查看的提交 hash/ref",
		"gitBranch.confirm.title": "Hutao Git 分支策略",
		"gitBranch.confirm.message": "要为这个 forkSession 创建并切换到 Git 分支吗？",
		"gitBranch.notice.created": "已为 forkSession 创建 Git 分支。",
		"gitBranch.notice.skipped": "已跳过 Git 分支创建。",
		"gitBranch.notice.failed": "Git 分支创建失败。",
		"fork.menu.source.title": "选择分支来源类型",
		"fork.menu.source.prompting": "提示",
		"fork.menu.source.edit": "修改",
		"fork.menu.source.commit": "提交",
		"fork.menu.mode.title": "选择分支模式",
		"fork.menu.mode.before": "从此点之前",
		"fork.menu.mode.retry": "重试此提示",
		"fork.menu.mode.after": "从此点之后",
		"fork.input.commit": "要创建分支的提交 hash/ref",
		"merge.select.source": "选择要合并的来源会话",
		"merge.confirm.apply.title": "Hutao 合并确认",
		"merge.confirm.applyEdits": "将来源 edits 应用到当前工作区？",
		"merge.confirm.applyTree": "将来源最终快照应用到当前工作区？",
		"merge.confirm.history": "仅导入来源会话历史，不修改代码？",
		"main.menu.title": "Hutao 菜单",
		"main.menu.sessions": "会话",
		"main.menu.promptings": "提示",
		"main.menu.edits": "修改",
		"main.menu.runs": "运行记录",
		"main.menu.git": "Git",
		"main.menu.fork": "创建分支",
		"main.menu.merge": "合并",
		"main.menu.doctor": "诊断",
		"main.menu.language": "语言",
		"menu.cancelled": "已取消。",
		"menu.noAction": "未选择操作。",
	},
} satisfies Record<HutaoLanguage, Record<string, string>>;

function normalizeLanguage(value: string | undefined): HutaoLanguage | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "en" || normalized === "en-us" || normalized === "en_us") return "en";
	if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh_cn" || normalized === "zh-hans")
		return "zh-CN";
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
