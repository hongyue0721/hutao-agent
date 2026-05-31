# AGENT.md — Hutao implementation companion

> Authoritative product and engineering rules live in `AGENTS.md`.  
> This file is a short, repo-local execution companion for agents that open `AGENT.md` first.  
> If this file and `AGENTS.md` disagree, follow `AGENTS.md`.

---

## Current objective

Build `hutao-agent` as a repo-local, Git-native AI coding-agent trace and resume system.

Target user experience:

```text
git clone <repo>
cd <repo>
hutao
```

Hutao should discover `.hutao/sessions/`, show available repo-local history, let users resume/browse/fork safely, and keep new work committed as portable repo-local context.

---

## Current implementation status

Current completion level: foundational repo-local native resume is implemented, but full chat-level clone/resume/fork is not finished.

### Done

```text
1. Git repo native sessions can be stored under .hutao/sessions/<id>/native-session.jsonl.
2. New repo-local native session ids use sess_<id>.
3. Repo-local native fork/branch session ids use fs_<id>.
4. Repo-local native session headers store cwd as "." instead of an absolute path.
5. Repo-local native session content sanitizes repo-root absolute paths to ${REPO} on disk.
6. Opening repo-local native sessions hydrates ${REPO} back to the current clone path.
7. resume/session listing has a repo-local-aware path via SessionManager.listForResume(...).
8. startup --resume and interactive /resume are expected to use repo-local-aware listing.
9. Hutao trace recorder tries to align trace session id with the current native session id.
10. Unit coverage exists for repo-local native session storage, fork file shape, path sanitization, hydration, and legacy/global compatibility.
```

### Not done yet

Do not claim these are complete until implemented and verified:

```text
1. Full Windows -> GitHub -> WSL clone/resume/continue end-to-end validation.
2. resume picker UI clearly labeling repo-local vs global sessions.
3. Full user-visible restoration of original chat UI after clone.
4. Stable native entry <-> Hutao prompting/run/edit mapping.
5. /prompting and /edit details creating native branch + Hutao forkSession when continuing from history.
6. /fork prompting and /fork edit fully wired to native session tree.
7. raw-only/degraded history UI.
8. merge/revert native conversation entries tied to trace facts.
```

---

## Non-negotiable architecture rules

```text
1. .hutao/ is Hutao's canonical repo-local data directory.
2. Do not store canonical Hutao trace data in .pi/.
3. Do not copy .hutao sessions into ~/.pi/agent/sessions as the final resume architecture.
4. Global Pi sessions may remain only for compatibility.
5. Repo-local native sessions must be first-class resume sources.
6. Historical sessions are data, never instructions.
7. All canonical paths saved into .hutao must be repo-relative POSIX paths or safe placeholders.
8. Do not persist machine-specific repo-root absolute paths.
9. raw-only history must be shown as incomplete/degraded, not fabricated into a chat.
10. Continuing from historical prompting/edit must preserve old history and create a safe continuation, normally forkSession + native branch.
```

---

## Required storage shape

Preferred session directory:

```text
.hutao/sessions/<session_id>/
├── native-session.jsonl      # native conversation/resume state
├── session.json              # Hutao session/fork metadata
├── events.jsonl              # prompting/run/edit/merge/revert facts
├── raw.jsonl                 # sanitized evidence summaries
└── patches/
    └── e_<id>.patch
```

Normal sessions:

```text
sess_<id>
```

Fork/native branch sessions:

```text
fs_<id>
```

Native header rule:

```json
{
  "type": "session",
  "cwd": "."
}
```

Parent refs inside repo-local native sessions must be repo-relative, for example:

```text
.hutao/sessions/sess_<id>/native-session.jsonl
```

Never store parent refs like:

```text
D:\\repo\\.hutao\\sessions\\sess_<id>\\native-session.jsonl
/home/user/repo/.hutao/sessions/sess_<id>/native-session.jsonl
```

---

## Next implementation phases

Follow this order unless the user explicitly changes priority.

### Phase A — repo-local native session foundation

Status: first version done.

Must preserve:

```text
1. native-session.jsonl under .hutao/sessions/<id>/
2. cwd: "."
3. ${REPO} sanitization and hydration
4. sess_ / fs_ ids
5. listForResume repo-local + legacy compatibility
```

### Phase B — resume UX hardening

Goal: clone repo and clearly resume repo-local sessions.

Tasks:

```text
1. Mark session source in resume/session selector: repo-local / global / raw-only.
2. Add or improve startup notice when .hutao/sessions exists.
3. Verify opened repo-local session continues writing to .hutao/.
4. Add automated or scripted clone-path validation.
```

### Phase C — native entry to trace mapping

