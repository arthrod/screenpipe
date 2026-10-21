# Slice review: hackathon issue docs 01–07 (`docs/automation-flows/history/hackathon/issues/01…07`)

PR #1 (`arthrod/screenpipe`, diff base `origin/main`). The seven files in this slice are all **new** (355 added lines, no deletions): the per-ticket record of the first seven hackathon tickets — what to build, status, ticked acceptance items, and (for 02/05) a verification table of exact commands, counts and screenshots. My focus per the ask: **each closed item must cite real evidence (test or screenshot), not claims**, plus the per-doc focus notes (02 flows tab + task page entry, 03 evidence/notification vs demo code, 04 user-only activation, 05 graph evidence, 06 create-automation draft behavior, 07 node tool description).

## Verdict

The docs are unusually well-evidenced: nearly every claim I traced to code, tests, screenshots or the shared live-check log held up, including at ticket-time git states. I found **3 × P2 and 1 × P3**, all documentation-integrity issues, no code problems in this slice (the slice is docs-only).

## What I verified, per doc

### 01-golden-path-n8n.md — evidence citations real
- `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md` exists and contains everything the checkboxes cite: NOVA-33 (line 47), NOVA-34 (line 92), NOVA-35 (line 96), NOVA-32 as Tâche (line 48), "6 × `type: none`" security alerts (line 42), newsletter → none (line 49), `docker restart` with 0 new executions in 90 s (line 97).
- "Documented in `SPEC.md`: activate vs publish" — real: `docs/automation-flows/history/hackathon/SPEC.md:32` (D7) documents n8n 2.42.2 `POST /workflows/{id}/publish`/`unpublish` with `activate`/`deactivate` deprecated.
- "Export contains no secrets" — checked `infra/automation-flows/workflows/novadesk-support-tickets.json`: the only credential hits are n8n credential *name/id references* (e.g. `"name": "Gmail account"`), no key material; the plain-language summary lives in `novadesk-support-tickets.review.json`.
- Note (not posted): the body's "email quoted in the description" reflects the pre-2026-10-18 spec; SPEC.md:34 (D9) was later changed to "never the pasted email". The checkbox's cited evidence (NOVA-33/34/35, created 10-17) is real under the rule of that day, and D9 records the change, so it reconciles — I left it out of the posted comments.

### 02-flow-from-task-and-flows-tab.md — flows tab + task page entry
- All 11 cited engine test names exist: `crates/screenpipe-engine/tests/automation_flows_test.rs:764,805,898,935,951,1079,1095,1134,1324,1403,1441` (`not_configured_returns_412` … `review_is_outdated_while_n8n_runs_an_older_version_than_its_draft`).
- All 4 cited n8n-connection tests exist: `crates/screenpipe-connect/src/connections/n8n.rs:136,173,199,215`.
- The three screenshots exist: `docs/automation-flows/history/hackathon/screenshots/02-flows-list.jpg`, `02-review-screen.jpg`, `02-n8n-not-configured.jpg`.
- `fxNovaDesk01` (doc line 50) was the real fixture id at ticket time (`git show b983d7aa4:…/fixtures.ts` → `id: "fxNovaDesk01"`); commit `dd1a1a9ff` ("mock fixture mirrors ticket 01") replaced it with `spNovaFlow000001` (now `apps/screenpipe-app-tauri/components/automation-flows/fixtures.ts:15`). Accurate history, but the repro URL now dead-ends → P3.
- **Stale status**: line 21 says `ready-for-agent` while every checkbox is `[x]` and a full verification table follows → P2 (shared with 03 and 05).

