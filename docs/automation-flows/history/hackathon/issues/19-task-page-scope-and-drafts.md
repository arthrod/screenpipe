# 19: Task Page — creation mode only where it works, answers never lost

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (stories 6–10); ticket 06 (what exists). Found by the spec audit (`docs/automation-flows/history/hackathon/issues/` gaps 8, 9, 11).

**What to build:**

- Only a Detected Task that can become an Automation Flow gets the
  "required Clarification Questions + Créer l'automatisation" mode. Today
  `packages/workflows-ui/src/workflows-app.tsx` (~line 749) passes `createFlow`
  for every task, so other tasks lose their optional answers / "Not sure" and
  the button fails with 404. Add a platform predicate (e.g.
  `canCreateAutomationFlow(taskId)`); the desktop platform answers from what
  the Flow service can create (today: the demo task id, see
  `crates/screenpipe-engine/src/automation_flows.rs` `DEMO_TASKS`). Any other
  task renders exactly as before (story 10).
- Answers being typed survive leaving the page (story 9): save drafts as the
  user types (debounced, through the existing save path or a per-task draft
  restored on mount), not only on submit.
- The question block texts on the Task Page are French like the rest of the
  demo flow (today some labels are English, `workflow-questions.tsx` ~143–151).

**Blocked by:** None (can start immediately).

**Status:** done (live: French block and Créer on the demo task; an unsaved answer was still there after leaving and reopening the Task Page — « Réponses : 1 sur 2 »; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] Frontend tests: a non-creatable task keeps the old page (optional answers, "Not sure", no Créer button); the demo task keeps the required mode; a typed answer is restored after unmount/remount without pressing save.
  `components/workflows/task-page-create-flow.test.tsx` drives `WorkflowsApp` with a host predicate:
  `wf-other-task` → English "0 of 2 answered · All optional", two "Not sure", "Save answers", no Créer,
  `createAutomationFlow` never called; the demo task → Créer disabled, no "Not sure"; an answer typed,
  page unmounted and reopened → answer restored, `saveWorkflowAnswers` never called; the question
  block is French in creation mode. `lib/workflows/automation-flows.test.ts`: the desktop predicate
  accepts only the demo task and its list equals the engine's `DEMO_TASKS` ids (fails on drift).
  Browser mock: `assets/19-task-page-fr.jpg` (demo task, French), `assets/19-draft-restored.jpg`
  (typed, left via "All workflows", reopened: restored, catalog untouched),
  `assets/19-other-task-unchanged.jpg` (non-creatable clone: old English page).
- [x] Existing workflows-ui and Task Page tests still pass.
  From `apps/screenpipe-app-tauri`, after merging `origin/hackathon/automation-flows` (83668c934):
  `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run --config vitest.config.ts components/workflows lib/workflows components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx`
  → 60 files, 569 passed, 1 skipped. `bun x tsc --noEmit -p .` → clean (exit 0, no output).
  From the repo root: `bun test infra/automation-flows` → 45 pass, 0 fail.

## What was built

- **Platform predicate** `WorkflowsPlatform.canCreateAutomationFlow?(taskId): boolean`
  (`packages/workflows-ui/src/platform.ts`). `WorkflowDetail` passes `createFlow` only when the host
  has `createAutomationFlow` and the predicate accepts the task (absent predicate: every task, for a
  future host that creates from any task). Desktop host: `canCreateAutomationFlow` in
  `apps/screenpipe-app-tauri/lib/workflows/automation-flows.ts` (a set holding
  `wf-novadesk-support-tickets`, mirroring the engine's `DEMO_TASKS`), wired into
  `desktopWorkflowsPlatform` and the browser-mock platform (`integrated-workflows.tsx`). No engine change.
- **Drafts** (story 9): `WorkflowQuestions` keeps the unsaved answers per task in `sessionStorage`
  (`screenpipe:workflow-answers:<workflow id>`, the same tab-local recovery the workflow editor uses
  with `screenpipe:workflow-edit:`), written on every change while answers can be saved and restored
  on mount; a save (or the save done by Créer) clears it. Applies to every task; nothing reaches the
  catalog before the user saves or creates. No debounce: a synchronous session write per change is
  cheap and cannot lose the last keystrokes on unmount. Scope: survives in-app navigation, closing and
  reopening Home (the window is hidden, not destroyed) and reloads; not an app quit.
- **French question block** in creation mode: one copy table in `workflow-questions.tsx`; English is
  verbatim for every other task, creation mode uses French (heading, hint, progress
  "Réponses : X sur N · Obligatoires pour créer l'automatisation", voice panel, field label
  "Autre chose à savoir ?", placeholders, Effacer, Enregistrer les réponses, footer "Vos réponses
  restent ici si vous quittez la page."). The stored answer key of the extra field is unchanged.
  Ticket 06's English creation-mode strings are gone (creation mode is always French now).

## Notes

- Still English in creation mode: two errors raised outside the component (409 "This workflow
  changed while you were answering…" in `workflows-app.tsx`, "These answers are too long to save"
  in `workflow-answers.ts`). Rare paths; left as is.
- A rehearsal interrupted mid-typing leaves a session draft that `reset.ts` cannot clear; quitting
  the app clears it (completed rehearsals clear it when Créer saves the answers).
- Live check for the orchestrator: on the demo machine, the demo task shows the French block and
  Créer; any other detected task shows the old English page without Créer; type an answer, click
  "View in timeline" or "All workflows", come back: the answer is still there.
