# Slice review: `lib/automation-flows/find-automation.ts` + `.test.ts`

Reviewer: reviewer-lib-flows-find · PR #1 · diff base `origin/main` (both files are **new** in this PR, +218 lines).

## What this slice changes

`find-automation.ts` is the in-app half of the hidden ⌃⌥⌘D hackathon demo: `findAutomation()` (find-automation.ts:38-61) looks up the 9 scripted demo captures in this machine's own recordings (`findRecordedFrames`, demo-task/recorded-evidence.ts:76-96), falls back to embedded key-frame images for captures the recording does not hold (find-automation.ts:42-45), installs the scripted Detected Task into the workflow catalog via `upsertTask` (find-automation.ts:47), then posts the "Repetitive task detected" notification (find-automation.ts:51) and reports `{ notified: true }` or `{ notified: false, reason }` (find-automation.ts:36, 53, 58). `desktopFindAutomationDeps()` (find-automation.ts:86-116) wires real dependencies (local search API, disk catalog, app notification server) plus a browser-mock/dev-loop mode. `openDemoTaskPage()` (find-automation.ts:64-67) is the notification's "View task" action.

Fits the PR as the app-side twin of `infra/automation-flows/demo/demo.ts` (stated at find-automation.ts:8-9). Consumers: `components/automation-flows/demo-shortcut-listener.tsx:16,31,33` (imports `desktopFindAutomationDeps` and `openDemoTaskPage`); sequencing/UX handling lives in `demo-shortcut.ts:34-68`. I read those consumers plus `demo-task/catalog.ts`, `demo-task/detected-task.ts`, `demo-task/recorded-evidence.ts` for context.

## Focus 1 — "abstain-when-unsure from issue #09 must be enforced here"

**Verdict: the premise does not apply to this file, and I verified that against the code.** The file contains no automation matching: its header says "no detection runs; finding repeated work installs the scripted Detected Task" (find-automation.ts:5-6), and it unconditionally installs the hard-coded task built by `buildDetectedTask` (demo-task/detected-task.ts:134-218). There is no confidence value, threshold, or match/no-match decision anywhere in `findAutomation()`. Issue #09's abstain-when-unsure behavior (low AI confidence → no ticket + « À trier à la main » notification) is enforced in the n8n workflow JSON per the issue doc (docs/automation-flows/history/flows-round-two/issues/09-ai-abstains-when-unsure.md:24-34 — the « Confiance suffisante » IF node and the « À trier à la main » HTTP node in `infra/automation-flows/workflows/novadesk-support-tickets.json`), which is a different reviewer's slice. This file therefore cannot violate the abstain rule because it makes no decision. The nearest in-file analog of an abstain/no-match outcome — `{ notified: false, reason }` — is correctly typed (find-automation.ts:36) and correctly consumed (demo-shortcut.ts:59-62: presenter told why, Task Page opened directly). One caveat for the lead: the installed task presents a hard-coded `confidence: 0.9` (demo-task/detected-task.ts:156,194) with no detection behind it — that is the documented demo contract (AGENTS.md hackathon mode; detected-task.ts:4-10), not a defect, but it is detection-shaped data produced without matching.

## Focus 2 — do tests cover the abstain/no-match branch?

**Mostly yes for the notification branches, no for two sub-branches.** Covered: gate-suppressed notification → `{ notified: false, reason }` with catalog still saved (find-automation.test.ts:85-89); notify server unreachable → reason from the thrown error (find-automation.test.ts:91-94); unreadable catalog → throws, no save, no notify (find-automation.test.ts:96-101). Not covered (posted as P2):

- the `!response.ok` / non-JSON-body path (find-automation.ts:55-58): no test ever gives `notify` a non-2xx `Response`, so neither the `HTTP ${response.status}` fallback nor the `.json().catch(() => ({}))` fallback (find-automation.ts:55) is exercised — a regression there stays green;
- evidence-image load failure (find-automation.ts:43-44): a `loadImage` rejection throws before `saveCatalog` (find-automation.ts:47) — the correct "never overwrite the catalog on failure" ordering is not pinned by any test.