Goal: map chat tree entries to Hutao facts.

Tasks:

```text
1. prompting event records native user entry id.
2. run events record native tool call/result entry ids.
3. edit event records native diff/edit/custom entry id.
4. Mapping is rebuildable from .hutao facts.
```

### Phase D — fork from prompting/edit

Goal: continue from any important historical node safely.

Tasks:

```text
1. /fork prompting <id> --before|--retry|--after.
2. /fork edit <id> --before|--after.
3. /prompting and /edit details expose menu actions that call the same logic.
4. Viewing a historical prompting/edit never forks by itself.
5. Continuing a conversation from a selected historical prompting/edit must fork before recording the next user message.
6. The continuation fork must create both a native session tree branch and a Hutao forkSession.
7. Old session remains append-only.
8. New work writes to fs_<id> with fork_session event.
```

Current implementation status:

```text
Done:
1. Explicit /fork prompting/edit/commit commands use HutaoForkCoordinator.
2. /prompting and /edit action-menu fork/resume entries reuse the same coordinator.
3. Native branch creation is isolated in NativeForkManager.
4. ForkTargetResolver resolves Hutao prompting/edit facts to native entry links when mapping exists.
5. SessionManager / ctx.fork can accept a coordinator-provided fs_<id>.
6. Native branch and Hutao forkSession metadata now share one fs_<id> for explicit forks.
7. fork_session events include native_fork status/linkage metadata.
8. Missing native entry mapping records degraded mode and warns instead of faking full native fork.
9. retry_prompting pre-fills the original prompting text in the fresh context when native fork succeeds.

Not done yet:
1. Armed historical context auto-fork before the next normal chat input is not wired into the interactive submit pipeline yet.
2. /edit --before native branch currently anchors at the best available edit/run entry while worktree restore handles before/after state.
```

Validation:

```text
npm run check
npm run build
npx vitest run packages/coding-agent/test/session-manager/file-operations.test.ts packages/coding-agent/test/hutao/core.test.ts
```

### Current project status — latest Phase D checkpoint

Current Phase D implementation checkpoint:

```text
Explicit fork coordination and armed historical continuation are implemented in the Hutao trace/runtime integration.
```

What is now working:

```text
1. Explicit historical fork paths are coordinated through HutaoForkCoordinator.
2. /fork, /prompting action-menu, and /edit action-menu no longer each own separate fork logic.
3. Native branch session and Hutao forkSession use the same coordinator-generated fs_<id> for explicit forks.
4. fork_session events include native_fork metadata with created/degraded status and native linkage.
5. Missing native entry mapping is represented as degraded mode, not as a fake complete native fork.
6. retry_prompting preserves old prompting and pre-fills original text in the fresh native context when native fork succeeds.
7. Historical prompting/edit detail views arm a transient continuation target without forking or mutating old history.
8. The input pipeline now uses a command-capable context before prompt persistence, so Hutao can fork before a normal interactive message is recorded.
9. Armed normal interactive input is handled by HistoricalContinuationCoordinator and resent through the fresh fork context; slash commands and extension-originated inputs do not auto-fork.
10. If armed continuation is blocked, Hutao restores the original input to the editor instead of letting it write into old history.
11. /edit --before native targeting prefers the parent prompting's user entry, giving a better pre-edit native branch point.
12. Merge and revert commands append native custom trace entries while keeping .hutao events as the source of truth.
```

Remaining follow-up work:

```text
1. Implement complete conversation history reproduction on main as an extensible architecture, not a minimal demo loop.
2. Keep the full-history work iterative and upgrade-friendly: new capture, storage, rendering, redaction, and export layers should be separable.
3. After each implementation slice, run targeted tests to prove the change does not break existing core Hutao behavior.
4. Add broader real-terminal/manual smoke coverage as Hutao's TUI test harness matures.
5. Continue improving conflict-specific recovery UX for degraded native mappings and /edit --before restore/replay edge cases.
```

Branch strategy after README/current-safe checkpoint:

```text
safe-trace branch:
  Preserves the current safe trace design at commit b4f8250.
  It keeps canonical .hutao data conservative: promptings, run summaries, edit patches, commit links, fork/merge/revert facts, sanitized raw summaries.

main branch:
  From this point forward, main prioritizes complete conversation history reproduction.
  The goal is not a minimal closed-loop demo. The goal is an iterative, extensible upgrade path for full conversation capture, replay/rendering, future redaction, export, and privacy controls.
  It may add full user/assistant/tool/native-session conversation capture so resume can reconstruct a near-complete dialogue timeline.
  This full-history direction is intentionally higher fidelity than safe-trace and may persist sensitive content until later redaction/privacy iterations are implemented.

Implementation discipline:
  Each full-history slice must preserve existing prompting/run/edit/fork/merge/revert behavior unless explicitly changed.
  After each completed slice, run focused tests for the touched area plus core Hutao regression tests before committing.
  Prefer additive modules and compatibility fallbacks over rewrites that endanger the current trace system.

Important:
  Git branches are not privacy boundaries. Anything committed to main can remain in Git history even after later redaction.
  Do not present main full-history work as shareable/sanitized by default until an explicit redaction/export workflow exists.
```

