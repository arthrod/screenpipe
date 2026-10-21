# Slice review — Questions rewrite (workflows-ui)

Reviewer slice: `packages/workflows-ui/src/workflow-questions.tsx` (focus: answer validation and duplicate-submission guard), `packages/workflows-ui/src/workflow-question.module.css` (question layout additions), `packages/workflows-ui/src/workflow-assistant.module.css` (assistant style tweaks). Diff base `origin/main...HEAD`; stat: 218 lines changed in the tsx (+~190 net), +17/-0 in the question CSS, +16/-16 in the assistant CSS.

## What this slice changes

- **Creation mode for the questionnaire** (`workflow-questions.tsx`): a new `createFlow`/`findFlow` prop pair switches the block from "all optional" to "every question required" via a two-entry `COPY` dictionary (`en` vs `creation`, lines 30–87). Questions become required (`complete`, lines 235–236), the "Not sure" checkbox is hidden in creation mode (line 303), and a single submit path (`create()`, lines 260–270) first saves the answers via `persist()` (line 265), then calls `createFlow` with only non-blank answers (line 267). If a Flow already exists for the task (`existingFlow`, looked up through `findFlow` on lines 160–165), the button becomes « Confirm changes » and requires `changed && complete` (lines 261, 316).
- **Draft persistence**: unsaved answers go to `sessionStorage` under a per-task key (`draftKey`, line 14; read/write helpers lines 15–27; effect lines 132–134). Restored drafts win over persisted answers (line 126) and count as "locked" against voice overwrite (line 130).
- **Suggested answers**: `workflow.openQuestionChoices` renders choice chips that fill the still-editable textarea (lines 298–300), with `aria-pressed` tracking.
- **Simulated progress**: `THINKING_MS = 5000` and `think()` (lines 88–109) drive a fake 0→100% progressbar shown during create/confirm (lines 310–314). The code comments are explicit that it is simulated ("Simulated AI thinking", lines 90–93); tests assert percent-only output (`task-page-create-flow.test.tsx:152–155, 281–284`).
- **CSS**: question module gains `.choices`, `.thinking`, `.track`, dark `color-scheme`, and reduced-motion handling; assistant module migrates its dark-mode overrides from hard-coded hexes to app theme tokens (`hsl(var(--card))` etc.).

## How it fits the PR

This is the Task Page end of "create an Automation Flow from a Detected Task": the host (`workflows-app.tsx:747–751`) wires `createFlow`/`findFlow` to `platform.createAutomationFlow`/`findAutomationFlow`, gated by `createsFlow` (`workflows-app.tsx:725`), which in the app resolves to the demo-task allowlist `CREATABLE_TASK_IDS` (`apps/screenpipe-app-tauri/lib/workflows/automation-flows.ts:38–41`). Answers flow to the engine via `flowsApi.createFromTask` (`automation-flows.ts:43–52`), which is documented idempotent per task. Answers themselves share the existing user-correction storage (`workflow-answers.ts:17–29`, 20 KB cap).

## Duplicate-submission guard — verdict: solid in-component

- `saving.current` is set synchronously before any `await` in both `submit()` (line 246) and `create()` (line 263), so a double click in the same tick cannot double-fire; buttons are additionally `disabled` via `busy` (lines 316–317). Tests assert exactly one `createAutomationFlow` call on double click (`task-page-create-flow.test.tsx:228–229` and `151–159`) and no call on `fireEvent.submit` of an already-created Flow (`129–130`).
- The form has a single `onSubmit` router (line 293): `submit()` in optional mode, `create()` in creation mode — no cross path.
- Cross-instance duplication (two windows, remount via the `reviewVisit` key at `workflows-app.tsx:1298` reseting `saving.current`) is backed by the engine-side per-task idempotency (`automation-flows.ts:4–6`). This overlaps the existing coderabbitai[bot] comment on `workflow-questions.tsx:260–268` (existing-Flow update path), so I did not post another one.

## Validation gaps found (posted as comments)

1. **P2 — creation controls are gated on `save`, not on `createFlow`.** The whole actions block, including « Create automation » / « Confirm changes », sits inside `{save && …}` (line 310), and draft persistence is `if (save)` (line 132–134) while the creation footer promises "Your answers stay here if you leave the page." (line 78). A host passing `createFlow` without `save` gets required-mode copy with **no submit button at all**. That combination is constructible today: `desktop-platform.ts:163–168` omits `saveWorkflowAnswers` when `browserPreview` is truthy while still including `createAutomationFlow` (line 163); `workflows-app.tsx:747` derives `save` from `canSaveAnswers && platform.saveWorkflowAnswers` while `createsFlow` (line 725) ignores save availability. Currently latent because `NEXT_PUBLIC_SCREENPIPE_WEB_DEV` is only ever `"mock"` in-repo and the mock path uses the fixture platform, which does provide `saveWorkflowAnswers` (`fixture-platform.ts:526`, `integrated-workflows.tsx:42–44`) — but it is one env value away.
2. **P3 — required validation accepts the "Not sure" placeholder.** `answered` counts any non-blank answer (lines 235–236), including the literal `"Not sure"` saved by the optional block; creation mode hides the checkbox (line 303) but happily restores such saved answers (lines 124–126) and sends them verbatim to `createFlow` (line 267). Latent today (the demo task is always creation-eligible, `automation-flows.ts:38–41`), but the prop contract allows the optional→creation transition.

