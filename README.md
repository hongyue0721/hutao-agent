# hutao-agent / 胡桃 Agent

中文 | [English](README.en.md)

## 致谢与用途声明


## 2026.08.16更新

**摆了哦，dsh太完美了**

`hutao-agent` 基于 [earendil-works/pi](https://github.com/earendil-works/pi) 改造而来。感谢 Pi 提供 coding agent CLI、TUI、tool runtime、extension system、session tree、统一 LLM provider 抽象等基础能力。

也特别感谢 [zyf2007](https://github.com/zyf2007)（胡桃酱）提供的天才思路与产品方向启发，让 Hutao 从普通 coding agent 改造进一步走向 repo-local、Git-native、可追溯的 AI 开发上下文系统。

Hutao 不是要替代 Pi 的 runtime，也不是要替代 Git。它是在 Pi agent harness 上增加一层 **repo-local、Git-native、可追溯的 AI coding trace / resume 系统**：把一次 AI 辅助开发中最关键的项目级事实保存到当前仓库内。

Hutao 关注的是：

```text
人当时说了什么 → agent 做了什么 → 文件实际怎么变了 → 这些变化和 Git / fork / merge / revert 有什么关系
```

---

## 目录

- [项目一句话](#项目一句话)
- [为什么需要 Hutao](#为什么需要-hutao)
- [核心设计逻辑](#核心设计逻辑)
- [整体架构](#整体架构)
- [数据模型](#数据模型)
- [`.hutao/` 数据目录](#hutao-数据目录)
- [功能实现详解](#功能实现详解)
- [通用扩展接口](#通用扩展接口)
- [Slash Commands 指令详解](#slash-commands-指令详解)
- [安全与路径策略](#安全与路径策略)
- [安装与构建](#安装与构建)
- [对外表述](#对外表述)
- [License and upstream](#license-and-upstream)

---

## 项目一句话

`hutao-agent` 是一个与 Git 仓库绑定的 AI coding agent。它不仅能辅助读代码、执行命令、修改文件，还会把项目级 AI 开发过程记录到当前仓库内的 `.hutao/`，让仓库同时携带：

```text
代码
Git commit 历史
AI 与人类协作产生代码的过程上下文
```

目标体验：

```bash
git clone <repo>
cd <repo>
hutao
```

Hutao 可以读取仓库内的 `.hutao/sessions/`，展示历史 sessions、promptings、runs、edits、forkSessions、merge events、commit links，并把这些历史和 Git 状态关联起来。

更短地说：

> Hutao 让仓库不只保存代码，也保存这个项目被人和 AI 一步步做出来的上下文。

---

## 为什么需要 Hutao

普通 Git 仓库保存代码和 commit message，但很难回答这些问题：

```text
当时用户是怎么描述问题的？
agent 为什么读这个文件？
agent 跑了哪些命令？
哪个 run 产生了这个 patch？
这个 edit 有没有进入 commit？
这个 commit 对应哪些 promptings？
从某个历史节点之后有没有试过另一种方案？
一次 merge 是导入历史、重放 edits，还是应用最终快照？
一次 revert 撤销的是哪个历史 edit？
```

普通聊天记录也不够，因为聊天通常是仓库外部状态：换机器、clone 仓库、review commit 时，项目上下文和代码历史容易分离。

Hutao 的做法是把项目级 AI 开发事实放回当前 Git 仓库：

```text
.hutao/
```

这样，一个项目被 clone、fork、review、merge 时，不只携带代码，也携带可追溯的 AI 开发过程。

---

## 核心设计逻辑

Hutao 的核心链路是：

```text
Human Prompting
    ↓
Agent Run
    ↓
File Edit
    ↓
Patch / Tree / Git State
    ↓
Commit Link
    ↓
Fork / Merge / Revert
```

核心三元组：

```text
Prompting = 人说了什么
Run       = agent 做了什么
Edit      = 文件实际变了什么
```

这三个概念保持清晰边界：

```text
人类输入不是 commit。
工具调用不一定是 edit。
只有文件或工作区实际发生变化，才生成 edit。
```

Git commit 与 Hutao trace 使用引用关系关联，而非硬嵌套：

```text
Prompting → Run → Edit
Commit ↔ Prompting
Commit ↔ Run
Commit ↔ Edit
```

这样可以处理真实开发中的情况：

```text
一个 commit 包含多个 promptings。
一个 prompting 产生多个 edits。
一个 edit 尚未进入 commit。
一个 commit 同时包含 human edit 和 agent edit。
rebase / squash / amend 后仍可通过 patch_hash / file / tree / timestamp 等信息重建关系。
```

---

## 整体架构

### 架构总览

Hutao 在 Pi agent harness 上以 **built-in extension** 的形式运行，不剥离 Pi runtime，而是在它之上叠加 repo-local trace 和 native resume 层：

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        hutao CLI (`hutao`)                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     Pi Agent Runtime                         │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │   │
│  │  │  TUI/CLI   │ │ LLM Provider│ │ Tool System │ │ Session  │ │   │
│  │  │  Interface │ │  Abstraction│ │ (read/edit  │ │  Tree    │ │   │
│  │  │            │ │             │ │  bash/write)│ │  / Fork  │ │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Hutao Trace Extension                        │   │
│  │                                                               │   │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │   │
│  │  │  TraceRecorder  │  │  NativeSession   │  │  Extension  │ │   │
│  │  │  (prompting /   │  │    Mirror        │  │  Event Bus  │ │   │
│  │  │   run / edit    │  │  (repo-local     │  │  Hooks      │ │   │
│  │  │   commit link)  │  │   resume files)  │  │             │ │   │
│  │  └─────────────────┘  └──────────────────┘  └─────────────┘ │   │
│  │                                                               │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌────────┐│   │
│  │  │ PathMapper  │ │ GitAdapter   │ │ SecretGuard│ │ IDs    ││   │
│  │  │ (repo-root  │ │ (repo-root   │ │ (.env /    │ │(ULID)  ││   │
│  │  │  discovery, │ │  discovery,  │ │  tokens /  │ │        ││   │
│  │  │  POSIX norm)│ │  diff, patch)│ │  keys)     │ │        ││   │
│  │  └─────────────┘ └──────────────┘ └────────────┘ └────────┘│   │
│  │                                                               │   │
│  │  ┌───────────────────┐  ┌──────────────────────────────────┐│   │
│  │  │  EventStore       │  │  PatchStore                     ││   │
│  │  │  (JSONL append)   │  │  (patch write / hash / apply)   ││   │
│  │  └───────────────────┘  └──────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Hutao Command Layer                          │   │
│  │                                                               │   │
│  │  /session /prompting /run /edit /git /fork /merge /doctor    │   │
│  │  /language /action /subagent /hutao                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Process Tree + Actions                       │   │
│  │                                                               │   │
│  │  ProcessTreeBuilder/Render/Collapsible/SummaryRules           │   │
│  │  ProcessActionRegistry (per-kind action definitions)          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Fork / Merge / Revert Coordinators           │   │
│  │                                                               │   │
│  │  ForkCoordinator + NativeForkManager + ForkTargetResolver     │   │
│  │  MergeManager (preview / history / apply-edits / apply-tree)  │   │
│  │  RevertManager (reverse patch + new edit event)               │   │
│  │  GitBranchPolicy (ask / always / never)                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Ephemeral Inquiry Flow                       │   │
│  │                                                               │   │
│  │  InquiryFlow (state machine / menus / promotion)              │   │
│  │  ReadOnlyGuard (blocks tool calls during inquiry)             │   │
│  │  TranscriptTracker (captures assistant answer for full_qa)    │   │
│  │  ForkStartupContext (writes attachment / follow-up / retry)   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Native Resume Layer                          │   │
│  │                                                               │   │
│  │  ConversationStore (loads timeline + trace links)             │   │
│  │  ConversationHydrator (builds untrusted custom context)       │   │
│  │  HistoricalContinuationCoordinator (auto-fork armed context)  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘

                            ┌──────────────────┐
                            │  .hutao/          │
                            │  (repo-local      │
                            │   trace store)    │
                            │                   │
                            │  manifest.json    │
                            │  sessions/        │
                            │  refs/            │
                            │  index/           │
                            │  cache/           │
                            │  tmp/             │
                            └──────────────────┘
```

### 事件流转线状图

Hutao 的核心事件从用户输入到 trace 写盘的完整流转：

```text
用户输入 (TUI/CLI)
  │
  ├─── Pi Event: input ──────────────────────────────────────┐
  │                                                           │
  │  HistoricalContinuationCoordinator                        │
  │    ├── armed? → auto-fork + route to forkSession          │
  │    ├── not armed → continue normal                        │
  │    └── degraded → block input, restore editor text        │
  │                                                           │
  ├─── Pi Event: before_agent_start ─────────────────────────┐
  │                                                           │
  │  TraceRecorder.recordPrompting()                          │
  │    ├── sanitize text (redact secrets, repo-relative paths)│
  │    ├── append prompting event to events.jsonl             │
  │    ├── append user_message to raw.jsonl                   │
  │    └── record git_head / git_tree / git_status_summary    │
  │                                                           │
  ├─── Pi Event: tool_execution_start ───────────────────────┐
  │                                                           │
  │  TraceRecorder.startRun()                                 │
  │    ├── capture before_head / before_tree / before_snapshot│
  │    ├── record tool / toolCallId / input_summary / cwd     │
  │    └── dangerous bash? → confirm or block                 │
  │                                                           │
  │  Read-only Inquiry Guard                                  │
  │    ├── inquiry active? → block tool call                  │
  │    └── no inquiry → allow                                 │
  │                                                           │
  ├─── Pi Event: tool_call ──────────────────────────────────┐
  │                                                           │
  │  TraceRecorder.recordToolCall()                           │
  │  Protected path check                                     │
  │    ├── .env / .ssh / node_modules → block                 │
  │    └── safe path → allow                                  │
  │                                                           │
  │  Bash trace staging                                       │
  │    ├── git commit command → auto-stage .hutao trace       │
  │    └── otherwise → skip staging                           │
  │                                                           │
  ├─── Pi Event: tool_result ────────────────────────────────┐
  │                                                           │
  │  TraceRecorder.finishRun()                                │
  │    ├── capture after_head / after_tree / after_snapshot   │
  │    ├── compute diff between before and after snapshots    │
  │    ├── diff exists? → generate edit event + write patch  │
  │    ├── no diff? → no edit                                 │
  │    ├── record output_summary / output_tail / output_hash │
  │    └── append native_entry_link for assistant/tool entries│
  │                                                           │
  ├─── SessionManager.onAppendEntry ──────────────────────────┐
  │                                                           │
  │  NativeSessionMirror                                      │
  │    ├── global native session? → mirror into repo-local    │
  │    │   .hutao/sessions/<id>/native-session.jsonl          │
  │    │   (sanitize: redact secrets, repo-relative paths,    │
  │    │    external paths, masked tokens)                    │
  │    ├── already repo-local? → use directly                 │
  │    └── mirror failure? → best-effort, don't block runtime │
  │                                                           │
  │  TraceRecorder.recordNativeEntryLink()                    │
  │    ├── link native entry → Hutao prompting/run/edit       │
  │    └── best-effort, don't block on failure                │
  │                                                           │
  └─── Pi Event: agent_end ──────────────────────────────────┐
                                                              │
      Read-only Inquiry Guard: clear lock                     │
      TraceRecorder: session write completed                  │
```

### fork 流转线状图

```text
用户选择 fork action
  │
  ├─── commands.ts: runCoordinatedFork() ────────────────────┐
  │                                                           │
  │  HutaoForkCoordinator.fork()                              │
  │    ├── GitAdapter.getStatusSummary() != clean? → reject  │
  │    ├── ForkTargetResolver.resolve()                       │
  │    │   ├── find source event in .hutao events             │
  │    │   ├── find native user entry via native_entry_link   │
  │    │   ├── determine fork position (before/at)            │
  │    │   └── extract retryText from original prompting      │
  │    │                                                      │
  │    ├── NativeForkManager.forkNativeSession()              │
  │    │   ├── has target entry? → ctx.fork(entryId, opts)    │
  │    │   │   └── creates native chat branch under fs_<id>   │
  │    │   │   └── onForked callback provides fresh context   │
  │    │   ├── no target entry? → degraded (no native branch) │
  │    │   └── cancelled? → return cancelled                  │
  │    │                                                      │
  │    ├── ForkSessionManager.createFork()                    │
  │    │   ├── restore history state (reverse/apply edits)    │
  │    │   ├── create .hutao/sessions/fs_<id>/                │
  │    │   ├── write session.json (kind=forkSession)          │
  │    │   ├── write fork_session event in events.jsonl       │
  │    │   └── rebuildIndex()                                 │
  │    │                                                      │
  │    ├── GitBranchPolicy.apply()                            │
  │    │   ├── ask → confirm with user                        │
  │    │   ├── always → create & switch branch                │
  │    │   └── never → skip                                   │
  │    │                                                      │
  │    └── applyForkStartupContext()                           │
  │        ├── has contextAttachment?                         │
  │        │   └─ sendMessage(attachment) → custom context    │
  │        │      (full_qa: untrusted historical evidence)    │
  │        ├── has followUpMessage?                           │
  │        │   └─ sendUserMessage(follow-up) → normal prompt  │
  │        ├── no follow-up but retryText + empty editor?     │
  │        │   └─ setEditorText(retryText)                    │
  │        └── else: continue normally                        │
  │                                                           │
  └─── Result: HutaoForkResult ──────────────────────────────┐
      ├── ok / sessionId / nativeStatus                       │
      ├── nativeSessionFile / degradedReason                  │
      └── retryText                                           │
```

### merge 流转线状图

```text
用户选择 merge action
  │
  ├─── commands.ts: mergeCommand() ───────────────────────────┐
  │                                                           │
  │  select source session                                    │
  │  confirmMergeOperation()                                  │
  │    ├── preview → no confirmation needed                   │
  │    ├── history_only → confirm                             │
  │    ├── apply_edits → confirm + dirty check                │
  │    └── apply_tree → confirm + dirty check                 │
  │                                                           │
  │  MergeManager.mergeSession()                              │
  │    ├── source not found? → reject                         │
  │    ├── preview → show source info, no code changes        │
  │    ├── history_only → write merge event, no code changes  │
  │    ├── dirty working tree? → reject for apply modes      │
  │    │                                                      │
  │    ├── apply_edits:                                       │
  │    │   ├── read source ordered edits                      │
  │    │   ├── for each edit:                                 │
  │    │   │   ├── git apply --check → ok? apply              │
  │    │   │   └── conflict? → stop or let user skip/resolve │
  │    │   └── capture resolution diff as new edit            │
  │    │   └── write merge event                              │
  │    │                                                      │
  │    └── apply_tree:                                        │
  │        ├── compute source base_tree → result_tree diff    │
  │        ├── apply final diff on target tree                │
  │        ├── conflict? → resolution flow                    │
  │        └── write merge event                              │
  │                                                           │
  │  appendNativeMergeTraceEntry()                            │
  │    └── write hutao_merge custom entry in native session   │
  │                                                           │
  └─── Result: MergeResult ──────────────────────────────────┐
      ├── ok / mode / message                                 │
      ├── appliedEdits / skippedEdits / conflictEdits         │
      ├── resolutionEdits / changedFiles                      │
      └── mergeIds                                            │
```

### 只读询问流转线状图

```text
用户选择 "只读询问" action on prompting/edit
  │
  ├─── EphemeralInquiryFlow.run() ────────────────────────────┐
  │                                                           │
  │  Initial Action Menu                                      │
  │    ├── Ask read-only question                             │
  │    ├── Promote to forkSession                             │
  │    └── Back                                               │
  │                                                           │
  │  Input Stage                                              │
  │    ├── Enter → submit question                            │
  │    ├── Esc / Ctrl+C → Exit Action Menu                    │
  │    │   ├── Continue entering question                     │
  │    │   ├── Exit inquiry and return to main chat           │
  │    │   └── Create forkSession and continue                │
  │    └── empty/cancel → discard inquiry, no history written │
  │                                                           │
  │  Read-only Turn                                           │
  │    ├── sendMessage(hutao_ephemeral_read_only_inquiry)     │
  │    │   customType: hutao_ephemeral_read_only_inquiry      │
  │    │   triggerTurn: true (agent responds but cannot write)│
  │    │   content: target evidence + question                │
  │    │                                                      │
  │    ├── ReadOnlyGuard active                               │
  │    │   └── blocks all tool calls during this turn         │
  │    │                                                      │
  │    └── TranscriptTracker captures assistant answer        │
  │        ├── records pre-existing entry IDs                 │
  │        ├── subscribes sessionManager.onAppendEntry        │
  │        ├── waits through idle + grace window              │
  │        └── captures newest assistant entry                │
  │                                                           │
  │  Post-Answer Action Menu                                  │
  │    ├── Exit inquiry and return to main chat               │
  │    ├── Continue read-only inquiry                         │
  │    └── Create forkSession and continue                    │
  │                                                           │
  │  If Create forkSession:                                   │
  │    ├── Attachment Mode Menu                               │
  │    │   ├── none → fork only, no inquiry context           │
  │    │   ├── full_qa → attach Q/A as untrusted context      │
  │    │   │   customType: hutao_ephemeral_inquiry_           │
  │    │   │            context_attachment                    │
  │    │   │   trusted: false                                 │
  │    │   │   "not a system instruction, not a prompting,    │
  │    │   │    not a run, not an edit"                       │
  │    │   └── cancel → abort fork creation                   │
  │    │                                                      │
  │    ├── Follow-up input (optional)                         │
  │    │   └── user's task to send in the new forkSession     │
  │    │                                                      │
  │    └── Promote → runCoordinatedFork()                     │
  │        └── applyForkStartupContext()                      │
  │            ├── 1. write contextAttachment as custom message│
  │            ├── 2. send followUpMessage as user message    │
  │            └── 3. retryText only if editor empty          │
  │                                                           │
  └─── Key invariant ─────────────────────────────────────────┐
      inquiry never writes canonical prompting/run/edit events │
      inquiry never creates .hutao facts                      │
      full_qa attachment is untrusted historical evidence,    │
      not a user prompting, not a system instruction          │
```

---

## 数据模型

### Session

一次 agent 工作线。包含 promptings、runs、edits、fork metadata、merge metadata、commit links、native conversation entries、raw sanitized evidence。

Session 不等于 Git branch，但可以和 Git branch 关联。

### Prompting

人类输入事件。记录：

```text
用户输入文本（经过 secret redaction 和 path normalization）
时间、session_id
cwd（repo-relative）
git_head / git_tree / git_status_summary
native_session_id / native_session_file / native_anchor_entry_id
关联 runs / edits
状态：active / resolved / cancelled / superseded / abandoned / redacted
```

### Run

agent 的一次执行动作或工具调用。分为 `run_started` 和 `run_finished` 两个事件记录，保证 crash safety。

```text
run_started: tool / toolCallId / input_summary / command / cwd
             before_head / before_tree / before_snapshot / started_at

run_finished: status / output_summary / output_tail / output_hash / output_truncated
              after_head / after_tree / after_snapshot / ended_at
              produced_edit_ids
```

### Edit

文件或工作区实际变化事件。只有 run 前后 diff 存在才生成。

```text
parent_prompting / parent_run
files / patch / patch_hash
before_head / after_head / before_tree / after_tree
status: active / reverted / partially_reverted / superseded / conflict / merged / skipped
native entry link（related_edit / related_edits）
```

### native_entry_link

连接原生聊天 entry 与 Hutao facts 的桥梁事件：

```text
native_session_id / native_session_file
native_entry_id / native_parent_entry_id / native_entry_type / native_message_role
related_prompting / related_run / related_edit / related_edits
related_merge / related_merges
related_revert_event / related_revert_events
tool_call_id / tool_call_ids
native_custom_type
```

### fork_session

forkSession 创建事件：

```text
parent_session / fork_from_type / fork_from_id / fork_mode
base_git_head / base_tree
native_fork: { status, target_entry_id, position, forked_session_id, forked_session_file }
created_by / reason
```

### merge

session 合并事件：

```text
source_session / target_session / mode / status
imported_edits / applied_edits / skipped_edits / conflict_edits / resolution_edits
target_before_tree / target_after_tree
```

### commit_link

Git commit 与 Hutao facts 的引用关联：

```text
commit / tree
prompting_ids / run_ids / edit_ids
link_method: explicit_command | observed_git_commit | patch_match | manual
```

---

## `.hutao/` 数据目录

```text
.hutao/
├── manifest.json              ← schema_version / agent_name / path_policy / security
├── sessions/
│   ├── sess_<id>/
│   │   ├── session.json       ← session metadata (kind, status, git heads, fork_from)
│   │   ├── events.jsonl       ← append-only canonical trace events
│   │   ├── raw.jsonl          ← sanitized evidence layer (user_message, tool_call_summary)
│   │   ├── native-session.jsonl ← repo-local native conversation entries
│   │   └── patches/
│   │       ├── e_<id>.patch   ← unified diff for each edit
│   │       └── e_<id>.patch.meta.json
│   └── fs_<id>/
│       ├── session.json       ← kind=forkSession, parent_session, fork_from
│       ├── events.jsonl
│       ├── raw.jsonl
│       ├── native-session.jsonl
│       └── patches/
├── refs/
│   ├── current-session        ← current active session id
│   └── sessions.json          ← ordered session metadata list
├── index/                     ← rebuildable read models
│   ├── promptings.json
│   ├── edits.json
│   ├── commits.json
│   ├── files.json
│   └── sessions.json
├── cache/
└── tmp/
```

事实来源层：

```text
.hutao/sessions/*/session.json         ← session/forkSession metadata
.hutao/sessions/*/events.jsonl         ← canonical trace facts (append-only)
.hutao/sessions/*/patches/             ← edit patches + hashes
.hutao/sessions/*/native-session.jsonl ← native conversation state for resume
```

`index/` 和 `cache/` 是可重建的派生数据。不要把 `index/` 当唯一事实来源。

---

## 功能实现详解

### 1. Trace 自动记录

Extension 在 Pi 事件 bus 上监听以下事件，自动写入 `.hutao/` trace：

```text
session_start      → 初始化 TraceRecorder，通知已有 sessions
input              → HistoricalContinuationCoordinator 检查是否需要 auto-fork
before_agent_start → TraceRecorder.recordPrompting()
tool_execution_start → TraceRecorder.startRun() + before git state
tool_call          → recordToolCall() + protected path check + dangerous bash confirm
tool_result        → TraceRecorder.finishRun() + diff detection → edit generation
```

每次 agent turn 结束后，native session entries 会被实时镜像到 repo-local `.hutao/sessions/<id>/native-session.jsonl`，并建立 `native_entry_link` 映射。

### 2. Edit 自动检测

`TraceRecorder.finishRun()` 在 tool 执行后自动做：

```text
1. 比较 before_snapshot 和 after_snapshot
2. 如果文件状态发生变化 → 生成 edit event
3. 将 diff 写入 patches/e_<id>.patch
4. 计算 patch_hash (sha256)
5. 建立 native_entry_link 关联 native entry → edit
```

binary file 只记录 path 和 hash，不保存完整内容。

bash 造成的文件变化（如 `npm run format`）也作为一个 edit 检测。

### 3. Repo-local Native Session Mirroring

如果 Pi runtime 使用全局 session 文件（如 `~/.pi/agent/sessions/`），Hutao 会实时将其镜像到 repo-local：

```text
.hutao/sessions/<trace-session>/native-session.jsonl
```

镜像时做以下 sanitization：

```text
repo-local absolute paths → ${REPO}/relative/path
external absolute paths   → [external-path-redacted]
secrets (sk-xxx, ghp_xxx, private keys) → [secret-redacted]
masked tokens (gho_************************************) → [secret-redacted]
```

如果 runtime 已经是 repo-local session，直接使用不镜像。

镜像失败时 best-effort 处理，不阻塞 Pi runtime 的正常 session 写入。

### 4. Repo-local Resume

```text
/session → 选择 session → resume
```

resume 时：

```text
1. 检查 .hutao/sessions/<id>/native-session.jsonl 是否存在
2. 存在 → ctx.switchSession(nativeSessionPath) → 加载完整聊天树
3. 用户可以看到原始 user/assistant/tool/edit entries
4. 用户可以继续输入，新数据写回 .hutao/
5. 缺失 native-session.jsonl → 创建 degraded continuation forkSession
```

clone 到另一台机器后，只要 `.hutao/` 被提交，resume 仍然可用。

### 5. Process Tree + Action Registry

`/prompting` 和 `/session` 等命令使用 **可折叠 process tree** 展示历史节点：

```text
Session sess_xxx (promptings=2 edits=1 commits=1)
├─ Prompting p_xxx: 修复登录超时 (runs=3 edits=1 commits=1)
│  ├─ Run r_xxx: read auth.ts
│  ├─ Run r_xxx: bash npm test
│  └─ Edit e_xxx: auth.ts (patch_hash=sha256:abc...)
```

折叠规则：

```text
session 默认展开
prompting / run / edit / merge / fork / revert / conflict 默认折叠
第一次 Enter → 展开
第二次 Enter → 进入 action menu / detail
```

每个节点有 **process action menu**，通过 `HutaoProcessActionRegistry` 定义可用动作：

```text
session:  View details / View conversation / Resume / Hydration preview / Merge wizard / ...
prompting: View original / View runs / View edits / Read-only inquiry / Fork before/after / Retry
edit:     View patch / View relations / Read-only inquiry / Fork before/after / Preview revert
run:      View details / View parent prompting / View produced edits
commit:   View promptings / View runs / View edits
merge:    View details / View source/target session / View applied/conflict/resolution edits
fork:     View details / View fork source / View parent session / Resume fork
revert:   View details / View original edit / View revert edit
conflict: View details / View merge / View conflict/resolution edits
```

### 6. 只读询问 (Ephemeral Inquiry)

只读询问是一个完整的状态机流程，不是简单的菜单回调：

```text
初始菜单 → 输入阶段 → 退出确认 → 只读 turn → 回答后菜单 → promote → attachment 选择
```

关键规则：

```text
1. 只读询问本身不是 prompting、不是 run、不是 edit。
2. 只读询问不写入 .hutao canonical facts。
3. 工具调用被 ReadOnlyGuard 阻止。
4. Esc/Ctrl+C 打开明确退出菜单，不会静默丢弃。
5. promote 时必须显式创建 forkSession。
6. full_qa attachment 是 untrusted historical evidence，不是 system instruction。
```

Attachment 写入顺序（由 `applyForkStartupContext` 控制）：

```text
1. contextAttachment (custom message) → 写入 fork native context
2. followUpMessage (user message)     → 正常 user prompting
3. retryText                          → 仅在 editor 空时预填
```

### 7. Historical Continuation (Auto-fork)

当用户查看 `/prompting <id>` 或 `/edit <id>` 时，Hutao 会 **arm** 一个 continuation：

```text
armed: 下一次正常聊天输入会被自动路由到 forkSession
```

`HistoricalContinuationCoordinator` 拦截 `input` 事件：

```text
1. 有 armed context → auto-fork + 路由输入到 forkSession
2. 成功 → 返回 { action: "handled" }
3. degraded → block 输入，恢复 editor text
4. 无 armed context → continue normal
```

### 8. Merge

三种用户可见模式：

```text
Import History     只导入历史，不改代码
Apply Edits        按 edit patch 顺序重放，保留 edit 级可追溯性
Apply Final Snapshot 直接应用最终结果，生成一个大 merge edit
```

类比：

```text
apply-edits: 按菜谱步骤重新做一遍
apply-tree:  直接把成品菜端过来
```

冲突处理：

```text
/merge session <id> --resolve    手动解决后捕获 resolution edit
/merge session <id> --skip       跳过最后一个冲突 edit
/merge session <id> --abort      取消 merge
```

### 9. Revert

revert 是新的历史事实，不删除旧 edit：

```text
Edit e1: 原始修改 src/auth.ts
Edit e2: revert e1 (reverse patch)
```

流程：

```text
1. 预览 reverse patch + dirty check + 后续 edit 影响
2. 用户确认
3. git apply -R patch
4. 写入 edit_reverted 事件
5. 记录 reverted_edit_id / revert_edit_id / related_edits
```

---

## 通用扩展接口

### Process Action Registry

`HutaoProcessActionRegistry` 是可扩展的动作定义系统。每个 node kind 可以注册自己的 action list：

```typescript
interface HutaoProcessActionRegistration {
  kind: HutaoProcessTreeNodeKind;
  titleKey: TranslationKey;
  getActions(node: HutaoProcessTreeNode, context: HutaoProcessActionRegistryContext): HutaoProcessAction[];
}
```

action 状态：

```text
enabled   → 可直接执行
preview   → 可选择，但必须先 preview/confirm
disabled  → 显示但不可执行，附带 reasonKey 说明
future    → 未来计划的占位
```

要新增 node kind 的 action，只需注册新的 `HutaoProcessActionRegistration`，不需要修改 `commands.ts`。

### Process Tree Expansion Policy

折叠/展开行为由 `HutaoProcessTreeExpansionPolicy` 控制：

```typescript
interface HutaoProcessTreeExpansionPolicy {
  defaultExpandedKinds?: ReadonlySet<HutaoProcessTreeNodeKind>;
  collapsibleKinds?: ReadonlySet<HutaoProcessTreeNodeKind>;
}
```

默认配置：

```text
默认展开: session
默认折叠: prompting / run / edit / merge / fork / revert / conflict
```

### Process Tree Summary Rules

节点标签上的衍生计数由 `HutaoProcessTreeSummaryRule` 控制：

```typescript
interface HutaoProcessTreeSummaryRule {
  kind: HutaoProcessTreeNodeKind;
  countKinds?: readonly HutaoProcessTreeNodeKind[];
  scope?: "children" | "descendants";
}
```

默认规则：

```text
prompting → (subagents=, runs=, edits=, commits=, merges=, forks=, reverts=, conflicts=)
subagent  → (runs=, edits=, commits=)
run       → (edits=, commits=)
merge     → (edits=, commits=, conflicts=, reverts=, forks=)
fork      → (sessions=, promptings=, edits=, commits=)
revert    → (edits=, commits=)
conflict  → (edits=, merges=, commits=)
```

### Conversation Hydration Policy

`/session <id> --hydrate` 的注入内容由 `ConversationHydrationPolicy` 控制：

```typescript
interface ConversationHydrationPolicy {
  maxEntries?: number;           // 最多注入的 native entries 数量
  maxEntryChars?: number;        // 每个 entry 最大字符数
  includeAssistantMessages?: boolean;
  includeToolResults?: boolean;
  includeCustomEntries?: boolean;
  includeTraceLinks?: boolean;
  includeEditLinks?: boolean;
  allowDegradedPreview?: boolean;
}
```

所有 hydration 内容都标记为 **untrusted project data**，不会获得 system/developer instruction 优先级。

### Git Branch Policy

```text
ask      → 询问用户是否创建 Git branch
always   → 自动创建并切换到 branch
never    → 不创建 Git branch
```

通过 `--git-branch` 参数传递给 `/fork`。

### Ephemeral Inquiry Attachment Modes

当前支持：

```text
none    → 只创建 forkSession，不附带只读询问上下文
full_qa → 附带完整问答作为 untrusted context attachment
```

未来计划扩展（不承诺实现时间）：

```text
summary            → 附带摘要
selected_messages  → 附带选定的消息
reviewed_attachment → 附带经过用户审核的上下文
```

### i18n

菜单语言通过 `/language` 命令切换，当前支持：

```text
zh-CN (简体中文)
en    (English)
```

语言偏好保存在 `.hutao/` 内，跟随仓库。

---

## Slash Commands 指令详解

### /hutao / /action

打开 Hutao 主菜单：

```text
Sessions / Promptings / Edits / Runs / Git / Fork / Merge / Doctor / Language
```

### /session

```text
/session                       列出 sessions，进入 action menu
/session <id>                  查看 session 详情 + promptings/runs/edits/commits
/session <id> --conversation   查看 native conversation timeline
/session <id> --hydrate-preview 预览 conversation hydration 内容
/session <id> --hydrate        排队注入 conversation context 到下一轮
```

Session action menu 支持：View details / View conversation / Preview hydration / Queue hydration / Resume / View promptings/runs/edits / Merge wizard / Merge preview / Import history / Apply edits / Apply final snapshot。

### /prompting

```text
/prompting                     展示可折叠 prompting tree
/prompting <id>                查看 prompting 详情 + related runs/edits/commits
/prompting --session <id>      按 session 过滤
/prompting --commit <hash>     挍关联 commit 过滤
/prompting --file <path>       挍关联 edit 文件过滤
/prompting search <query>      搜索 prompting 文本
```

Prompting action menu 支持：View original / View runs / View edits / View commits / Read-only inquiry / Fork before / Retry / Fork after。

查看 `/prompting <id>` 时会自动 arm continuation：下一次正常输入会被 auto-fork 路由到该 prompting 之后。

### /run

```text
/run                           列出 runs
/run <id>                      查看 run 详情（tool/input/output/git state）
/run --session <id>            按 session 过滤
```

Run action menu 支持：View details / View parent prompting / View produced edits / View related commits。

### /edit

```text
/edit                          列出 edits
/edit <id>                     查看 edit 详情（patch/files/relations/git state）
/edit revert <id>              预览并执行 revert
/edit --session <id>           按 session 过滤
/edit --prompting <id>         按 prompting 过滤
/edit --commit <hash>          按 commit 过滤
/edit --file <path>            按文件过滤
/edit --reverted               只看已 revert 的 edits
/edit --conflicts              只看冲突 edits
```

Edit action menu 支持：View patch / View changed files / View parent prompting/run / View relations / Read-only inquiry / Fork before/after / Preview revert。

查看 `/edit <id>` 时也会自动 arm continuation。

### /git

```text
/git                           打开 Git action 菜单（status / graph / scan / stage-trace / commit detail）
/git <commit>                  查看 commit 详情 + Hutao trace 关联
/git graph                     查看 recent git log + trace overlay
/git graph --file <path>       按文件过滤
/git graph --range <range>     指定 log range
/git scan                      扫描近期 commits 建立 commit_links
/git stage-trace               stage .hutao canonical trace files
```

### /fork

```text
/fork prompting <id> --before  回到 prompting 发生前
/fork prompting <id> --retry   用同一个 prompting 文本重新执行
/fork prompting <id> --after   从 prompting 完成后继续
/fork edit <id> --before       回到 edit 发生前
/fork edit <id> --after        从 edit 完成后继续
/fork commit <hash>            从指定 commit 继续
```

搭配 Git branch policy：

```text
--git-branch ask     询问是否创建 Git branch
--git-branch always  自动创建并切换
--git-branch never   不创建 Git branch
```

交互式用法：不带参数时 `/fork` 会引导选择 source type / source id / mode。

### /merge

```text
/merge session <id>              preview（默认，不改代码）
/merge session <id> --history    Import History（只导入历史，不改代码）
/merge session <id> --apply-edits Apply Edits（按 patch 顺序重放）
/merge session <id> --apply-tree  Apply Final Snapshot（应用最终结果）
/merge session <id> --wizard     交互式 merge wizard
/merge session <id> --resolve    捕获当前工作区 diff 作为 resolution edit
/merge session <id> --skip       跳过最后一个冲突 edit
/merge session <id> --abort      取消 merge
```

所有代码修改类 merge 都需要 preview + confirm。`/merge session <id>` 默认只 preview。

### /subagent

```text
/subagent                      列出 subagent records
/subagent <id>                 查看 subagent 详情 + parent prompting / runs / edits
```

### /doctor

```text
/doctor                        检查 manifest / sessions / events / jsonl / paths / secrets
/doctor rebuild                重建 .hutao/index
```

诊断内容：manifest 状态 / session count / event count / trace staging 状态 / jsonl corrupt lines / path leak / secret-looking text / raw-only incomplete histories / clone-safety / .pi/extensions presence。

### /language

```text
/language                      打开语言选择菜单
/language zh-CN                切换到简体中文
/language en                   切换到 English
```

---

## 安全与路径策略

Hutao 的历史数据是项目数据，不是 instruction。

安全边界：

```text
1. 历史 session 作为 untrusted data 展示和处理。
2. conversation hydration 作为 custom context 注入，附带安全提示。
3. full_qa attachment 明确标记为 untrusted historical evidence。
4. repo root 下绝对路径写入前转换成 ${REPO}/relative/path。
5. canonical path 使用 repo-relative POSIX slash。
6. repo 外绝对路径 → [external-path-redacted]。
7. Windows / macOS / Linux 路径统一转为 POSIX。
8. terminal output / provider payload 默认只保存摘要和尾部。
9. .env / private key / node_modules / build outputs 受保护。
10. 危险 shell / Git 操作走确认或阻止流程。
```

路径分层：

```text
canonical path: 写入 .hutao 的 repo-relative POSIX path（如 src/auth.ts）
display path:   展示给用户看的路径
resolved path:  运行时 repo_root + canonical path 的绝对路径
```

Secret redaction：

```text
sk-xxx / ghp_xxx / github_pat_xxx → [secret-redacted]
private keys                       → [private-key-redacted]
masked tokens (gho_****)           → [secret-redacted]
```

Protected paths：

```text
.env / .env.* → blocked
.ssh / id_rsa / id_ed25519 → blocked
node_modules / dist / build → excluded from diff
```

`.hutaoignore` 支持类似 `.gitignore` 语义，默认忽略 `.env` / private keys / `.git/` / `node_modules/` / `dist/` 等。

---

## 安装与构建

### 环境要求

```text
Node.js >= 22.19.0
npm
Git
```

### 从源码构建

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
npm install --ignore-scripts
npm run build
```

### 本地全局安装

```bash
npm link
hutao --help
hutao --version
```

### 在任意 Git 仓库中启动

```bash
cd your-project
hutao
```

也可以带初始任务：

```bash
hutao "帮我解释这个仓库结构"
hutao "帮我修复登录超时后没有返回 401 的问题"
```

---

## 对外表述

推荐表述：

```text
恢复项目级 AI 开发上下文。
追溯 human input → agent run → file edit → git state。
让代码改动可解释、可 fork、可 merge、可撤销。
clone 仓库后不仅得到代码，也得到 AI 开发过程。
```

不推荐表述：

```text
完整恢复 AI 思考
100% 复现 agent 行为
替代 Git
```

---

## License and upstream

This project is based on [earendil-works/pi](https://github.com/earendil-works/pi). Please respect upstream license and attribution requirements.

`hutao-agent` keeps Pi's runtime foundations and adds Hutao-specific repo-local trace, resume, fork, merge, revert, process-tree, and native conversation mapping capabilities.
