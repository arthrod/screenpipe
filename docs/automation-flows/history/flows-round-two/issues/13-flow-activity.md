# 13: Flow Activity on the Review Screen (D18)

**What to build:** The Review Screen lists the Flow's Activity: for each handled email, the outcome (ticket, ignored, abstained, failed) and the reason, read from n8n's executions.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 09, 11

**Status:** done, live check pending: the Activity of the real demo Flow after a ticket, an ignored email, an abstention and a failure (see below)

- [x] The service derives each run's outcome and reason from n8n execution data.
- [x] The Review Screen shows the Activity list, newest first.
- [x] Engine integration tests cover each outcome; a component test covers the list.

## How it works

- Engine: `GET /automation-flows/:id/activity`
  (`crates/screenpipe-engine/src/automation_flows/activity.rs`) reads the
  Flow's latest 20 executions with `includeData=true` and returns, newest
  first, `{executionId, startedAt, outcome, reason, email, ticket}`. Running
  runs are left out (not handled yet). Nothing is stored: n8n is the source.
  - `failed`: n8n status not success; reason « Échec à l'étape « … » : … »
    (same wording as the D16 notification).
  - `ticket`: a step output Jira's created issue (`{key, self:
    …/rest/api/…/issue/…}`, « Créer le ticket Jira »), or a D20 Jira search
    found the email's ticket (`{issues: [{key|id}]}`); `ticket` = its key.
  - `abstained`: the AI's `output.confidence` is not `high` (the same gate as
    « Confiance suffisante »).
  - `ignored`: the AI answered and no ticket was made.
  - `done`: no AI answer at all (a Flow without an AI decision, e.g. a
    chat-made schedule Flow).
  - `reason` is the AI's `output.reason` (ticket 09); `email` is the
    trigger's first item `from`/`subject` (shared with the D16 notification).
- App: `components/automation-flows/flow-activity.tsx`, section « Activité »
  between the graph and the activation history; re-read with the Review
  Screen (focus, visibility, interval). Browser mock serves one run per
  outcome (`fixtureActivity`).

```
Activité
┌────────────────────────────────────────────────────────────────┐
│ Échec (red)            17/10/2026 14:10                        │
│ Claire Martin <claire.martin@client.fr> · « Export PDF vide… » │
│ Échec à l'étape « Créer le ticket Jira » : 503 Service Unav…   │
├────────────────────────────────────────────────────────────────┤
│ À trier à la main      17/10/2026 13:20                        │
│ Loris Omont <…> · « Les relances, c'est normal ? »             │
│ Je ne sais pas si c'est une question d'usage ou un défaut…     │
├────────────────────────────────────────────────────────────────┤
│ Ignoré · Ticket NOVA-28 créé …                                 │
└────────────────────────────────────────────────────────────────┘
```

Integration notes: ticket 10's dedupe node must output Jira's search answer
(`issues`) for a hit to show as « Ticket … créé »; if it outputs something
else, adjust `existing_issue` in `activity.rs`. Ticket 12 (Retry) can add a
« Relancer » button on `failed` rows (each row has its `executionId`).

## Live check (ticket 16)

1. Open the demo Flow's Review Screen after real runs: a bug email shows
   « Ticket NOVA-n créé » with the AI's reason; the Google security alert
   « Ignoré »; an ambiguous email « À trier à la main »; a forced failure
   « Échec » in red with its step and error; newest first.
2. Confirm n8n 2.42.2's `GET /executions?includeData=true&workflowId=` list
   returns `data.resultData.runData` per execution (as the single execution
   route does); if it does not, the rows show no email/reason.
3. Check the Activity reads quickly enough with 20 runs (email bodies are in
   the run data).

## Tests run

After `git merge main` (ticket 07 included) into `ticket-13`:

- `cargo test -p screenpipe-engine --test automation_flows_test` → 89 passed, 0 failed
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed
  (new: `activity_shows_the_ticket_an_email_became_with_the_ais_reason`,
  `activity_shows_an_email_the_ai_was_unsure_about_as_abstained`,
  `activity_shows_an_email_that_needed_no_ticket_as_ignored`,
  `activity_lists_handled_emails_newest_first_with_the_failed_ones_and_why`,
  `activity_shows_the_ticket_an_email_already_had_when_creation_was_skipped`,
  `activity_of_a_flow_without_an_ai_answer_says_its_runs_went_through`;
  the fake n8n execution list now honours `limit` and `includeData`).
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bunx vitest run components/automation-flows`
  → 3 files, 88 passed (new: Activity list newest first with each outcome,
  empty Activity, API route, browser-mock Activity).
- `bunx tsc --noEmit -p .` → no error in `components/automation-flows`.