### 03-demo-task-evidence-notification.md — claims match demo code (verified at HEAD unless noted)
- `demo.ts` prints `Installed ${DEMO_TASK_ID} …` (`infra/automation-flows/demo/demo.ts:83`) and `Notification shown …` (`demo.ts:54`); it requires the route answer `Notification sent successfully` (`demo.ts:48`); the failure path exits 1 (`demo.ts:87`).
- `duplicate notification suppressed` is the app's notification-route answer: `apps/screenpipe-app-tauri/src-tauri/src/notifications/routes.rs:345`, gated by the 90 s repeat window `DEFAULT_REPEAT_COOLDOWN_MS: i64 = 90_000` (`apps/screenpipe-app-tauri/src-tauri/src/notifications/gate.rs:264`).
- `routeNotificationDeeplink` navigates to `/home?mode=workflows&reviewRequest=…&workflow=<id>` exactly as claimed: `apps/screenpipe-app-tauri/lib/notifications/actions.ts:179-187`.
- Embedded-image path: `isEmbeddedScreenshot` = negative `frameId` + `/^data:image\/(jpeg|png|webp);base64,/` (`packages/workflows-ui/src/screenshots.ts:8-11`); `serializeWorkflowData` strips `dataUrl` only for `frameId > 0` (`screenshots.ts:26-31`); engine `discard_screenshot_pixels` likewise (`crates/screenpipe-core/src/workflows/mod.rs:1272-1283`).
- Catalog write path: `SCREENPIPE_WORKFLOWS_DIR` override and `~/Library/Application Support/screenpi.pe/workflows` (`infra/automation-flows/demo/catalog.ts:19-22`), backup + `renameSync` (`catalog.ts:95`).
- "nothing to reset" and the file list (`detected-task.ts`, `evidence/*.webp`, …) are **accurate at ticket time** — verified in the ticket-03 commit `773a74fc1` (`git show 773a74fc1:infra/automation-flows/demo/reset.ts` line 19; commit stat shows exactly the 9 webps + `detected-task.ts`). At HEAD ticket 15 moved evidence to recorder frames and the fixture to `apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task.ts` — expected evolution of a history doc, not flagged.
- Screenshot `issues/assets/03-task-page.jpg` exists. Ticket tests cited exist (`components/workflows/demo-task-evidence.test.tsx`, `step-evidence.test.tsx`, `lib/workflows/guide-images.test.ts`).
- Ran `bun test infra/automation-flows/demo`: **25 pass, 0 fail** (3 files; the doc's 6/6 was one file at ticket time — count grew with tickets 15/16, consistent).

### 04-activation.md — user-only activation enforcement
- Engine behavior matches the doc: `409 {"error": "version_changed"}` (`crates/screenpipe-engine/src/automation_flows.rs:497`), `502 activation_failed` (`automation_flows.rs:508`), and ticket 14's `403 activation_requires_user` (`automation_flows.rs:524`).
- "No code path activates a Flow without a user click" is **true at HEAD** — the only engine-side entry points are the HTTP handlers `activate_flow`/`deactivate_flow` (`automation_flows.rs:1470,1535`); frontend activation happens only in `flow-activation.tsx:60-90` on a button click — **but the doc cites no evidence for this checkbox** (no test/command/screenshot). The enforcement + evidence landed in ticket 14 (engine test asserts `activation_requires_user` at `crates/screenpipe-engine/tests/automation_flows_test.rs:1951,2092`; live: `LIVE-CHECKS.md:90,106`) → P2: point the checkbox at that.
- Known and already commented on the PR by coderabbitai (`flow-activation.tsx:60-69`): on `version_changed` the same click activates the newest, not-yet-read version (`flow-activation.tsx:64-68`). Not duplicated here.

### 05-graph.md — graph evidence
- `apps/screenpipe-app-tauri/components/automation-flows/flow-graph.tsx` substantiates the claims: `@xyflow/react` (line 12-23), `flow-node-<id>` test id (line 69), read-only (`nodesConnectable/nodesDraggable=false`, `deleteKeyCode=null`, lines 300-309), dashed context links (line 265), neutral placeholder `"No explanation for this step."` (line 46), wheel scrolls the page (lines 297-299), screenshot `screenshots/05-review-screen-graph.jpg` exists. Layout details (1.3× vertical etc.) were later reworked (uniform `ROW_HEIGHT`/`COLUMN`, context rows) — historical doc, not flagged.
- **Ran the doc's exact verification command**: `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx` (in `apps/screenpipe-app-tauri`) → **1 failed, 127 passed**. The failure (`flows-tab.test.tsx:790`, caption regex `/Oct 17, .+ · Gmail, Jira$/` vs fixture timestamp `2026-10-17T02:05:41Z`) is **timezone-dependent**: this machine is EDT, so the timestamp renders Oct 16. Re-ran with `TZ=Europe/Paris …` → **70/70 pass**. The doc records counts that only reproduce in Europe/Paris → P2 (02's verification table has the same fragility; 02:42 documents the Node/`localStorage` env quirk but not the TZ one).
- `flow-graph.test.tsx` now holds 14 cases (doc says 7) — later tickets added cases; consistent growth, not flagged.