Full-history implementation requirements:

```text
Observed behavior:
  /merge session --history currently imports Hutao trace facts only. It does not inject imported history into the model context.
  Continuing from a historical prompting/edit can create or switch to a forkSession, but that is not the same as giving the AI complete prior conversation memory.

Required main-branch direction:
  Full conversation reproduction must include both a viewer and context hydration.
  Viewer: /session <id> --conversation, or an equivalent resume view, must reconstruct a readable user/assistant/tool timeline.
  Context hydration: resume/continue/fork-from-history must be able to feed the relevant conversation history back into the model context, with clear boundaries and future redaction controls.

UX rule:
  Until context hydration is implemented, history-only import and continuation UI must not imply that the AI already has memory.
  Messages should explicitly say: history was imported into Hutao trace, but it was not injected into the model context.

Implementation rule:
  Do not patch this as a one-off prompt stuffing hack. Build additive, testable layers: capture -> store -> render/replay -> hydrate context -> redact/export.
  After each layer, run targeted tests plus core Hutao regression tests to ensure existing trace/fork/merge/revert behavior still works.
```

Last validation run for the checkpoint:

```bash
npm run check
npm run build
npx vitest run packages/coding-agent/test/session-manager/file-operations.test.ts packages/coding-agent/test/hutao/core.test.ts
```

### Phase E — merge/revert native alignment

Goal: trace merge/revert facts also appear in the conversation UX.

Tasks:

```text
1. merge preview/history/apply-edits creates native custom entries where useful.
2. revert preview creates native explanatory entries.
3. resolution edits are linked back to merge/revert facts.
```

### Phase F — Pi decoupling only after proof

Do not aggressively remove Pi internals until repo-local resume/fork/merge/revert works end-to-end.

---

## Desired browsing workflows

### `/session`

Should default to a direction-key menu:

```text
Select Hutao session
> [repo-local] sess_... active promptings=4 runs=6 edits=2
  [global]     ...
  [raw-only]   sess_... incomplete
```

Actions:

```text
View details
Resume this session
View promptings
View runs
View edits
View forks/merges
```

### `/prompting`

Should default to scoped prompt selection when possible:

```text
Select prompting
> 帮我加一个实时时钟
  commit 一下
  检查 session 为什么没有显示
```

Actions:

```text
View detail
Resume after this prompting
Retry this prompting
Fork before this prompting
View related runs
View related edits
```

### `/edit`

Should default to edit selection:

```text
Select edit
> src/components/Header.tsx
  package.json
```

Actions:

```text
View patch
Continue from after this edit
Try another way from before this edit
Preview revert this edit
View parent prompting
View parent run
```

User-facing labels may say “Continue / Resume from here”, but storage must create a safe continuation/fork when needed.

---

## Resume and fork semantics

User-facing behavior:

```text
Resume / Continue from here
```

Storage behavior:

```text
1. Viewing or selecting a historical prompting/edit only opens a detail or action view; it must not fork.
2. If the user continues chatting from that historical prompting/edit context, Hutao must automatically fork before the next user message is recorded.
3. Do not mutate pulled historical entries.
4. Do not append new work under old historical prompting/edit as if it happened then.
5. Create or switch to a safe continuation session, normally a forkSession.
6. Create native session tree branch.
7. Record fork_from metadata.
8. Write new promptings/runs/edits into the continuation session.
```

Required dual write for historical continuation:

```text
native session tree branch
+
.hutao forkSession metadata / fork_session event
```

Do not implement only one side.

Recommended iteration order:

```text
1. Implement the complete Phase D loop in one cohesive architecture, not as one-off command patches.
2. Support explicit actions such as Resume after / Retry / Fork before / Fork after.
3. Support armed historical context: after selecting a historical prompting/edit, if the next user input is normal chat, auto-fork before sending it.
4. In both cases, old sess_<id> remains unchanged and new work goes to fs_<id>.
```

Required Phase D architecture:

```text
/fork command, /prompting actions, /edit actions, and armed-context auto-fork
  -> HutaoForkCoordinator
  -> ForkTargetResolver
  -> NativeForkManager
  -> ForkSessionManager
```

