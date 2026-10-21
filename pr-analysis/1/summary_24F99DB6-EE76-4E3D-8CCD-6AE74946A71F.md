# Review slice: `automation_flows/health.rs` + `automation_flows/activity.rs` (PR #1)

Reviewer: reviewer-rust-flows-health. Both files are new in this PR (486 + 196 lines, `git diff origin/main...HEAD --stat` shows 682 insertions, no deletions).

## What the slice changes and how it fits the PR

**`health.rs`** implements SPEC D19 (`docs/automation-flows/history/hackathon/SPEC.md:44,125`): a background loop (`check_periodically`, health.rs:259-265) started from `automation_flows.rs:273-281` when the router is constructed with a `HealthSchedule` (engine default 15 min / 30 s retry, health.rs:50-57; wired in `server.rs:437,1509`). Each check (health.rs:268-285):

1. Reports n8n reachability/auth/config state as the last result served by `GET /automation-flows/health` (health.rs:248-251), the basis of the app's "n8n unreachable" banner.
2. Notifies failed runs (`status` `error`/`crashed`, health.rs:447-452) since the last *complete* check, deduplicated through a persisted ledger `<data dir>/automation-flows-health.json` (health.rs:29,140-188) that is shared with the D16 error-workflow route via `notify_run` (health.rs:211-223, consumed at failures.rs:203-214) so a run is never notified twice, across restarts.
3. Deletes chat drafts under construction for 24 h, in n8n and in the store (health.rs:310-362), under the shared `write_lock`.

`Pacing` (health.rs:60-88) is the debounce: fixed 15-min cadence, 30 s while n8n is unreachable, and exponential backoff 30 s→15 min while notifications stay undeliverable (so a headless engine without a notification server does not re-list every run every 30 s forever). The ledger is bounded: `prune` keeps only entries ≥ `since − 24h` (health.rs:31,183-187), and `save` goes through the repo's atomic-replace primitive (health.rs:163, `atomic_file.rs:41-75`).

**`activity.rs`** implements SPEC D18 (`SPEC.md:123`): `GET /:id/activity` (route at automation_flows.rs:296) lists the newest 20 executions of a Flow with `includeData=true` (activity.rs:13,49-60) and classifies each into a `FlowRun` row: `failed` / `ticket` / `abstained` / `ignored` / `done` (activity.rs:121-131), with the handled email, failure reason, ticket key, and a `retried` flag derived from n8n's `retryOf`/`retrySuccessId` (activity.rs:65-72,104). Nothing is persisted — n8n is the source of truth, per the module header (activity.rs:5-7) and README design rule 1. `retry.rs:67` reuses `flow_run` to render the retry route's answer.

It is a well-written pair: careful module docs, conservative defaults (a draft with no parseable timestamp is kept, health.rs:346-352), dedup shared between both notification paths, atomic writes, degraded data handled gracefully (detailed fetch failure falls back to the summary run, health.rs:409-417), and the backoff logic is tested.

## Checks I ran

- `cargo test -p screenpipe-engine --lib automation_flows` → **exit 0, "5 passed; 0 failed; 1791 filtered out"** (includes both `health::tests` Pacing tests, health.rs:458-485). This is the only execution check I ran; I did not run the wider engine suite or any frontend tests.
- Verified the n8n public API contract used here against n8n's docs (WebFetch of docs.n8n.io/connect/n8n-api/executions + web search): `GET /executions` supports `workflowId`, `limit`, `includeData`, `status`, `startedAfter`; the execution `status` enum is `new|running|waiting|success|error|crashed|canceled|unknown` — so health.rs's `"error" | "crashed"` (health.rs:449) and activity.rs's `success`/`running|new|waiting` handling (activity.rs:85-92) are real values. **Not verified against a live n8n 2.42.2** (the pinned image, `infra/automation-flows/docker-compose.yml:13`), and I could not verify from docs that the execution summary always carries `retryOf`/`retrySuccessId` as strings, nor what `POST /executions/:id/retry` returns (see risks).

## Notable risks and quality issues (details posted as PR comments)

