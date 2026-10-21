# Reviewer slice: `packages/workflows-ui` app shell + CSS (PR #1)

Slice assigned: `packages/workflows-ui/src/workflows-app.tsx` (65 changed lines) and
`packages/workflows-ui/src/workflows-app.module.css` (165 changed lines). Note: the
slice brief described "tab state and toggle entry (chat-workflows-toggle)" — no such
identifier exists anywhere in the repo (grep over `packages/workflows-ui/src`,
`apps/screenpipe-app-tauri/components`, `apps/screenpipe-app-tauri/lib` returned
nothing). The actual diff content is reviewed below.

## What this slice changes

### `workflows-app.tsx`
1. **Task Page header** (`workflows-app.tsx:733-741`): the "All workflows" back
   button and title move into a new sticky `.taskHeader` (`data-testid="task-header"`),
   and a new `OpenAutomationButton` (`workflows-app.tsx:780-799`) appears in the
   header when the host supports creating Automation Flows from this task
   (`createsFlow`, `workflows-app.tsx:728`). It looks up an existing flow per task on
   each tab activation via `platform.findAutomationFlow`, and opens it with
   `platform.openAutomationFlow`.
2. **`timelineLabel`** (`workflows-app.tsx:729`): `"View in timeline"` passed down to
   `WorkflowStepEvidence`, which only uses it when `platform.openCapturedMoment`
   exists (`workflow-step-evidence.tsx:23`).
3. **`WorkflowQuestions` wiring** (`workflows-app.tsx:760-761`): new `createFlow` /
   `findFlow` props gated on `createsFlow`. `WorkflowQuestions` already holds these
   behind a latest-ref (`workflow-questions.tsx:158`), so the inline closures recreated
   each render are safe.
4. **Review-request reload** (`workflows-app.tsx:966-994`): a review request
   (notification/deeplink) now forces one catalog reload before handling, via
   `reloadedForReview` (once per key) plus `setCatalogReady(false)` +
   `setCatalogLoadRevision(+1)`; the in-flight load is aborted by the load effect's
   cleanup (`workflows-app.tsx:1044,1081-1082`). Handling bumps `reviewVisit`, which is
   appended to the `WorkflowDetail` React key (`workflows-app.tsx:1298`) so the opened
   page mounts afresh on the reloaded copy. Hosts without `loadCapturedWork` keep the
   old behavior (the reload branch is skipped).
5. This is the shared-package half of the PR's "create Automation Flow from a task"
   feature; the desktop-host half (fixture, demo task, flows tab) lives outside my
   slice.

### `workflows-app.module.css`
1. **New `--on-ink` token** (`workflows-app.module.css:18`) replacing hard-coded
   `#fff` for text on `--ink` fills (nav, primary button, skill phases, embedded nav).
2. **`#fff` → `var(--panel)` sweep** across ~25 surfaces (filter bar, panels, skill
   dialog, profile cards, replay, …) so surfaces follow the theme.
3. **`.taskHeader` sticky header rules** (`workflows-app.module.css:302-306`).
4. **New dark theme block** (`workflows-app.module.css:831-919`): `.app` token
   overrides from the host's `--foreground`/`--card`/etc. HSL variables, per-element
   color/border overrides, macOS-vibrancy handling, and command-palette styling.

## Verified checks (run in this session)

- `git diff origin/main...HEAD` on both files — read in full; both files read in full.
- `bun run test:vitest -- --run components/workflows/task-page-create-flow.test.tsx
  components/workflows/workflow-loading.test.tsx components/workflows/workflows-view-theme.test.tsx`
  (from `apps/screenpipe-app-tauri`): **40/40 passed** (18 + 19 + 3). This is the
  scoped vitest subset touching my slice, not the full `bun run test` suite — not run.
- Review-reload effect traced by hand: single reload per request key; aborted stale
  load cannot write back (`cancelled` flag + `AbortController`); handling happens only
  after `catalogReady && !catalogLoadError`; `handledReview` prevents repeats. No bug
  found.
- Dark-palette sweep: I checked every `#hex` surface the diff touches for a dark
  override; gaps found are listed below. (This complements the existing coderabbitai
  comment on `workflows-app.module.css:337/517/521`.)

## Findings

### P2 — `.taskHeader` sticky offset breaks under the taller compact topbars (css)
`.taskHeader { top: 59px; z-index: 1 }` (`workflows-app.module.css:302`) assumes the
59px `.topbar` (`workflows-app.module.css:149`). Two pre-existing compact rules make
the topbar taller than 59px, and the pinned header then slides under it (topbar
z-index 2): `@media (max-width: 680px) .topbar:has(.toolbarAccessory)` sets
`min-height: 96px; flex-wrap: wrap` (`workflows-app.module.css:818-820`), and
`@container workflow-pane (max-width: 900px) .sourceTopbar` wraps to two rows
(`workflows-app.module.css:827-828`). Both props are live in the desktop host
(`integrated-workflows.tsx:96-98` passes `toolbarAccessory` and `sourceControl`), so
the Task Page back button/title get obscured and clicks land on the topbar. This is
the compact-mode layout regression the slice brief asked about.

### P2 — Context-page textareas unreadable in dark mode (css)
`.profileCard > textarea, .profileAdvanced textarea` keeps `background: #fafaf7` with
`color: var(--ink)` (`workflows-app.module.css:513`); in dark mode `--ink` re-resolves
to near-white `hsl(var(--foreground))` (`workflows-app.module.css:835`), so typed text
is near-white on near-white. The PR's own theme test can't catch it: it skips hidden
pages (`workflows-view-theme.test.tsx:131`) and never navigates to the Context page.
Adjacent to (not duplicating) the existing coderabbitai finding about
`.profileKpis fieldset` at css:521 — different selectors, and here the *text* becomes
invisible, not just the surface mismatch. Same comment notes the minor
`.profileKpiRow > button:hover` light-pink hover with no dark override
(`workflows-app.module.css:527`).

### P3 — `OpenAutomationButton` error handling / staleness (tsx)
`open(flowId).catch(() => {})` (`workflows-app.tsx:798`) makes a failed "Open
automation" click a silent no-op with no feedback; the header button also won't appear
after a Flow is created from `WorkflowQuestions` on the same page until `active`
toggles or the task changes (effect deps `[active, taskId]`,
`workflows-app.tsx:796`). Swallowing `find` errors matches existing convention
(`workflow-questions.tsx:163`, `workflows-app.tsx:665`), so this is polish, not a
blocker.

## Not covered / could not verify
- Embedded-host chrome geometry (whether the host's 56px chrome overlaps the sticky
  topbar in embedded mode) — host-side layout outside my two files; the `taskHeader`
  offset deliberately mirrors the pre-existing topbar, so any such issue predates this
  PR.
- Full frontend suite (`bun run test`) and any Tauri/native build — not run, per slice
  scope.
- Did not duplicate the existing coderabbitai comments (activation version gating,
  retry race, dark contrast on css:337/517/521, etc.); none of my findings repeats
  them.

## Quality overall
The shared-package changes are well-factored: the `--on-ink` token removes a real
maintenance hazard, the review-reload logic is carefully race-guarded and commented,
and the dark block is systematic. The two P2s are completeness gaps (compact topbar
heights, Context page in dark), not design errors.
