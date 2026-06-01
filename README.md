# hutao-agent / 胡桃 Agent

中文 | [English](README.en.md)

## 致谢与用途声明

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
- [当前已实现能力](#当前已实现能力)
- [安装与构建](#安装与构建)
- [基础使用流程](#基础使用流程)
- [核心数据模型](#核心数据模型)
- [`.hutao/` 数据目录](#hutao-数据目录)
- [repo-local native session](#repo-local-native-session)
- [fork / merge / revert 操作逻辑](#fork--merge--revert-操作逻辑)
- [Slash Commands 指令说明](#slash-commands-指令说明)
- [安全与路径策略](#安全与路径策略)
- [内部执行规范](#内部执行规范)
- [最近实现 checkpoint](#最近实现-checkpoint)
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

Git commit 与 Hutao trace 使用引用关系关联：

```text
Prompting -> Run -> Edit
Commit <-> Prompting
Commit <-> Run
Commit <-> Edit
```

这样可以处理真实开发中的情况：

```text
一个 commit 包含多个 promptings。
一个 prompting 产生多个 edits。
一个 edit 尚未进入 commit。
一个 commit 同时包含 human edit 和 agent edit。
rebase / squash / amend 后仍可通过 patch、file、tree、timestamp 等信息重建关系。
```

---

## 项目逻辑树

从仓库整体看，Hutao 把代码、Git 历史和 AI 开发上下文放在同一个 repo 中：

```text
Git Repository
├── Source Code
│   ├── src/
│   ├── tests/
│   ├── configs
│   └── docs
│
├── Git History
│   ├── commits
│   ├── branches
│   ├── merges
│   └── tags
│
└── Hutao Trace
    └── .hutao/
        ├── Sessions
        │   ├── Session sess_<id>
        │   │   ├── Prompting
        │   │   │   └── 人当时想让 agent 做什么
        │   │   │
        │   │   ├── Run
        │   │   │   ├── read / grep / find / ls
        │   │   │   ├── bash / test / build
        │   │   │   └── edit / write / apply patch
        │   │   │
        │   │   ├── Edit
        │   │   │   ├── files
        │   │   │   ├── patch
        │   │   │   ├── patch_hash
        │   │   │   └── before / after git state
        │   │   │
        │   │   ├── Commit Links
        │   │   │   └── commit <-> prompting/run/edit
        │   │   │
        │   │   └── Native Conversation
        │   │       ├── user messages
        │   │       ├── assistant messages
        │   │       ├── tool calls
        │   │       ├── tool results
        │   │       └── native_entry_link -> prompting/run/edit
        │   │
        │   └── ForkSession fs_<id>
        │       ├── fork_from prompting/edit/commit
        │       ├── new promptings
        │       ├── new runs
        │       ├── new edits
        │       └── native chat branch
        │
        ├── Merge Events
        │   ├── history-only
        │   ├── apply-edits
        │   └── apply-tree
        │
        ├── Revert Events
        │   └── revert edit as a new edit
        │
        ├── Patches
        │   └── e_<id>.patch
        │
        └── Index / Cache
            └── rebuildable read models
```

从事件因果看，Hutao 记录的是一条可追溯链：

```text
User Intent
└── Prompting p_<id>
    ├── Run r_<id>
    │   ├── tool call / command
    │   ├── output summary
    │   └── Edit e_<id>
    │       ├── changed files
    │       ├── patch
    │       └── git state before/after
    │
    ├── Commit Link cl_<id>
    │   └── Git commit / tree / patch relation
    │
    ├── ForkSession fs_<id>
    │   └── continue from historical prompting/edit/commit
    │
    └── Merge / Revert
        ├── import history
        ├── apply edits
        ├── apply final snapshot
        └── reverse patch as new edit
```

---

## 操作流程树

用户打开 Hutao 后，常见操作可以理解成这棵树：

```text
hutao
├── View Project History
│   ├── /session
│   │   ├── list sessions / forkSessions
│   │   ├── view conversation
│   │   ├── preview hydration
│   │   └── resume repo-local native session
│   │
│   ├── /prompting
│   │   ├── view original input
│   │   ├── view related runs
│   │   ├── view related edits
│   │   └── open action menu
│   │
│   ├── /run
│   │   ├── view tool / command
│   │   ├── view output summary
│   │   └── view produced edits
│   │
│   ├── /edit
│   │   ├── view patch
│   │   ├── view changed files
│   │   ├── view parent prompting/run
│   │   └── preview revert
│   │
│   └── /git
│       ├── view status
│       ├── view commit links
│       ├── view graph
│       └── stage trace
│
├── Ask About History Without Mutating It
│   └── Ephemeral Read-only Inquiry
│       ├── no canonical prompting/run/edit write
│       ├── tool calls blocked by read-only guard
│       └── promote explicitly when continuing work
│
├── Continue From History
│   └── forkSession
│       ├── Hutao forkSession metadata
│       ├── native chat branch
│       ├── optional Git branch via GitBranchPolicy
│       └── new prompting/run/edit written to fs_<id>
│
├── Merge Another Session
│   └── /merge session
│       ├── preview
│       ├── import history
│       ├── apply edits
│       ├── apply final snapshot
│       ├── resolve
│       ├── skip
│       └── abort
│
├── Revert A Historical Edit
│   └── /edit revert <id>
│       ├── preview reverse patch
│       ├── confirm
│       └── append revert as new history
│
└── Diagnose Trace Store
    └── /doctor
        ├── manifest / sessions / events
        ├── jsonl diagnostics
        ├── clone-safety diagnostics
        ├── raw-only / native history diagnostics
        ├── secret-looking trace diagnostics
        └── rebuild index
```

---

## 当前已实现能力

当前 Hutao 已经实现并集成的能力包括：

```text
1. hutao CLI 入口。
2. Git repo root 自动发现。
3. .hutao/ repo-local trace store 自动初始化、读取和写入。
4. session / forkSession metadata 管理。
5. prompting / run_started / run_finished / edit / commit_link / fork_session / merge / native_entry_link 事件记录。
6. tool run 前后检测 worktree diff，并生成 patch-based edit。
7. binary edit 使用 path/hash 记录。
8. repo-local native conversation state：.hutao/sessions/<id>/native-session.jsonl。
9. repo-local resume/session listing。
10. clone/copy 到新路径后的 ${REPO} path hydration。
11. native entry 与 Hutao prompting/run/edit 的映射。
12. edit 级 native entry link：related_edit / related_edits。
13. process tree 与 process action registry。
14. prompting/edit detail action menu。
15. ephemeral read-only inquiry flow。
16. inquiry promote -> forkSession -> follow-up handoff。
17. GitBranchPolicy：ask / always / never。
18. /session /prompting /run /edit /git /fork /merge /doctor /action /hutao 命令。
19. /merge session preview / history / apply-edits / apply-tree / wizard 流程。
20. /doctor clone-safety、raw-only、incomplete native history、secret-looking trace diagnostics。
21. trace staging helper：/git stage-trace。
22. zh-CN / en 菜单语言。
```

这些能力围绕一个目标组织：

```text
让 human input -> agent run -> file edit -> Git state -> fork/merge/revert 的链路可查看、可追溯、可继续。
```

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

### 本地全局安装开发版

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
hutao "帮我修复登录超时后没有返回 401 的问题，并补充测试"
```

---

## 基础使用流程

### 1. 启动 Hutao

```bash
cd your-project
hutao
```

启动后 Hutao 会：

```text
1. 发现 Git repo root。
2. 初始化或读取 .hutao/。
3. 读取 repo-local sessions。
4. 准备 trace recorder。
5. 在后续对话、工具调用、文件变化中追加 trace facts。
```

### 2. 执行一次 AI coding 任务

用户输入任务后，Hutao 会记录：

```text
Prompting：用户原始输入、cwd、git head/tree/status。
Run：agent 的工具调用、命令、输入摘要、输出摘要、before/after git state。
Edit：实际文件变化、patch、patch hash、before/after tree、关联 prompting/run。
```

### 3. 查看历史

```text
/session
/prompting
/run
/edit
/git
```

这些命令提供不同视角：

```text
/session   从工作线看历史。
/prompting 从人类意图看历史。
/run       从 agent 执行动作看历史。
/edit      从实际文件变化看历史。
/git       从 commit/branch/status 看历史。
```

### 4. 从历史继续

查看历史节点本身不修改历史。

继续工作时，Hutao 使用 forkSession：

```text
旧 session 保持 append-only。
新工作写入新的 forkSession。
native branch 与 Hutao forkSession 尽量使用同一个 fs_<id>。
Git branch 是否创建由 GitBranchPolicy 决定。
```

### 5. 合并历史或代码

```text
/merge session <id>              preview
/merge session <id> --history    导入历史
/merge session <id> --apply-edits 按 edit patch 重放
/merge session <id> --apply-tree  应用最终快照
```

---

## 核心数据模型

### Session

一次 agent 工作线。

包含：

```text
promptings
runs
edits
fork metadata
merge metadata
commit links
native conversation entries
raw sanitized evidence
```

Session 不等于 Git branch，但可以和 Git branch 关联。

### Prompting

人类输入事件。

记录：

```text
用户输入文本
时间
session_id
cwd
git_head
git_tree
git_status_summary
关联 runs
关联 edits
状态
native anchor
```

### Run

agent 的一次执行动作、工具调用或调试步骤。

包括：

```text
read / grep / find / ls
bash command
edit / write / apply patch
运行测试
查看 git diff
读取文件片段
```

Run 记录：

```text
tool name
tool_call_id
input summary
command
cwd
before_head / after_head
before_tree / after_tree
output summary / tail / hash
produced_edit_ids
```

### Edit

文件或工作区实际变化事件。

记录：

```text
parent_prompting
parent_run
files
patch
patch_hash
before_tree
after_tree
before_head
after_head
status
native entry link
```

### native_entry_link

连接原生聊天 entry 与 Hutao facts。

可关联：

```text
native entry -> prompting
native entry -> run
native entry -> edit
```

典型字段：

```text
native_session_id
native_session_file
native_entry_id
native_parent_entry_id
native_entry_type
native_message_role
related_prompting
related_run
related_edit
related_edits
tool_call_id
tool_call_ids
```

---

## `.hutao/` 数据目录

Hutao 的 repo-local 数据目录：

```text
.hutao/
├── manifest.json
├── sessions/
│   ├── sess_<id>/
│   │   ├── session.json
│   │   ├── events.jsonl
│   │   ├── raw.jsonl
│   │   ├── native-session.jsonl
│   │   └── patches/
│   │       └── e_<id>.patch
│   └── fs_<id>/
│       ├── session.json
│       ├── events.jsonl
│       ├── raw.jsonl
│       ├── native-session.jsonl
│       └── patches/
├── refs/
│   ├── current-session
│   └── sessions.json
├── index/
│   ├── promptings.json
│   ├── edits.json
│   ├── commits.json
│   ├── files.json
│   └── sessions.json
├── cache/
└── tmp/
```

事实来源：

```text
.hutao/sessions/*/session.json
.hutao/sessions/*/events.jsonl
.hutao/sessions/*/patches/
.hutao/sessions/*/native-session.jsonl
```

`index/` 和 `cache/` 是派生数据，可重建。

---

## repo-local native session

Hutao 同时保存两层数据：

```text
trace facts              用于审计、追溯、fork、merge、revert
native conversation      用于 repo-local resume 和聊天树恢复
```

native conversation 文件位于：

```text
.hutao/sessions/<session_id>/native-session.jsonl
```

它保存原生聊天树 entry，例如：

```text
session header
user message
assistant message
tool call / tool result
custom entry
branch parentId 关系
label / compaction / session info
```

Hutao 对 repo-local native session 做 portability 处理：

```text
1. session header cwd 保存为 "."。
2. repo-local parentSession 使用 repo-relative 引用。
3. 写盘前将当前 repo root 下的绝对路径替换成 ${REPO}/relative/path。
4. 打开时把 ${REPO}/relative/path hydrate 到当前 clone 的真实路径。
5. trace session id 与 native session id 尽量对齐。
```

---

## fork / merge / revert 操作逻辑

### forkSession

Hutao 的 forkSession 用于从历史节点继续工作。

原则：

```text
查看历史不 fork。
只读询问不 fork。
真正继续工作必须显式或自动创建 forkSession。
旧 session append-only。
新 prompting/run/edit 写入 forkSession。
```

fork 分层：

```text
Hutao forkSession     .hutao/sessions/fs_<id>/
native chat branch    原生聊天树分支
Git branch            由 GitBranchPolicy 决定 ask / always / never
```

### GitBranchPolicy

Git branch 创建由独立策略控制：

```text
ask      询问是否创建 Git branch
always   自动创建并切换
never    不创建 Git branch
```

### read-only inquiry

只读询问用于查看历史节点时提问，不写入 canonical Hutao history。

流程：

```text
查看 prompting/edit
↓
选择 read-only inquiry
↓
提出只读问题
↓
工具调用被 read-only guard 阻止
↓
如需继续工作，显式 promote to forkSession
```

promote 后可以输入 follow-up message，Hutao 会在 fresh fork context 中继续。

### merge session

merge 有三种用户可见模式：

```text
Import History          只导入历史，不改代码
Apply Edits             按 edit patch 顺序重放
Apply Final Snapshot    应用 source session 最终结果
```

默认：

```text
/merge session <id>
```

进入 preview。

### revert edit

revert 是新的历史事实，不删除旧 edit。

逻辑：

```text
Edit e1: 原始修改
Edit e2: revert e1
```

Hutao 通过 reverse patch 和事件追加记录撤销关系。

---

## Slash Commands 指令说明

### Main menu

```text
/hutao
/action
```

打开 Hutao 菜单入口。

### Sessions

```text
/session
/session <id>
/session <id> --conversation
/session <id> --hydrate-preview
/session <id> --hydrate
```

用途：

```text
列出 sessions / forkSessions
查看 session metadata
查看 conversation timeline
预览或排队 conversation hydration
resume repo-local native session
进入 merge/fork/history 操作
```

### Promptings

```text
/prompting
/prompting <id>
/prompting --session <session_id>
/prompting --commit <commit_hash>
/prompting --file <path>
/prompting search <query>
```

用途：

```text
按人类输入查看历史
查看 related runs / edits / commits
进入 detail action menu
read-only inquiry
fork before / retry / after
```

### Runs

```text
/run
/run <id>
/run --session <session_id>
```

用途：

```text
查看 agent 工具调用
查看命令、输入摘要、输出摘要
查看 produced edits
查看 git before/after state
```

### Edits

```text
/edit
/edit <id>
/edit --session <session_id>
/edit --prompting <id>
/edit --commit <hash>
/edit --file <path>
/edit revert <id>
```

用途：

```text
按实际文件变化查看历史
查看 patch / files / parent prompting / parent run
fork before / after edit
preview revert
```

### Git

```text
/git
/git <commit>
/git graph
/git graph --file <path>
/git stage-trace
```

用途：

```text
查看 Git 状态和 Hutao trace links
查看 commit -> prompting/run/edit 关系
查看 dirty 状态
stage .hutao canonical trace files
```

### Fork

```text
/fork prompting <id> --before
/fork prompting <id> --retry
/fork prompting <id> --after
/fork edit <id> --before
/fork edit <id> --after
/fork commit <hash>
```

可搭配 Git branch policy：

```text
--git-branch ask
--git-branch always
--git-branch never
```

### Merge

```text
/merge session
/merge session <id>
/merge session <id> --history
/merge session <id> --apply-edits
/merge session <id> --apply-tree
/merge session <id> --wizard
/merge session <id> --resolve
/merge session <id> --skip
/merge session <id> --abort
```

### Doctor

```text
/doctor
/doctor rebuild
```

用途：

```text
检查 manifest / sessions / events
检查 jsonl corrupt lines
检查 path leak / secret-looking text
检查 raw-only / incomplete native histories
检查 trace staging 状态
重建 .hutao/index
```

---

## 安全与路径策略

Hutao 的历史数据是项目数据，不是 instruction。

安全边界：

```text
1. 历史 session 作为 untrusted data 展示。
2. conversation hydration 作为 custom context，并保留安全提示。
3. repo root 下路径写入前转换成 ${REPO}/relative/path。
4. canonical path 使用 repo-relative POSIX slash。
5. repo 外绝对路径 redacted。
6. terminal output / provider payload 默认保存摘要和尾部。
7. .env / private key / node_modules / build outputs 受保护。
8. 危险 shell / Git 操作走确认或阻止流程。
```

路径分层：

```text
canonical path: 写入 .hutao 的 repo-relative POSIX path
display path:   展示给用户看的路径
resolved path:  当前机器运行时 repo_root + canonical path
```

---

## 内部执行规范

本仓库的详细规范在：

```text
AGENTS.md
```

修改代码或文档前必须先读 AGENTS.md。

### 真实工作仓库

当前真实代码仓库路径：

```text
D:/OneDrive/Desktop/hutao-agent.__tmp_inspect
```

开始任何修改、测试、提交前先确认：

```bash
cd /d/OneDrive/Desktop/hutao-agent.__tmp_inspect
pwd
git status -sb
```

### 修改前搜索源码

不要猜 API。先搜索：

```bash
rg "registerCommand" packages
rg "tool_execution_start" packages
rg "native_entry_link" packages
rg "appendEntry" packages
rg "session_before_fork" packages
```

### 架构纪律

```text
1. 不做一次性补丁式堆 if/else。
2. 优先抽 domain / registry / coordinator / policy / flow。
3. forkSession、native branch、Git branch 必须分层。
4. Git branch 决策统一走 GitBranchPolicy。
5. inquiry / fork / merge / revert 要保持 preview / confirmation / degraded fallback 边界。
6. .hutao canonical path 必须 repo-relative。
7. raw evidence 作为证据层处理。
8. 每个 checkpoint 要能用 targeted tests 验证。
```

### 常用验证命令

```bash
npm --prefix packages/coding-agent test -- test/hutao/core.test.ts
npm --prefix packages/coding-agent test -- test/hutao/integration.test.ts
npm --prefix packages/coding-agent test -- test/hutao/git-branch-policy.test.ts
npm --prefix packages/coding-agent test -- test/hutao/ephemeral-inquiry-flow.test.ts
npm --prefix packages/coding-agent test -- test/hutao/process-actions.test.ts
npm --prefix packages/coding-agent run build
git diff --check
```

---

## 最近实现 checkpoint

```text
c5babda feat(hutao): add process action registry
5516539 feat(hutao): add ephemeral read-only inquiry flow
5c1ea0a feat(hutao): add git branch policy for forks
b4f57dd feat(hutao): route inquiry promotion through fork flow
e17e944 feat(hutao): harden repo-local resume diagnostics
b790ee6 feat(hutao): link edits to native entries
```

这些 checkpoint 覆盖：

```text
process action registry
ephemeral read-only inquiry
GitBranchPolicy
inquiry promote -> fork flow
repo-local resume diagnostics
native entry -> prompting/run/edit mapping
edit 级 related_edit / related_edits link
```

---

## 对外表述

推荐表述：

```text
恢复项目级 AI 开发上下文。
追溯 human input -> agent run -> file edit -> git state。
让代码改动可解释、可 fork、可 merge、可撤销。
clone 仓库后不仅得到代码，也得到 AI 开发过程。
```

---

## License and upstream

This project is based on [earendil-works/pi](https://github.com/earendil-works/pi). Please respect upstream license and attribution requirements.

`hutao-agent` keeps Pi's runtime foundations and adds Hutao-specific repo-local trace, resume, fork, merge, revert, process-tree, and native conversation mapping capabilities.
