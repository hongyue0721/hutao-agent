# hutao-agent / 胡桃 Agent

中文 | [English](README.en.md)

## 致谢与用途声明

本项目框架来源于 pi-agent（earendil-works/pi）。感谢原项目提供 coding agent harness、TUI、extension system、tool runtime、LLM provider abstraction 等基础能力。

`hutao-agent` 当前是一个验证性 demo，用于验证用户“胡桃酱”（https://github.com/zyf2007）提出的天才思路：让 AI coding agent 的 prompting、run、edit、fork、merge、revert 像 Git 历史一样可追溯、可分叉、可合并、可恢复。

本框架仅作为思路验证用途，不代表对原 pi-agent 的正式替代，也不代表原项目立场。

---

`hutao-agent` 是一个和 Git 仓库绑定的 AI coding agent。它不仅能帮你读文件、跑命令、改代码，还会把“人类输入了什么、agent 做了什么、文件实际改了什么、这些改动和 Git commit 有什么关系”记录到仓库内的 `.hutao/` 目录中。

启动命令：

```bash
hutao
```

典型使用方式：

```bash
git clone <repo>
cd <repo>
hutao
```

如果仓库已经包含 `.hutao/` 历史，Hutao 启动后可以读取历史 sessions、promptings、runs、edits、forkSessions、mergeEvents，以及它们和 Git commit / branch / merge 的关系。

---

## 目录