- **P2 — failure detection has a 100-execution blind window per Flow** (health.rs:35,389-396): only the newest 100 executions are listed per check; failures pushed past that window within one 15-min interval are silently never notified and never marked seen. n8n supports a `status` filter that would fix this cheaply.
- **P2 — one failing draft cleanup fails the whole check** (health.rs:303,353): a single `api.delete_workflow`/`api.workflow` error aborts `delete_abandoned_drafts` with `?`, discarding the already-computed notified/pending report and mislabeling health as `failed` (health.rs:277-280), and permanently blocks cleanup of later drafts; it also holds `write_lock` across all its n8n calls, stalling every activate/deactivate/create route meanwhile.
- **P3 — clock skew / missing timestamps silently skip failed runs forever** (health.rs:401-404): the watermark `last_check_at` is engine-clock while `stoppedAt` is n8n-clock; any constant skew makes runs stopped within the skew after a watermark permanently invisible, and a run with unparseable timestamps is skipped every check without being recorded.
- **P3 — undeliverable notifications only logged at `debug`** (health.rs:428-431), and the success contract with the notification server is the literal message `"Notification sent successfully"` (failures.rs:331) — a wording change on either side silently turns real deliveries into `Gated` (recorded, never retried).
- **P3 — test coverage is thin for the amount of classification logic**: only the two `Pacing` tests exist (health.rs:454-486); `Ledger::{since,prune}`, `failed`, `notify_once` dedup, and all of `flow_run`'s outcome classification (`ticket/abstained/ignored/done/failed`, the D18 wire contract) are untested, though they are pure or nearly pure. `automation-flows-spec.md:158` promised engine tests against a fake n8n (wiremock).
- **P3 — a non-failed execution with no `data.resultData` classifies as `done`** (activity.rs:107-131): the retry route feeds exactly such a response into `flow_run` (retry.rs:67), which could show "done" and hide a created ticket right after the user clicks Retry. I could not verify n8n's retry-response shape from docs, so this is flagged as a risk, not a confirmed bug.

## Spec drift (deliberate, documented in code — no comment posted)

- `SPEC.md:125` says the first check looks "24 h back"; the code looks only since engine start without a ledger (health.rs:22-24,173-178), with an explicit rationale in the module doc (avoiding a burst of a day of notifications on first install).
- `SPEC.md:125` says checks run "every 30 s while … a notification is pending"; the code backs off exponentially to 15 min (health.rs:43-47,81-86), tested at health.rs:472-485.

Both deviations are explained in-code and are sensible; the lead reviewer may want the history spec annotated.

## Other observations (not posted)

- `ticket` is also populated from a D20 search hit (`existing_issue`, activity.rs:117-120,187-196) while the field's rustdoc (activity.rs:24-25) says "when the run created one" — behavior matches `SPEC.md:123`, the doc comment is what's stale (folded into a posted comment).
- Two near-duplicate `instant` helpers with different return types (`Utc` at health.rs:190-194 vs `FixedOffset` at activity.rs:77-79) — nit, not posted.
- In activity.rs the sort treats an unparseable `startedAt` as the newest run (`Reverse(None)`, activity.rs:73) — cosmetic, not posted.
- Ledger load silently treats a corrupt/unreadable file as empty (health.rs:153-158), unlike `FlowStore::load` which errors (automation_flows.rs:1101-1110); failure mode is a one-time re-notify burst, benign-ish; not posted.
- Memory is bounded as the slice's focus demands: activity stores nothing, the execution list is capped at 20 (transient parse of full `includeData` payloads only), and the ledger is pruned to a ~24 h window.

## What I did not check

- No live n8n instance: field names (`retryOf`, `retrySuccessId`, `data.resultData` shape) rest on docs and cross-file consistency (retry.rs:80 uses `retrySuccessId` the same way), not on an executed integration test.
- I did not run the frontend tests, the full engine suite, or review how the app consumes `n8n: "failed"` (app side is another reviewer's slice).
- I did not verify whether n8n poll triggers create executions on empty polls (my 100-window analysis assumes they do not; the demo Gmail trigger polls every 5 s — `infra/automation-flows/workflows/novadesk-support-tickets.json:14-467`).
