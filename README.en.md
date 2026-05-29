# hutao-agent / HuTao Agent

[中文](README.md) | English

## Acknowledgements and purpose statement

This project is based on pi-agent (`earendil-works/pi`). We thank the original project for providing the coding agent harness, TUI, extension system, tool runtime, LLM provider abstraction, and related foundations.

`hutao-agent` is currently a validation demo. It exists to validate the brilliant idea proposed by user “HuTaoJiang” (https://github.com/zyf2007): making AI coding agent prompting, runs, edits, forks, merges, and reverts traceable, forkable, mergeable, and recoverable like Git history.

This framework is only for idea validation. It is not a formal replacement for the original pi-agent project and does not represent the original project's position.

---

`hutao-agent` is a Git-repository-bound AI coding agent. It can read files, run commands, edit code, and record what the human asked, what the agent did, what files actually changed, and how those changes relate to Git commits inside `.hutao/`.

CLI command:

```bash
hutao
```

Typical workflow:

```bash
git clone <repo>
cd <repo>
hutao
```

If the repository already contains `.hutao/` history, Hutao can load previous sessions, promptings, runs, edits, fork sessions, merge events, and their relationships to Git commits, branches, and merges.

---

## Table of contents

- [What is hutao-agent?](#what-is-hutao-agent)
- [Key features](#key-features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Storage layout](#storage-layout)
- [Slash command reference](#slash-command-reference)
- [Merge strategies](#merge-strategies)
- [Safety and privacy](#safety-and-privacy)
- [Common workflows](#common-workflows)
- [Troubleshooting](#troubleshooting)
- [Current status](#current-status)

---

## What is hutao-agent?

`hutao-agent` is not just a chat log saver. It is a repository-local, Git-native, traceable, forkable, mergeable, and revertable AI coding agent trace system.

A repository should not only store code and Git commit history. It should also be able to store how the project was built step by step by humans and AI.

Hutao focuses on this chain:

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

It helps answer:

```text
What did the human ask at the time?
Which files did the agent read?
Which commands did the agent run?
Which tool calls actually changed files?
What patch did each edit produce?
Which commit later included the edit?
What did a fork session try?
Can another session be previewed or merged back?
Can a specific edit be reverted?
Can the history still be understood after cloning to another path?
```

---

## Key features

### 1. Stable command: `hutao`

The user-facing command is:

```bash
hutao
```

### 2. Repository-local trace: `.hutao/`

Hutao trace data is stored under `.hutao/` inside the current Git repository. It can move with the repository through clone, fork, and merge.

### 3. Prompting / Run / Edit model

Hutao separates human intent, agent actions, and actual file changes.

```text
Prompting = human input
Run       = agent execution action
Edit      = actual file change
```

### 4. Patch-based edit tracking

Each edit stores patch, patch hash, before/after Git state, and links to its parent prompting and run.

### 5. Git-native commit links

Hutao does not replace Git. It links promptings, runs, and edits to Git commits.

### 6. Fork session

Continuing from an old prompting, edit, or commit creates a new `forkSession`. Old history is not mutated.

### 7. Merge session

Hutao supports preview, history-only import, apply-edits, and apply-tree merge modes. The default merge command is preview-only and does not modify code.

### 8. Revert without deleting history

Reverting an edit does not delete the original edit. Hutao appends new events and, if needed, a new edit.

### 9. Conservative safety and privacy defaults

By default, Hutao does not store full provider payloads, does not store full terminal output, avoids sensitive files such as `.env`, and uses repository-relative POSIX paths.

### 10. Default tone

Hutao remains a professional coding agent, but uses a warmer and cuter younger-sister style by default. It naturally addresses the user as “哥哥”, avoids emoji and kaomoji, and never lets tone override correctness, safety, or technical quality.

---

## Installation

### Prerequisites

Hutao is distributed as a Node.js/npm CLI package. Before installation, install:

```text
Node.js 20+
npm
Git
a usable terminal
```

Node.js 22 LTS or newer is recommended.

Check versions:

```bash
node --version
npm --version
git --version
```

Package artifact in this repository:

```text
packages/coding-agent/hutao-agent-0.77.0.tgz
```

Local copied package:

```text
D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz
```

---

### Windows installation

#### 1. Install Node.js and Git

Option 1: install from official websites.

```text
Node.js: https://nodejs.org/
Git for Windows: https://git-scm.com/download/win
```

Option 2: use winget.

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

After installation, reopen PowerShell and check:

```powershell
node --version
npm --version
git --version
```

#### 2. Install Hutao from repository tgz

If you are in the repository root:

```powershell
cd D:\OneDrive\Desktop\hutao-agent.__tmp_inspect
npm install -g --ignore-scripts .\packages\coding-agent\hutao-agent-0.77.0.tgz
```

If you use the copied desktop package:

```powershell
npm install -g --ignore-scripts "D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz"
```

#### 3. Verify installation

```powershell
where hutao
hutao --version
```

Expected output:

```text
0.77.0
```

Windows npm usually creates these command shims:

```text
C:\Users\<you>\AppData\Roaming\npm\hutao.cmd
C:\Users\<you>\AppData\Roaming\npm\hutao.ps1
```

#### 4. PATH troubleshooting

If `hutao` is not recognized, close and reopen PowerShell first.

Then check npm global paths:

```powershell
npm config get prefix
where npm
where hutao
```

Ensure this directory is in Windows PATH:

```text
C:\Users\<you>\AppData\Roaming\npm
```

If PowerShell blocks `hutao.ps1` because of execution policy, use:

```powershell
hutao.cmd --version
```

Or adjust current-user execution policy:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

#### 5. Start

```powershell
mkdir D:\hutao-demo
cd D:\hutao-demo
git init
hutao
```

---

### macOS installation

#### 1. Install Homebrew, Node.js, and Git

If Homebrew is not installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install Node.js and Git:

```bash
brew install node git
```

Check versions:

```bash
node --version
npm --version
git --version
```

#### 2. Get the repository

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 3. Install from repository tgz

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

#### 4. Verify

```bash
which hutao
hutao --version
```

Expected output:

```text
0.77.0
```

#### 5. npm global PATH troubleshooting

Check npm global prefix:

```bash
npm config get prefix
```

Common global bin directories:

```text
/usr/local/bin
/opt/homebrew/bin
~/.npm-global/bin
```

If `hutao` is not found, add npm global bin to your shell profile.

zsh example:

```bash
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 6. Start

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### Linux Debian / Ubuntu-family installation

Applies to:

```text
Debian
Ubuntu
Linux Mint
Pop!_OS
Zorin OS
Kali and other Debian/Ubuntu-family distributions
```

#### 1. Install Git and basic tools

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential
```

#### 2. Install Node.js

Recommended: install Node.js 22 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Check versions:

```bash
node --version
npm --version
git --version
```

#### 3. Get the repository

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 4. Install Hutao

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

If global install has permission issues, configure a user-level npm prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

If using zsh:

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 5. Verify

```bash
which hutao
hutao --version
```

#### 6. Start

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### Linux Arch / Manjaro-family installation

Applies to:

```text
Arch Linux
Manjaro
EndeavourOS
Garuda Linux and other Arch-family distributions
```

#### 1. Install Node.js, npm, and Git

```bash
sudo pacman -Syu
sudo pacman -S --needed nodejs npm git base-devel
```

Check versions:

```bash
node --version
npm --version
git --version
```

If the repository Node.js version is too old, use nvm or another Node version manager to install Node.js 22+.

#### 2. Get the repository

```bash
git clone https://github.com/hongyue0721/hutao-agent.git
cd hutao-agent
```

#### 3. Install Hutao

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

If global install has permission issues, use a user-level npm prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

zsh users:

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

#### 4. Verify

```bash
which hutao
hutao --version
```

#### 5. Start

```bash
mkdir hutao-demo
cd hutao-demo
git init
hutao
```

---

### Build and install from source

If you want to rebuild the package from source:

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

### Uninstall

```bash
npm uninstall -g hutao-agent
```

Verify command removal:

```bash
where hutao   # Windows
which hutao   # macOS/Linux
```

---

## Quick start

Create a Git repository and start Hutao:

```bash
mkdir demo
cd demo
git init
hutao
```

After startup, you can type natural-language tasks or use slash commands:

```text
/session      # choose sessions by direction-key menu, then inspect/resume/merge
/prompting    # choose promptings by direction-key menu, then inspect/retry/resume
/edit         # choose edits by direction-key menu, then view patch / continue / preview revert
/run
/git
/language     # switch menu language
/doctor
```

After an agent edit, files like these should appear:

```text
.hutao/manifest.json
.hutao/sessions/<session>/session.json
.hutao/sessions/<session>/events.jsonl
.hutao/sessions/<session>/patches/<edit>.patch
```

---

## Recent updates

The current package artifact includes these new capabilities:

```text
packages/coding-agent/hutao-agent-0.77.0.tgz
D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz
```

### Direction-key menu browsing

`/session`, `/prompting`, and `/edit` open direction-key selection menus by default. Normal browsing no longer requires copying low-level IDs. ID-based commands such as `/session <id>`, `/prompting <id>`, and `/edit <id>` remain available for debugging and scripting.

### Resume / continuation

When continuing from a historical session, prompting, or edit, Hutao creates a safe continuation `forkSession` and records new promptings, runs, and edits there instead of mutating pulled history.

Common entry points:

```text
/session      -> select a session -> Resume this session
/prompting    -> select a prompting -> Resume after this prompting
/edit         -> select an edit -> Continue from after this edit
```

### Menu language switching

New `/language` command:

```text
/language
/language en
/language zh-CN
```

The default language is Simplified Chinese. You can temporarily override it with an environment variable:

```bash
HUTAO_LANG=en hutao
HUTAO_LANG=zh-CN hutao
```

The preference is stored in:

```text
.hutao/cache/preferences.json
```

This is local preference data, not canonical trace data, and should generally not be committed.

### Startup history notice

If the repository already contains `.hutao/sessions`, startup shows:

```text
Found N Hutao sessions. Use /session to browse and resume.
```

This means history was discovered and can be browsed or continued through `/session`.

### Automatic trace staging

Before the agent runs `git commit`, Hutao attempts to stage canonical trace data:

```text
.hutao/manifest.json
.hutao/refs
.hutao/sessions
```

It does not stage by default:

```text
.hutao/index
.hutao/cache
.hutao/tmp
```

You can also run it manually:

```text
/git stage-trace
```

### Safer revert preview

`/edit revert <id>` and the edit menu action “Preview revert this edit” first show:

```text
impacted files
working tree status
git apply -R --check result
number of later same-file edits
```

The reverse patch is applied only after confirmation, and the original edit is not deleted.

### Windows / WSL / GitHub sync validation

The experiment repository validated that Windows `blog-test` and WSL `~/test-blog` can synchronize `.hutao/sessions` through GitHub. A session or forkSession created on one side can be pulled, read, and browsed on the other side.

Note: `.hutao/refs/current-session` currently syncs through Git as well. For concurrent multi-machine workflows, a future version may split this into a machine-local current-session ref.

---

## Core concepts

### Session

A `Session` is one line of agent work. It contains promptings, runs, edits, fork metadata, merge metadata, commit links, and related trace records.

A session is not the same as a Git branch, but it can be linked to Git branches and commits.

### Prompting

A `prompting` is a human input event. It answers: what did the human ask the agent to do?

It can be:

```text
a task request
a question
a correction
a continue request
a merge request
a fork request
```

Recorded fields include:

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

A `run` is one agent action or tool call. It answers: what did the agent do?

Examples:

```text
read file
grep / find / ls
bash command
edit tool
write tool
run tests
scan git diff
```

A run does not necessarily change files. An edit is created only when the worktree changes before and after the run.

### Edit

An `edit` is an actual file or worktree change. It answers: what changed in the code?

Recorded fields include:

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

A `commit_link` connects Git commits with promptings, runs, and edits. One commit may contain multiple promptings or edits, and an edit may remain uncommitted.

### forkSession

A `forkSession` continues from a historical node. It does not overwrite the old session. It creates a new work line.

### Merge event

A `merge` event records session merge behavior, including history-only, apply-edits, apply-tree, conflict, skip, resolve, and abort.

### Revert event

A revert appends history instead of deleting history. The original edit remains, and new events record the revert behavior.

---

## Storage layout

Hutao trace data is stored in:

```text
.hutao/
```

Typical layout:

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

Source of truth:

```text
.hutao/sessions/*/session.json
.hutao/sessions/*/events.jsonl
.hutao/sessions/*/patches/
```

`index/` and `cache/` can be rebuilt.

---

## Slash command reference

All commands below are used inside the Hutao interactive TUI.

---

### `/session`

List sessions and fork sessions in the current repository.

```text
/session
```

Shows:

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

Use when you want to see all AI work lines in the repository.

---

### `/session <id>`

Show details for one session or fork session.

```text
/session sess_01...
/session fs_01...
```

Shows:

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

List all promptings.

```text
/prompting
```

A prompting is a human input event.

---

### `/prompting <id>`

Show one prompting in detail.

```text
/prompting p_01...
```

Shows:

```text
original user input
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

Filter promptings by session.

```text
/prompting --session sess_01...
```

---

### `/prompting --commit <commit_hash>`

Filter promptings by commit.

```text
/prompting --commit abc123
```

Purpose: trace a Git commit back to the related human request.

---

### `/prompting --file <path>`

Filter promptings by file.

```text
/prompting --file src/auth.ts
```

Purpose: find which human requests affected a file.

---

### `/prompting search <query>`

Search prompting text.

```text
/prompting search token expiration
```

---

### `/run`

List agent runs.

```text
/run
```

A run is one tool call or execution action by the agent.

---

### `/run <id>`

Show one run in detail.

```text
/run r_01...
```

Shows:

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

Use this to inspect exactly what the agent did and whether it produced edits.

---

### `/edit`

List edits.

```text
/edit
```

An edit is an actual file change, not just any tool call.

---

### `/edit <id>`

Show one edit in detail.

```text
/edit e_01...
```

Shows:

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

Filter edits by session.

```text
/edit --session sess_01...
```

---

### `/edit --prompting <id>`

Filter edits by prompting.

```text
/edit --prompting p_01...
```

---

### `/edit --commit <hash>`

Filter edits by commit.

```text
/edit --commit abc123
```

---

### `/edit --file <path>`

Filter edits by file.

```text
/edit --file src/auth.ts
```

---

### `/edit --reverted`

Show reverted edits.

```text
/edit --reverted
```

---

### `/edit --conflicts`

Show conflict-related edits.

```text
/edit --conflicts
```

---

### `/edit revert <id>`

Revert an edit.

```text
/edit revert e_01...
```

Behavior:

```text
checks worktree safety
tries to reverse-apply the patch
appends revert events
records a new edit if files changed
does not delete the original edit
```

---

### `/git`

Show Hutao trace from a Git-centered view.

```text
/git
```

Shows:

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

Show Hutao links for a commit.

```text
/git abc123
```

Shows:

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

Show Git graph and Hutao trace tree.

```text
/git graph
```

Hierarchy:

```text
Commit
└── Prompting
    └── Run
        └── Edit
```

---

### `/git graph --file <path>`

Show Git graph filtered by file.

```text
/git graph --file src/auth.ts
```

---

### `/git graph --range <range>`

Show Git graph for a commit range.

```text
/git graph --range main~10..main
```

---

### `/git --file <path>`

Show Git/Hutao records related to a file.

```text
/git --file src/auth.ts
```

---

### `/git --range <range>`

Show Git/Hutao records for a commit range.

```text
/git --range abc123..def456
```

---

### `/git scan`

Scan Git commits and try to create Hutao commit links.

```text
/git scan
```

Purpose: after committing code, supplement `commit_link` records by patch/file matching.

---

### `/git stage-trace`

Safely stage Hutao canonical trace data.

```text
/git stage-trace
```

Stages `.hutao/manifest.json`, `.hutao/refs`, and `.hutao/sessions`; does not stage `.hutao/index`, `.hutao/cache`, or `.hutao/tmp`.

---

### `/fork prompting <id> --before`

Create a fork session before a prompting.

```text
/fork prompting p_01... --before
```

Use this to return to before the user input and try another path.

---

### `/fork prompting <id> --retry`

Retry the same prompting text.

```text
/fork prompting p_01... --retry
```

The original prompting is not overwritten.

---

### `/fork prompting <id> --after`

Continue after a prompting completed.

```text
/fork prompting p_01... --after
```

---

### `/fork edit <id> --before`

Create a fork session before an edit.

```text
/fork edit e_01... --before
```

Use this to redo the edit with a different implementation.

---

### `/fork edit <id> --after`

Continue after an edit.

```text
/fork edit e_01... --after
```

Use this to accept the edit and continue from it.

---

### `/fork commit <hash>`

Create a fork session from a Git commit.

```text
/fork commit abc123
```

---

### `/merge session`

Open the session merge entry.

```text
/merge session
```

---

### `/merge session <id>`

Preview merging a session. This does not modify code by default.

```text
/merge session fs_01...
```

Shows:

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

Import history only. No code changes.

```text
/merge session fs_01... --history
```

Best for reviewing another session, comparing attempts, letting the agent see another exploration history, or not adopting code yet.

---

### `/merge session <id> --apply-edits`

Replay source session patches in edit order.

```text
/merge session fs_01... --apply-edits
```

Behavior:

```text
checks clean working tree
reads ordered edits
skips already merged edits
runs git apply --check per patch
applies patches one by one
records applied/conflict/skipped
```

Recommended because it preserves edit causality, maps conflicts to specific edits, and allows individual applied edits to be reverted later.

---

### `/merge session <id> --apply-tree`

Apply the source session final result snapshot.

```text
/merge session fs_01... --apply-tree
```

Best when only the final result matters, intermediate edits are messy, or apply-edits has too many conflicts.

Tradeoff: edit-level traceability is weaker.

---

### `/merge session <id> --dry-run`

Run dry-run / preview without applying code.

```text
/merge session fs_01... --dry-run
```

---

### `/merge session <id> --wizard`

Open merge wizard.

```text
/merge session fs_01... --wizard
```

Options:

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

Capture a resolution edit after manually resolving conflicts.

```text
/merge session fs_01... --resolve
```

---

### `/merge session <id> --skip`

Skip the latest conflicting edit.

```text
/merge session fs_01... --skip
```

Behavior:

```text
records skipped edits
does not silently apply code
advances or completes the merge conflict workflow
```

---

### `/merge session <id> --abort`

Abort merge.

```text
/merge session fs_01... --abort
```

---

### `/action edit <id>`

Open the action menu for an edit.

```text
/action edit e_01...
```

Typical actions:

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

Open the action menu for a prompting.

```text
/action prompting p_01...
```

Typical actions:

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

Open the action menu for a session.

```text
/action session sess_01...
```

Typical actions:

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

Open the action menu for a run.

```text
/action run r_01...
```

Typical actions:

```text
view run details
view parent prompting
view produced edits
view related commits
```

---

### `/doctor`

Run Hutao diagnostics.

```text
/doctor
```

Checks:

```text
manifest presence
session/event readability
corrupt JSONL
index health
absolute path leaks
secret-looking leaks
whether .hutao should be treated as untrusted data
.pi/extensions risk warning
```

---

### `/language`

Switch Hutao menu language.

```text
/language
/language en
/language zh-CN
```

`/language` opens a direction-key menu. The preference is stored in `.hutao/cache/preferences.json`; it is local preference data, not canonical trace data.

---

### `/doctor rebuild`

Rebuild `.hutao/index`.

```text
/doctor rebuild
```

Rebuilds:

```text
.hutao/index/sessions.json
.hutao/index/promptings.json
.hutao/index/edits.json
.hutao/index/commits.json
.hutao/index/files.json
```

---

## Merge strategies

### Import History

Command:

```text
/merge session <id> --history
```

Imports source session trace history into the current view without code changes.

Best for:

```text
reviewing another approach
comparing fork results
not adopting code yet
```

### Apply Edits

Command:

```text
/merge session <id> --apply-edits
```

Replays source session patches one by one in edit order. This is the recommended code merge strategy.

Analogy:

```text
Follow the recipe step by step.
```

Pros:

```text
preserves causality
maps conflicts to specific edits
easy to revert individual edits
```

### Apply Final Snapshot

Command:

```text
/merge session <id> --apply-tree
```

Applies the source session final result as a snapshot instead of replaying each edit.

Analogy:

```text
Bring over the finished dish.
```

Best for:

```text
only the final result matters
intermediate edits are messy
apply-edits has too many conflicts
```

---

## Safety and privacy

### History is data, not instruction

`.hutao` history cloned from a third-party repository must be treated as untrusted input. Historical text can be displayed, searched, and compared, but must not become high-priority system instructions.

### Path policy

Canonical paths stored in `.hutao` must be repository-relative POSIX paths.

Good:

```text
src/auth.ts
packages/api/src/index.ts
```

Bad:

```text
C:\Users\Alice\project\src\auth.ts
/home/alice/project/src/auth.ts
```

### Sensitive files ignored by default

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

### Output truncation

Run output stores summaries, tails, hashes, and truncation metadata by default. Full terminal output is not stored by default.

### `.hutaoignore`

Use `.hutaoignore` to extend ignore rules and prevent sensitive or generated files from entering trace data.

---

## Common workflows

### Inspect repository AI history

```text
/session
/prompting
/run
/edit
/git graph
/doctor
```

### Trace a commit back to prompting

```text
/git <commit>
```

### Inspect AI edit history for a file

```text
/git graph --file src/auth.ts
/prompting --file src/auth.ts
/edit --file src/auth.ts
```

### Continue from an old edit

```text
/edit e_01...
/fork edit e_01... --after
```

### Retry an old prompting

```text
/prompting p_01...
/fork prompting p_01... --retry
```

### Safely merge another forkSession

```text
/merge session fs_01...
/merge session fs_01... --history
/merge session fs_01... --apply-edits
```

### Rebuild indexes

```text
/doctor rebuild
```

---

## Troubleshooting

### Windows does not recognize `hutao`

Verify global installation:

```bash
npm list -g --depth=0 hutao-agent
```

Check command shim:

```bash
where hutao
```

Reinstall from local package:

```bash
npm install -g --ignore-scripts "D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz"
```

Then close and reopen PowerShell.

### No models available

This means no provider/model is configured yet. Use the login flow or configure a model.

Possible command:

```text
/login
```

### `.hutao` exists but data looks wrong

```text
/doctor rebuild
```

### Merge conflicts

```text
/merge session <id> --resolve
/merge session <id> --skip
/merge session <id> --abort
```

### Dirty working tree

These operations usually need a clean working tree:

```text
fork from old state
revert edit
merge apply-edits
merge apply-tree
checkout historical state
```

Commit, stash, or manually save current changes first.

---

## Current package artifact

Package artifact in repository:

```text
packages/coding-agent/hutao-agent-0.77.0.tgz
```

Local copied path:

```text
D:\OneDrive\Desktop\新建文件夹\hutao-agent-0.77.0.tgz
```

Install:

```bash
npm install -g --ignore-scripts ./packages/coding-agent/hutao-agent-0.77.0.tgz
```

---

## Current status

Implemented:

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

Still staged for future cleanup:

```text
internal package names may still reference @earendil-works/pi-*
runtime config directory may still be .pi
.pi/extensions loading remains for compatibility
some docs/examples may still mention Pi internals
```

Hutao trace data itself always lives in:

```text
.hutao/
```

---

## License

If a LICENSE file exists in this repository, follow that license.

If no explicit LICENSE is present, obtain permission from the project owner before redistribution.
