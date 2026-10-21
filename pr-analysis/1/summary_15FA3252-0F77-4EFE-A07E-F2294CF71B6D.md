# Slice review — workflows theme test + stale task-page create-flow test (PR #1)

Slice: two NEW test files, 513 lines total, in `apps/screenpipe-app-tauri/components/workflows/`:
- `workflows-view-theme.test.tsx` (190 lines, 3 tests)
- `task-page-create-flow.test.tsx` (323 lines, 18 tests)

## What the slice changes

**`workflows-view-theme.test.tsx`** — theme-compliance test for the Workflows view. It injects the real
`@screenpipe/workflows-ui` CSS modules into jsdom (via `import.meta.glob` of
`../../node_modules/@screenpipe/workflows-ui/src/*.module.css` + `readFileSync`, lines 40–60), maps author class
names to vitest-given CSS-module names (lines 52–54), then renders the Task Page (`renderTaskPage`, lines 143–155)
and `IntegratedWorkflows` (line 185) under the app's `dark` class and asserts a DOM walk finds no light neutral
surface and no forced `color-scheme: light` (`lightSurfaces`, lines 127–141; `isLightSurface` luminance/chroma
detector, lines 100–104). One light-mode test guards the detector itself (lines 168–173: light theme must produce
>0 light surfaces, so an all-pass detector can't silently rot).

**`task-page-create-flow.test.tsx`** — behavior tests for the Task Page's Clarification-Questions → « Create
automation » flow: gating of the create button on answered questions (lines 43–53), host-capability wording
(optional vs required modes, lines 55–100), suggested-answer chips (102–118), existing-automation states (« Open
automation » header, « Confirm changes » apply-with-thinking, lines 120–208), Enter-to-create (210–217),
save-then-create ordering with persisted-answers verification through the fixture storage (219–241), in-memory
draft restoration across remount without saving (243–254), failure→retry (256–269), thinking-lock until the
Review Screen is shown (270–297), and the ticket-17 stale-page scenario (299–322).

## How it fits the whole PR

- The theme test is the enforcement behind the PR's "Workflow screens now follow light and dark themes" claim
  (coderabbit summary comment on this PR).
- The task-page test is the named regression test for issue #17:
  `docs/automation-flows/history/flows-round-two/issues/17-create-automation-stale-task-page.md:23` says the
  « ticket 17 » test in this file "fails without the fix", and :24 describes the fix ("every review request
  reloads the catalog and remounts the Task Page"). Fix commit `bcb3e74c0` is in this branch (verified:
  `git merge-base --is-ancestor bcb3e74c0 HEAD` → ancestor) and its diff touches exactly this test file (+70
  lines) plus `workflows-app.tsx`.
- The ticket-17 test drives the real mechanism: it writes the actual catalog key
  `screenpipe:fictional-workflow-editor-preview` (test line 305), which is the fixture platform's storage key
  (`packages/workflows-ui/src/fixture-platform.ts:477`, `restore()` at :481) and the browser mock's
  `MOCK_CATALOG_KEY` (`apps/screenpipe-app-tauri/lib/automation-flows/find-automation.ts:83`); `upsertTask`
  bumps the task revision (`apps/screenpipe-app-tauri/lib/automation-flows/demo-task/catalog.ts:26`), matching
  the "stale revision" failure mode.

## Checks run (this session)

- `bun x vitest run --config vitest.config.ts components/workflows/workflows-view-theme.test.tsx
  components/workflows/task-page-create-flow.test.tsx` from `apps/screenpipe-app-tauri` → **21/21 passed**
  (18 + 3), 3.1 s. One stderr warning appeared in theme test 3 only: `[workflows] Loading unavailable
  { phase: 'catalog', transient: false, status: undefined }` — see risk 1.
- jsdom canvas probe (node + repo jsdom): `canvas.getContext('2d')` → null ("Not implemented … without
  installing the canvas npm package"); `img.decode` → not a function. Proves the throw point in risk 1.
- Verified exports/keys: `THINKING_MS = 5000` (`packages/workflows-ui/src/workflow-questions.tsx:89`),
  `readWorkflowAnswers` (`packages/workflows-ui/src/workflow-answers.ts:6`), `DEMO_TASK_ID`/`CLARIFICATION_QUESTIONS`/
  `QUESTION_CHOICES`/`buildDetectedTask` (`apps/.../demo-task/detected-task.ts:13,44,50,134`), localStorage key
  (`find-automation.ts:83`, `fixture-platform.ts:477`).
- Vitest config supports the files: `globals: true` (so RTL auto-cleanup covers the task-page file, which has no
  afterEach cleanup), jsdom env, include pattern matches `**/*.test.tsx`
  (`apps/screenpipe-app-tauri/vitest.config.ts:19-26`).
- NOT run: the full frontend suite (`bun run test` — runs test:vitest + test:bun across the app), and the
  ticket-17 test against the pre-fix parent commit (would need a tree checkout; the issue doc's "fails without
  the fix" claim is corroborated by commit content, not re-executed by me).

## Notable risks and quality issues

1. **P2 — Theme test 3 scans the catalog-error UI, not the workflows view it claims.** In the
   `IntegratedWorkflows` dark test (lines 181–189), the mocked `desktopWorkflowsPlatform` is
   `createFixtureWorkflowsPlatform()` with the default `fixtureWorkflowAnalysis`, whose evidence screenshots are
   SVG data URLs (`fixture-platform.ts:75`). `loadCapturedWork` rasterizes them
   (`fixture-platform.ts:508` → `rasterizeFixture` :413–422), which needs `image.decode()` + canvas 2D — both
   missing in jsdom (probe above), so the load rejects; observed as the `Loading unavailable` warning
   (`workflows-app.tsx:1069`, `transient:false` → `setCatalogLoadError(true)` :1071–1073) → the app renders the
   « Couldn't load your workflows » role=alert section instead of content (workflows-app.tsx:1323–1326). The
   dark-mode assertion then passes over chrome + error state. The Task Page tests avoid this by using webp data
   URLs (`buildDetectedTask` provider, line 145), which skip rasterization.
2. **P2 — The light-surface detector is blind to `hsl()`/`color-mix()` backgrounds, which the scanned view's own
   stylesheet uses.** `colours()` (lines 80–96) parses only hex, `rgba()`, and 4 named whites. Yet
   `workflows-app.module.css:302` paints the sticky Task Page header with
   `color-mix(in srgb, var(--paper) 94%, transparent)` (on screen in the dark Task Page test today), and the
   dark overrides use `hsl(var(--sidebar-background))` / `hsl(var(--card))` etc.
   (`workflows-app.module.css:863,879,882,910,912`; also `chat-primitives.module.css`,
   `workflow-assistant.module.css`). A future light surface written in these syntaxes ships undetected — silent
   false-pass in the file whose whole job is detection.
3. **Slice-focus mismatch (summary note, not posted):** the ask describes this file as "dark/light/reduced-motion
   coverage", but the 190 lines contain no reduced-motion/animation assertions at all (no `prefers-reduced-motion`,
   no animation/transition checks) — only dark + one light detector-guard test. If reduced-motion coverage was
   intended, it doesn't exist in this file.
4. **Task-page file: no defects found worth posting.** Quality is high: ordering assertions
   (`["save","create"]`, lines 230, 161), double-click idempotence (151, 228), persistence read back through the
   fixture storage (236–240), thinking-lock held until the host resolves (292–295), error-retry path (256–269),
   and the ticket-17 scenario is the doc-named regression test.
5. **Coupling to existing PR feedback (context for the lead):** coderabbit's comment on
   `packages/workflows-ui/src/workflow-questions.tsx:260-268` proposes an engine-side update/pause path for
   existing Flows. The test at task-page lines 133–168 pins the CURRENT contract (`createAutomationFlow` called
   with the saved answers after « Confirm changes »). If that feedback is accepted, this test will need updating
   in the same change.
6. Minor (not posted): the deep `../../../../packages/workflows-ui/src/...` imports (task-page lines 10–11) and
   the `node_modules` glob (theme line 40) bypass the package's public entry, but this is the established pattern
   in 8+ sibling test files (workflow-questions, workflow-timing, step-evidence, …) — not comment-worthy.

## Comments posted

See `comments_15FA3252-0F77-4EFE-A07E-F2294CF71B6D.md` — 2 comments, both P2, both on
`workflows-view-theme.test.tsx`. Nothing posted on `task-page-create-flow.test.tsx` (no findings). Neither
duplicates existing PR feedback (verified against the fetch-pr-feedback artifact: no existing comment touches
these two files).