### 06-task-page-create-automation.md — create-automation draft behavior
- Platform capability exists: `packages/workflows-ui/src/platform.ts:48` (`createAutomationFlow?(taskId, answers)`); desktop host `apps/screenpipe-app-tauri/lib/workflows/automation-flows.ts:43`, navigation `pipes&tab=flows&flow=<id>` + `navigate` emit + `switch-pipes-tab` (`automation-flows.ts:114,163,183`) — matches the implementation notes.
- `components/workflows/task-page-create-flow.test.tsx` covers the ticked claims: disabled-until-answered (line 43), page unchanged without the capability (line 55), "saves the answers, then asks the host once" (line 219), "shows why creation failed, keeps the answers and allows a retry" (line 256), locked until Review Screen shows (line 270, the double-click guard).
- **Draft behavior** (my focus) is evidenced: engine test `create_from_task_imports_switched_off_and_tagged` (`automation_flows_test.rs:898`, asserts Draft) and live record `LIVE-CHECKS.md:87` ("Review Screen « Brouillon » … n8n: one workflow …, inactive, tag `screenpipe-flow`"), plus idempotent re-click (`LIVE-CHECKS.md:88`). Screenshots `issues/assets/06-task-page-disabled.jpg` / `-enabled.jpg` exist. No findings.

### 07-screenpipe-node-ai-tool.md — node tool description accuracy
- "Two operations, search content and activity summary, usable as step and AI tool" — accurate at ticket time: `git show 022b8c7f3:packages/n8n-nodes-screenpipe/nodes/ScreenPipe/ScreenPipe.node.ts` shows exactly `searchContent`/`activitySummary` with `usableAsTool: true`. At HEAD a third `notify` operation exists (dispatcher `ScreenPipe.node.ts:231`), added by commit `1955e12b8` — history, not flagged.
- "Tool returned the real NOVA-25 captures; live runs created NOVA-32/33" — `LIVE-CHECKS.md:57` and `:47-48` confirm.
- "Build step copies into the mounted custom-nodes folder; built output never committed" — `packages/n8n-nodes-screenpipe/scripts/build.ts:41-56` (finds the `/home/node/custom-nodes` mount, refuses a non-gitignored folder); `git ls-files packages/n8n-nodes-screenpipe | grep dist/` → 0 tracked. Package tests exist (`test/screenpipe.node.test.ts` etc.). Fixture has the tool wired (`CUSTOM.screenPipe` at `infra/automation-flows/workflows/novadesk-support-tickets.json:193,392`). No findings.

## Risks / quality issues (posted)
1. **P2** — Stale `Status: ready-for-agent` on fully-completed docs 02 (`:21`), 03 (`:18`), 05 (`:13`); every sibling completed ticket says "done". Breaks the docs' value as an audit trail.
2. **P2** — Issue 04's "No code path activates a Flow without a user click" (`:18`) is a bare claim with no cited evidence; ticket 14 later enforced and evidenced it — cite it.
3. **P2** — The "exact commands" recorded in 02/05 are timezone-fragile: I ran 05's command and got a reproducible failure outside `TZ=Europe/Paris` (`flows-tab.test.tsx:790`), 70/70 pass with the TZ set. Pin the TZ in the docs or fix the assertion.
4. **P3** — Issue 02's Review Screen URL uses the removed fixture id `fxNovaDesk01` (`:50`; now `spNovaFlow000001`, `fixtures.ts:15`).

## What I did NOT run
- `cargo test -p screenpipe-engine --test automation_flows_test`, `cargo test -p screenpipe-engine --lib automation_flows`, `cargo test -p screenpipe-connect --lib connections::` — **not run** (Rust compile cost); the cited test *names* were verified to exist by grep, counts taken on trust.
- The full frontend suite, `bun run dev:web` browser-mock URLs, and any native-app run — not run.
- The physical/live claims (NOVA tickets, docker restart, notification clicks) are taken from `LIVE-CHECKS.md`, which self-describes as observed on the demo machine; I could not re-observe them.
