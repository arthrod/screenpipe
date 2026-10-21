# Reviewer slice: `components/automation-flows/{labels,mock,fixtures}.ts` (PR #1)

Reviewer: reviewer-ui-flows-support · 2026-10-20 · Diff base `origin/main...HEAD`

## What this slice is

Three new files, 540 added lines, no deletions (`git diff origin/main...HEAD --stat`):

- **`labels.ts`** (84 lines) — the copy layer for the Flows UI: `STATUS_LABEL`, `EXECUTION_LABEL`, `EVENT_LABEL`, `BY_LABEL` maps plus `formatDate`, `lastRunLabel`, `outcomeLabel`, `activationEventLabel`, `activationLabel`, `shortVersion`. Consumed by `flows-tab.tsx:20`, `flow-review.tsx:32`, `flow-activity.tsx:19`, `flow-learned-from.tsx:24`, `common.tsx:13`.
- **`fixtures.ts`** (197 lines) — `fixtureFlow` (the bundled NovaDesk demo workflow as the engine would return it), `fixtureActivity` (4 runs, one per outcome, newest first), `DEMO_TASK_ID`, `summaryOf`. Consumed by `mock.ts:14`, `api.test.ts:23`, `lib/workflows/automation-flows.test.ts:27`, `pipe-store-flows-tab.test.tsx:9`.
- **`mock.ts`** (259 lines) — an in-memory n8n-less engine answering `/automation-flows/*` for the browser mock (`bun run dev:web`) and tests: health states via `?flowsState=`, activate/deactivate/dismiss/restore/delete/PUT-change/retry with the same credential and error semantics as the engine. Consumed by `lib/dev/browser-engine-mock.ts:5`, `lib/dev/browser-tauri-mock.ts:20`, and the test files above.

Focus lenses and what I found for each:

## i18n lens (labels.ts)

- **Labels are hardcoded English strings, not translation keys, and they are invisible to the app's translation pipeline.** The app *does* have one: General Translation (`gt.config.json`, target locale `ja`; webpack plugin wired in `next.config.mjs`). Per `scripts/i18n/compiler.mjs` (its own comment): auto-injection "operates on React jsx/jsxs calls, after Next's SWC transform"; non-JSX strings need explicit `useGT`. `labels.ts` is plain TS string maps and template strings (`labels.ts:7-35, 50-79`) rendered through JSX *expressions* by consumers — so none of its ~40 user-facing strings can be auto-translated, and there is no `useGT`/`gt-react` import anywhere under `components/automation-flows/` (rg across the app finds 10 files using `gt-react`, none in this feature). Result for a `ja` user: JSX copy on the same screens ("No Flows yet…", `flows-tab.tsx:64-66`) translates; every status, run, and history label (`"Not on yet"`, `"succeeded"`, `"Turned on by you"`, dates forced to `en-US` at `labels.ts:41`) stays English. Mitigating: this follows a pre-existing pattern — `components/settings/capture-filters/app-filter-list.tsx:33` and `components/settings/live-view-card.tsx:50` are identical hardcoded label maps untouched by this PR (empty diff). Posted as P3.
- **Themes: `labels.ts` carries zero styling** — pure strings, so theme consistency cannot fail in this file; consumers use theme tokens (`text-muted-foreground`, etc.). One consumer inconsistency observed but **out of my file scope, not posted**: `flow-activity.tsx:107` uses `text-red-600` without a dark variant where `flows-tab.tsx:143` uses `text-red-600 dark:text-red-400` for the same "failed" semantic. Flagging here so the lead can route it.
- **Deliberate, documented choices I am *not* flagging**: `needs_review` renders as "Paused" (`labels.ts:11-12`), mirrored by `groupOf` in `flows-tab.tsx:30-31` ("A Flow changed after it was on is Paused") and the identical `StatusBadge` marker for both statuses (`common.tsx:148-157`); `formatDate` hardcodes `en-US` with an explicit comment (`labels.ts:37`).

## Mock-focus lens (mock.ts)

- **Mock data is clearly marked**: header comment declaring the file as the browser-mock engine (`mock.ts:5-11`), all state/functions named `mock*`/`*Mock*`, exported `resetAutomationFlowsMock`, and the fake credential literally named `BROWSER_MOCK_FLOW_ACTIVATION_KEY = "browser-mock-flow-activation"` (`mock.ts:20`).
- **No behavioral leak into production**: the only gate is a runtime early-return — `installBrowserRuntime()` returns unless `NEXT_PUBLIC_SCREENPIPE_WEB_DEV` is `mock`/`live` or `window` is undefined (`browser-runtime.ts:39-40`), and that env is set only by the `dev:web` scripts (`package.json:6-7`). Verified `next.config.mjs` has no dev-strip either. **But the modules ship in the production bundle**: `app/layout.tsx:8` statically imports `@/lib/dev/browser-runtime`, which statically imports both mock modules (`browser-runtime.ts:11-18`) and calls `installBrowserRuntime()` unconditionally at module scope (`browser-runtime.ts:87`). Since the env value flows through `parseMode()` as an argument, the bundler cannot eliminate the call or its imports, so `mock.ts` + `fixtures.ts` (~460 lines incl. demo strings, French emails, `NOVA-*` ids, the mock credential string) are in every page's JS. I did not run a production build to measure the minified cost or rule out bundler-level dead-code elimination — reported as not run. Posted as P3 (dynamic-import indirection suggested).
- **The mock mirrors the engine honestly** — verified against the engine source: `offStatus` (`mock.ts:60-63`) is exactly `derive_status` (`crates/screenpipe-engine/src/automation_flows.rs:1147-1161`); dismiss-while-active → 409 `flow_active` (`mock.ts:67-69` vs `automation_flows.rs:512-517`); activate without credential → 403, wrong `versionId` → 409 `version_changed` (`mock.ts:102-110` vs `FlowError::VersionChanged` mapping `automation_flows.rs:496-498`); retry of a non-failed/already-retried run → 409 `run_not_failed` (`mock.ts:37-42`); `from-task` returns 200 vs the engine's 201, which is compatible because `request()` accepts any `response.ok` (`api.ts:266`). Module-level mutable state is reset per test where it matters (`api.test.ts:54`); `lib/workflows/automation-flows.test.ts` only makes read/no-op mock calls (its `beforeEach` at lines 47-53 lacks the reset but nothing mutates).

