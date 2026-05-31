# hutao-agent / 胡桃 Agent

中文 | [English](README.en.md)

## 致谢与用途声明

`hutao-agent` 基于 [earendil-works/pi](https://github.com/earendil-works/pi) 改造而来。感谢 Pi 提供 coding agent CLI、TUI、tool runtime、extension system、session tree、统一 LLM provider 抽象等基础能力。

也特别感谢 [zyf2007](https://github.com/zyf2007)（胡桃酱）提供的天才思路与产品方向启发，让 Hutao 从普通 coding agent 改造进一步走向 repo-local、Git-native、可追溯的 AI 开发上下文系统。

Hutao 不是要替代 Pi 的 runtime，也不是要替代 Git。它是在 Pi agent harness 上增加一层 **repo-local、Git-native、可追溯的 AI coding trace / resume 系统**：把一次 AI 辅助开发中最关键的项目级事实保存到当前仓库内。

Hutao 默认不承诺保存完整 provider payload、完整终端输出、完整 token 输入，也不承诺 100% 复现模型当时的内部状态。它关注的是：

```text
人当时说了什么 → agent 做了什么 → 文件实际怎么变了 → 这些变化和 Git / fork / merge / revert 有什么关系
```

---

## 一句话介绍

`hutao-agent` 是一个与 Git 仓库绑定的 AI coding agent。它可以像普通 coding agent 一样读文件、跑命令、改代码，同时把开发过程记录到仓库内的 `.hutao/`，让代码之外的 AI 开发上下文也能被 clone、查看、追溯、分叉、合并和恢复。

核心链路：

```text
Human Prompting
    ↓
Agent Run
    ↓
File Edit
    ↓
Patch / Git State
    ↓
Commit Link
    ↓
Fork / Merge / Revert
```

目标体验：

```bash
git clone <repo>
cd <repo>
hutao
```

如果仓库里已经包含 `.hutao/`，Hutao 会在启动、resume picker 和相关命令中读取 repo-local sessions，让用户看到这个项目过去的 AI 开发历史，而不是只能看到当前代码快照。

---

## 项目定位

Hutao 的核心产品定义是：

> 让 AI 写代码的过程像 Git 历史一样可查看、可追溯、可分叉、可合并、可撤销。

它解决的问题不是“保存聊天记录”这么简单，而是把 AI coding 过程中分散在 TUI、工具调用、文件 diff、Git commit 和 session tree 里的事实组织成一条可审计链路。

Hutao 重点保存：

```text
1. prompting：用户的一次输入或意图。
2. run：agent 的一次工具调用、命令执行或调试步骤。
3. edit：文件或工作区实际发生的 patch 变化。
4. commit_link：Git commit 与 prompting/run/edit 的关联。
5. fork_session：从历史 prompting/edit/commit 继续探索的新工作线。
6. merge：把另一个 session/forkSession 的历史或代码结果合入当前工作线。
7. native_entry_link：Pi/Hutao 原生聊天 entry 与 Hutao trace fact 的映射。
```

Hutao 不做这些承诺：

```text
1. 不替代 Git。
2. 不默认提交完整 token、provider request/response 或 terminal output。
3. 不把历史 session 当成 system prompt 或可信指令。
4. 不保证 100% 复现模型当时的输出和思考。
5. 不把 raw-only 历史伪造成完整聊天上下文。
```

---

## 当前实现状态

当前版本已经从“单纯 trace 原型”推进到 **repo-local native session + menu-first Hutao UX + fork/merge/revert trace 对齐** 阶段。

已经实现并验证的能力包括：

```text
1. `hutao` CLI 入口，package bin 指向 dist/cli.js。
2. Git repo root 自动发现。
3. `.hutao/` 自动初始化、读取和写入。
4. repo-local native session 存储在 `.hutao/sessions/<id>/native-session.jsonl`。
5. resume/session picker 能合并 repo-local、raw-only、legacy global sessions。
6. native session cwd 使用 `.`，避免保存机器相关绝对路径。
7. repo-local native session 内容在磁盘上把 repo root 替换成 `${REPO}`，打开时按当前 clone 路径 hydrate。
8. Windows ↔ WSL / 不同 clone 路径的 repo-local path portability 已有测试和真实 GitHub roundtrip 验证。
9. prompting / run_started / run_finished / edit / commit_link / fork_session / merge / native_entry_link 等事件写入 `.hutao/events.jsonl`。
10. 工具调用前后检测工作区 diff，产生 patch-based edit。
11. binary edit 采用路径和 hash 记录，不默认保存完整二进制内容。
12. `/hutao` 与 `/action` 提供 menu-first 主入口。
13. `/session`、`/prompting`、`/run`、`/edit`、`/git`、`/fork`、`/merge`、`/doctor`、`/language` 等命令可用。
14. 查看历史 prompting/edit 不会立即 fork；继续普通输入会通过 armed continuation 尝试先 fork 再继续。
15. forkSession 尽量与 native branch 使用同一个 `fs_<id>`。
16. `/merge session` 默认 preview，不改代码。
17. `/merge session --history`、`--apply-edits`、`--apply-tree`、`--wizard`、`--resolve`、`--skip`、`--abort` 已实现。
18. `/edit revert <id>` 会 preview reverse patch 并要求确认。
19. `/git stage-trace` 和 git commit 前 trace auto-stage/提醒机制已接入。
20. `/doctor` 可以诊断 manifest、sessions、events、patches、index、路径泄漏、secret-like 内容和 trace staging 状态。
21. 菜单语言支持 `zh-CN` 和 `en`。
```

仍然需要保守表述的边界：

```text
1. 不承诺完整恢复模型当时状态。
2. 不默认保存完整 provider payload、完整 token 输入或完整 terminal output。
3. apply-tree 可用，但属于高级最终快照策略，不是默认推荐合并方式。
4. raw-only/degraded 历史只能降级展示，不能伪造成完整原生聊天。
5. 复杂 merge 冲突仍需要用户手动处理、skip、resolve 或 abort。
6. Windows 上部分全量测试可能受 symlink、权限、路径分隔符差异影响；WSL/Linux 原生文件系统更接近 CI 行为。
```

---

## 安装与构建

### 环境要求

```text
Node.js >= 22.19.0
npm
Git
```

检查环境：

```bash
node --version
npm --version
git --version
```

### 从源码构建

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
npm install --ignore-scripts
npm run build
```

根仓库是 npm workspace monorepo，常用脚本：

```bash
npm run build     # 构建 tui / ai / agent / coding-agent
npm run check     # 格式、类型、依赖、shrinkwrap 和 smoke 检查
npm run test      # 运行各 workspace 测试
```

### 本地全局安装

如果已经有打包产物：

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

或者重新打包再安装：

```bash
npm pack --workspace packages/coding-agent
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

验证：

```bash
hutao --version
hutao --help
which hutao      # macOS / Linux
where hutao      # Windows PowerShell / CMD
```

---

## 基础用法

在任意 Git 仓库中启动：

```bash
cd your-project
hutao
```

也可以直接带初始任务：

```bash
hutao "帮我解释这个仓库结构"
hutao "帮我修复登录超时后没有返回 401 的问题，并补充测试"
```

常见模型参数沿用 Pi coding-agent 的 provider/model 能力：

```bash
hutao --provider openai --model gpt-4o
hutao --model anthropic/claude-sonnet-4-5
hutao --models "claude-*,gpt-4o"
hutao --list-models
```

只读审查示例：

```bash
hutao --tools read,grep,find,ls -p "Review the code in src/"
```

如果当前仓库已有 `.hutao/` 历史，进入 TUI 后可以先打开主菜单：

```text
/hutao
```

或者直接查看：

```text
/session
/prompting
/run
/edit
/git
/doctor
```

---

## 核心概念和数据模型

Hutao 的数据模型围绕一条固定因果链展开：

```text
Session
└── Prompting
    ├── Run
    │   └── Edit?
    ├── Run
    └── Run
        └── Edit?
```

一句话区分：

```text
Prompting = 人说了什么
Run       = agent 做了什么
Edit      = 文件实际变了什么
```

这三个概念不能混用。不是所有 run 都是 edit，也不是所有 commit 都等于一次 prompting。

---

### Session

`Session` 是一次 agent 工作线。它保存这条工作线上的 promptings、runs、edits、fork metadata、merge metadata、commit links、raw evidence 和 native entry links。

Session 不等于 Git branch，但可以和 Git branch、Git commit、Pi/Hutao native session tree 建立关系。

常见 session 类型：

```text
session      普通工作线。
forkSession  从历史 prompting、edit 或 commit 继续探索的新工作线。
```

Hutao 的 session metadata 存在：

```text
.hutao/sessions/<session_id>/session.json
.hutao/refs/sessions.json
.hutao/refs/current-session
```

`session.json` 记录：

```text
id、kind、status、created_at、updated_at、base_git_head、base_tree、parent_session、fork_from、summary
```

---

### Prompting

`prompting` 表示用户的一次输入或意图，不是“prompt engineering”。

它回答：

```text
人当时想让 agent 做什么？
```

一次 prompting 可以是：

```text
一次任务指令
一次问题
一次纠正
一次继续请求
一次 fork 请求
一次 merge 请求
一次撤销请求
```

Hutao 当前在 `before_agent_start` 阶段记录 prompting。记录内容包括：

```text
id
session_id
actor: human
text
cwd
git_head
git_tree
git_status_summary
native_session_id
native_session_file
native_anchor_entry_id
created_at
status
```

隐私和安全规则：

```text
1. prompting 文本会做路径替换和敏感信息截断。
2. repo 内绝对路径写入前变成 ${REPO}/relative/path。
3. repo 外绝对路径默认变成 [external-path-redacted]。
4. prompting 是历史事实，不应被覆盖或删除。
```

---

### Run

`run` 表示 agent 的一次执行动作、工具调用或调试步骤。

它回答：

```text
agent 当时做了什么？
```

典型 run：

```text
read 文件
grep 搜索
ls/find 列目录
bash 跑测试或构建
edit/write 修改文件
查看 git diff
git commit
```

Hutao 当前把 run 拆成两类 append-only event：

```text
run_started   工具执行前的快照。
run_finished  工具执行后的结果。
```

`run_started` 记录：

```text
id
tool
tool_call_id
input_summary
command
cwd
before_head
before_tree
before_worktree_diff_hash
started_at
parent_prompting
native anchor fields
```

`run_finished` 记录：

```text
status
output_summary
output_tail
output_truncated
output_hash
after_head
after_tree
after_worktree_diff_hash
produced_edit_ids
ended_at
```

输出保存策略默认保守：

```text
1. 不保存完整 terminal output。
2. 只保存摘要、尾部、hash、截断标记。
3. 不保存完整 provider request/response。
4. 明显密钥会被 redacted。
```

---

### Edit

`edit` 表示文件或工作区实际发生变化。

它回答：

```text
代码实际发生了什么变化？
```

Hutao 在工具调用前后比较 worktree snapshot。如果 run 之后出现真实 diff，就生成 edit。

edit 记录：

```text
id
session_id
parent_prompting
parent_run
actor
tool
files
patch
patch_hash
before_head / after_head
before_tree / after_tree
status
summary
```

patch 默认存到：

```text
.hutao/sessions/<session_id>/patches/<edit_id>.patch
```

第一版 edit 粒度是工具调用级：

```text
一次 edit/write 工具调用产生的 diff = 一个 edit
一次 bash run 如果造成文件变化 = 一个 edit
format/lint 自动修改多个文件也可以先作为一个 edit
```

binary 文件策略：

```text
1. binary patch 不默认保存完整内容。
2. 记录 affected files、hash、before/after 信息。
3. 保守避免把大文件或敏感二进制写入 trace。
```

---

### Commit Link

`commit_link` 表示 Git commit 与 prompting/run/edit 的引用关系。

Hutao 不把 commit 当成 prompting/run/edit 的物理容器，原因是：

```text
一个 commit 可以包含多个 promptings。
一个 prompting 可以产生多个 commits。
一个 edit 可能尚未进入任何 commit。
一个 commit 可能混合人类手动修改和 agent 修改。
rebase/squash/amend 会改变 commit 粒度或 hash。
```

正确关系是：

```text
Prompting -> Run -> Edit
Commit <-> Prompting
Commit <-> Run
Commit <-> Edit
```

当前 commit link 来源：

```text
1. agent 执行 git commit，Hutao 观察 bash run 前后 HEAD 变化，写 observed_git_commit。
2. /git scan 通过 patch/file 匹配尝试补充 commit links。
```

commit link 不是绝对真理，所以事件中保留 `link_method`。

---

### Native Session / Conversation State

Hutao 同时维护两层历史：

```text
trace facts              .hutao/sessions/<id>/events.jsonl
native conversation      .hutao/sessions/<id>/native-session.jsonl
```

二者职责不同：

```text
trace facts          用于审计、追溯、merge、revert、index rebuild。
native conversation  用于像原聊天一样 resume、显示 user/assistant/tool/custom entries。
```

Hutao 会通过 `native_entry_link` 事件建立映射：

```text
native_entry_id <-> hutao_prompting_id / hutao_run_id / hutao_edit_id
```

repo-local native session 的 portability 规则：

```text
1. native session header 中 cwd 存为 "."。
2. session 内容落盘前把 repo root 替换成 ${REPO}。
3. clone 到新路径后打开 session 时，把 ${REPO} hydrate 成当前 clone root。
4. Windows / WSL / Linux 下 canonical path 都使用 repo-relative POSIX 风格。
```

如果只有 raw evidence，没有完整 native entries 或 trace facts，Hutao 必须降级展示为 incomplete/degraded history，不能编造聊天记录。

---

### forkSession

`forkSession` 是从历史节点继续工作的核心机制。

硬规则：

```text
查看历史不会 fork。
基于历史继续工作必须 fork。
旧 session、旧 prompting、旧 edit 不会被覆盖。
```

支持的来源：

```text
prompting
edit
commit
```

支持的模式：

```text
prompting --before  回到该 prompting 发生前。
prompting --retry   保留旧 prompting，用同一文本重新尝试。
prompting --after   从该 prompting 完成后的结果继续。
edit --before       回到该 edit 发生前。
edit --after        接受该 edit 后继续。
commit              从指定 commit 状态创建 forkSession。
```

Hutao 会尽量让：

```text
native branch session id == Hutao forkSession id == fs_<id>
```

如果 native entry mapping 不足，Hutao 仍会创建 degraded fork metadata，并明确提示 native branch 不完整。

---

### Armed Historical Continuation

Hutao 支持一种更自然的历史继续方式：打开历史详情后，下一次普通输入自动 fork。

流程：

```text
1. 用户执行 /prompting <id> 或 /edit <id> 查看历史。
2. Hutao 只 arm 一个 transient continuation target，不立即 fork。
3. 用户下一次输入普通聊天内容。
4. input 事件在 prompt 持久化前被拦截。
5. Hutao 先创建 forkSession / native branch。
6. 再把用户原始输入发送到新 fork 上。
```

保护规则：

```text
1. slash command 不触发 auto-fork。
2. extension-originated input 不触发 auto-fork。
3. 如果 fork 失败，Hutao 会恢复输入到编辑器，避免把新输入写进旧历史。
```

---

### Merge

`merge` 表示把另一个 session/forkSession 的历史或代码结果合入当前工作线。

默认行为：

```text
/merge session <id>
```

只 preview，不修改代码。

三种主要合并策略：

```text
history_only  只导入历史，不改代码。
apply_edits   按 source session 的 edit 顺序 replay patch。
apply_tree    应用 source session 的最终快照差异，生成 merge edit。
```

推荐默认代码合并策略是 `apply_edits`，因为它保留 edit 因果链，冲突能定位到具体 edit。

`apply_tree` 更像“把最终结果端过来”，适合只关心最终状态或中间 edit 很乱的场景，但 edit 级可追溯性弱一些。

危险操作保护：

```text
1. preview 优先。
2. history/apply-edits/apply-tree 都会先展示 changed files 并要求确认。
3. apply-edits/apply-tree 要求 working tree clean。
4. 冲突时可 resolve、skip 或 abort。
```

---

### Revert

Hutao 的 revert 不删除旧 edit，而是追加新事件。

原则：

```text
旧 edit 是历史事实，不能被覆盖。
revert 是新的历史事实，也要记录。
```

当前 `/edit revert <id>` 会：

```text
1. 查找 edit patch。
2. 检查 working tree dirty 状态。
3. 执行 reverse patch check。
4. 展示 preview。
5. 用户确认后 apply reverse patch。
6. 写 edit_reverted / revert edit 等事件。
```

---

## `.hutao/` 数据目录

Hutao 的 canonical trace 数据保存在当前 Git 仓库内的 `.hutao/`，而不是写入全局 `~/.pi/agent/sessions`。

推荐提交到 Git 的核心数据是：

```text
.hutao/manifest.json
.hutao/refs/current-session
.hutao/refs/sessions.json
.hutao/sessions/*/session.json
.hutao/sessions/*/events.jsonl
.hutao/sessions/*/raw.jsonl
.hutao/sessions/*/patches/*.patch
.hutao/sessions/*/native-session.jsonl
```

典型目录结构：

```text
.hutao/
├── manifest.json
├── refs/
│   ├── current-session
│   └── sessions.json
├── sessions/
│   ├── sess_<id>/
│   │   ├── session.json
│   │   ├── native-session.jsonl
│   │   ├── events.jsonl
│   │   ├── raw.jsonl
│   │   └── patches/
│   │       └── e_<id>.patch
│   └── fs_<id>/
│       ├── session.json
│       ├── native-session.jsonl
│       ├── events.jsonl
│       ├── raw.jsonl
│       └── patches/
├── index/
├── cache/
└── tmp/
```

### 文件职责

| 路径 | 职责 | 是否事实来源 |
| --- | --- | --- |
| `.hutao/manifest.json` | Hutao trace store manifest，声明 schema、path policy、安全策略。 | 是 |
| `.hutao/refs/current-session` | 当前 Hutao trace session id。 | 是 |
| `.hutao/refs/sessions.json` | session/forkSession metadata 汇总。 | 是 |
| `.hutao/sessions/<id>/session.json` | 单个 session/forkSession metadata。 | 是 |
| `.hutao/sessions/<id>/events.jsonl` | append-only trace facts：prompting、run、edit、merge、fork 等。 | 是 |
| `.hutao/sessions/<id>/raw.jsonl` | sanitized raw evidence：用户消息、工具摘要、结果摘要等。 | 辅助证据 |
| `.hutao/sessions/<id>/patches/*.patch` | edit patch。 | 是 |
| `.hutao/sessions/<id>/native-session.jsonl` | repo-local 原生聊天/session tree 状态，用于 clone 后像聊天一样 resume。 | native UX 来源 |
| `.hutao/index/` | 从 events 重建的查询索引。 | 否，可重建 |
| `.hutao/cache/` | preferences、语言等缓存。 | 否 |
| `.hutao/tmp/` | 临时文件。 | 否 |

`events.jsonl` 是 append-only。历史状态变化通过新事件表达，不应该原地覆盖旧事件。

---

## repo-local native session

Hutao 同时保存 trace facts 和 native conversation state。

原因是：

```text
trace facts 能回答：谁让 agent 做了什么、哪个 run 改了哪些文件、patch 是什么、merge/revert 怎么发生。
native conversation 能回答：clone 后怎么像原聊天一样打开、看到 user/assistant/tool/custom entries 并继续。
```

repo-local native session 文件位于：

```text
.hutao/sessions/<session_id>/native-session.jsonl
```

它与 Pi 原生 session format 对齐，包含：

```text
session header
message entries
custom entries
tool/result/diff 相关 entries
branch/tree parentId 关系
session_info / label / compaction 等原生 entry
```

Hutao 对 repo-local native session 做了 portability 处理：

```text
1. session header 的 cwd 保存为 "."。
2. parentSession 对 repo-local fork 使用 repo-relative 引用。
3. 写盘前将当前 repo root 下的绝对路径替换成 ${REPO}/relative/path。
4. 打开时把 ${REPO}/relative/path hydrate 到当前 clone 的真实路径。
5. resume picker 会同时列出 repo-local、raw-only、legacy global sessions。
```

这让以下流程成立：

```bash
git clone <repo>
cd <repo>
hutao
```

只要 `.hutao/` 被提交，另一个路径、另一台机器或 Windows/WSL clone 后仍能发现 repo-local sessions，并继续写回 `.hutao/`。

---

## 路径策略

Hutao 写入 `.hutao/` 的 canonical path 必须是 repo-relative POSIX path。

允许：

```text
src/auth.ts
packages/api/src/index.ts
${REPO}/src/auth.ts
.
```

不允许作为 canonical path：

```text
/Users/alice/project/src/auth.ts
/home/bob/project/src/auth.ts
C:\Users\Bob\project\src\auth.ts
/mnt/c/Users/Bob/project/src/auth.ts
```

实际策略：

```text
1. 结构化路径字段尽量保存为 repo-relative POSIX path。
2. raw 文本中的 repo 内绝对路径替换成 ${REPO}/...。
3. repo 外绝对路径替换成 [external-path-redacted]。
4. Windows 反斜杠写入前 normalize 成 POSIX slash。
5. 打开 repo-local native session 时，将 ${REPO} 按当前 clone root hydrate。
```

SSH/remote shell 边界：

```text
远程 shell 中出现的 /home/...、/srv/...、容器路径或 SSH 主机路径默认视为外部证据。
不要自动映射成本机 repo path。
```

原因是远端路径可能来自不同机器、不同 clone、不同分支或容器环境。

---

## 仓库结构

Hutao 仍然复用 Pi monorepo 的基础包结构。当前最重要的目录如下：

```text
.
├── package.json
├── README.md
├── AGENTS.md
├── agent.md
├── packages/
│   ├── agent/
│   │   └── Pi/Hutao agent runtime 基础能力
│   ├── ai/
│   │   └── provider/model 抽象
│   ├── tui/
│   │   └── terminal UI 组件和渲染
│   └── coding-agent/
│       ├── package.json
│       ├── src/
│       │   ├── cli.ts / cli 相关入口
│       │   ├── core/
│       │   │   ├── extensions/
│       │   │   ├── session-manager.ts
│       │   │   └── tool/runtime/session 基础设施
│       │   ├── hutao/
│       │   │   ├── extension.ts
│       │   │   ├── commands.ts
│       │   │   ├── trace-recorder.ts
│       │   │   ├── event-store.ts
│       │   │   ├── session-registry.ts
│       │   │   ├── merge-manager.ts
│       │   │   ├── fork-session-manager.ts
│       │   │   ├── native-fork-manager.ts
│       │   │   ├── historical-continuation-coordinator.ts
│       │   │   ├── path-mapper.ts
│       │   │   ├── git-adapter.ts
│       │   │   └── ...
│       │   └── modes/
│       └── test/
│           ├── hutao/
│           └── session-manager/
└── scripts/
```

`packages/coding-agent/package.json` 提供最终 CLI：

```json
{
  "name": "hutao-agent",
  "bin": {
    "hutao": "dist/cli.js"
  }
}
```

---

## 架构分层

整体结构可以理解为：

```text
hutao CLI
  ↓
Pi coding-agent runtime
  ├─ model/provider abstraction
  ├─ TUI
  ├─ built-in tools: read / bash / edit / write / grep / find / ls
  ├─ native session tree
  └─ extension event bus
       ↓
       Hutao built-in extension
       ├─ event listeners
       ├─ slash commands
       ├─ trace recorder
       ├─ repo-local event store
       ├─ native session alignment
       ├─ fork/continuation manager
       ├─ merge/revert manager
       ├─ Git adapter
       ├─ path mapper
       └─ safety/privacy guards
```

Hutao 的事实来源是 `.hutao/`；Pi/Hutao native session tree 负责聊天体验和 branch/resume UX。

两者互相引用，但不能互相替代：

```text
trace facts 是审计、merge、revert 的依据。
native conversation 是 resume UI/聊天上下文的依据。
```

---

## 核心模块

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| Hutao extension | `packages/coding-agent/src/hutao/extension.ts` | 注册事件监听和 slash commands，把 Hutao 接入 Pi runtime。 |
| Commands | `packages/coding-agent/src/hutao/commands.ts` | `/hutao`、`/session`、`/prompting`、`/edit`、`/git`、`/fork`、`/merge` 等命令。 |
| TraceRecorder | `packages/coding-agent/src/hutao/trace-recorder.ts` | 记录 prompting、run、edit、commit_link、native_entry_link。 |
| EventStore | `packages/coding-agent/src/hutao/event-store.ts` | 初始化 `.hutao/`，append events/raw，维护 manifest 和 refs。 |
| SessionRegistry | `packages/coding-agent/src/hutao/session-registry.ts` | 创建/读取 session 与 forkSession metadata。 |
| GitAdapter | `packages/coding-agent/src/hutao/git-adapter.ts` | repo root、HEAD/tree、diff、patch apply/check、status、file hash。 |
| PathMapper | `packages/coding-agent/src/hutao/path-mapper.ts` | repo-relative path、POSIX normalize、`${REPO}` 替换、外部路径 redaction。 |
| PatchStore | `packages/coding-agent/src/hutao/patch-store.ts` | 保存 edit patch 和 patch hash。 |
| IndexBuilder | `packages/coding-agent/src/hutao/index-builder.ts` | 从 append-only events 重建 `.hutao/index`。 |
| ReadModel | `packages/coding-agent/src/hutao/read-model.ts` | 聚合读取 sessions/events，为命令视图提供数据。 |
| ConversationStore | `packages/coding-agent/src/hutao/conversation-store.ts` | 读取 repo-local native conversation / raw-only degraded history。 |
| ConversationHydrator | `packages/coding-agent/src/hutao/conversation-hydrator.ts` | 将可用历史作为 untrusted next-turn custom context 注入。 |
| ForkTargetResolver | `packages/coding-agent/src/hutao/fork-target-resolver.ts` | 将 prompting/edit/commit 解析为 fork target。 |
| NativeForkManager | `packages/coding-agent/src/hutao/native-fork-manager.ts` | 创建 Pi/Hutao native branch session。 |
| HutaoForkCoordinator | `packages/coding-agent/src/hutao/fork-coordinator.ts` | 协调 native fork 与 Hutao forkSession，尽量复用同一个 `fs_<id>`。 |
| HistoricalContinuationCoordinator | `packages/coding-agent/src/hutao/historical-continuation-coordinator.ts` | 处理历史详情页 armed continuation 和下一次普通输入 auto-fork。 |
| MergeManager | `packages/coding-agent/src/hutao/merge-manager.ts` | merge preview、history-only、apply-edits、apply-tree、skip、resolve、abort。 |
| RevertManager | `packages/coding-agent/src/hutao/revert-manager.ts` | reverse patch revert，并追加 revert/edit 事件。 |
| CommitLinker | `packages/coding-agent/src/hutao/commit-linker.ts` | 通过 patch/file 匹配建立 commit links。 |
| TraceStager | `packages/coding-agent/src/hutao/trace-stager.ts` | 检查和暂存 `.hutao` canonical trace 文件。 |
| SecretGuard | `packages/coding-agent/src/hutao/secret-guard.ts` | 保护敏感路径、输出脱敏和截断。 |
| i18n | `packages/coding-agent/src/hutao/i18n.ts` | 中英文菜单文案和语言偏好。 |

---

## Extension 事件接入点

Hutao built-in extension 主要监听这些 Pi extension events：

```text
session_start          初始化 recorder、状态栏和历史提示。
input                  armed continuation pre-persistence 拦截。
before_agent_start     记录 prompting。
tool_call              记录 tool call summary、危险命令确认、敏感路径阻断、trace auto-stage。
tool_execution_start   记录 run_started 和 before snapshot。
tool_result            记录 run_finished，检测 edit，保存 patch，观察 commit link。
session_before_fork    更新 fork 状态提示。
```

这些事件让 Hutao 能在不重写 Pi runtime 的情况下记录完整项目级 AI 开发链路。

---

## Slash Commands / 命令说明

Hutao 的 slash commands 是查看、追溯、fork、merge、revert repo-local AI 开发历史的主要入口。

命令有两种使用方式：

```text
1. 直接传参数：适合熟悉 ID / 目标的用户。
2. 不传参数：打开 menu-first 选择器，适合浏览和发现。
```

所有命令都要求当前目录在 Git 仓库内；如果不在 Git repo，Hutao 会提示 `Not in a Git repository.`。

---

### `/hutao`

主菜单入口。

```text
/hutao
```

用途：

```text
打开 Hutao main menu，集中进入 sessions、promptings、edits、runs、git、fork、merge、doctor、language 等功能。
```

菜单项：

```text
Sessions
Promptings
Edits
Runs
Git
Fork
Merge
Doctor
Language
```

说明：

```text
/hutao 和 /action 使用同一个 handler。
推荐新用户优先使用 /hutao，从菜单开始探索。
```

---

### `/action`

动作菜单入口，也是 `/hutao` 的底层实现。

```text
/action
/action session <id>
/action prompting <id>
/action edit <id>
/action run <id>
/action git
/action fork
/action merge
/action doctor
/action language
```

用途：

```text
从一个对象或功能入口打开可执行动作菜单。
```

常见行为：

```text
/action                  打开 Hutao 主菜单。
/action session <id>     查看 session 可用动作。
/action prompting <id>   查看 prompting 可用动作。
/action edit <id>        查看 edit 可用动作。
/action run <id>         查看 run 详情。
/action merge            进入 merge session picker。
```

适合场景：

```text
在详情页或知道某个 ID 时快速跳转到相关操作。
```

---

### `/session`

查看和选择 Hutao sessions / forkSessions。

```text
/session
/session <id>
/session <id> --conversation
/session <id> --hydrate-preview
/session <id> --hydrate
```

无参数行为：

```text
打开 session selector，选择一个 session 后进入 session action menu。
```

`/session <id>` 展示：

```text
kind
status
parent_session
fork_from
base_git_head
base_tree
last_git_head
updated_at
summary
promptings
runs
edits
forks
merges
commit links
```

conversation 相关参数：

```text
--conversation       展示 repo-local native conversation timeline。
--hydrate-preview    预览可注入到下一轮的 conversation context。
--hydrate            将可用 conversation context 排队到下一轮，作为 untrusted custom context。
```

安全说明：

```text
/session --hydrate 不会把历史提升为 system/developer instruction。
它只会作为 nextTurn custom context 传入，并保持 untrusted data 语义。
raw-only / incomplete 历史不会被伪造成完整聊天。
```

---

### `/prompting`

查看用户输入历史。

```text
/prompting
/prompting <id>
/prompting --session <session_id>
/prompting --commit <commit_hash>
/prompting --file <path>
/prompting search <query>
```

无参数行为：

```text
打开最近 promptings 选择器，选择后进入 prompting action menu。
```

筛选参数：

```text
--session <id>       只看某个 session/forkSession 下的 promptings。
--commit <hash>      只看与某个 commit_link 关联的 promptings。
--file <path>        只看产生过该文件 edit 的 promptings。
search <query>       按 prompting 文本搜索。
```

`/prompting <id>` 展示：

```text
session
git_head
git_tree
cwd
status
related commits
原始用户输入
runs
edits
建议动作
```

重要行为：

```text
打开 prompting 详情会 arm continuation target。
这不会立刻 fork。
下一次普通聊天输入会先 auto-fork，再记录到新 forkSession。
slash command 不触发 auto-fork。
```

常见动作：

```text
/fork prompting <id> --before
/fork prompting <id> --retry
/fork prompting <id> --after
/edit --prompting <id>
/git <commit>
```

---

### `/run`

查看 agent 工具执行历史。

```text
/run
/run <id>
/run --session <session_id>
```

无参数行为：

```text
打开最近 runs 选择器。
```

用途：

```text
追溯 agent 当时调用了什么工具、执行了什么命令、输出摘要是什么、有没有产生 edit、是否关联 commit。
```

`/run <id>` 展示：

```text
session
parent prompting
tool
tool_call_id
status
cwd
command
started_at / ended_at
before_head / after_head
before_tree / after_tree
before/after worktree diff hash
related commits
produced edits
input summary
output summary
output tail
output truncated
```

说明：

```text
run 是 agent 行为记录，不等于 edit。
只有 run 前后文件真的变了，才会有 produced edits。
```

---

### `/edit`

查看和 revert 文件改动历史。

```text
/edit
/edit <id>
/edit --session <session_id>
/edit --prompting <id>
/edit --commit <hash>
/edit --file <path>
/edit --reverted
/edit --conflicts
/edit revert <id>
```

无参数行为：

```text
打开最近 edits 选择器，选择后进入 edit action menu。
```

筛选参数：

```text
--session <id>       只看某个 session/forkSession 下的 edits。
--prompting <id>     只看某个 prompting 产生的 edits。
--commit <hash>      只看与某个 commit_link 关联的 edits。
--file <path>        只看影响某个文件的 edits。
--reverted           关注已 revert 的 edits。
--conflicts          关注冲突相关 edits。
```

`/edit <id>` 展示：

```text
summary
session
parent prompting
parent run
related commits
related merges
files
patch path
patch hash
before_head / after_head
before_tree / after_tree
status
patch preview
```

重要行为：

```text
打开 edit 详情会 arm continuation target。
这不会立刻 fork。
下一次普通聊天输入会先 auto-fork，再从该 edit 之后继续。
```

#### `/edit revert <id>`

用途：

```text
对某个 edit 执行 reverse patch revert。
```

安全流程：

```text
1. 查找 edit patch。
2. 检查当前 working tree 状态。
3. 执行 git apply -R --check 等价检查。
4. 展示 preview：影响文件、dirty 状态、reverse patch check、后续同文件 edits。
5. 用户确认后才应用 reverse patch。
6. 写入 edit_reverted / revert edit 事件。
```

原则：

```text
revert 不删除旧 edit。
旧 edit 和 revert edit 都是历史事实。
```

---

### `/git`

从 Git 视角查看 Hutao trace。

```text
/git
/git <commit>
/git graph
/git graph --file <path>
/git graph --range <range>
/git --file <path>
/git --range <range>
/git scan
/git stage-trace
```

无参数行为：

```text
打开 Git action menu，可选择 status、graph、scan、stage trace、commit detail。
```

常用命令：

```text
/git                  查看 HEAD、dirty 状态、commit links、recent trace。
/git graph            展示 git log graph + Hutao commit links。
/git graph --file p   只看某个文件相关 graph/link。
/git graph --range r  使用指定 git log range。
/git <commit>         查看某个 commit 关联的 promptings/runs/edits/merge events。
/git scan             扫描近期 commits，尝试通过 patch/file 匹配补充 commit_link。
/git stage-trace      暂存 .hutao canonical trace 文件。
```

`/git stage-trace` 用途：

```text
在 git commit 前确保 .hutao/manifest、refs、sessions、events、patches、native-session 等 canonical trace 文件被纳入提交。
```

说明：

```text
如果 agent 执行 git commit，Hutao 会尝试提前 stage trace 并提示未暂存状态。
commit_link 可能来自 observed_git_commit 或 /git scan，不应被视为绝对可靠。
```

---

### `/fork`

显式创建 forkSession。

```text
/fork
/fork prompting <id> --before
/fork prompting <id> --retry
/fork prompting <id> --after
/fork edit <id> --before
/fork edit <id> --after
/fork commit <hash>
```

无参数行为：

```text
打开 fork source menu：prompting / edit / commit。
选择来源后继续选择 ID 和 fork mode。
```

模式语义：

```text
prompting --before   回到该 prompting 发生前。
prompting --retry    保留旧 prompting，用同一文本重新尝试。
prompting --after    从该 prompting 完成后的结果继续。
edit --before        回到该 edit 发生前。
edit --after         接受该 edit 后继续。
commit               从指定 commit 状态创建 forkSession。
```

执行结果：

```text
1. 创建 Hutao forkSession metadata。
2. 尽量创建 repo-local native branch session。
3. 尽量让 native session id 与 Hutao forkSession id 都是同一个 fs_<id>。
4. native mapping 不足时进入 degraded fork，但不会伪造完整 native branch。
```

安全说明：

```text
/fork 会保留旧 session/prompting/edit 不变。
新输入、新 run、新 edit 写入新的 forkSession。
```

---

### `/merge`

预览或合并另一个 session/forkSession。

```text
/merge session
/merge session <session_id>
/merge session <session_id> --history
/merge session <session_id> --apply-edits
/merge session <session_id> --apply-tree
/merge session <session_id> --dry-run
/merge session <session_id> --wizard
/merge session <session_id> --resolve
/merge session <session_id> --skip
/merge session <session_id> --abort
```

无参数行为：

```text
/merge session 会打开 source session picker，然后进入 merge wizard。
```

默认行为：

```text
/merge session <id>
```

只 preview，不修改代码。

主要模式：

```text
--history       只导入 source session 历史，不修改代码。
--apply-edits   按 source edits 顺序 replay patch。
--apply-tree    应用 source final snapshot，生成一个 merge tree edit。
--wizard        进入交互式 merge wizard。
--dry-run       等价于 preview，只检查和展示，不修改代码。
--resolve       把当前 working tree diff 捕获为 merge resolution edit。
--skip          跳过最近一次冲突 edit，不应用代码变化。
--abort         记录 abort merge event，不应用代码变化。
```

安全行为：

```text
1. preview 永远不改代码。
2. --history 会确认，并明确提示 No code changes will be applied。
3. --apply-edits / --apply-tree 会先 preview changed files，再要求确认。
4. apply-edits / apply-tree 要求 working tree clean。
5. 发生冲突时停止，并提示 resolve / skip / abort。
6. skip last conflict 会再次确认，避免误跳过。
```

推荐：

```text
想参考另一个方案：/merge session <id> --history
想保留过程因果链：/merge session <id> --apply-edits
只关心最终文件结果：/merge session <id> --apply-tree
不确定时：/merge session <id> 或 /merge session <id> --wizard
```

---

### `/language`

切换 Hutao 菜单语言。

```text
/language
/language en
/language zh-CN
```

无参数行为：

```text
打开语言选择菜单。
```

保存位置：

```text
.hutao/cache/preferences.json
```

说明：

```text
HUTAO_LANG 环境变量可以临时覆盖语言偏好。
```

---

### `/doctor`

诊断和修复 Hutao trace 数据。

```text
/doctor
/doctor rebuild
/doctor --rebuild
```

用途：

```text
检查 .hutao/ 的结构、索引、路径、安全和 staging 状态。
```

检查内容：

```text
repo root
origin
manifest 是否存在
manifest untrusted flag
sessions 数量
events 数量
canonical trace staged/unstaged/untracked 状态
jsonl 行数
corrupt jsonl lines
absolute repo path leak
secret-looking trace leak
.pi/extensions 风险提示
```

修复能力：

```text
/doctor rebuild
/doctor --rebuild
```

会从 append-only events 重建 `.hutao/index`。

安全说明：

```text
/doctor 不会把历史 session 当成指令。
如果发现 .pi/extensions 存在，会提醒审查第三方 repo extension 风险。
```

---

## 合并策略说明

Hutao 的 merge 不是简单地执行 `git merge`。它合并的是 **session/forkSession 中的 AI 开发历史和可选代码变化**。

核心原则：

```text
1. 旧 session 不变。
2. 旧 prompting/run/edit 不变。
3. merge 行为写成新的 merge event。
4. 如果产生代码变化，要么记录 applied source edits，要么生成 resolution/merge edit。
5. 默认只 preview，不改代码。
```

---

### Preview / 预览

```text
/merge session <id>
```

默认模式，只展示 source session 的情况，不修改代码。

preview 会关注：

```text
source session
source kind
parent session / fork_from
changed files
prompting/run/edit 数量
是否已有 applied/skipped edits
当前 working tree 是否可能阻止 apply
可用模式
```

适合：

```text
不确定是否要合并时先看影响范围。
```

---

### Import History / 只导入历史

```text
/merge session <id> --history
```

只把 source session 的历史导入当前 trace 视图，不修改代码。

特点：

```text
1. 不应用 patch。
2. 不修改 working tree。
3. 写入 mode=history_only 的 merge event。
4. native session 中追加 hutao_merge helper entry。
```

适合：

```text
参考另一个 fork 的探索过程。
让 agent 在后续上下文里看到另一条工作线。
暂时不采用代码。
只想保留“这个方案被考虑过”的历史。
```

---

### Apply Edits / 应用编辑过程

```text
/merge session <id> --apply-edits
```

按 source session 中 edit 的顺序 replay patch。

这是推荐的代码合并方式。

优点：

```text
1. 保留 edit 因果链。
2. 冲突能定位到具体 edit。
3. 单个 applied edit 更容易解释和 revert。
4. 最符合 Prompting -> Run -> Edit 模型。
```

当前实现行为：

```text
1. 先 preview changed files，并要求确认。
2. 要求 working tree clean。
3. 跳过已经 applied/skipped 的 source edit。
4. 对每个 patch 先 apply check。
5. 成功则 apply patch 并记录 applied_edits。
6. 遇到冲突则停止，写 conflict merge event。
7. 用户可选择 resolve / skip / abort。
```

适合：

```text
想把另一个 fork 的过程和代码一起合回来。
希望保留 edit 级可追溯性。
希望冲突定位到具体 AI edit。
```

---

### Apply Final Snapshot / 应用最终快照

```text
/merge session <id> --apply-tree
```

不逐个 replay edit，而是应用 source session 的最终状态差异。

特点：

```text
1. 更关注结果，而不是过程。
2. 通常会生成一个 merge_apply_tree edit。
3. 如果最终快照已经存在，会把 source edits 标记为 skipped。
4. 如果无法 clean apply，会写 conflict merge event。
```

适合：

```text
只关心 source session 的最终文件结果。
source session 中间 edit 很乱。
apply-edits 冲突太多。
```

代价：

```text
edit 级可追溯性弱一些。
不适合作为默认策略。
```

---

### Resolve / Skip / Abort

冲突后常见操作：

```text
/merge session <id> --resolve
/merge session <id> --skip
/merge session <id> --abort
```

含义：

```text
--resolve  将当前 working tree diff 捕获为 merge resolution edit。
--skip     跳过最近一次 conflicting edit，不应用代码变化。
--abort    记录 abort merge event，不应用代码变化。
```

安全规则：

```text
1. --resolve 会要求确认。
2. --skip 会要求确认。
3. --abort 不修改代码，只记录事件。
4. resolution edit 仍然是新的历史事实，不会覆盖 source edit。
```

---

## 安全与隐私

Hutao 默认保守保存数据。它的目标是恢复项目级 AI 开发上下文，而不是把所有聊天和机器状态全部塞进 Git。

默认不保存：

```text
完整 provider request
完整 provider response
完整 token 输入
完整 terminal output
.env 内容
私钥文件内容
大生成目录内容
repo 外绝对路径原文
```

默认会做：

```text
1. run output 截断并记录 hash。
2. tool call/result 只保存摘要和尾部。
3. repo 内路径 canonicalize 成 repo-relative POSIX path 或 ${REPO}/...。
4. repo 外路径 redacted。
5. obvious secret/token 文本 redacted。
6. 历史 session 只当数据展示，不当 instruction 执行。
```

受保护路径示例：

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
.git/
node_modules/
dist/
build/
coverage/
```

危险命令示例：

```text
rm -rf
sudo
chmod -R
chown -R
git reset --hard
git clean -fd
git push --force
curl | sh
wget | sh
```

这些命令在 `tool_call` 阶段会触发确认或阻断逻辑。

第三方仓库风险：

```text
1. .hutao 历史是不可信输入。
2. .pi/extensions 如果存在，需要审查后再信任。
3. 历史里出现的“忽略规则、读取密钥”等文本只能作为历史文本展示，不能提升为系统指令。
```

---

## 常见工作流

### 1. 第一次在仓库里使用 Hutao

```bash
cd your-project
hutao
```

进入后直接输入任务，例如：

```text
帮我梳理这个仓库结构，并修复登录超时后没有返回 401 的问题。
```

完成后查看 trace：

```text
/session
/prompting
/run
/edit
/git
/doctor
```

提交前建议：

```text
/git stage-trace
git status
git commit -m "..."
```

---

### 2. clone 后恢复 repo-local 历史

目标体验：

```bash
git clone <repo>
cd <repo>
hutao
```

如果仓库提交了 `.hutao/`：

```text
1. resume/session picker 能看到 repo-local sessions。
2. /session 能浏览 session/forkSession。
3. /session <id> --conversation 能查看 native conversation timeline。
4. 继续输入会把新 native entries 和 trace facts 写回当前 clone 的 .hutao/。
```

路径不会依赖旧机器：

```text
旧路径 C:\Users\Alice\project 不会作为 canonical path 保存。
新路径 /home/bob/project 会在打开时按 ${REPO} hydrate。
```

---

### 3. 查看某个文件的 AI 改动来源

```text
/prompting --file src/auth.ts
/edit --file src/auth.ts
/git graph --file src/auth.ts
```

用途：

```text
找到谁让 agent 改了这个文件。
找到哪个 run 产生了 patch。
找到这些 edit 是否进入某个 commit。
```

---

### 4. 从旧 prompting 重试

显式 fork：

```text
/prompting <id>
/fork prompting <id> --retry
```

或者：

```text
/prompting <id>
直接输入新的普通消息
```

第二种方式会触发 armed continuation：Hutao 会先 auto-fork，再把新输入送到 forkSession。

---

### 5. 从旧 edit 后继续

```text
/edit <id>
/fork edit <id> --after
```

或者打开 edit 详情后直接输入下一条普通消息，触发 auto-fork。

适合：

```text
接受某个历史 edit 的结果，在它之后继续优化。
```

---

### 6. 从旧 edit 前换一种改法

```text
/edit <id>
/fork edit <id> --before
```

适合：

```text
不想采用这个 edit，但想保留旧历史并尝试另一种实现。
```

---

### 7. 安全合并另一个 forkSession

先 preview：

```text
/merge session <id>
```

只导入历史：

```text
/merge session <id> --history
```

应用 edits：

```text
/merge session <id> --apply-edits
```

如果冲突：

```text
# 手动处理冲突后
/merge session <id> --resolve

# 或跳过最近冲突 edit
/merge session <id> --skip

# 或放弃本次 merge 流程
/merge session <id> --abort
```

---

### 8. revert 某个 edit

```text
/edit <id>
/edit revert <id>
```

Hutao 会先 preview reverse patch，不会直接改代码。

原则：

```text
旧 edit 保留。
revert 作为新的历史事实追加。
```

---

### 9. 诊断 trace 状态

```text
/doctor
/doctor rebuild
```

适合：

```text
检查 .hutao 是否完整。
检查 index 是否需要重建。
检查是否有绝对路径泄漏。
检查是否有 secret-like 文本。
检查 trace 文件是否未暂存。
```

---

### 10. 切换菜单语言

```text
/language
/language zh-CN
/language en
```

语言偏好保存在：

```text
.hutao/cache/preferences.json
```

---

## 开发与测试

### 安装依赖

```bash
npm install --ignore-scripts
```

### 构建

根仓库构建：

```bash
npm run build
```

只构建 coding-agent workspace：

```bash
npm run build --workspace hutao-agent
```

构建产物会生成到：

```text
packages/coding-agent/dist/
```

CLI 入口验证：

```bash
node packages/coding-agent/dist/cli.js --version
node packages/coding-agent/dist/cli.js --help
```

### Check

```bash
npm run check
```

根仓库 check 包含：

```text
biome check
dependency pin check
TypeScript import check
shrinkwrap check
tsgo --noEmit
browser smoke check
```

注意：根仓库 `npm run check` 可能会执行格式化写入行为；需要只读验证时应先确认工作区状态，或改用更小范围的 targeted test/build。

### 测试

全 workspace 测试：

```bash
npm test
```

coding-agent workspace 测试：

```bash
npm test --workspace hutao-agent
```

Hutao 重点测试：

```bash
npm test --workspace hutao-agent -- test/hutao/core.test.ts
npm test --workspace hutao-agent -- test/hutao/integration.test.ts
npm test --workspace hutao-agent -- test/session-manager/file-operations.test.ts
```

常见重点覆盖：

```text
PathMapper repo-relative / Windows normalize / external path redact
EventStore append/read JSONL
GitAdapter diff detection / .hutaoignore
TraceRecorder prompting/run/edit/commit_link/native_entry_link
ConversationStore repo-local native conversation reconstruction
ConversationHydrator untrusted nextTurn context
ForkSessionManager before/after/retry/commit fork
HutaoForkCoordinator native + Hutao fs_<id> alignment
ForkTargetResolver historical target mapping
HistoricalContinuationCoordinator armed auto-fork
MergeManager preview/history/apply-edits/apply-tree/skip/resolve/abort
RevertManager reverse patch
SecretGuard redaction
TraceStager git commit 前 trace stage
SessionManager repo-local native storage/hydration/listForResume
```

### 手动验收建议

基础验收：

```bash
npm install --ignore-scripts
npm run build
npm run check
npm link
hutao --version
hutao --help
```

demo repo 验收：

```bash
mkdir demo
cd demo
git init
hutao
```

完成一次包含文件修改的 agent 工作后，应出现：

```text
.hutao/manifest.json
.hutao/refs/current-session
.hutao/refs/sessions.json
.hutao/sessions/<session>/session.json
.hutao/sessions/<session>/events.jsonl
.hutao/sessions/<session>/native-session.jsonl
.hutao/sessions/<session>/patches/<edit>.patch
```

并验证：

```text
/session 能看到 session/forkSession。
/prompting 能看到 human input。
/run 能看到 tool execution。
/edit 能看到 patch。
/git 能看到 commit link 或 dirty/uncommitted edit 状态。
/fork edit <id> --after 能创建 forkSession。
/merge session <id> 默认 preview。
/merge session <id> --history 不改代码。
/merge session <id> --apply-edits 会先 preview/confirm。
/doctor 能检查路径泄漏、secret-like 文本、trace staging 状态。
```

clone/resume 验收：

```text
1. 在路径 A 创建 repo-local session 并提交 .hutao/。
2. clone 到路径 B。
3. 运行 hutao。
4. resume/session picker 中能看到 repo-local session。
5. 打开后能看到原生聊天/native entries。
6. 继续输入后，新数据写回路径 B 的 .hutao/。
7. .hutao/ 中不应出现路径 A 或路径 B 的绝对路径作为 canonical path。
```

---

## 已验证内容

当前工作中已经验证过的关键点包括：

```text
1. hutao CLI help/version 正常。
2. /hutao command 已注册，且与 /action 共用同一个 handler。
3. menu-first workflow 可走通：/action -> Runs、/action -> Git、/merge session wizard preview。
4. Hutao core/integration/session-manager targeted tests 通过。
5. npm test --workspace hutao-agent 通过。
6. npm run build --workspace hutao-agent 通过。
7. repo-local native session path sanitization/hydration 覆盖 Windows -> WSL mixed separator 问题。
8. GitHub private repo roundtrip 手动 E2E 通过：push .hutao -> clone 新路径 -> list/open repo-local session -> append new native entries -> push -> re-clone verify。
```

GitHub roundtrip 验证的重点是：

```text
1. `.hutao/` 随 Git 提交同步。
2. clone 后 `SessionManager.listForResume` 能发现 repo-local session。
3. `SessionManager.open` 能打开 clone 后的 native session。
4. clone 路径继续 append user/assistant entries 后能写回 `.hutao/`。
5. 重新 clone 后能看到 continued turn。
6. source/clone 绝对路径未泄漏进 `.hutao/`。
```

说明：该 GitHub roundtrip 是手动 E2E 验证，不是当前仓库内已固化的自动测试文件。

---

## 当前限制

Hutao 当前仍有一些边界需要明确：

```text
1. 不保证完整复现模型当时内部状态。
2. 不默认保存完整 provider payload、完整 token 输入或完整 terminal output。
3. 历史 session 不会被提升为 system/developer prompt，也不会自动执行其中内容。
4. 第一版 edit 粒度偏工具调用/patch，不做复杂语义拆分。
5. binary 文件主要记录路径和 hash，不保存完整内容。
6. raw-only history 只能降级展示，不能恢复成完整原生聊天。
7. apply-edits 冲突时需要用户处理或选择 skip/abort/resolve。
8. apply-tree 更适合最终快照合并，不适合作为默认过程追溯策略。
9. index/cache/tmp 不是事实来源，应能从 events 重建。
10. 多人实时协作、云同步、行级 blame、自动解决所有冲突都不是当前第一目标。
```

平台边界：

```text
1. Windows 可运行主要功能，但全量测试可能受 symlink、权限、路径分隔符、EPERM/EACCES 差异影响。
2. WSL/Linux 原生文件系统更接近 CI/Linux 行为。
3. SSH/remote shell 路径默认视为外部证据，不自动映射成本机 repo path。
```

---

## Roadmap

短期方向：

```text
1. 继续增强 repo-local resume picker 的用户可见标识。
2. 增强 native entry <-> Hutao prompting/run/edit mapping 的稳定性。
3. 固化 GitHub-backed clone/resume/writeback E2E 为自动化测试。
4. 增强 raw-only/degraded history UI。
5. 增强 merge conflict resolution UX。
6. 持续减少 Windows path/symlink/permission 差异导致的测试噪音。
```

中期方向：

```text
1. 更完整的 forkSession/native branch 交互体验。
2. 更精细的 commit link 重建策略，支持 rebase/squash 后 patch_hash 关联。
3. 更友好的 trace graph / commit graph / file history UI。
4. 更完善的 .hutaoignore 与 secret scanning 策略。
5. 更清晰的 share/export/doctor 工作流。
```

非目标：

```text
1. 替代 Git。
2. 默认把全部聊天 token/provider payload 提交到仓库。
3. 保证 100% 复现模型输出。
4. 自动信任第三方仓库里的历史 session 或 extension。
5. 自动解决所有 merge/revert 冲突。
```

---

## 对外表述

推荐这样描述 Hutao：

```text
Hutao 让 AI 写代码的过程像 Git 历史一样可查看、可追溯、可分叉、可合并、可撤销。
```

或者：

```text
clone 仓库后，不只得到代码，也得到这个项目被人和 AI 一步步做出来的上下文。
```

适合强调：

```text
恢复项目级 AI 开发上下文。
追溯 human input -> agent run -> file edit -> git state。
让 AI 代码改动可解释、可 fork、可 merge、可 revert。
把 repo-local session 和 native conversation state 随 Git 一起迁移。
```

不要这样宣传：

```text
完整恢复 AI 思考。
100% 复现 agent 行为。
替代 Git。
默认提交全部聊天 token。
默认保存完整 provider request/response。
自动信任历史 session 指令。
```

---

## License and upstream

本项目基于 [earendil-works/pi](https://github.com/earendil-works/pi) 改造。上游基础能力归原项目贡献者所有；Hutao 相关 repo-local trace / session / fork / merge 产品化改造在此基础上继续演进。
