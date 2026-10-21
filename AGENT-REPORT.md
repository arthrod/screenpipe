# Agent Report — P1-2 "Failure notifications eaten" (issue #6 / PR #1 review)

Branch `fix/failure-notify`, commit `163697e7a` (fix) + this report.
Spec section: P1-2 of `/tmp/p1-fix-spec.md` (comments_A3C02BC7 P1, rider + comments_24F99DB6 P3).

## Root cause

`failures.rs`'s `notify()` classified every 2xx `/notify` answer whose
`message` was not exactly `"Notification sent successfully"` as terminal
`Undelivered::Gated`, and `health.rs`'s `notify_once` then wrote the run
into the notified ledger. For the app's suppression answers —
`"notifications paused"` (quiet hours/snooze/master-off),
`"pipe notifications disabled"`, `"pipe muted"` — the app had dropped the
alert *before* any panel or history row, so the run produced no visible
trace and a ledger entry forbidding retry: the D16 promise ("a failed Flow
run is reported") silently failed. The exact-string match was also fragile
in both directions (a wording change reclassifies a delivery), and the
mirror image lived in `failure_notice`: a failing *trigger*'s notice id
was `trigger-<millis>`, so every error-workflow poll of a persistently
failing trigger looked like a brand-new alert (a toast and a history row
each time), defeating the app's repeat/history gates.

## Diff summary (6 files, +649/−63)

- `crates/screenpipe-engine/src/automation_flows/failures.rs`
  - `classify(status, answer)` — pure, unit-tested: decides on the
    machine-readable `outcome` field when present; else on the app's
    `message` copy, now pinned by tests. Pause/disable/mute → retryable
    `Undelivered::Suppressed`; `"duplicate notification suppressed"` /
    `"Notification already sent"` → terminal `Gated` (the user saw it);
    unrecognized 2xx → retryable (never a silent loss; surfaces as
    pending); non-2xx → `Unreachable`.
  - `Undelivered::Suppressed` variant; `report_failure` routes failing
    *triggers* through `health::notify_run` with a stable pseudo-run key
    `trigger:<flow>:<fnv1a(error)>` instead of bypassing the ledger with
    a clock-based id (`error_fingerprint`/`trigger_key`/`fnv1a` helpers).
  - Unit tests: full status×message×outcome matrix + trigger-key
    stability (same error ⇒ same alert, new error ⇒ new alert).
- `crates/screenpipe-engine/src/automation_flows/health.rs`
  - `Delivery::Suppressed` behaves like `Unreachable` for delivery
    (pending, ledger unmarked) → the D19 check re-delivers once the
    suppression lifts; existing Pacing backoff applies.
  - `PendingRuns` streak tracking in `Health`: debug "will retry" on
    early misses, `warn!` once after 5 consecutive checks per run
    ("notification path broken" distinction, comments_24F99DB6).
  - Unit test for warn-once semantics.
- `crates/screenpipe-engine/tests/automation_flows_test.rs` — 5 new
  integration tests (see RED/GREEN below) + `answer_notifications`/
  `deliver_notifications` fake-server helpers.
- `apps/screenpipe-app-tauri/src-tauri/src/notifications/routes.rs` —
  every `/notify` answer now carries machine-readable `outcome`
  (`shown`/`duplicate`/`paused`/`pipe_disabled`/`muted`/…) via a
  `notify_answer` helper; messages unchanged; pinned unit test
  (`notify_answers_name_their_delivery_outcome`) for all 9 pairs.
- `apps/screenpipe-app-tauri/lib/automation-flows/find-automation.ts` —
  reads `outcome` first, pinned copy as fallback (+ vitest cases);
  removes the last client-side repeat of the success literal.

## RED evidence (new tests against unmodified code, stashed impl)

```
$ cargo test -p screenpipe-engine --test automation_flows_test notif
test a_failed_run_while_notifications_are_paused_is_delivered_once_the_pause_lifts ... FAILED
  panicked at tests/automation_flows_test.rs:3869:5: assertion `left == right` failed:
  {"n8n":"reachable","notified":["exec-quiet"],"pendingNotifications":[],...}
    left: Array [String("exec-quiet")]   right: Array []
test a_failure_reported_while_notifications_are_paused_is_re_delivered_after_the_pause ... FAILED
    left: Array []   right: Array [String("exec-live")]
test a_persistently_failing_trigger_is_notified_once_not_on_every_poll ... FAILED
  {"notified":true}  left: Bool(true)  right: false
test result: FAILED. 7 passed; 3 failed

$ cargo test -p screenpipe-engine --test automation_flows_test -- outcome_field reported_while
test the_outcome_field_classifies_the_answer_not_the_english_copy ... FAILED
    left: Array []   right: Array [String("exec-live")]
test a_failure_reported_while_notifications_are_paused_is_re_delivered_after_the_pause ... FAILED
    left: Array []   right: Array [String("exec-live")]
test result: FAILED. 0 passed; 2 failed
```

(First RED attempt hit "No space left on device" mid-build — machine disk
at 100%; not a test result. Re-run cleanly after the machine's mbx gc
freed space. Two fixtures were also corrected from `failed_run` (fixed
past `stoppedAt`) to `failed_run_ago(…, zero)` so the health check's
since-window could not confound the failure, and RED was re-verified
before implementing: with the run in-window, the only possible skip
reason is the ledger mark — the bug.)

## GREEN evidence (after implementation)

```
$ cargo test -p screenpipe-engine --test automation_flows_test -- outcome_field reported_while already_saw pause pause_lifts persistently notif
test result: ok. 13 passed; 0 failed; 0 ignored   (all notification tests incl. 5 new)

$ cargo test -p screenpipe-engine --lib automation_flows
automation_flows::failures::tests::every_answer_of_the_notification_server_classifies_as_it_delivered ... ok
automation_flows::failures::tests::the_outcome_field_classifies_the_answer_not_the_copy ... ok
automation_flows::failures::tests::a_failing_trigger_names_one_stable_alert_per_error ... ok
automation_flows::health::tests::a_run_pending_across_checks_warns_once_not_on_every_check ... ok
test result: ok. 9 passed; 0 failed

$ cargo test -p screenpipe-engine --test automation_flows_test     # full scoped suite
test result: ok. 112 passed; 0 failed; finished in 6.98s

$ cd apps/screenpipe-app-tauri && bun x vitest run --config vitest.config.ts \
    lib/automation-flows/find-automation.test.ts lib/workflows/automation-flows.test.ts \
    components/automation-flows/__tests__/demo-shortcut-listener.test.tsx
Test Files  3 passed (3)   Tests  31 passed (31)
$ bun x vitest run --config vitest.config.ts components/workflows/task-page-create-flow.test.tsx
Tests  18 passed (18)
$ bun run typecheck    # clean
```

## Deviations / blockers

1. **src-tauri native verification BLOCKED** (AGENTS.md queue policy):
   `bun run test:tauri` refuses — "machine-wide sccache is required;
   refusing local compilation" (sccache absent on this machine, macOS).
   The `routes.rs` change is therefore self-reviewed, not compiled or
   tested here: mechanical `ApiResponse` → `notify_answer` swap at 10
   return sites of `send_notification` (handler return type
   `Json<ApiResponse>` → `Json<serde_json::Value>`, valid axum), plus a
   pure unit test mirroring the existing gate-test style. Engine tests
   already pin the same strings as the fallback contract, so behavior
   does not depend on the unverified change landing correctly.
2. **Build environment**: the machine disk hit 100% twice (ENOSPC kills
   mid-build; sibling agents build in parallel worktrees). Switched to
   the machine-configured `mbx` cargo shim (PATH) — same
   `cargo test -p screenpipe-engine …` commands, shared self-pruning
   cache ("786.4 GiB of outputs shared rather than copied"). No other
   agents' worktrees or caches were deleted.
3. **Trigger failures vs suppression**: a *one-shot* trigger failure
   during a suppression is not re-delivered (the D19 check can only
   re-list n8n executions; a trigger failure has none) — a *still-failing*
   trigger re-reports on every poll and is delivered once the
   suppression lifts; documented in `failures.rs`. The spec required
   re-delivery for failed *runs*, which is fully covered.
4. Warn-escalation constant chosen as 5 consecutive checks (~8 min at
   the 30 s→900 s backoff); spec said "N checks" without a number.

## Acceptance vs spec (P1-2)

- ✅ Failed run during quiet-hours/pause/mute re-delivered after the lift
  (ledger unmarked, D19 backoff) — proven end-to-end (health check and
  D16 route paths).
- ✅ Only "duplicate/already sent" answers terminal (unit + integration).
- ✅ `/notify` contract machine-readable (`outcome` field) AND pinned by
  tests on the engine side (copy fallback matrix) and app side (pairs
  test, blocked from running — see deviations) and TS client (vitest).
- ✅ Health log distinguishes "will retry soon" (debug) from "not
  notified for N checks" (warn, once).
- ✅ Mirror image: trigger spam pinned — same error ⇒ one alert (ledger
  + stable notice id), new error ⇒ new alert.
