# 21: Switching a Flow off never orphans the execution in progress

Spec: stories 31 (each email processed once — never lost either), 36 (a change
to an active Flow switches it off first). Found in rehearsal 3 (2026-10-17).

**What happened:** the bug email arrived 5 s after « Activer »; n8n's IMAP
trigger fetched it, marked it read and started execution 22. Fifteen seconds
later the chat change unpublished the workflow. Execution 22 stayed `running`
with no node run, forever; the email, already read, was lost (no ticket).
Rehearsal 2 only escaped because its execution finished 2 s before the pause.

**What to build:** before the Flow service unpublishes an active workflow —
chat modification (`PUT /automation-flows/:id`) and deactivation
(`POST /:id/deactivate`) — it waits while n8n reports a running execution of
that workflow (`GET /executions?workflowId=<id>&status=running`), polling
about every second, up to a bounded time (≈90 s; the demo's AI step takes
10–25 s). If one is still running at the deadline, it changes nothing and
answers `409 {error: "flow_running", detail}`; the client and the
`automation-flows` skill say to try again in a moment. Activation is
unchanged.

**Blocked by:** None.

**Status:** done (live: a chat change sent while execution 24 ran waited for it, the ticket was created, then the Flow paused; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] Engine tests (fake n8n): a running execution that finishes → the change/deactivation waits, then unpublishes; one still running at the deadline → 409 `flow_running`, no unpublish, no history entry; none running → immediate as today.
  `switching_off_waits_for_the_email_being_processed` (Désactiver and a chat change of an active
  Flow; the fake n8n records any execution still running at unpublish as orphaned: none),
  `a_flow_still_processing_at_the_deadline_is_left_running_with_409` (no n8n write, still active,
  history unchanged), `switching_off_an_idle_flow_asks_n8n_once` (one poll, then unpublish).
- [x] Review Screen « Désactiver » and the chat show the `flow_running` message; skill updated.
  `flows-tab.test.tsx`: « Désactivation impossible » + « n8n traite encore un e-mail avec ce Flow :
  rien n'a changé. Réessayez dans un instant. ». Skill: `409 flow_running` → wait a minute, send the
  same request once more, then tell the user.
- [x] Live (orchestrator): bug email, then the chat change while it is processed → the ticket is created, then the Flow is paused.

## What was built

- `RunningWait {interval, deadline}` (default 1 s / 90 s), a public `SCServer.flow_running_wait`
  passed to the Flow router; tests use 10 ms / 300 ms.
- `N8nApi::unpublish` polls `GET /executions?workflowId=<id>&status=running&limit=1` and unpublishes
  once nothing runs; at the deadline it answers `409 {error: "flow_running", detail}` and changes
  nothing. Every unpublish goes through it: `POST /:id/deactivate`, `PUT /:id` of an active Flow
  (after the edit is validated, before anything changes), and `from-task`'s pre-imported copy left
  on. The write lock is held while waiting, so a second click waits and then sees the Flow off.
- Commands and results: see ticket 22 (same branch, same runs).

## Notes

- The poll and the unpublish are two calls: an execution n8n starts in between (an email arriving
  in that instant) can still be cut. The 90 s bound means a Review Screen click can take that long
  with no progress indicator beyond the disabled buttons.
- An executions call that fails (non-2xx) fails the switch-off (`n8n_failed`) rather than
  unpublishing blind.

## Follow-up (second-pass review, 2026-10-17 16:20)

An execution n8n reports as running forever (a hung AI call before the 30 s
model timeout, a crash) would block every « Désactiver » (90 s, then 409).
The user's own click now switches off at the deadline anyway; a chat change
or a non-UI caller still gets `409 flow_running` and nothing changes. Test:
`the_users_desactiver_switches_off_even_when_an_execution_never_ends`.
