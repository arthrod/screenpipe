# Slice review — Automation Flows UI: activation, activity, delete, health banner

Reviewer slice of PR #1 (`arthrod/screenpipe`, head = this checkout, base = `origin/main`).
All four files in this slice are **new** (398 insertions, 0 deletions):
`git diff origin/main...HEAD --stat -- <4 files>` → flow-activation.tsx +114, flow-activity.tsx +161,
flow-delete.tsx +96, health-banner.tsx +27.

## What this slice is and how it fits the PR

These four components are the Review Screen's control layer for Automation Flows:

- **`flow-activation.tsx`** — the `useFlowActivation` hook (Turn on / Pause / Dismiss / Restore) plus
  `FlowActivationNotices`. All actions funnel through `run()` (flow-activation.tsx:74-90) with a
  single `busy` flag; `activate()` handles the engine's `version_changed` by re-reading and activating
  the newest version in the same click (flow-activation.tsx:62-71). Consumers: `flow-review.tsx:90-156`
  (every action button is `disabled={busy}` — flow-review.tsx:121,140,146,152).
- **`flow-activity.tsx`** — the D18 run history: newest-first `FlowRun` list, 3-row preview with
  « Show all », empty/loading/error states, and D17 « Retry » per failed run with per-run busy/done/error
  state (flow-activity.tsx:27-88, 91-146) and error-code-specific copy (:161-176).
- **`flow-delete.tsx`** — two-step delete: first click only reveals "Delete for good" + Cancel
  (:31, 50-72), `busy` disables both (:56, 62), errors surface in a `role="alert"` block (:78-90).
  Used in the list rows (flows-tab.tsx:148) and the Review Screen header (flow-review.tsx:127).
- **`health-banner.tsx`** — reads the engine's last health check via `useFlowsLoad` and shows
  "n8n is unreachable: your Flows are not running" only for `n8n === "unreachable"` (:17-27);
  mounted at the top of the Flows tab (flows-tab.tsx:37).

Together they implement the PR's "user turns a Flow on, from the Review Screen, on the version they
read" and "delete asks once more" rules, backed by the engine's `/automation-flows/*` routes
(`api.ts:277-368`).

## Verification I ran

- **Pause-waits-for-running (issue #21), UI↔engine contract** — confirmed in the engine:
  `unpublish` polls n8n every 1 s up to a 90 s deadline and returns `409 flow_running` with nothing
  changed (crates/screenpipe-engine/src/automation_flows.rs:186-206, 849-871); `deactivate_flow`
  passes `user_stop = (by == "user")` (:1559) where `from_user` is the UI credential (:1459-1464);
  `delete_flow` passes `false` — deletion never force-stops (:1604-1610). The UI handles
  `flow_running` for both (flow-activation.tsx:17-18/106, flow-delete.tsx:17-18/86) and both copy
  strings are covered by tests (flows-tab.test.tsx:656-672, 920-939). The **engine side of issue #21
  works on the first click**; my finding below is about the Pause copy misdescribing the second click.
- **Health-banner truthfulness** — engine states are `reachable | unreachable | unauthorized |
  not_configured | failed | unknown` (health.rs:113-126, 271-281), paced 15 min / 30 s-while-down
  (health.rs:39-57), matching the file's header comment. The banner's `unreachable`-only condition is
  the truthful choice: `unauthorized`/`not_configured` mean ScreenPipe's API access failed, not that
  n8n stopped executing active workflows, and those states already surface through the list's error
  panels (common.tsx:243-276).
- **Delete cannot fire twice** — confirmed: `disabled={busy}` on both confirm buttons
  (flow-delete.tsx:56,62), and engine-side idempotent + serialized (404 counts as deleted,
  automation_flows.rs:873-883; `write_lock`, :1586). Confirmation flow tested
  (flows-tab.test.tsx:869-891: "A first click only asks").
- **Activity rendering** — outcome labels, red failure styling, reason text, email line, empty state
  and preview folding are all asserted (flows-tab.test.tsx:388-455); retry paths including
  "failed again", engine refusal codes, and `retried` hiding the button (:477-558). Engine
  `retried` semantics (`retryOf`/`retrySuccessId`, activity.rs:26-28, 65-72, 104) match the UI's
  rendering (flow-activity.tsx:112-118).
- **Tests** (scoped file, not the whole suite): `cd apps/screenpipe-app-tauri && bun vitest run
  components/automation-flows/__tests__/flows-tab.test.tsx` → **70 tests, 69 passed, 1 failed**.
  The failure is `Review Screen > shows each time the user did the task by hand, as a strip of its
  captures` (flows-tab.test.tsx:776, assertion at :790, "Oct 17, … · Gmail, Jira" caption) — that is
  `flow-learned-from.tsx`, **outside my slice**; flagging it here only because I observed it in the
  shared test file. Every test touching my four files passes.

## Findings (also posted as PR comments)

1. **P2 — Pause's `flow_running` copy invites a destructive retry** (flow-activation.tsx:17-18).
   After the 90 s wait the notice says "nothing changed. Try again in a moment." For a user click the
   engine sets `user_stop = true`, so the invited retry waits another 90 s and then force-unpublishes
   mid-execution — per the engine's own comment the in-flight email is then lost
   (automation_flows.rs:186-189). The same-shaped Delete copy is truthful (never force-stops).
   One sentence of deactivate-specific copy fixes it. Details in comments file.
2. **P3 — Activity presents the engine's capped page as the total** (flow-activity.tsx:31, 53, 86).
   The engine sends at most 20 runs (`ACTIVITY_RUNS = "20"`, no pagination — activity.rs:13, 49-60);
   past 20 runs the UI shows "Activity 20" and "Show all 20" as if complete. Caption or paginate.
3. **P3 — banner truthfulness is test-pinned for only 4 of 6 states**
   (health-banner.tsx:21-22): `unauthorized` and `failed` are untested in the
   "stays away" loop (flows-tab.test.tsx:989-1005).

## Non-findings worth recording

- **Not duplicated from existing PR feedback**: CodeRabbit's Major on flow-activation.tsx:60-69
  (same-click activation of an unread version after `version_changed`) is a different concern from my
  P2 (flow_running pause copy); I did not re-raise theirs. My P2 does not overlap CodeRabbit's
  retry.rs double-retry comment (engine-side, different flow).
- **Double-fire on activation actions**: safe — one `busy` flag disables all four buttons
  (flow-review.tsx:121,140,146,152); React discrete events flush between clicks.
- **Stale async retry across flows**: safe — `FlowActivity` unmounts when `flowId` changes because
  `FlowReview`'s loader flips to `loading` (flow-review.tsx:43,57-62,176), so an in-flight retry's
  `replace` lands on an unmounted hook (no-op).
- **Activity error state has no "Try again"** (flow-activity.tsx:58-61) unlike other surfaces, but it
  self-heals via the 15 s background refresh (common.tsx:86-98); left unposted.
- **RunRow timestamp is a plain span**, not `<time dateTime>` as History uses (flow-review.tsx:207) —
  trivial inconsistency, left unposted.

## Not checked (stated plainly)

- No runtime verification against a real n8n instance; everything above is static reading plus the
  vitest run.
- I did not run the engine's Rust tests (`cargo test -p screenpipe-engine`) — my slice is TS-only;
  engine code was read solely to verify the contract the UI copy depends on.
- I did not run the full frontend suite (`bun run test`), only the scoped flows-tab file named above.
