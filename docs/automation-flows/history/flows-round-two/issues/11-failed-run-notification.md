# 11: Notification on a failed run (D16)

**What to build:** When a Flow run fails, an n8n Error Workflow alerts ScreenPipe: a notification names the email's sender and subject and opens the Flow's Review Screen; the Flow shows red in the list. Nothing is paused.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** None (can start immediately)

**Status:** done, live check pending: forced failure → notification → Review Screen, red row (see below)

- [x] Flows get an Error Workflow that posts the Flow id, sender and subject to ScreenPipe's notify server.
- [x] The notification deep-links to the Review Screen.
- [x] A Flow whose last run failed is red in the list and stays active.
- [x] Tests cover the error-workflow wiring, the notification input and the red state; a forced failure is checked live and noted. (live part pending, ticket 16)

## How it works

- n8n does not hand a failed run's input to an error workflow, so the path is
  n8n → engine → notify server:
  - ScreenPipe installs one n8n workflow « ScreenPipe — échecs des Flows »
    (tag `screenpipe-flow-errors`, never `screenpipe-flow`: not a Flow, not
    listed; switched off, since n8n runs error workflows without activation):
    Error Trigger → HTTP Request `POST http://host.docker.internal:<api port>/automation-flows/{{ $json.workflow.id }}/failures`
    `{executionId, error}`, authenticated with the only `screenpipeApi`
    credential n8n holds (wired by `check_and_wire`). Without exactly one such
    credential it is not installed (warning; D19's health check still covers failures).
  - Every Flow written by ScreenPipe names it in `settings.errorWorkflow`:
    `POST /` (chat), `POST /from-task` (fresh import) and `PUT /:id` (chat
    change, even when the chat drops the setting). Part of the first version,
    so the reviewed version is unchanged. Naming it never blocks a write.
  - `POST /automation-flows/:id/failures` reads the execution
    (`includeData=true`, must belong to that Flow, else 404), takes `from` /
    `subject` of the first node's first item (IMAP simple or resolved format),
    the failing step and error, and posts to the notify server
    (`SCREENPIPE_FOCUS_PORT`, default 11435): title « Échec du Flow « name » »,
    body « E-mail de … : « … ». / Échec à l'étape « … » : … / Le Flow reste
    actif. », id `automation-flow-failure:<flow>:<execution>` (one
    notification per run, D19 can reuse `failure_notice`), deeplink action
    « Voir le Flow » `screenpipe://flows/<id>`. Nothing is written to n8n.
- App: `screenpipe://flows/<id>` from a notification brings Home up on
  `pipes&tab=flows&flow=<id>`; Home's `navigate` listener now switches the
  Automations view to that Flow (`followFlowsNavigation`), which also fixes the
  Chat overlay link when Home was already open on another section.
- List: a Flow whose `lastExecution.status` is `error` has a red marker and a
  red « Dernière exécution : … · en erreur » line; its status label is
  unchanged (« Active »).

```
Before (marker ink, line grey)            After (marker and line red)
Support NovaDesk               ■ Active   Support NovaDesk               ■ Active
Dernière exécution : 17/10 · en erreur    Dernière exécution : 17/10 · en erreur
```

Code: `crates/screenpipe-engine/src/automation_flows/failures.rs`,
`automation_flows.rs` (route, three `name_error_workflow` calls, tag helpers
take a name), `server.rs` (`flow_failure_reports`),
`apps/screenpipe-app-tauri/lib/notifications/actions.ts`,
`lib/workflows/automation-flows.ts`, `app/(main)/home/page.tsx`,
`components/automation-flows/{flows-tab,common}.tsx`. Contract row added in
`docs/automation-flows/history/hackathon/SPEC.md`.

Integration notes: ticket 07's « Terminer » / draft routes must also call
`failures::name_error_workflow` before writing the workflow; ticket 12 (Retry)
can add a « Réessayer » action to `failure_notice`; ticket 14 (health check)
can build its notifications with `failure_notice` (same id, so a run reported
by both is shown once). An adopted copy installed by `import-workflow.sh` is
not given the setting (the demo reset deletes it, so `from-task` imports fresh).

## Live check (integrating session, ticket 16)

1. Create the demo Flow from the Task Page; in n8n, check that
   « ScreenPipe — échecs des Flows » exists, is off, has the ScreenPipe API
   credential, and that the Flow's settings name it as Error Workflow.
2. In the error workflow's HTTP node, confirm the URL port is the running
   engine's (3030) and that n8n accepts `predefinedCredentialType` =
   `screenpipeApi` (Bearer header).
3. Activate, force a failure (e.g. temporarily break the Jira node's URL in a
   copy, or stop the proxy), send a real email: a notification « Échec du Flow
   … » names the sender and subject; « Voir le Flow » opens the Review Screen;
   the list shows the Flow red and still « Active ».
4. Restore the Flow.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 73 passed, 0 failed (after merging main, with tickets 04/05)
  (new: `every_flow_reports_its_failed_runs_through_one_error_workflow`,
  `a_failed_run_is_notified_with_its_email_and_the_flow_keeps_running`,
  `a_failing_trigger_is_notified_with_its_error`, `only_a_run_of_that_flow_is_notified`).
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed.
- `cd apps/screenpipe-app-tauri && bunx vitest run components/automation-flows lib/workflows/automation-flows.test.ts lib/notifications/actions.test.ts lib/__tests__/notification-actions.test.ts app/notification-panel/page.test.tsx components/chat/markdown-block.test.tsx`
  → 8 files, 186 tests passed.
- `bunx tsc --noEmit -p .` → no error in the changed files.

## Live finding (n8n 2.42.2)

- n8n refuses to save a workflow whose `settings.errorWorkflow` names a
  workflow with no published version (`400 "The selected error workflow has no
  published version."`), so every write naming the error workflow failed while
  it was installed switched off. Fix (branch `fix-error-workflow-published`):
  `error_workflow_id` publishes the error workflow after installing it, and
  publishes an installed one that is not published; if n8n refuses, the Flow
  is written without `errorWorkflow` (health check covers failures). Its only
  trigger is the Error Trigger, so publishing runs nothing; Flows still switch
  on only by the user's click. The fake n8n now refuses like n8n; tests
  asserting « no /publish » exclude the error workflow's publish.
  `cargo test -p screenpipe-engine --test automation_flows_test` → 106 passed;
  `cargo test -p screenpipe-engine --lib automation_flows` → 5 passed.
