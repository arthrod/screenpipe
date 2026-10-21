# Review slice: `crates/screenpipe-engine/tests/automation_flows_test.rs` lines 4069–5085 (final fifth)

Reviewer slice: "Final fifth: reset/demo and end-to-end golden path." All line numbers are the file at PR head (the file is entirely new to this PR: `git diff origin/main...HEAD --stat` shows 5085 insertions; origin/main has an empty stub at the same path).

## What this slice is

The last ~1000 lines of a 5085-line integration suite that runs the engine's `/automation-flows` API against a fake n8n (wiremock, `FakeN8n` at tests/automation_flows_test.rs:65-504) and a real `SCServer` router over in-memory SQLite (`App::build_with`, :557-620). My fifth covers four sections:

1. **Activity tail** (:4088-4144) — `GET /:id/activity` edge cases: a retried email whose ticket already existed reports the existing key ("Ticket already created?" node, :4088-4118), and a Flow with no AI decision step reports its runs as plain `done` (:4120-4144).
2. **Step-by-step draft builder** (:4146-4520) — `POST /automation-flows/drafts`, `PUT /drafts/:id` per step, `POST /drafts/:id/finish` (« Terminer »): drafts start switched-off, tagged `screenpipe-flow-building`, hidden from the list (:4185-4208); half-built steps are accepted with per-node `missing` explanations (:4254-4304); invented/disabled/unknown-version nodes are refused before n8n sees anything (:4306-4340); finish lists every remaining problem (:4351-4378) or turns a complete draft into a reviewable Flow and closes the draft routes (:4380-4417); wires a credential the user created after the last step (:4419-4441); an under-construction Flow can be activated by nobody, not even the UI key (:4443-4478); the chat can delete its abandoned draft (:4480-4499); finish names ScreenPipe's error workflow like creation does (:4501-4519).
3. **Health check (D19)** (:4521-4810) — reachability banner state (:4531-4549); failed runs since the last check notified exactly once (:4566-4605); the first check after install ignores pre-start failures (:4607-4626); dedupe between the error workflow's live report and the scheduled check, both directions (:4628-4655); a notification server that was down gets a retry at the next check (:4657-4683); a check holding draft cleanup never delays a live failure report past 100 ms (:4685-4717); drafts under construction >24 h are deleted on check (:4719-4745); pacing at start / on schedule (:4780-4810).
4. **Retry (D17)** (:4812-5085) — the golden path: retry a failed run, n8n re-runs it with `loadWorkflow` per review state, the answer is the retried run as Activity lists it (:4848-4875); only the UI credential may retry (:4877-4899); failed-again reasons (:4901-4925); 404/409 taxonomy for non-retryable runs (:4927-4968); n8n refusals surface as `n8n_failed` with n8n's message (:4970-4990); the `loadWorkflow` truth table across chat-edit/unpublished, published-in-n8n, and saved-but-unpublished states (:4992-5039); Activity's `retried` flag via both `retrySuccessId` and `retryOf` (:5041-5085).

## How it fits the whole PR

This file is the engine-side verification backbone of Automation Flows, and this fifth encodes the product's safety rules as executable assertions: *nothing runs without the user* (retry gate on `FlowActivationKey`, :4877-4899 matching `retry.rs:35-37`), *nothing runs unreviewed* (the `loadWorkflow` matrix at :4992-5039 matching `retry.rs:54-61`), *no double notification* (dedupe tests), *no blocked failure reporting* (:4685-4717). The demo-⌃⌥⌘D "reset" itself is app-side (`src-tauri/src/shortcuts.rs`) and outside this file; its production-registration risk is already covered by an existing CodeRabbit comment, as is the double-retry in-flight race in `retry.rs` — I did not duplicate either.

Fixture fidelity is a strength: node names in the fixtures ("New support email", "Read the email (AI)", "Confident enough", "Ticket needed", "Find the ticket for this email", "Ticket already created?", "Create the Jira ticket") exactly match the shipped demo workflow `infra/automation-flows/workflows/novadesk-support-tickets.json` (verified by grep), so the Activity-parsing tests cannot silently drift from the real workflow.

## Verification I ran

- `cargo test -p screenpipe-engine --test automation_flows_test -- --test-threads=4 draft terminer activity retry check vice_versa server_missed an_unreachable` → **30 passed, 0 failed** (2.69 s).
- `cargo test -p screenpipe-engine --test automation_flows_test -- --test-threads=4 each_step invented only_the_users only_a_failed` → **6 passed, 0 failed** (0.37 s).
- Together these executed all 27 tests fully or partially inside lines 4069-5085, plus 6 incidental matches from adjacent sections. I did not run the other ~77 tests of the file (other reviewers' slices), nor the whole crate suite.
- Cross-checked test expectations against the implementation they exercise: `retry.rs:54-61` (`load_workflow`), `retry.rs:75-81` (`retryable`), `activity.rs:83-141` (`flow_run` outcome/ticket/reason), `activity.rs:65-75` (`retried` via `retryOf`), `health.rs:75-87` (pacing) — all consistent with the fixtures.

## Findings (full paragraphs in the comments file)

- **P2** — `the_check_runs_at_start_then_on_its_schedule_and_sooner_while_n8n_is_down` (:4781) never asserts the "sooner while n8n is down" clause its name claims: `wait_for_health` tolerates 5 s, so the test would pass even if the engine ignored `retry` entirely. The pacing logic is unit-tested at `health.rs:458-469`, so this is a naming/coverage mismatch, not an untested behavior — but the name over-claims what the integration test proves.
- **P3** — :4536 and :4799 model "n8n down" as hard-coded `http://127.0.0.1:9` while the file's own `closed_port_url()` helper (:752-757, used at :807, :1891) guarantees a refusing port.
- **P3** — :4716's absolute `waited < 100 ms` bound is sound for the property (queueing costs ≥ ~180 ms) but can flake under CI load; passed here.
- **P3** — :4426 grafts `second_step()["nodes"][1]` positionally; a named `summary_node()` helper would survive reordering.

## What I could not verify

- n8n 2.42.2 fidelity claims baked into fixtures/comments (retry refused for finished executions only, update-republishes unless `publishIfActive=false`, unpublish orphans running executions) are taken from the fixture comments; I had no real n8n to check against.
- The desktop-app demo reset path (⌃⌥⌘D) and the notification's « Retry » webview action are outside this file and unreviewed by me.
- I read lines outside 4069-5085 only for helpers the slice depends on (`App`, `FakeN8n`, `active_flow`, `failed_run`, `chat_workflow`, `posts_ending_with`, `n8n_writes`), not to review them.
