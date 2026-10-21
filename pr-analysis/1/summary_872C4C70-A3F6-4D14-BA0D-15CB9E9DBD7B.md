# Review slice: `crates/screenpipe-engine/src/automation_flows.rs` lines 1501–2246

Focus: final third — pause/activation semantics, shutdown, and event emission.
Reviewer: reviewer-rust-flows-core-3. All line refs are to the PR-head file.

## What this slice contains

The whole file is new in this PR (2246 lines; `git diff origin/main...HEAD --stat` shows
3394 insertions across `automation_flows.rs` + 4 submodule files). Lines 1501–2246 hold the
state-changing handlers and their unit tests:

- **Activation** — `activate_flow` (1470–1530): requires the UI credential
  (`from_user`, 1476), requires the reviewed `versionId` (1480–1492), refuses a stale version
  (`VersionChanged`), double-click idempotency via `already_running && already_reviewed`
  (1493–1505), publishes exactly the reviewed version (1509–1514), records
  `reviewed_version_id`, clears `dismissed`, logs event `"activated"` by `"user"`
  (1519–1523).
- **Shutdown/pause** — `deactivate_flow` (1535–1562) unpublishes through
  `N8nApi::unpublish` with `RunningWait` (poll 1 s, deadline 90 s; the user's explicit stop
  overrides the deadline, 858–878), logs `"deactivated"` as `"user"`/`"api"` by credential.
  `delete_flow` (1571–1615) switches an active Flow off first (user's click included —
  documented 409 on deadline, 1564–1568), then deletes in n8n and removes the record.
  `set_dismissed` (1637–1664) refuses to dismiss a running Flow.
- **Chat edit** — `update_flow` (1670–1733): validates before touching n8n (1679–1688),
  unpublishes an active Flow first and logs `"paused_for_edit"` (1690–1698), PUTs with
  `publishIfActive=false` so a refused edit never goes live (1700–1715), logs `"modified"`.
- **Draft lifecycle** — draft request types, `check_draft`, `draft_view`, `start_draft`,
  `draft_state`, `update_draft`, `finish_draft` (1741–2024), plus `create_flow`
  (2030–2077) and `create_from_task` (2085–2186). Tests (2188–2246) cover `derive_status`,
  bundled fixtures, and workflow-id validation only — but a 5085-line integration suite
  (`crates/screenpipe-engine/tests/automation_flows_test.rs`) covers these handlers well
  (activation gating/idempotency at :1525–:2098, unpublish waits at :2963–:3091, chat edits
  at :2191–:2879, drafts at :4186–:4532).

The slice fits the PR's core safety story: nothing runs without the user's Review-Screen
click on a version they read; switching off never loses the email being processed.

## Findings (also posted as PR comments)

1. **P2 — unpublish wait only sees `status=running`.** `deactivate_flow`/`delete_flow`/
   `update_flow` all rely on `N8nApi::unpublish` → `is_running`, which queries n8n with a
   `status=running` filter (840–854). The file's own `last_execution` maps
   `"running" | "new" | "waiting"` to running (802–808), i.e. the file itself models
   executions that are mid-flight without status `running` (a Wait node holds an email in
   `waiting`). If real n8n reports such an execution while a trigger message is pending, the
   wait passes and unpublish loses that email — the exact loss `RunningWait` exists to
   prevent (module doc 186–194). The integration tests' fake n8n only ever uses
   `status: "running"` (`automation_flows_test.rs:137–148`), so this is untested. I could
   not verify real n8n's status taxonomy/timing from this checkout.

2. **P2 — activation records whatever n8n published as "reviewed".** After `switch("publish")`,
   `published_version` is taken from the response's `activeVersionId`
   (1515–1518) and stored as `reviewed_version_id` (1519–1520) with no assertion that it
   equals the version the user actually reviewed. A concurrent n8n-editor change between
   `load_flow` (1485) and `switch` (1512) would then be recorded as user-reviewed —
   defeating the PR's central invariant. Whether n8n's publish endpoint refuses a stale
   `versionId` could not be verified here; a local `published_version != version` →
   `VersionChanged` check makes the invariant hold regardless. Tiny window, cheap fix.

3. **P2 — global `write_lock` held across the unpublish polling wait.**
   `deactivate_flow` (1545–1554), `delete_flow` (1584–1604), `update_flow` (1675–1698) and
   `create_from_task` (2155) hold the single `write_lock` while `unpublish` polls up to the
   90 s deadline (plus per-call 20 s reqwest timeouts, 256–260). During that window every
   mutating route is blocked — including activating a *different* Flow — and neither the
   engine routes nor the flow API client impose any request timeout (checked: no timeout
   layer in `server.rs` routes; none in
   `apps/screenpipe-app-tauri/lib/automation-flows/api.ts`), so callers hang with no bound.

4. **P3 — early-return skips `dismissed = false`.** The double-click/already-running path
   (1501–1505) returns before the `record.dismissed = false` at 1521–1522, so a dismissed
   Flow that n8n runs at the already-reviewed version stays flagged dismissed; once paused
   it will show `dismissed` instead of `paused` (`derive_status`, 1146–1159).

5. **P3 — `update_flow` hardcodes `by: "chat"`.** 1694–1696 and 1727 attribute every
   modification to the chat, but the route is open to any local-API-key caller (pipes, MCP);
   the `ActivationEvent` doc (1087–1089) promises `"api"` for other local callers. Audit
   trail is wrong for non-chat callers.

## Not issues (checked)

- `finish_draft`'s conditional re-save (2010–2015) is sound: `check_draft` →
  `flow_checks::inspect` takes `&mut Value` and wires sole-held credentials
  (`flow_checks.rs:156`, doc at 24–26), and `failures::name_error_workflow` (2007) runs
  before the comparison, so both "wired just now" and the error-workflow setting can
  legitimately differ.
- `create_from_task`'s existing-Flow branch not pausing an active Flow (2103–2112) is
  already flagged on the PR (coderabbitai, anchored at
  `packages/workflows-ui/src/workflow-questions.tsx:260`) — not re-posted.
- Orphaned local records for Flows deleted directly in the n8n editor persist (only the
  demo-task branch cleans up, 2114–2116); harmless today since `list_flows` iterates n8n.
  Mentioned here for the record; not posted.

## Checks run

- `git diff origin/main...HEAD --stat -- crates/screenpipe-engine/src/automation_flows.rs crates/screenpipe-engine/src/automation_flows/` — file is entirely new.
- Read the full file (2247 lines) plus `flow_checks.rs` (signatures and `inspect` body), the
  integration test index, and the fake-n8n execution helpers.
- `grep` for `RunningWait` config: `server.rs:435` uses `Default::default()` (90 s deadline).
- `grep` for request timeouts in `server.rs` and the flow API client: none found for these
  routes.
- I did not run `cargo test` (no compile/test of the slice was executed in this session);
  all coverage statements above come from reading the test file.
