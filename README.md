# hutao-agent / 胡桃 Agent

中文 | [English](README.en.md)

## 致谢与用途声明

本项目框架来源于 [earendil-works/pi](https://github.com/earendil-works/pi)。感谢原项目提供 coding agent harness、TUI、extension system、tool runtime、LLM provider abstraction、session tree 等基础能力。

`hutao-agent` 是在 Pi 基础上进行产品化改造和验证的 repo-local AI coding agent trace system。它的目标不是替代 Git，也不是完整复现模型的全部 token/思考过程，而是把 AI 参与开发时最重要的项目级上下文保存到仓库里：人类输入、agent 运行、文件改动、patch、fork、merge、revert 与 Git 状态。

---

## 一句话介绍

`hutao-agent` 是一个与 Git 仓库绑定的 AI coding agent。它不仅能帮你读文件、跑命令、修改代码，还会把开发过程记录到仓库内的 `.hutao/`：

```text
Human Prompting → Agent Run → File Edit → Patch / Git State → Commit Link → Fork / Merge / Revert
```

典型体验：

```bash
git clone <repo>
cd <repo>
hutao
```

如果仓库已经包含 `.hutao/` 历史，Hutao 启动后会读取历史 sessions、promptings、runs、edits、forkSessions、mergeEvents，并通过 `/session`、`/prompting`、`/edit`、`/git` 等命令查看这些记录。

---

## 当前状态

当前版本聚焦于 **repo-local trace、历史查看、历史 fork、armed continuation、merge/revert trace 对齐**。

已经实现并接入的能力包括：

```text
1. hutao CLI 入口。
2. Git repo root 自动发现。
3. .hutao/ 初始化、读取与写入。
4. prompting / run_started / run_finished / edit / commit_link 等事件记录。
5. 工具调用前后工作区 diff 检测，产生 patch-based edit。
6. repo-relative POSIX path 存储策略。
7. slash commands: /session /prompting /run /edit /git /fork /merge /action /language /doctor。
8. 历史 prompting/edit 查看不 fork。
9. 显式 /fork 可从 prompting、edit、commit 创建 forkSession。
10. 查看历史后 armed continuation：下一次普通输入会先 auto-fork，再继续工作。
11. native session branch 与 Hutao forkSession 尽量使用同一个 fs_<id>。
12. native mapping 缺失时进入 degraded mode，不伪装成完整 native fork。
13. /merge session 默认 preview，不改代码。
14. /merge session --history / --apply-edits / --apply-tree / --wizard / --resolve / --skip / --abort。
15. /edit revert <id> 安全预览和 reverse patch revert。
16. /git stage-trace 与 git commit 前 trace 自动暂存提醒。
17. /doctor 诊断、索引重建、敏感路径/绝对路径检查。
18. /language 中英文菜单切换。
```

仍然保守处理或处于持续增强中的能力：

```text
1. 不承诺 100% 复现模型当时状态。
2. 不默认保存完整 provider payload、完整 terminal output 或完整 token 输入。
3. apply-tree 已可用，但定位为高级/谨慎使用策略。
4. degraded native mapping、复杂冲突恢复和真实终端 smoke 覆盖仍在继续增强。
5. Windows 全量测试里仍有部分路径、symlink、权限类历史问题；Linux/WSL 原生文件系统更接近目标运行环境。
```

---

## 安装

### 环境要求

根仓库与 `packages/coding-agent` 当前要求：

```text
Node.js >= 22.19.0
npm
Git
```

检查：

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

### 本地全局安装

如果仓库内已经有打包产物：

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

或者先重新打包：

```bash
npm pack --workspace packages/coding-agent
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

验证：

```bash
hutao --version
which hutao      # macOS / Linux
where hutao      # Windows PowerShell / CMD
```

### 模型与运行方式

Hutao 继承 Pi 的 provider/model 配置与交互模式。常见启动方式：

```bash
hutao                                  # 交互式 TUI
hutao "帮我解释这个仓库结构"           # 单次任务
hutao --provider openai --model gpt-4o
hutao --model anthropic/claude-sonnet-4-5
hutao --models "claude-*,gpt-4o"       # 限定 Ctrl+P 可切换模型范围
hutao --list-models
```

如果需要临时指定 API key：

```bash
hutao --provider openai --model gpt-4o --api-key "$OPENAI_API_KEY"
```

具体 provider、settings、extensions、TUI 使用方式仍沿用 Pi coding-agent 的基础能力；Hutao 在此基础上默认加载内置 trace extension。

### 开发模式

```bash
npm install --ignore-scripts
npm run build
npm run check
npm test --workspace packages/coding-agent
```

根仓库常用脚本：

```bash
npm run build     # 构建 tui / ai / agent / coding-agent
npm run check     # 格式、类型、依赖与 smoke 检查
npm run test      # 运行各 workspace 测试
```

---

## 快速开始

在任意 Git 仓库中运行：

```bash
cd your-project
hutao
```

开始一次普通 coding agent 工作，例如：

```text
帮我修复登录超时后没有返回 401 的问题，并补充测试。
```

Hutao 会在 agent 工作过程中记录：

```text
1. prompting：你输入了什么。
2. run：agent 调用了哪些工具、读了什么、跑了什么命令。
3. edit：哪些文件实际发生了变化，以及对应 patch。
4. commit_link：如果观察到 git commit，会把 commit 与相关 prompting/run/edit 关联。
```

之后可以查看：

```text
/session
/prompting
/run
/edit
/git
/doctor
```

---

## 核心概念

### Session

一次 agent 工作线。它包含 promptings、runs、edits、fork metadata、merge metadata、commit links 和 sanitized raw records。

Session 不等同于 Git branch，但可以与 native session branch / Git branch / commit 建立关系。

### Prompting

`prompting` 表示一次人类输入。

它回答：

```text
人当时想让 agent 做什么？
```

记录内容包括：

```text
用户输入文本、cwd、git_head、git_tree、git_status_summary、session_id、native anchor、创建时间、状态。
```

### Run

`run` 表示 agent 的一次工具执行或调试步骤。

它回答：

```text
agent 当时做了什么？
```

Hutao 当前记录 `run_started` 与 `run_finished`：

```text
tool name、tool_call_id、input_summary、command、cwd、before/after head、before/after tree、diff hash、输出摘要、输出尾部、状态、produced_edit_ids。
```

### Edit

`edit` 表示文件或工作区实际发生变化。

它回答：

```text
代码实际发生了什么变化？
```

Hutao 会保存：

```text
files、patch path、patch hash、parent prompting、parent run、before/after git state、状态、summary。
```

第一版规则是：一次编辑工具调用或一次会改变工作区的 bash run，可产生一个 edit。Hutao 不把所有 run 都叫 edit。

### Commit Link

`commit_link` 是 Git commit 与 prompting/run/edit 的引用关系。

当前支持：

```text
1. agent 执行 git commit 时，观察 HEAD 变化并记录 observed_git_commit。
2. /git scan 通过 patch/file 匹配补充 commit link。
```

Hutao 不把 commit 当作 prompting/run/edit 的物理容器，因为 commit 可能被 rebase、squash、amend，也可能混合人类手动改动。

### forkSession

从历史 prompting、edit 或 commit 继续工作时，Hutao 创建新的 `forkSession`。

硬规则：

```text
查看历史不会 fork。
基于历史继续工作必须 fork。
旧 session / prompting / edit 不会被覆盖。
```

### Armed Historical Continuation

当你打开历史 prompting 或 edit 详情时，Hutao 会把它设为一个 transient continuation target，但不会立刻 fork。

下一次普通交互输入到来时：

```text
1. Hutao 在 prompt 持久化前拦截输入。
2. 根据 armed target 创建 forkSession。
3. 尽量创建对应 native branch session。
4. 在新 fork 上重新发送原始输入。
5. 如果 fork 被阻止，会恢复输入到编辑器，避免写入旧历史。
```

Slash command 和 extension-originated input 不会触发 auto-fork。

### Merge Event

`merge` 表示把另一个 session / forkSession 的历史或代码结果合并到当前 session 的事件。

默认 merge 只 preview，不改代码。

### Revert Event

revert 不删除旧 edit，而是追加事件，并在需要时生成新的 revert edit。

---

## `.hutao/` 数据目录

Hutao 的 canonical trace 存在当前 Git 仓库内：

```text
.hutao/
├── manifest.json
├── refs/
│   ├── current-session
│   └── sessions.json
├── sessions/
│   └── <sess_or_fs_id>/
│       ├── session.json
│       ├── events.jsonl
│       ├── raw.jsonl
│       └── patches/
│           └── <edit_id>.patch
├── index/
├── cache/
└── tmp/
```

事实来源：

```text
.hutao/manifest.json
.hutao/refs/current-session
.hutao/refs/sessions.json
.hutao/sessions/*/session.json
.hutao/sessions/*/events.jsonl
.hutao/sessions/*/patches/*.patch
```

`index/`、`cache/`、`tmp/` 是辅助数据，索引可以通过 `/doctor rebuild` 重建。

路径规则：

```text
canonical path 必须是 repo-relative POSIX path。
raw 文本中的 repo 内绝对路径会替换为 ${REPO}/...。
repo 外绝对路径默认 redacted。
```

---

## Slash Commands

### `/session`

列出 Hutao sessions / forkSessions。

```text
/session
/session <id>
```

详情会展示：

```text
metadata、summary、promptings、runs、edits、forks、merges、commit links。
```

### `/prompting`

查看人类输入历史。

```text
/prompting
/prompting <id>
/prompting --session <session_id>
/prompting --commit <commit_hash>
/prompting --file <path>
/prompting search <query>
```

打开某个 prompting 详情会 arm continuation target，但不会立即 fork。

### `/run`

查看 agent run 历史。

```text
/run
/run <id>
/run --session <session_id>
```

用于追溯 agent 当时调用了什么工具、命令、输出摘要以及关联 edits。

### `/edit`

查看文件改动历史。

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

打开某个 edit 详情会展示 patch、父 prompting/run、相关 commit、merge/revert 关系，并 arm continuation target。

`/edit revert <id>` 会先 preview reverse patch 与 dirty 状态，确认后才应用。

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

常用能力：

```text
/git             # 显示当前 HEAD、dirty 状态、commit links、recent edits。
/git <commit>    # 查看 commit 关联的 promptings / runs / edits。
/git scan        # 尝试通过 patch/file 匹配补充 commit links。
/git stage-trace # git commit 前暂存 .hutao canonical trace 文件。
```

### `/fork`

显式创建 forkSession。

```text
/fork prompting <id> --before
/fork prompting <id> --retry
/fork prompting <id> --after
/fork edit <id> --before
/fork edit <id> --after
/fork commit <hash>
```

语义：

```text
prompting --before：回到该 prompting 执行前。
prompting --retry ：保留旧 prompting，用同一文本重新尝试。
prompting --after ：从该 prompting 完成后的结果继续。
edit --before     ：回到该 edit 前。
edit --after      ：接受该 edit 后继续。
commit            ：从指定 commit 状态创建 forkSession。
```

Hutao 会尽量通过 `HutaoForkCoordinator` 同步创建 native fork，并让 native session 与 Hutao forkSession 使用同一个 `fs_<id>`。如果缺少 native entry mapping，则写入 degraded metadata。

### `/merge`

预览或合并另一个 session / forkSession。

```text
/merge session
/merge session <id>
/merge session <id> --history
/merge session <id> --apply-edits
/merge session <id> --apply-tree
/merge session <id> --dry-run
/merge session <id> --wizard
/merge session <id> --resolve
/merge session <id> --skip
/merge session <id> --abort
```

默认：

```text
/merge session <id>
```

只做 preview，不改代码。

三种主要策略：

```text
--history     只导入历史，不修改代码。
--apply-edits 按 source session 的 edit 顺序 replay patch。
--apply-tree  应用 source session 的最终快照差异，生成较大的 merge edit。
```

### `/action`

打开交互式动作菜单。

```text
/action edit <id>
/action prompting <id>
/action session <id>
/action run <id>
```

用于从详情页快速跳转查看 patch、parent prompting、fork、merge preview 等动作。

### `/language`

切换 Hutao 菜单语言。

```text
/language
/language en
/language zh-CN
```

偏好会保存到 `.hutao/cache/preferences.json`。也可以用环境变量 `HUTAO_LANG` 临时覆盖。

### `/doctor`

诊断和修复 Hutao trace 数据。

```text
/doctor
/doctor rebuild
/doctor --rebuild
```

检查内容包括：

```text
manifest、sessions、events、patches、index、trace staging 状态、绝对路径泄漏、secret-like 文本、untrusted flag。
```

---

## 合并策略说明

### Import History / 只导入历史

```text
/merge session <id> --history
```

只把 source session 的历史导入当前视图，不修改代码。

适合：

```text
参考另一个 fork 的探索过程。
让 agent 看到另一个方案的上下文。
暂时不采用代码。
```

### Apply Edits / 应用编辑过程

```text
/merge session <id> --apply-edits
```

按 source session 的 edit 顺序 replay patch。

优点：

```text
保留 edit 因果链。
冲突能定位到具体 edit。
单个 applied edit 更容易 revert。
```

这是推荐的代码合并方式。

### Apply Final Snapshot / 应用最终快照

```text
/merge session <id> --apply-tree
```

不逐个 replay edit，而是应用 source session 最终状态差异。

适合：

```text
只关心最终结果。
source session 中间过程较乱。
apply-edits 冲突太多。
```

代价：

```text
edit 级可追溯性弱一些，通常会形成一个较大的 merge edit。
```

---

## 架构介绍

### 总体分层

```text
CLI / TUI
  └─ Pi coding-agent runtime
      ├─ Tool runtime: read / grep / bash / edit / write / ...
      ├─ Extension system: events + slash commands + UI API
      └─ Hutao built-in extension
          ├─ Trace recording
          ├─ Repo-local event storage
          ├─ Git diff / patch / commit linkage
          ├─ Fork / continuation coordination
          ├─ Merge / revert managers
          └─ Safety / privacy guards
```

### 关键模块

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| Hutao extension | `packages/coding-agent/src/hutao/extension.ts` | 注册事件监听和 slash commands，接入 Pi runtime。 |
| Commands | `packages/coding-agent/src/hutao/commands.ts` | `/session`、`/prompting`、`/edit`、`/git`、`/fork`、`/merge` 等命令实现。 |
| TraceRecorder | `packages/coding-agent/src/hutao/trace-recorder.ts` | 记录 prompting、run、edit、commit_link、native_entry_link。 |
| EventStore | `packages/coding-agent/src/hutao/event-store.ts` | 初始化 `.hutao/`，append JSONL event/raw，维护 manifest 和 refs。 |
| SessionRegistry | `packages/coding-agent/src/hutao/session-registry.ts` | 读取/创建 session 与 forkSession metadata。 |
| GitAdapter | `packages/coding-agent/src/hutao/git-adapter.ts` | repo root、HEAD/tree、diff、patch check/apply、status、file snapshot。 |
| PathMapper | `packages/coding-agent/src/hutao/path-mapper.ts` | 绝对路径转 repo-relative、POSIX normalize、raw path redact。 |
| PatchStore | `packages/coding-agent/src/hutao/patch-store.ts` | 保存 edit patch 与 hash。 |
| IndexBuilder | `packages/coding-agent/src/hutao/index-builder.ts` | 从 append-only events 重建 `.hutao/index`。 |
| ReadModel | `packages/coding-agent/src/hutao/read-model.ts` | 聚合读取 sessions/events。 |
| ForkTargetResolver | `packages/coding-agent/src/hutao/fork-target-resolver.ts` | 将 historical prompting/edit 映射到 Hutao 和 native fork target。 |
| NativeForkManager | `packages/coding-agent/src/hutao/native-fork-manager.ts` | 通过 Pi native session API 创建 native fork。 |
| HutaoForkCoordinator | `packages/coding-agent/src/hutao/fork-coordinator.ts` | 统一协调 native fork 与 Hutao forkSession，复用同一个 `fs_<id>`。 |
| HistoricalContinuationCoordinator | `packages/coding-agent/src/hutao/historical-continuation-coordinator.ts` | 处理历史详情页 armed continuation 与下一次普通输入 auto-fork。 |
| ContinuationStore | `packages/coding-agent/src/hutao/continuation-store.ts` | 保存 transient armed continuation target。 |
| MergeManager | `packages/coding-agent/src/hutao/merge-manager.ts` | merge preview、history-only、apply-edits、apply-tree、abort。 |
| RevertManager | `packages/coding-agent/src/hutao/revert-manager.ts` | reverse patch revert，并追加 revert/edit 事件。 |
| CommitLinker | `packages/coding-agent/src/hutao/commit-linker.ts` | 通过 patch/file 匹配建立 commit links。 |
| TraceStager | `packages/coding-agent/src/hutao/trace-stager.ts` | 检查/暂存 `.hutao` canonical trace 文件。 |
| SecretGuard | `packages/coding-agent/src/hutao/secret-guard.ts` | 保护敏感路径、输出脱敏、截断。 |
| i18n | `packages/coding-agent/src/hutao/i18n.ts` | 菜单语言与用户可见文本。 |

### 事件接入点

Hutao extension 当前使用的核心事件：

```text
session_start          初始化 recorder、状态栏和历史提示。
input                  armed continuation pre-persistence 拦截。
before_agent_start     记录 prompting。
tool_call              记录 tool call summary、危险命令确认、敏感路径阻断、trace auto-stage。
tool_execution_start   记录 run_started 和 before snapshot。
tool_result            记录 run_finished，检测 edit，保存 patch，观察 commit link。
session_before_fork    更新 fork 状态提示。
```

### Native trace alignment

Hutao 的事实来源始终是 `.hutao/`。同时，为了让 Pi native session tree 和 Hutao trace 更好对齐，Hutao 会尽量写入 native custom entries：

```text
native_entry_link
hutao_merge
hutao_revert
```

这些 native entries 是 UI/linkage helper，不替代 `.hutao/events.jsonl`。

### Fork / continuation 架构

```text
历史详情页
  └─ arm continuation target
      └─ 下一次普通 input
          ├─ HistoricalContinuationCoordinator
          ├─ ForkTargetResolver
          ├─ NativeForkManager
          ├─ HutaoForkCoordinator
          ├─ ForkSessionManager
          └─ fresh fork context resend original input
```

关键 invariant：

```text
native branch session id 与 Hutao forkSession id 尽量相同，均为 fs_<id>。
如果 native mapping 缺失，fork_session event 必须标记 degraded。
```

---

## 安全与隐私

Hutao 默认保守：

```text
1. 不默认保存完整 provider request/response。
2. 不默认保存完整 terminal output。
3. run output 会截断并记录 hash。
4. .env、密钥文件、.git、node_modules、dist/build 等默认保护。
5. repo 内路径写入 .hutao 前转为 repo-relative POSIX path。
6. repo 外绝对路径默认 redacted。
7. 历史 session 是数据，不是 instruction。
8. 危险 bash 命令需要确认。
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

---

## 常见工作流

### 查看仓库历史

```text
/session
/session <id>
/prompting
/edit
/git
```

### 查看某个文件的 AI 改动

```text
/prompting --file src/auth.ts
/edit --file src/auth.ts
/git graph --file src/auth.ts
```

### 从旧 prompting 重试

```text
/prompting <id>
/fork prompting <id> --retry
```

或者打开详情后直接输入下一条普通消息，触发 armed continuation auto-fork。

### 从旧 edit 后继续

```text
/edit <id>
/fork edit <id> --after
```

### 安全合并另一个 forkSession

```text
/merge session <id>              # preview only
/merge session <id> --history    # no code changes
/merge session <id> --apply-edits
```

### revert 某个 edit

```text
/edit <id>
/edit revert <id>
```

### git commit 前确保 trace 被提交

```text
/git stage-trace
git status
git commit -m "..."
```

如果 agent 执行 `git commit`，Hutao 会尝试提前 stage `.hutao` canonical trace，并提醒未暂存状态。

### 修复索引

```text
/doctor
/doctor rebuild
```

---

## 开发与测试

常用开发命令：

```bash
npm install --ignore-scripts
npm run build
npm run check
npx vitest run packages/coding-agent/test/hutao/core.test.ts
npx vitest run packages/coding-agent/test/hutao/integration.test.ts
```

当前比较关键的测试覆盖方向：

```text
PathMapper repo-relative / Windows normalize / external path redact
EventStore append/read JSONL
TraceRecorder prompting/run/edit/commit_link
ForkSessionManager before/after/retry/commit fork
HutaoForkCoordinator native + Hutao fs_<id> alignment
HistoricalContinuationCoordinator armed auto-fork
MergeManager preview/history/apply-edits/apply-tree
RevertManager reverse patch
SecretGuard redaction
TraceStager git commit 前 trace stage
```

平台说明：

```text
Windows 可运行主要功能，但部分全量测试可能受 symlink、path separator、EPERM/EACCES 差异影响。
WSL/Linux 原生文件系统更接近 CI/Linux 行为；运行全量测试前需要先 npm run build。
```

---

## 当前限制

```text
1. 不保证完整复现模型当时内部状态或全部 provider payload。
2. 历史 session 不会被提升为 system prompt，也不会自动执行其中内容。
3. 第一版 edit 粒度偏工具调用/patch，不做复杂语义拆分。
4. binary 文件第一版主要记录路径和 hash，不保存完整内容。
5. apply-edits 冲突时需要用户处理或选择 skip/abort/resolve。
6. apply-tree 更适合最终快照合并，不适合作为默认过程追溯策略。
7. index/cache/tmp 不是事实来源，应可重建。
```

---

## 对外表述

推荐这样理解 Hutao：

```text
让 AI 写代码的过程像 Git 历史一样可查看、可追溯、可分叉、可合并、可撤销。
```

不要把它描述为：

```text
完整恢复 AI 思考。
100% 复现 agent 行为。
替代 Git。
默认提交全部聊天 token 或 provider payload。
```

Hutao 的核心价值是：

```text
clone 仓库后，不只得到代码，也得到这个项目被人和 AI 一步步做出来的上下文。
```
