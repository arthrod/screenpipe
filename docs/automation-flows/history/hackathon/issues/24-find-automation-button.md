# 24: « Trouver une automatisation » button in Automations

Ported principle from `archive/main-before-automation-flows` (`560eec203`,
« Find an automation »): a button in Automations that finds repeated work and
announces it with a notification. User decisions (2026-10-17): the button runs
the **scripted** detection (demo contract: no detection runs) and sits **next
to the notification bell** (visible on every Automations tab).

**Status:** done (browser mock verified; native app not run).

## What the user sees

1. Automations → « Trouver une automatisation » next to the bell.
2. Click: « Recherche dans votre activité… » (the 9 recorder-frame lookups,
   a few seconds).
3. The notification « Tâche répétitive détectée » appears; « Voir la tâche »
   opens the Task Page of `wf-novadesk-support-tickets` (questions, evidence,
   « Créer l'automatisation »), exactly like `demo.ts`.
4. If the notification is not shown (duplicate within 90 s, pause, quiet
   hours, server unreachable, browser dev loop), a toast gives the reason and
   the Task Page opens directly.

Each click reinstalls the task in its start state (answers cleared), like
`demo.ts`. Errors (unreadable catalog, missing image) show a toast; an
unreadable catalog is never overwritten.

## Files

- `apps/screenpipe-app-tauri/components/automation-flows/find-automation-button.tsx`:
  the button; placed in `components/pipe-store.tsx` before `NotificationBell`.
- `apps/screenpipe-app-tauri/lib/automation-flows/find-automation.ts`:
  `findAutomation(deps)` (frames lookup → embedded fallback → catalog upsert
  → notify) and the app wiring: catalog through `lib/workflows/disk-storage.ts`
  (the file the engine serves), `/notify` through `appServerFetch`; in
  `bun run dev:web` mock, the fixture platform's localStorage catalog and no
  notification.
- The scripted task moved from `infra/automation-flows/demo/` into the app so
  both share one source: `lib/automation-flows/demo-task/` (`detected-task.ts`
  now also holds `notificationPayload` and `EVIDENCE_PATH`;
  `recorded-evidence.ts` accepts an injected `fetch`; `catalog.ts` holds the
  pure `upsertTask`). The key frames moved to
  `apps/screenpipe-app-tauri/public/automation-flows/demo-evidence/`.
  `infra/automation-flows/demo/{demo,catalog,reset}.ts` import from there and
  keep their command lines.

## Checks

- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run --config vitest.config.ts lib/automation-flows components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx components/__tests__/pipe-store-error-state.test.tsx components/workflows/demo-task-evidence.test.tsx components/workflows/task-page-create-flow.test.tsx`:
  9 files, 105 passed (7 new in `lib/automation-flows/find-automation.test.ts`,
  3 new in `components/automation-flows/__tests__/find-automation-button.test.tsx`).
- `bun test infra/automation-flows/demo`: 30 passed.
- `bun x tsc --noEmit -p .` (app): no errors.
- `bun infra/automation-flows/demo/demo.ts --print > file`: the task with 9/9
  embedded images.
- Browser mock (`bun run dev:web`, `/home?section=pipes&tab=flows`, dismiss the
  mock's storage dialog first): button shown next to the bell
  (`screenshots/24-find-automation-button.jpg`), searching state, then the
  Task Page with 9/9 images loaded, both questions and « Créer
  l'automatisation » (`screenshots/24-find-automation-task-page.jpg`); no
  console error.
- **Not verified:** the native app (real catalog file, real notification,
  recorder frames). Check on the demo machine with the dev build before
  relying on it on stage.
