# 22: Review fixes — Flow service (engine)

Spec: stories 12, 22–24, 31, 34–38, 44; AGENTS.md "nothing activates without
an explicit user action". From the independent code review of 2026-10-17
(standards, spec, correctness/security) and rehearsal 3. Includes ticket 21.

**What to build** (all in `crates/screenpipe-engine/src/automation_flows.rs`
+ its tests, the typed client `apps/screenpipe-app-tauri/components/automation-flows/api.ts`
for new codes/fields, and the `automation-flows` skill):

1. **Ticket 21** — see `21-pause-waits-for-running-executions.md`.
2. **Who deactivated.** `POST /:id/deactivate` logs `by: "user"` only when the
   request carries the UI activation credential (ticket 14's header);
   otherwise `by: "api"`. The client sends the header on Désactiver too.
3. **Activated outside the review.** `reviewOutdated` is also true when the
   workflow is active and its `activeVersionId` is not the
   `reviewedVersionId` (published in n8n, by the CLI or anyone, without the
   Review Screen's click). The existing banner and « Activer cette version »
   then show.
4. **The chat cannot wire secrets.** Chat creation (`POST /`) drops every
   node's `credentials`. Chat modification (`PUT /:id`) takes each node's
   `credentials` from the current n8n workflow for nodes that keep their
   name and type, and drops them on new or retyped nodes — never from the
   request.
5. **Fixed facts per step.** `Flow.nodes[].facts: string[]` lists what the
   AI did not write: the names of the n8n credentials the node uses, and for
   an HTTP Request node the method and the URL host. (Ticket 23 renders it.)
6. **Creation never takes over an existing Flow.** In `create_from_task`, if a
   local record already exists for the pre-imported fixed id, adopt it (set
   `sourceTaskId`, keep its history and reviewed version, do not unpublish);
   only a copy with no record is switched off and recorded as today.
7. **n8n errors are named right.** Connection failures/timeouts stay `502
   n8n_unreachable`; 401/403 stay `412 n8n_unauthorized`; any other non-2xx
   from n8n becomes `502 {error: "n8n_failed", detail}`.
8. **No MCP side door.** Drop `availableInMCP` from the settings the Flow
   service accepts (chat) and from the bundled demo workflow's settings.
9. **Where the task was seen.** `Flow.sourceMoment: {frameId: number | null,
   timestamp: string} | null`: for a Flow created from a Detected Task, the
   first evidence moment of that task in the workflow catalog (the engine
   already reads it for `/workflows/catalog`); `null` otherwise. (Ticket 23
   renders « Voir dans la timeline ».)

Skill: say chat changes cannot add credentials (the user picks them in n8n)
and what `flow_running` means (wait and retry once).

**Blocked by:** None. Ticket 23 runs in parallel on the frontend, the demo
workflow's Jira step and the n8n nodes; it codes against the contract above.

**Status:** done (live: facts, timeline moment, « Désactivé hors de Screenpipe », outdated flag after a publish in n8n, no availableInMCP; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)
tip merged (ticket 23 included).

- [x] Engine tests (fake n8n) for each numbered item; existing tests pass.
  `crates/screenpipe-engine/tests/automation_flows_test.rs`: 1 → ticket 21 (three tests, see its
  file); 2 `deactivation_is_logged_as_the_users_only_with_the_ui_credential`; 3
  `review_is_outdated_when_n8n_runs_a_version_the_user_never_activated`; 4
  `chat_create_cannot_wire_the_users_n8n_credentials`,
  `chat_update_keeps_the_users_credentials_and_never_takes_the_chats`; 5
  `each_step_lists_the_facts_the_ai_did_not_write`; 6
  `create_never_takes_over_a_flow_the_user_already_has`; 7
  `any_other_n8n_failure_is_named_n8n_failed_not_unreachable`; 8
  `no_flow_is_offered_to_n8n_mcp_clients`; 9
  `a_flow_from_a_task_points_at_the_first_moment_the_task_was_seen`,
  `a_flow_from_the_chat_has_no_source_moment`. Two existing deactivation tests now click through the
  UI credential (they expect `by: "user"`).
- [x] Client types/codes and messages for `flow_running`, `n8n_failed`, `by: "api"` (« Désactivé hors de Screenpipe »), `facts`, `sourceMoment`.
  `api.test.ts`: Désactiver sends the UI credential; the browser mock logs `api` without it; 409
  `flow_running` and 502 `n8n_failed` become typed codes. `flows-tab.test.tsx`: « Désactiver »
  refused with `flow_running` says « n8n traite encore un e-mail… Réessayez dans un instant »; an
  `api` entry reads « Désactivé hors de Screenpipe ».

## What was built

- Engine (`crates/screenpipe-engine/src/automation_flows.rs`):
  - `deactivate` logs `by: "user"` only with the matching `x-screenpipe-flow-activation` header,
    else `"api"` (shared `from_user` check with activation).
  - `reviewOutdated` = active and (`activeVersionId != versionId` or `activeVersionId !=
    reviewedVersionId`). Activating the version n8n already runs records the review and logs
    `activated` without a second publish (the early "double click" return now also needs the
    reviewed version to match).
  - `keep_user_credentials`: chat creation drops every node's `credentials`; a chat change takes
    them from the current n8n workflow for nodes with the same name and type, none otherwise.
  - `FlowNode.facts`: `Identifiant n8n : <credential name>` per credential; for
    `n8n-nodes-base.httpRequest`, `<METHOD> <host>` (method defaults to GET), or `<METHOD> (adresse
    calculée à l'exécution)` when the URL is an expression without a fixed host. Never the path or
    query.
  - `create_from_task`: a pre-imported copy with a local record is adopted as is (sourceTaskId and
    answers set, summary filled only if empty, history/reviewed version/on-off kept, `200`); only a
    copy without a record is unpublished.
  - `upstream_error` → `502 {error: "n8n_failed", detail}`; `n8n_unreachable` only for no answer.
  - `availableInMCP` removed from the accepted settings and from the bundled workflow (its test now
    asserts it is absent).
  - `Flow.sourceMoment`: read live from the workflow catalog (`routes::workflows::read_catalog`, now
    `pub(crate)`; `SCServer.workflow_catalog_dir` passed to the router) for a Flow with a
    `sourceTaskId`: the earliest of the task's evidence entries (top level and per stage) and
    recorder frames (`stage_screenshots`, positive ids); a recorder frame wins a tie; `frameId` null
    otherwise; `null` when the catalog or the task is missing.
- Client: `ActivationEvent.by` adds `"api"`; `FlowNode.facts`, `Flow.sourceMoment` (merged with
  ticket 23's identical lines); codes `n8n_failed`, `flow_running`; `deactivate` sends the UI
  credential; Task Page creation messages for both codes; browser mock logs `api` without the
  credential; « Désactivé hors de Screenpipe » label; the `flow_running` sentence under
  « Désactivation impossible ».
- Skill: rule 4 (credentials cannot be added; renamed/retyped nodes lose theirs; say which nodes
  need one), errors `502 n8n_failed` and `409 flow_running` (wait a minute, send once more, then
  tell the user). `SPEC.md` contract updated.

## Commands and results

From the worktree, after `git merge origin/hackathon/automation-flows` (8a79bf1c4):

- `cargo test -p screenpipe-engine --test automation_flows_test` → 47 passed, 0 failed.
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed.
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 2 passed.
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows lib/workflows`
  → 37 files, 397 tests passed. Also `components/workflows components/__tests__/pipe-store-flows-tab.test.tsx`
  → 23 files passed (1 skipped), 201 tests passed.
- `cd apps/screenpipe-app-tauri && bun x tsc --noEmit -p .` → clean.
- `bun test infra/automation-flows` → 50 pass, 0 fail.

## Notes

- Live check (orchestrator, dev build): open the demo Flow → each step shows its fixed facts and
  « Voir dans la timeline » opens 02:05:41Z (or its recorder frame when ticket 15 found one);
  « Désactiver » → history « Désactivé par vous »; `curl -X POST …/deactivate` with the local API
  key only → « Désactivé hors de Screenpipe »; publish the workflow from the n8n editor → the Review
  Screen shows the outdated banner and « Activer cette version ».
- Re-import the bundled workflow (`infra/automation-flows/import-workflow.sh`) so n8n's copy loses
  `availableInMCP`; an update through the Flow service does not remove a setting n8n already holds.
- A node the chat renames loses its credentials (by design: name and type are the match key).