## Fixtures lens (fixtures.ts)

- **Types mirror the client API exactly**: `Flow`/`FlowSummary`/`FlowRun`/`ActivationEvent` field-by-field against `api.ts:12-103` — no missing/extra fields; `FlowNode.sentence` (`string | null`) satisfied.
- **The claimed drift test is real and honest**: `api.test.ts:371-392` reads `infra/automation-flows/workflows/novadesk-support-tickets{,.review}.json` and asserts fixture `name`, `summary`, `sourceTaskId`, and per-node `{name, type, sentence}` vs the JSON's `{name, type, notes}` (sticky notes excluded). I ran the file: **35/35 pass** (`bun x vitest run --config vitest.config.ts components/automation-flows/__tests__/api.test.ts`). Fixture graph sanity I ran via `bun -e`: 14 nodes, 14 edges, 0 dangling endpoints; activity ids unique, newest-first as documented.
- **One shared staleness the drift test cannot see**: `fixtures.ts:45` says the AI call "takes more than 12 seconds is tried once more", but the node sets `timeout: 8000` (`novadesk-support-tickets.json:126`) — the same wrong fact a comment already on this PR flags on the infra JSON (`:136`). Because the drift test enforces fixture == JSON `notes`, fixing the JSON alone will redden `api.test.ts:381-388` until `fixtures.ts:45` is updated too. Posted as P3 (additive to the existing comment; different file).
- **Fixture-internal inconsistency vs engine semantics**: `fixtureFlow.lastExecution: null` (`fixtures.ts:18`) while `fixtureActivity` holds 4 n8n executions — the engine derives `lastExecution` from n8n `GET /executions?workflowId=…&limit=1` (`automation_flows.rs:785-809`), so a Flow with activity would never present as "Never run" (`labels.ts:51`) in the real list. Demo-only dishonesty; posted as P3.

## The one P2 — timezone-dependent test through `formatDate`

`formatDate` (`labels.ts:38-48`) formats in the viewer's local timezone; `flows-tab.test.tsx:778-779` feeds `2026-10-17T02:05:41Z` / `02:08:36Z` and line 790 asserts `/Oct 17, .+ · Gmail, Jira$/`. Measured on this machine (EDT, UTC-4):

- `bun x vitest run --config vitest.config.ts components/automation-flows` → **1 failed | 122 passed**; failure at `flows-tab.test.tsx:790`, rendered text `Fri, Oct 16, 10:05 PM` vs expected `Oct 17`.
- Same file with `TZ=UTC` → **70/70 pass**.

So CI (UTC) is green while any contributor at UTC-3 or further west gets a red suite locally. Fix belongs in the test (pin `TZ=UTC` in the vitest environment, or derive the expectation with `Intl`), not in `formatDate` — users should see local times. Posted as P2 anchored on `labels.ts:38-48`.

## Commands run (this session)

- `git diff origin/main...HEAD --stat -- <3 files>` → 540 insertions, 0 deletions.
- fetch-pr-feedback gates: `gh pr view 1`, `gh repo view`, `gh api user`, resolved-threads GraphQL (`[]`), both paginated comment fetches (jq filters per skill) — 15 existing line comments, all `coderabbitai[bot]`; none on my three files.
- `rg` sweeps: mock/fixture/label importers; i18n framework (`i18next|lingui|inlang|paraglide|useTranslation|intl.` → none); `gt-react|useGT` users; `lib/dev` references; engine symbols.
- `bun -e` fixture sanity (edges/ordering) — output in transcript.
- `bun x vitest run --config vitest.config.ts components/automation-flows` → 1 failed | 122 passed; `... api.test.ts` → 35/35; `TZ=UTC ... flows-tab.test.tsx` → 70/70. (Scoped vitest invocation mirroring `package.json:10`; not the full frontend suite.)

## Not run / not verified

- No production bundle build (`bun run build` / next build) — the bundle-inclusion claim for `mock.ts` is from static import-graph reading, not measured output.
- No `ja`-locale build/render — the GT-invisible claim is from `compiler.mjs`/`gt.config.json` reading plus absence of `useGT` in the feature, not observed rendering.
- Engine-side `restore`-when-not-dismissed semantics unverified (mock no-ops); only the documented paths were cross-checked.
