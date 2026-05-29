# agent.md — Hutao next-step implementation notes

## Goal

Make repository-local Hutao sessions feel like normal resumable conversations after clone/pull.

Expected user experience:

```text
git clone <repo>
cd <repo>
hutao
```

Hutao should discover `.hutao/sessions`, show the available history, and let the user browse and continue without manually copying IDs.

## Product direction

1. Pulled `.hutao/sessions` are first-class resumable history, not cold data.
2. `/session`, `/prompting`, and `/edit` should default to direction-key menus.
3. Users should not need to type session/prompting/edit IDs for normal browsing.
4. ID-based commands may remain as advanced/debug shortcuts.
5. Continuing from historical data must not silently rewrite old history.
6. When continuing from a historical prompting/edit/session, use a safe continuation model, normally a `forkSession`, while presenting the UX as “resume/continue from here”.
7. Revert operations are dangerous and must be preview-first.

## Desired workflows

### Session browsing

`/session` should open a menu like:

```text
Select Hutao session
> sess_...  active  promptings=4 runs=6 edits=0
  sess_...  active  promptings=0 runs=0 edits=0
```

After selecting a session, show actions:

```text
View details
Resume this session
View promptings
View runs
View edits
```

### Prompting browsing

`/prompting` should open a menu of promptings, preferably scoped to the current/resumed session when possible:

```text
Select prompting
> 帮我加一个实时时钟
  commit 一下
  检查 session 为什么没有显示
```

After selecting a prompting, show actions:

```text
View detail
Resume after this prompting
Retry this prompting
Fork before this prompting
```

### Edit browsing

`/edit` should open a menu of edits:

```text
Select edit
> src/components/Header.tsx
  package.json
```

After selecting an edit, show actions:

```text
View patch
Continue from after this edit
Try another way from before this edit
Preview revert this edit
```

Use safer user-facing labels where possible:

```text
Continue from after this edit = resume from after_edit
Try another way from before this edit = fork from before_edit
Preview revert this edit = preview-only revert flow
```

## Resume semantics

User-facing behavior:

```text
Resume / Continue from here
```

Storage behavior:

```text
Do not mutate old pulled history.
Create or switch to a safe continuation session, usually a forkSession.
Record fork_from metadata.
Write new promptings/runs/edits into the continuation session.
```

This preserves trace integrity while making the UX feel like a normal conversation resume.

## Revert safety

`Preview revert this edit` must not directly change files.

Required preview checks:

1. Show impacted files.
2. Check whether working tree is dirty.
3. Run `git apply -R --check` on the edit patch when available.
4. Warn about later edits in the same session that may depend on this edit.
5. Require explicit confirmation before applying.
6. If applied, append new revert/edit events; never delete the original edit.

## Startup behavior

When Hutao starts inside a repo with existing `.hutao/sessions`, it should notify the user:

```text
Found N Hutao sessions. Use /session to browse and resume.
```

A later version may open the session menu automatically, but a startup notice is an acceptable first step.

## Implementation notes

Before implementing, inspect the actual local APIs for:

```text
ctx.ui.select
command handlers
session switching/resume behavior
ForkSessionManager
SessionRegistry
TraceRecorder current-session handling
```

Do not invent Pi/Hutao APIs. Use the local source definitions.

## Validation

After implementation:

1. Build `packages/coding-agent`.
2. Test in a repo with pulled `.hutao/sessions`.
3. Verify `/session`, `/prompting`, and `/edit` are usable by direction-key menus.
4. Verify normal ID-based commands still work for advanced/debug usage.
5. Verify resume/continue does not overwrite old session history.
6. Verify revert remains preview-first.

---

## Menu localization scope

Current decision: only localize Hutao-owned menus and add a `/language` command.

### In scope

1. Add a small Hutao i18n layer for menu labels.
2. Support two languages initially:
   - `zh-CN`
   - `en`
3. Default language: `zh-CN`.
4. Allow temporary override via environment variable:

```bash
HUTAO_LANG=en
HUTAO_LANG=zh-CN
```

5. Add `/language` command with a direction-key menu:

```text
选择语言 / Select language
> 简体中文
  English
```

6. Store local language preference in:

```text
.hutao/cache/preferences.json
```

This is intentionally local/cache data, not canonical trace history.

7. Localize only Hutao-owned menu titles and menu choices, especially:
   - `/session` selection and action menus
   - `/prompting` selection and action menus
   - `/edit` selection and action menus
   - `/action` menus through shared helpers
   - obvious `/merge` wizard choices if touched safely

8. Convert menu logic away from comparing displayed labels. Use stable action IDs internally:

```ts
{ id: "viewPatch", label: t("edit.action.viewPatch") }
```

Then branch on `id`, not localized text.

### Out of scope for this pass

Do not localize:

1. Full TUI.
2. Model selector.
3. Provider errors.
4. Tool output.
5. Stack traces.
6. Detailed trace field labels such as `summary`, `session`, `files`, `patch hash`.
7. Stored `.hutao/sessions` data.
8. System prompt.
9. Complete resume/continue semantics.

### Risk rule

Menu localization must not change trace storage, agent execution, or merge/revert semantics.
If a menu item performs a dangerous action, keep existing confirmation/preview behavior.