## Other observations (not posted)

- **Simulated 5s progress is a deliberate product decision** (documented in-code lines 90–93 and asserted by tests). Note it adds a hard 5 s latency before the real `createFlow` call starts, and the bar depicts activity that is not happening; flagging here for the lead reviewer's awareness, not as a defect against stated intent.
- `findFlow` rejections are swallowed (`() => {}`, line 163). Acceptable: `/from-task` is idempotent per task (`automation-flows.ts:4–6`), so a missed lookup degrades to a create that reuses the existing Flow.
- `think()`'s `setTimeout` chain and `create()`'s `finally` can call `setState` after unmount (up to ~5 s). React 18 treats this as a no-op; cosmetic. A benign `act(...)` warning from this pattern shows in the test output at `workflow-questions.tsx:158`.
- With zero open questions the component returns `null` (line 271), so a creation-eligible task with no questions offers no create path — appears intentional ("questions unlock creation" per the test suite name) but worth a product glance.
- Cross-task state bleed is NOT possible: `WorkflowDetail` is keyed `${workflow.id}:${reviewVisit}` (`workflows-app.tsx:1298`), remounting the questions per task.
- Draft/restore semantics look right: drafts store only diffs vs saved (line 133) and are cleared after a successful persist (answers==saved ⇒ `writeDraft` removes the key, lines 22–26); `writeWorkflowAnswers` merges and caps at 20 KB (`workflow-answers.ts:17–29`).

## CSS slices

- **Question module** (all additions verified against the only importer, `workflow-questions.tsx`): `.choices`, `.thinking`, `.track`, dark `color-scheme`, reduced-motion for `.track` are all used and theme via the `.app` token set (`workflows-app.module.css:7–12` light, `:835–841` dark remap), so dark mode flips correctly. **`.actionButtons` (line 27) and `.actions button.secondary` (line 28) are dead** — `rg` finds no `styles.actionButtons`/`styles.secondary` anywhere; posted as P3.
- **Assistant module**: the diff replaces the hard-coded dark hexes with `hsl(var(--…))` tokens. I verified every token used (`--card`, `--border`, `--foreground`, `--background`, `--surface-secondary`, `--surface-tertiary`, `--muted-foreground`) is defined for BOTH themes in `apps/screenpipe-app-tauri/app/globals.css` (light lines 48–104, dark lines 183–239). Light-mode rules are untouched (still hex), matching the file's existing pattern. The migration is partial within the file — pre-existing light-tuned hard-codes that also apply in dark mode remain (e.g. `.composer:focus-within` border `#b3b5aa` line 65, `.messageActions button` color `#96988c` line 60, `.contextDot` border `#8b8f80` line 70, `.error`/`.saveError` `#9c4539` line 89, `.toolCall pre` border `#e6e6e1` line 118) — pre-existing, not introduced here, so noted only.

## Checks run

- `git diff origin/main...HEAD -- <three files>` and full reads of all three files plus `workflow-answers.ts`, `workflows-app.tsx` (host wiring), `platform.ts`, `fixture-platform.ts`, `automation-flows.ts`, `desktop-platform.ts`, `task-page-create-flow.test.tsx`, `globals.css` token blocks.
- `cd apps/screenpipe-app-tauri && bun x vitest run --config vitest.config.ts components/workflows/task-page-create-flow.test.tsx components/workflows/workflow-questions.test.tsx` → **2 files, 29 tests, all passed** (4.5 s). One benign `act()` warning attributed to `workflow-questions.tsx:158`.
- `rg` verifications: unused CSS classes; importers of `workflow-question.module.css`; definitions of every CSS custom property used by the new dark rules.

## Feedback already on the PR (dedup check)

15 review comments, all `coderabbitai[bot]` (fetched per fetch-pr-feedback; author and current user are both `arthrod`, so their comments are excluded by the skill's default). The only one touching my files targets `workflow-questions.tsx:260–268` (existing-Flow update path should pause + apply). None of my posted comments duplicate it or the other 14.