`openDemoTaskPage` and `desktopFindAutomationDeps` have zero direct tests; the listener test mocks them out (`components/automation-flows/__tests__/demo-shortcut-listener.test.tsx:50-51`).

## Notable risks / quality issues

- **P3 — success detected by exact message string.** find-automation.ts:57 requires `result.message === "Notification sent successfully"`. Verified against the server: `src-tauri/src/notifications/routes.rs:601-602` returns exactly that on success; `routes.rs:344-345` returns `success: true, message: "duplicate notification suppressed"` for gate suppression, so the message really is the only discriminator (the `success` boolean is `true` in both cases). The same literal is independently duplicated in `infra/automation-flows/demo/demo.ts:48`, `crates/screenpipe-engine/src/automation_flows/failures.rs:331`, and `packages/n8n-nodes-screenpipe/nodes/ScreenPipe/ScreenPipe.node.ts:332` — an established convention, so correct today but brittle if the server copy is ever reworded. Posted as P3 (shared constant).
- Error-detail loss in the desktop `notify` wiring: the `.catch()` at find-automation.ts:111-113 replaces the underlying network error with the generic "Screenpipe's notification server does not answer". Acceptable for demo tooling; noted, not posted.
- Mock-mode `JSON.parse(raw)` (find-automation.ts:95) can throw on corrupted localStorage; it surfaces as "Demo not started" via demo-shortcut.ts:55-57. Dev-only path, acceptable.
- Security: clean. Search auth goes through `localFetch`, which only attaches the bearer key to the local API (lib/api.ts:242-255); the notify payload is built from constants (demo-task/detected-task.ts:28-41); the browser-dev guard at find-automation.ts:104-106 prevents `bun run dev:web` from reaching a real machine's notification server. That guard is a safety property with no test pinning it (folded into the posted test-gap comment's scope? no — mentioned here only; it is env-gated demo tooling).
- Performance: 18 sequential searches (9 captures × 2 sides, recorded-evidence.ts:68-69) with bounded timeouts/retries (recorded-evidence.ts:48-55). Not on the recording hot path; user-initiated and guarded against concurrent presses (demo-shortcut.ts:35-37). No concern.
- Test-helper nit (not posted): `recordedEverything` uses a non-null `!` on `.find()` (find-automation.test.ts:18-19); safe under the current query construction (every lookup puts `capture.at` in `start_time` or `end_time`, recorded-evidence.ts:41-42) but would fail with a confusing TypeError if the query shape changed.

## Checks run (exact commands, from `apps/screenpipe-app-tauri`)

1. `NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/vitest run lib/automation-flows/find-automation.test.ts --config vitest.config.ts` → **7 passed** (0.73 s). First attempt with `bun x vitest` failed at startup with `Cannot find module '@vitejs/plugin-react'` — `bun x` resolved a home-directory vitest (`/Users/arthrod/node_modules`), an environment issue, not a test failure; rerun with the app's local binary. This is a single-file run, not the full frontend suite.
2. `NODE_OPTIONS=--no-experimental-webstorage ./node_modules/.bin/vitest run lib/automation-flows/demo-shortcut.test.ts --config vitest.config.ts` → **8 passed** (0.57 s) — the direct consumer of `findAutomation`.
3. `git diff origin/main...HEAD --stat` for the two files → 102 + 116 insertions, both files new.
4. Evidence images referenced by `evidenceDataUrl` verified to exist: 9 `.webp` files under `apps/screenpipe-app-tauri/public/automation-flows/demo-evidence/`.

## Comments posted

Two comments (one P2 on the test file's uncovered no-match sub-branches, one P3 on the string-matched success contract). Nothing duplicated from the existing PR feedback — none of the 13 existing line-specific comments (all coderabbitai[bot]) touch these two files.