- [项目定位](#项目定位)
- [核心特点](#核心特点)
- [安装](#安装)
- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [数据目录](#数据目录)
- [指令详解](#指令详解)
- [合并策略](#合并策略)
- [安全与隐私](#安全与隐私)
- [常见工作流](#常见工作流)
- [故障排查](#故障排查)
- [当前状态](#当前状态)

---

## 项目定位

`hutao-agent` 的目标不是简单保存聊天记录，而是构建一个：

```text
repo-local、Git-native、可追溯、可 fork、可 merge、可 revert 的 AI coding agent trace system
```

也就是说，一个仓库不只保存代码和 Git commit 历史，还能保存这个项目是怎样被人类和 AI 一步步做出来的。

Hutao 关注这条链路：

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

它可以回答：

```text
当时人类让 agent 做了什么？
agent 当时读了哪些文件、跑了哪些命令、做了哪些工具调用？
哪些 run 真的改了文件？
每个 edit 的 patch 是什么？
这个 edit 后来进入了哪个 commit？
某个 forkSession 尝试了什么方案？
另一个 session 能不能 preview / merge 回来？
某个 edit 能不能单独 revert？
clone 到另一个目录后，还能不能理解这些历史？
```

---

## 核心特点

### 1. 稳定命令：`hutao`

最终用户命令是：

```bash
hutao
```

### 2. 仓库本地 trace：`.hutao/`

Hutao 的 trace 数据放在当前 Git 仓库内的 `.hutao/`。这些数据可以随仓库 clone、fork、merge。

### 3. Prompting / Run / Edit 三元模型

Hutao 严格区分人说了什么、agent 做了什么、文件实际变了什么。

```text
Prompting = 人类输入
Run       = agent 执行动作
Edit      = 文件实际改动
```

### 4. Patch-based edit tracking

每个 edit 会保存 patch、patch hash、before/after Git 状态、关联 prompting 和 run。

### 5. Git-native commit links

Hutao 不替代 Git，而是把 prompting / run / edit 和 Git commit 建立引用关系。

### 6. Fork session

从旧 prompting、edit 或 commit 继续工作时，Hutao 创建新的 `forkSession`，不会篡改旧历史。

### 7. Merge session

Hutao 支持 preview、history-only、apply-edits、apply-tree 等合并方式。默认 merge 只 preview，不改代码。

### 8. Revert without deleting history

revert edit 不会删除原 edit，而是追加新的事件和必要的新 edit。

### 9. 安全隐私默认保守

默认不保存完整 provider payload、不保存完整 terminal output、不记录 `.env` 等敏感文件，路径使用 repo-relative POSIX path。

### 10. 默认语气

Hutao 默认是专业 coding agent，但语气更温柔可爱，会自然叫“哥哥”，不使用 emoji 和颜文字，也不会让语气影响正确性、安全性和技术质量。

---

## 安装

### 安装前准备

Hutao 是 Node.js/npm 发布形态的命令行工具，安装前需要：

```text
Node.js 20+
npm
Git
一个可用终端
```

建议使用 Node.js 22 LTS 或更新版本。

检查版本：

```bash
node --version
npm --version
git --version
```

仓库内安装包：

```text
packages/coding-agent/hutao-agent-0.77.0.tgz
```

本机复制包：

```text
D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz
```

---

### Windows 安装

#### 1. 安装 Node.js 和 Git

方式一：从官网下载。

```text
Node.js: https://nodejs.org/
Git for Windows: https://git-scm.com/download/win
```

方式二：使用 winget。

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

安装后重新打开 PowerShell，检查：

```powershell
node --version
npm --version
git --version
```

#### 2. 从仓库 tgz 安装 Hutao

如果你在本仓库根目录：

```powershell
cd D:\OneDrive\Desktop\hutao-agent.__tmp_inspect
npm install -g --ignore-scripts .\packages\coding-agent\hutao-agent-0.77.0.tgz
```

如果你使用桌面复制包：

```powershell
npm install -g --ignore-scripts "D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz"
```

#### 3. 验证安装

```powershell
where hutao
hutao --version
```

期望输出：

```text
0.77.0
```

Windows npm 通常会生成这些入口：

```text
C:\Users\<you>\AppData\Roaming\npm\hutao.cmd
C:\Users\<you>\AppData\Roaming\npm\hutao.ps1
```

#### 4. PATH 排查

如果提示 `hutao` 不是可识别命令，先关闭并重新打开 PowerShell。

然后检查 npm 全局路径：

```powershell
npm config get prefix
where npm
where hutao
```

确认下面目录在 Windows PATH 中：

```text
C:\Users\<you>\AppData\Roaming\npm
```

如果 PowerShell 因执行策略拒绝运行 `hutao.ps1`，可以使用：

```powershell
hutao.cmd --version
```

或调整当前用户执行策略：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

#### 5. 启动

```powershell
mkdir D:\hutao-demo
cd D:\hutao-demo
git init
hutao
```

---

### macOS 安装

#### 1. 安装 Homebrew、Node.js、Git

如果还没有 Homebrew：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装 Node.js 和 Git：

```bash
brew install node git
```

检查版本：

```bash
node --version
npm --version
git --version
```

#### 2. 获取仓库

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 3. 从仓库 tgz 安装

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

#### 4. 验证

```bash
which hutao
hutao --version
```

期望输出：

```text
0.77.0
```

#### 5. npm global PATH 排查

查看 npm 全局 prefix：

```bash
npm config get prefix
```

常见全局 bin 目录：

```text
/usr/local/bin
/opt/homebrew/bin
~/.npm-global/bin
```

如果 `hutao` 找不到，把 npm global bin 加入 shell 配置。

zsh 示例：

```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 6. 启动

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### Linux Debian / Ubuntu 系安装

适用于：

```text
Debian
Ubuntu
Linux Mint
Pop!_OS
Zorin OS
Kali 等 Debian/Ubuntu 系发行版
```

#### 1. 安装 Git 和基础工具

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential
```

#### 2. 安装 Node.js

推荐使用 NodeSource 安装 Node.js 22：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

检查版本：

```bash
node --version
npm --version
git --version
```

#### 3. 获取仓库

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 4. 安装 Hutao

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

如果全局安装遇到权限问题，可以配置用户级 npm prefix：

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

如果使用 zsh：

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 5. 验证

```bash
which hutao
hutao --version
```

#### 6. 启动

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### Linux Arch / Manjaro 系安装

适用于：

```text
Arch Linux
Manjaro
EndeavourOS
Garuda Linux 等 Arch 系发行版
```

#### 1. 安装 Node.js、npm、Git

```bash
sudo pacman -Syu
sudo pacman -S --needed nodejs npm git base-devel
```

检查版本：

```bash
node --version
npm --version
git --version
```

如果仓库源里的 Node.js 版本过旧，可以使用 nvm 或其他 Node 版本管理器安装 Node.js 22+。

#### 2. 获取仓库

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 3. 安装 Hutao

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

如果全局安装遇到权限问题，使用用户级 npm prefix：

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

zsh 用户：

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 4. 验证

```bash
which hutao
hutao --version
```

#### 5. 启动

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### 从源码构建安装

如果你想基于源码重新打包：

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
npm install --ignore-scripts
cd packages/coding-agent
npm run build
npm pack
npm install -g --ignore-scripts ./hutao-agent-0.77.0.tgz
hutao --version
```

---

### 卸载

```bash
npm uninstall -g hutao-agent
```

验证命令是否移除：

```bash
where hutao   # Windows
which hutao   # macOS/Linux
```

---

## 快速开始

创建一个 Git 仓库并启动 Hutao：

```bash
mkdir demo
cd demo
git init
hutao
```

启动后可以直接输入自然语言任务，也可以使用 slash commands：

```text
/session
/prompting
/run
/edit
/git
/doctor
```

完成一次 agent 编辑后，通常会出现：

```text
.hutao/manifest.json
.hutao/sessions/<session>/session.json
.hutao/sessions/<session>/events.jsonl
.hutao/sessions/<session>/patches/<edit>.patch
```

---

## 核心概念

### Session

`Session` 是一次 agent 工作线，包含 promptings、runs、edits、fork metadata、merge metadata、commit links 等。

Session 不等于 Git branch，但可以和 Git branch / commit 关联。

### Prompting

`prompting` 是一次人类输入事件，回答“人当时想让 agent 做什么”。

它可以是：

```text
一次任务指令
一次问题
一次纠正
一次继续请求
一次 merge 请求
一次 fork 请求
```

记录字段包括：

```text
id
session_id
actor
text
cwd
git_head
git_tree
git_status_summary
created_at
status
related runs / edits / commits
```

### Run

`run` 是 agent 的一次动作或工具调用，回答“agent 当时做了什么”。

例子：

```text
read file
grep / find / ls
bash command
edit tool
write tool
run tests
scan git diff
```

Run 不一定改文件。只有 run 前后工作区发生变化时才会产生 edit。

### Edit

`edit` 是文件或工作区实际变化事件，回答“代码实际发生了什么变化”。

记录字段包括：

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
summary
```

### Commit link

`commit_link` 把 Git commit 和 prompting / run / edit 关联起来。一个 commit 可以包含多个 promptings 或 edits，一个 edit 也可能尚未进入 commit。

### forkSession

`forkSession` 是从历史节点继续工作的 session。它不会覆盖旧 session，而是创建新的工作线。

### Merge event

`merge` event 记录 session 合并行为，包括 history-only、apply-edits、apply-tree、conflict、skip、resolve、abort。

### Revert event

revert 是追加历史，不是删除历史。原 edit 保留，新事件记录撤销行为。

---

## 数据目录

Hutao trace 数据存放在：

```text
.hutao/
```

推荐结构：

```text
.hutao/
├── manifest.json
├── sessions/
│   └── sess_<id>/
│       ├── session.json
│       ├── events.jsonl
│       ├── raw.jsonl
│       └── patches/
│           ├── e_<id>.patch
│           └── e_<id>.patch.meta.json
├── refs/
│   ├── current-session
│   └── sessions.json
├── index/
│   ├── sessions.json
│   ├── promptings.json
│   ├── edits.json
│   ├── commits.json
│   └── files.json
├── cache/
└── tmp/
```

事实来源：

```text
.hutao/sessions/*/session.json
.hutao/sessions/*/events.jsonl
.hutao/sessions/*/patches/
```

`index/` 和 `cache/` 可以重建。

---

## 指令详解

下面所有命令都在 Hutao 交互式 TUI 内使用。

---

### `/session`

列出当前仓库中的 sessions 和 forkSessions。

```text
/session
```

显示内容：

```text
id
title
kind: session | forkSession
status
parent_session
fork_from
prompting count
run count
edit count
merge count
base git head
last git head
updated_at
```

使用场景：想看这个仓库有哪些 AI 工作线。

---

### `/session <id>`

查看某个 session 或 forkSession 的详情。

```text
/session sess_01...
/session fs_01...
```

显示内容：

```text
session metadata
summary
promptings
runs
edits
forks
merges
commit links
```

---

### `/prompting`

列出所有 prompting。

```text
/prompting
```

Prompting 是人类输入事件。

---

### `/prompting <id>`

查看某个 prompting 详情。

```text
/prompting p_01...
```

显示内容：

```text
原始用户输入
session id
created git head
cwd
git status summary
status
related runs
related edits
related commits
fork actions
merge usage
```

---

### `/prompting --session <session_id>`

按 session 过滤 promptings。

```text
/prompting --session sess_01...
```

---

### `/prompting --commit <commit_hash>`

按 commit 过滤 promptings。

```text
/prompting --commit abc123
```

用途：从 Git commit 反查当时人类让 agent 做了什么。

---

### `/prompting --file <path>`

按文件过滤 promptings。

```text
/prompting --file src/auth.ts
```

用途：查看哪些人类输入影响过某个文件。

---

### `/prompting search <query>`

搜索 prompting 文本。

```text
/prompting search token expiration
```

---

### `/run`

列出 agent runs。

```text
/run
```

Run 是 agent 的一次工具调用或执行动作。

---

### `/run <id>`

查看某个 run 详情。

```text
/run r_01...
```

显示内容：

```text
run id
session id
parent prompting
tool
tool_call_id
status
cwd
command
started_at
ended_at
before_head / after_head
before_tree / after_tree
before_worktree_diff_hash / after_worktree_diff_hash
related commits
produced edits
input summary
output summary
output tail
output_truncated
```

用途：定位 agent 当时具体做了什么、输出了什么、有没有产生 edit。

---

### `/edit`

列出 edits。

```text
/edit
```

Edit 是真实文件改动，不是普通工具调用。

---

### `/edit <id>`

查看某个 edit 详情。

```text
/edit e_01...
```

显示内容：

```text
summary
session
parent prompting
parent run
related commit
files
patch path
patch hash
before_tree
after_tree
status
merge/revert relation
patch preview
```

---

### `/edit --session <session_id>`

按 session 过滤 edits。

```text
/edit --session sess_01...
```

---

### `/edit --prompting <id>`

按 prompting 过滤 edits。

```text
/edit --prompting p_01...
```

---

### `/edit --commit <hash>`

按 commit 过滤 edits。

```text
/edit --commit abc123
```

---

### `/edit --file <path>`

按文件过滤 edits。

```text
/edit --file src/auth.ts
```

---

### `/edit --reverted`

查看已 revert 的 edits。

```text
/edit --reverted
```

---

### `/edit --conflicts`

查看冲突相关 edits。

```text
/edit --conflicts
```

---

### `/edit revert <id>`

撤销某个 edit。

```text
/edit revert e_01...
```

行为：

```text
检查工作区是否安全
尝试反向应用 patch
追加 revert event
如果产生文件变化，记录新的 edit
不会删除原 edit
```

---

### `/git`

显示 Git 视角下的 Hutao trace。

```text
/git
```

显示内容：

```text
current HEAD
working tree status
recent commits
linked promptings
linked runs
linked edits
uncommitted Hutao edits
```

---

### `/git <commit>`

查看某个 commit 的 Hutao 关联。

```text
/git abc123
```

显示内容：

```text
commit hash
subject
tree
parents
dirty status
link methods
linked promptings
linked runs
linked edits
merge resolution events
```

---

### `/git graph`

显示 Git graph 和 Hutao trace tree。

```text
/git graph
```

输出层级：

```text
Commit
└── Prompting
    └── Run
        └── Edit
```

---

### `/git graph --file <path>`

按文件显示 Git graph。

```text
/git graph --file src/auth.ts
```

---

### `/git graph --range <range>`

按 commit range 显示 Git graph。

```text
/git graph --range main~10..main
```

---

### `/git --file <path>`

查看某个文件相关的 Git / Hutao 记录。

```text
/git --file src/auth.ts
```

---

### `/git --range <range>`

查看某个 commit range 的 Git / Hutao 记录。

```text
/git --range abc123..def456
```

---

### `/git scan`

扫描 Git commits 并尝试建立 Hutao commit links。

```text
/git scan
```

用途：提交代码后，通过 patch/file match 补充 commit_link。

---

### `/fork prompting <id> --before`

从某个 prompting 发生前创建 forkSession。

```text
/fork prompting p_01... --before
```

用途：回到用户输入前，尝试另一种路线。

---

### `/fork prompting <id> --retry`

用同一条 prompting 文本重新尝试。

```text
/fork prompting p_01... --retry
```

注意：原 prompting 不会被覆盖。

---

### `/fork prompting <id> --after`

从某个 prompting 完成后继续。

```text
/fork prompting p_01... --after
```

---

### `/fork edit <id> --before`

从某个 edit 发生前创建 forkSession。

```text
/fork edit e_01... --before
```

用途：重做这个 edit，换一种实现。

---

### `/fork edit <id> --after`

从某个 edit 之后继续。

```text
/fork edit e_01... --after
```

用途：接受这个 edit，并在它基础上继续开发。

---

### `/fork commit <hash>`

从 Git commit 创建 forkSession。

```text
/fork commit abc123
```

---

### `/merge session`

打开 session merge 入口。

```text
/merge session
```

---

### `/merge session <id>`

预览合并某个 session。默认不改代码。

```text
/merge session fs_01...
```

显示内容：

```text
source session
source kind
parent session
fork_from
base git head/tree
result git head/tree
prompting count
run count
edit count
changed files
already merged?
current working tree dirty?
possible conflicts
available modes
```

---

### `/merge session <id> --history`

只导入历史，不修改代码。

```text
/merge session fs_01... --history
```

适合：参考另一个 session、比较不同尝试、让 agent 看到另一条探索历史、暂时不采用代码。

---

### `/merge session <id> --apply-edits`

按 source session 的 edit 顺序 replay patches。

```text
/merge session fs_01... --apply-edits
```

行为：

```text
检查 working tree 是否干净
读取 ordered edits
跳过已 merge edits
逐个 git apply --check
逐个应用 patch
记录 applied/conflict/skipped
```

推荐原因：保留 edit 因果链，冲突能定位到具体 edit，以后可以单独 revert 某个 applied edit。

---

### `/merge session <id> --apply-tree`

应用 source session 的最终结果快照。

```text
/merge session fs_01... --apply-tree
```

适合：只关心最终结果、中间 edits 太乱、apply-edits 冲突太多。

代价：edit 级可追溯性会弱一些。

---

### `/merge session <id> --dry-run`

执行 dry run / preview，不实际应用代码。

```text
/merge session fs_01... --dry-run
```

---

### `/merge session <id> --wizard`

打开 merge wizard。

```text
/merge session fs_01... --wizard
```

可选项：

```text
Preview only
Import History
Apply Edits
Apply Final Snapshot
Skip Last Conflict
Skip Last Conflict and Continue
Capture Resolution
Abort
```

---

### `/merge session <id> --resolve`

手动解决冲突后，捕获 resolution edit。

```text
/merge session fs_01... --resolve
```

---

### `/merge session <id> --skip`

跳过最近一次冲突 edit。

```text
/merge session fs_01... --skip
```

行为：

```text
记录 skipped edits
不静默应用代码
推进或完成 merge conflict workflow
```

---

### `/merge session <id> --abort`

中止 merge。

```text
/merge session fs_01... --abort
```

---

### `/action edit <id>`

打开 edit 的 action 菜单。

```text
/action edit e_01...
```

常见操作：

```text
view edit details
view patch
view parent prompting
view parent run
fork before edit
fork after edit
revert edit
```

---

### `/action prompting <id>`

打开 prompting 的 action 菜单。

```text
/action prompting p_01...
```

常见操作：

```text
view prompting details
view runs
view edits
fork before prompting
retry prompting
fork after prompting
```

---

### `/action session <id>`

打开 session 的 action 菜单。

```text
/action session sess_01...
```

常见操作：

```text
view session details
preview merge
import history
apply edits
apply tree
open merge wizard
```

---

### `/action run <id>`

打开 run 的 action 菜单。

```text
/action run r_01...
```

常见操作：

```text
view run details
view parent prompting
view produced edits
view related commits
```

---

### `/doctor`

运行 Hutao 诊断。

```text
/doctor
```

检查内容：

```text
manifest 是否存在
sessions/events 是否可读
JSONL 是否损坏
index 是否健康
是否有绝对路径泄漏
是否有疑似 secret 泄漏
.hutao 是否应视为不可信数据
.pi/extensions 风险提示
```

---

### `/doctor rebuild`

重建 `.hutao/index`。

```text
/doctor rebuild
```

重建文件：

```text
.hutao/index/sessions.json
.hutao/index/promptings.json
.hutao/index/edits.json
.hutao/index/commits.json
.hutao/index/files.json
```

---

## 合并策略

### Import History / 只导入历史

命令：

```text
/merge session <id> --history
```

只把 source session 的 trace 历史导入当前视图，不改代码。

适合：

```text
参考另一个方案
比较 fork 结果
暂时不采用代码
```

### Apply Edits / 应用编辑过程

命令：

```text
/merge session <id> --apply-edits
```

按 source session 的 edit 顺序逐个 replay patch。推荐作为默认代码合并策略。

类比：

```text
按菜谱步骤重新做一遍
```

优点：

```text
保留因果链
可定位冲突 edit
便于单独 revert
```

### Apply Final Snapshot / 应用最终快照

命令：

```text
/merge session <id> --apply-tree
```

不逐个 replay edit，而是把 source session 的最终结果作为快照合入当前工作区。

类比：

```text
直接把成品菜端过来
```

适合：

```text
只关心最终结果
中间 edit 很乱
apply-edits 冲突太多
```

---

## 安全与隐私

### 历史是数据，不是指令

从第三方仓库 clone 下来的 `.hutao` 历史必须视为不可信输入。历史文本可以展示、检索、比较，但不能变成高优先级 system instruction。

### 路径规则

写入 `.hutao` 的 canonical path 必须是 repo-relative POSIX path。

正确：

```text
src/auth.ts
packages/api/src/index.ts
```

错误：

```text
C:\Users\Alice\project\src\auth.ts
/home/alice/project/src/auth.ts
```

### 默认忽略敏感文件

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

### 输出截断

run output 默认保存摘要、尾部、hash、是否截断，不默认保存完整 terminal output。

### `.hutaoignore`

可以通过 `.hutaoignore` 扩展忽略规则，避免敏感或生成文件进入 trace。

---

## 常见工作流

### 查看仓库 AI 历史

```text
/session
/prompting
/run
/edit
/git graph
/doctor
```

### 从 commit 追溯 prompting

```text
/git <commit>
```

### 查看某个文件的 AI 改动历史

```text
/git graph --file src/auth.ts
/prompting --file src/auth.ts
/edit --file src/auth.ts
```

### 从旧 edit 继续

```text
/edit e_01...
/fork edit e_01... --after
```

### 重试旧 prompting

```text
/prompting p_01...
/fork prompting p_01... --retry
```

### 安全合并另一个 forkSession

```text
/merge session fs_01...
/merge session fs_01... --history
/merge session fs_01... --apply-edits
```

### 重建索引

```text
/doctor rebuild
```

---

## 故障排查

### Windows 识别不到 `hutao`

验证全局安装：

```bash
npm list -g --depth=0 hutao-agent
```

检查命令入口：

```bash
where hutao
```

从本地安装包重装：

```bash
npm install -g --ignore-scripts "D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz"
```

然后关闭并重新打开 PowerShell。

### 进入后提示没有模型

说明还没有配置 provider/model。可以使用登录流程或配置模型。

可能用到：

```text
/login
```

### `.hutao` 存在但数据不对

```text
/doctor rebuild
```

### merge 冲突

```text
/merge session <id> --resolve
/merge session <id> --skip
/merge session <id> --abort
```

### 工作区 dirty

下面操作通常需要 clean working tree：

```text
fork from old state
revert edit
merge apply-edits
merge apply-tree
checkout historical state
```

请先 commit、stash 或手动保存当前改动。

---

## 当前安装包

仓库内安装包：

```text
packages/coding-agent/hutao-agent-0.77.0.tgz
```

本机复制位置：

```text
D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz
```

安装：

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

---

## 当前状态

已实现：

```text
hutao CLI
Windows global install from tgz
.hutao trace storage
prompting/run/edit events
patch storage
session list/detail
prompting list/detail
run list/detail
edit list/detail
Git commit view and graph
commit link scan
fork sessions
merge preview
merge history-only
merge apply-edits
merge apply-tree
merge wizard
merge skip/resolve/abort
edit revert
doctor diagnostics
index rebuild
secret/path safety checks
```

仍然分阶段清理：

```text
internal package names may still reference @earendil-works/pi-*
runtime config directory may still be .pi
.pi/extensions loading remains for compatibility
some docs/examples may still mention Pi internals
```

Hutao trace 数据本身始终放在：

```text
.hutao/
```

---

## License / 许可证

如果仓库中存在 LICENSE 文件，请以该文件为准。

如果没有明确 LICENSE，请在重新分发前先获得项目所有者授权。
