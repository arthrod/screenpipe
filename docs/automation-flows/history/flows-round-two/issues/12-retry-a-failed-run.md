# 12: Retry a failed run (D17)

**What to build:** The user retries a failed run from the Review Screen or from the failure notification. The email was already marked read and its run and input are kept in n8n, so nothing is lost; with duplicate-safe creation, a retry never makes a second ticket.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 10, 11

**Status:** done, live check pending: a forced failure, fixed then retried, ends in exactly one ticket (see below)

- [x] A retry route calls n8n's execution retry for the Flow's failed run.
- [x] The Review Screen and the failure notification offer « Relancer ».
- [x] Engine integration and component tests cover retry and its errors.
- [ ] A forced failure, fixed then retried, ends in exactly one ticket (live, noted).

## How it works

- Engine: `POST /automation-flows/:id/runs/:run/retry`
  (`crates/screenpipe-engine/src/automation_flows/retry.rs`).
  - Reads the run (`GET /executions/:run`): it must belong to that Flow
    (else `404 run_not_found`), have ended without finishing, and have no
    successful retry yet (`retrySuccessId`), else `409 run_not_failed`. So a
    double click, or « Relancer » in the notification after the Review
    Screen, runs it once.
  - Calls n8n `POST /executions/:run/retry`. n8n 2.42.2 re-runs the failed
    step with the input it kept and answers once the retried run has ended
    (read in the container's `execution.service.js` and
    `executions.public.controller.js`), so the engine waits up to 180 s for
    this call only (the client's 20 s timeout is overridden); still running
    after that → `504 retry_still_running`.
  - `loadWorkflow: true` (the Flow as saved now, so a fix made since runs)
    only when n8n's saved Flow is the version the user reviewed or the one
    n8n publishes. Otherwise (a chat change waiting for review, an
    unpublished n8n draft) the run is retried as it ran: an unreviewed change
    never runs.
  - Answers the retried run as an Activity row (outcome, reason, email,
    ticket). n8n refusing → `502 n8n_failed` with n8n's message.
  - Needs the user's click, like activation: the route refuses a request
    without the UI credential (`403 retry_requires_user`), which only the
    Review Screen and the failure notification's « Retry » (handled by the
    app's webview) send. The chat agent, pipes and MCP clients share the
    local API key and cannot re-run a Flow's emails.
- Notification (`failures.rs` `failure_notice`): a second action
  `{"type": "api", "label": "Relancer", "method": "POST", "url":
  "/automation-flows/<flow>/runs/<run>/retry", "body": {}, "deeplink_url":
  "screenpipe://flows/<flow>"}`. The app's existing `api` action calls it
  with the local API key and, on success, opens the Review Screen. A failing
  trigger (no run) gets no « Relancer ».
- Activity (`activity.rs`): each row gains `retried`: a failed run whose
  retry succeeded, or that a listed run is `retryOf` (a retry that failed
  again: that newer run is the one to retry).
- App (`components/automation-flows/flow-activity.tsx`, `api.ts`, `mock.ts`):
  a failed row not retried yet has « Relancer »; while n8n runs it, « n8n
  relance l'exécution… »; then « Relancé : Ticket NOVA-30 créé » and the
  Activity is re-read (the retried run appears on top), or « La relance a
  encore échoué : … » with the button kept, or the reason it could not run
  (n8n unreachable, not failed, gone, still running). The browser mock
  retries the fixture's failed run into a ticket.
- Contract row added in `docs/automation-flows/history/hackathon/SPEC.md`.

```
Before                                   After
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ Échec (red)    17/10/2026 14:10  │     │ Ticket NOVA-30 créé  17/10 14:30 │
│ Claire Martin · « Export PDF… »  │     │ Claire Martin · « Export PDF… »  │
│ Échec à l'étape « Créer le … »   │     │ L'export PDF est cassé.          │
└──────────────────────────────────┘     ├──────────────────────────────────┤
                                         │ Échec (red)    17/10/2026 14:10  │
  (row with [↻ Relancer] before the      │ Claire Martin · « Export PDF… »  │
   click)                                │ Échec à l'étape « Créer le … »   │
                                         │ Relancé : Ticket NOVA-30 créé    │
                                         └──────────────────────────────────┘
```

Known limit (ticket 10): a run that failed on « Création refusée par Jira »
(Jira refused the ticket three times) runs that Stop and Error again on
retry and fails again; that email needs a fix and a new run.

## Live check (ticket 16)

1. Check the n8n API key in Connexions → n8n may retry executions (n8n
   2.42.2 scope `execution:retry`; owner keys without scopes are fine).
2. Activate the demo Flow, force a failure (e.g. stop the Jira credential
   from working, or point « Chercher le ticket de cet email » at a wrong
   host in n8n and publish), send a bug email: the failure notification has
   « Voir le Flow » and « Relancer »; the Review Screen's Activity shows
   « Échec » with « Relancer ».
3. Fix the cause (restore and publish in n8n), click « Relancer » on the
   Review Screen: « Relancé : Ticket NOVA-n créé », a new row on top, and
   exactly one NOVA ticket with the `mail-…` label. The list's red marker
   goes away (last run succeeded).
4. Force a second failure, fix it, then use « Relancer » from the
   notification: the Review Screen opens, one ticket again. Clicking
   « Relancer » in the notification after a retry from the screen answers
   `run_not_failed` (no second run).
5. In n8n, the retried execution has mode `retry` and the original has
   `retrySuccessId`; check that the n8n list (`GET /executions`) returns
   `retryOf` and `retrySuccessId` (the Activity's `retried` relies on them).
6. Check a retry with the AI step finishes well within 180 s.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 95 passed, 0 failed
  (new: `retrying_a_failed_run_runs_it_again_in_n8n_and_says_how_it_ended`,
  `a_retry_that_fails_again_says_where_and_why`,
  `only_a_failed_run_of_that_flow_is_retried`,
  `a_retry_n8n_refuses_is_reported_with_its_reason`,
  `a_retry_never_runs_a_change_nobody_reviewed_or_published`,
  `activity_offers_to_retry_only_failed_runs_not_retried_yet`; the two
  failure-notification tests now check « Relancer »; the fake n8n gains
  `POST /executions/:id/retry` like 2.42.2's).
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed.
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bunx --env-file=/dev/null vitest run components/automation-flows`
  → 3 files, 94 passed (new: retry then the run it became, a retry that
  fails again, retry errors, « Relancer » only on failed runs not retried,
  API route, browser-mock retry).
- `bunx tsc --noEmit -p .` → no error in `components/automation-flows` or
  `lib/workflows/automation-flows.ts`.

## Later changes

- The retry route requires the UI credential, like activation: a request with
  only the local API key gets `403 retry_requires_user` (see the Engine bullet
  above, rewritten to the shipped policy; the notification's `api` action
  still reaches the route because the app's webview adds the credential).
- « Relancer » is now `Retry`: the UI copy moved to English
  (`components/automation-flows/flow-activity.tsx`). The French strings this
  ticket quotes (notification label, Activity rows, live check) are as they
  shipped then.