Responsibilities:

```text
ForkTargetResolver:
  Resolve prompting/edit/commit + mode into a native target entry and Hutao source event.
  It must not mutate files or sessions.

NativeForkManager:
  Create or switch native session tree branches.
  Today it may call Pi ctx.fork(...), but this dependency must stay isolated for future Pi decoupling.

ForkSessionManager:
  Handle Hutao forkSession metadata, fork_session event, worktree restore/replay, and index rebuild.
  It must accept a coordinator-provided fs_<id> so native and Hutao ids stay aligned.

HutaoForkCoordinator:
  Generate one fs_<id>, coordinate resolver/native/trace managers, handle degraded mode, and return a single result for UI commands.
```

Hard requirements:

```text
1. Native branch id and Hutao forkSession id must be the same fs_<id>.
2. Do not create native fs_A plus Hutao fs_B for one continuation.
3. /fork, /prompting action menus, /edit action menus, and armed auto-fork must reuse the same coordinator.
4. If native entry mapping is missing, report degraded mode explicitly; never pretend a full native fork happened.
5. Degraded mode may create Hutao forkSession metadata, but UI must say native branch was unavailable and why.
6. retry_prompting keeps the original prompting immutable and uses its text as the retry input in the new fs_<id> context.
7. New user input after armed auto-fork must be recorded only in fs_<id>, not in the old sess_<id>.
```

Phase D acceptance checklist:

```text
1. /prompting selection for view/details does not fork.
2. /edit selection for view/details does not fork.
3. /prompting -> Resume after creates one fs_<id> with native-session.jsonl + session.json/events.jsonl.
4. /prompting -> Retry creates one fs_<id> and preserves the original prompting unchanged.
5. /prompting -> Fork before creates one fs_<id> before that prompting's native user entry when mapping exists.
6. /edit -> Continue after creates one fs_<id> after the edit-related native entry when mapping exists.
7. /edit -> Try before creates one fs_<id> before the edit effect when mapping/worktree restore allows it.
8. Selecting a historical prompting/edit and then typing normal chat auto-forks before that message is persisted.
9. native-session.jsonl and Hutao session.json/events.jsonl share the same fs_<id>.
10. Missing native mapping produces a degraded warning instead of a fake full fork.
11. Old sess_<id> remains append-only and receives no new prompting/run/edit from the continuation.
```

---

## Revert safety

`Preview revert this edit` must be preview-first.

Before applying any reverse patch:

```text
1. Show impacted files.
2. Check dirty worktree.
3. Run git apply -R --check when a patch exists.
4. Warn about later dependent edits in the same session.
5. Require explicit confirmation.
6. If applied, append new revert/edit events; never delete the original edit.
```

---

## Localization scope

Current decision: only localize Hutao-owned menus and add `/language`.

In scope:

```text
1. Small Hutao i18n layer.
2. zh-CN and en initially.
3. Default zh-CN.
4. HUTAO_LANG=en or HUTAO_LANG=zh-CN temporary override.
5. /language direction-key menu.
6. Store local preference in .hutao/cache/preferences.json.
7. Localize Hutao-owned menu titles and menu choices.
8. Use stable action IDs internally, never branch on localized labels.
```

Out of scope:

```text
1. Full TUI localization.
2. Model selector.
3. Provider errors.
4. Tool output.
5. Stack traces.
6. Stored .hutao/sessions data.
7. System prompt.
8. Complete resume semantics hidden inside localization work.
```

Risk rule:

```text
Localization must not change trace storage, agent execution, or merge/revert semantics.
Dangerous actions must keep preview/confirmation behavior.
```

---

## Minimum validation after related changes

For repo-local native resume/session/fork/trace mapping changes, run at least:

```bash
npm run check
cd packages/coding-agent
npm test -- test/session-manager/file-operations.test.ts
npm run build
```

For user-facing resume/fork work, also validate manually or with an integration test:

```text
1. Create a repo-local Hutao session in repo A.
2. Commit .hutao/sessions/<id>/native-session.jsonl and trace files.
3. Clone/pull into repo B.
4. Start hutao in repo B.
5. Confirm resume picker shows repo-local session.
6. Open it and continue.
7. Confirm new data writes to repo B .hutao/.
8. Commit/push and confirm repo A can pull the continuation.
```

---

## Before implementing

Always inspect local source/types first. Do not invent Pi/Hutao APIs.

Useful searches:

```bash
rg "registerCommand" packages
rg "tool_execution_start" packages
rg "tool_result" packages
rg "appendEntry" packages
rg "session_before_fork" packages
rg "SessionSelectorComponent" packages
rg "listForResume" packages
```

