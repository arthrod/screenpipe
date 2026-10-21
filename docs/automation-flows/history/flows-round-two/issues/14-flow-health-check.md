# 14: Flow health check (D19)

**What to build:** At app start and every 15 minutes, ScreenPipe checks its Flows: when n8n is unreachable a banner says « n8n injoignable, tes Flows ne tournent pas »; failed runs since the last check become notifications (catching failures that happened while the app or n8n was down); drafts left under construction more than 24 hours without a change are deleted.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 07, 11

**Status:** done, live check pending: banner with n8n stopped, a failure missed while the app was down notified at start, see below

- [x] The check runs at start and every 15 minutes.
- [x] An unreachable n8n shows the banner; it disappears once n8n answers.
- [x] Failed runs since the last check produce one notification each, never twice.
- [x] Building drafts unchanged for 24 hours are deleted.
- [x] Engine integration and component tests cover each part.

## Where it runs, and why

In the engine, as a tokio task spawned with the `/automation-flows` router
(`SCServer::flow_health_schedule`, default every 15 min; `None` in tests).
That is how the engine's other periodic work runs (meeting-summary
finalizer, coverage sampler, telemetry reporters, OAuth refresh and memory
sync schedulers), and the engine is what holds the n8n key, the Flow store
and the D16 failure notice. It runs at engine start, i.e. at app start (the
desktop embeds the engine), whether or not a window is open; a webview timer
would stop with the window and need the n8n key. The task is aborted when
its router is dropped (an engine restart builds a new one). The app only
reads the last result for its banner.

## How it works

- Code: `crates/screenpipe-engine/src/automation_flows/health.rs`; routes
  `GET /automation-flows/health` (last result, no n8n call) and `POST` (check
  now). Result `{checkedAt, n8n, notified[], pendingNotifications[],
  deletedDrafts[]}`; `n8n` is `reachable`, `unreachable`, `unauthorized`,
  `not_configured`, `failed` or `unknown` (before the first check).
- Schedule: at start, then every 15 min; every 30 s while n8n is
  unreachable or a failed run could not be handed to the notification server
  (so the banner goes, and the notification comes, soon after they are back).
- Failed runs: per Flow (tag `screenpipe-flow`, not building), the latest
  100 executions; `error`/`crashed` ones that stopped since the last complete
  check (the first check looks 24 h back) are notified with ticket 11's
  `failure_notice` (same id, deeplink, sender and subject). The ledger
  `<data dir>/automation-flows-health.json` records each notified run; the
  error workflow's `POST /:id/failures` goes through the same ledger, so a run
  is never notified twice, whichever path saw it first, across restarts too.
  A run the notification server did not take stays pending (the watermark
  does not advance); a run it gated (pause, quiet hours) counts as handled.
- Drafts: workflows tagged `screenpipe-flow-building` plus store records
  `building: true`, unchanged for 24 h (n8n `updatedAt`, else the record's
  `createdAt`) are deleted in n8n and in the store; a record whose workflow is
  gone is cleared. A finished Flow is never touched.
- App: `components/automation-flows/health-banner.tsx` above the Flows list
  and the Review Screen, red bordered `role="alert"` « n8n injoignable, tes
  Flows ne tournent pas » while `n8n` is `unreachable`; read on the Flows
  screens' refresh rhythm (15 s, focus). Browser mock: `?flowsState=unreachable`.
  Contract row added in `docs/automation-flows/history/hackathon/SPEC.md`.

```
Flows tab, n8n stopped
┌────────────────────────────────────────────┐
│ n8n injoignable, tes Flows ne tournent pas │  (red border)
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ Impossible de joindre n8n …   [Réessayer]  │  (existing list error)
└────────────────────────────────────────────┘
```

## Live check (ticket 16)

1. With the app running on a rebuilt engine, `GET :3030/automation-flows/health`
   shows `n8n: "reachable"` and a `checkedAt` from app start.
2. Stop n8n (`docker stop automation-flows-n8n-1`, integrating session only):
   within 30 s the Flows tab shows the banner; start it: it goes within ~45 s.
3. Quit the app, make the demo Flow fail (see ticket 11), start the app: one
   « Échec du Flow … » notification at start, none at the next checks.
4. A fresh chat draft survives `POST :3030/automation-flows/health`
   (`deletedDrafts: []`); deletion after 24 h is proven by the engine test only.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 95 passed
  (6 new: unreachable then reachable, failed runs notified once each, error
  workflow and check never both notify a run, a missed notification retried,
  24-hour drafts deleted with recent drafts and finished Flows kept, the
  scheduled check at start and on its period). The ledger guard and the 24 h
  threshold were each disabled once: 2 tests failed, then restored.
- `cargo test -p screenpipe-engine --lib automation_flows` → 4 passed (1 new: 15 min / 30 s schedule).
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bunx vitest run components/automation-flows lib/workflows/automation-flows.test.ts`
  → 4 files, 107 passed (3 new banner tests, seen red first).
- `bunx tsc --noEmit -p .` → no error in `components/automation-flows`.
