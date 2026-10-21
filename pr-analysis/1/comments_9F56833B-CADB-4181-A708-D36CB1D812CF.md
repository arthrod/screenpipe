Review of the Flows copy/mock/fixture layer (`labels.ts`, `mock.ts`, `fixtures.ts`) — 5 findings, none blocking. All were verified against the engine, the i18n build config, and test runs from this checkout.

---

**`apps/screenpipe-app-tauri/components/automation-flows/labels.ts:38-48`** · **P2 (test breaks local dev for most of the Americas)**

`formatDate` formats in the viewer's local timezone (no `timeZone` option), and the new test asserting its output is timezone-dependent: `flows-tab.test.tsx:778-790` feeds captures at `2026-10-17T02:05:41Z`/`02:08:36Z` and expects `getByText(/Oct 17, .+ · Gmail, Jira$/)`. Measured on an EDT (UTC-4) machine: the scoped run (`bun x vitest run --config vitest.config.ts components/automation-flows`) fails 1/123 with the rendered text `Fri, Oct 16, 10:05 PM`, and the same file passes 70/70 under `TZ=UTC`. CI (UTC) will stay green while any contributor at UTC-3 or further west gets a red suite on an untouched branch. Keep user-facing local times in `formatDate`; fix the test instead — pin `process.env.TZ = "UTC"` in the vitest setup (or derive the expected string with the same `Intl` call), and consider doing it globally so the other date assertions can't drift the same way.

---

**`apps/screenpipe-app-tauri/components/automation-flows/labels.ts:7`** · **P3 (i18n: the whole label layer is invisible to the app's translation pipeline)**

The app localizes through General Translation (`gt.config.json`, target locale `ja`, plugin wired in `next.config.mjs`), and per `scripts/i18n/compiler.mjs` the auto-injection "operates on React jsx/jsxs calls"; non-JSX strings need explicit `useGT`. `labels.ts` is plain TS string maps (`STATUS_LABEL`/`EXECUTION_LABEL`/`EVENT_LABEL`/`BY_LABEL`) rendered via JSX *expressions* by consumers, with no `useGT` anywhere under `components/automation-flows/` — so for a Japanese user, JSX copy on the same screens translates while every Flows status, run outcome, and history label ("Not on yet", "succeeded", "Turned on by you", plus `en-US`-forced dates at `labels.ts:41`) stays English. This follows a pre-existing pattern (`app-filter-list.tsx:33`, `live-view-card.tsx:50` are older hardcoded maps), so it's a debt note rather than a regression: if `ja` is a supported locale at release, route these maps through `useGT`/the GT dictionary, or accept and document that the Flows screens are English-only for now.

---

**`apps/screenpipe-app-tauri/components/automation-flows/mock.ts:23`** · **P3 (mock and fixture code ship in the production bundle)**

The runtime gate is fine — `installBrowserRuntime()` returns early unless `NEXT_PUBLIC_SCREENPIPE_WEB_DEV` is `mock`/`live` (`browser-runtime.ts:39-40`), and that env is set only by the `dev:web` scripts — but the *inclusion* isn't gated: `app/layout.tsx:8` statically imports `@/lib/dev/browser-runtime`, which statically imports `browser-engine-mock` and `browser-tauri-mock` (`browser-runtime.ts:11-18`) and calls `installBrowserRuntime()` unconditionally at module scope (`browser-runtime.ts:87`). Because the env value passes through `parseMode()` as an argument, the bundler can't prove the call dead, so `mock.ts` + `fixtures.ts` (~460 lines: demo summaries, French fixture emails, `NOVA-*` ids, the `browser-mock-flow-activation` credential string) land in every page's production JS. I haven't run a production build to measure the actual cost, so this may be small — but it's cheap to fix: make `app/layout.tsx` (or `browser-runtime.ts`) load the mock modules via a dynamic `import()` that only executes when the mode parses, so the dev-only graph is a separate lazy chunk. I did not run a production bundle to confirm the final tree-shaking outcome; the claim is from the static import graph.

---

**`apps/screenpipe-app-tauri/components/automation-flows/fixtures.ts:18`** · **P3 (fixture contradicts engine semantics: a Flow with Activity shows "Never run")**

`fixtureFlow.lastExecution: null` while `fixtureActivity` (returned as the same Flow's Activity by the mock) holds four n8n executions. The engine derives `lastExecution` from n8n `GET /executions?workflowId=…&limit=1` (`crates/screenpipe-engine/src/automation_flows.rs:785-809`), so a real Flow with this activity history would have a non-null `lastExecution` and its list row would show a last run — the mock instead shows "Never run" (`labels.ts:51`) next to a Review Screen listing four runs, including successes. Set `lastExecution` from the newest fixture run (e.g. `{ status: "error", startedAt: "2026-10-17T12:10:00.000Z" }`, which also exercises the red "failed" row path in `flows-tab.tsx:142-145`), or add a comment stating the mismatch is deliberate.

---

**`apps/screenpipe-app-tauri/components/automation-flows/fixtures.ts:45`** · **P3 (same stale "12 seconds" fact as the infra JSON — and the drift test couples the two fixes)**

This sentence repeats the wrong timeout already flagged on `infra/automation-flows/workflows/novadesk-support-tickets.json:136` (the node sets `timeout: 8000` at `:126`), which is expected — the drift test at `__tests__/api.test.ts:371-392` asserts the fixture's per-node `sentence` equals the JSON's `notes`. That's the right kind of test, but note the blast radius: applying the suggested fix to the infra JSON *without* the same edit here turns `api.test.ts` red (I ran the file — 35/35 green today, precisely because both copies are stale together). Update both in the same commit. Since the Review Screen shows these sentences to the user before Activation, the corrected "8 seconds" should land in both.
