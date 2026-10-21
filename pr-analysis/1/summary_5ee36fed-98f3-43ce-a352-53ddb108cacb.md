# Slice review: `crates/screenpipe-engine/src/automation_flows.rs` lines 1–750

Reviewer slice: **state, types, CRUD scaffolding, n8n client** (first third of the new
2246-line flows service). PR #1 is 234 files, +34,606/−600 (`git diff origin/main...HEAD --stat`).
Nothing in this slice was previously commented on by other reviewers (fetched via the
fetch-pr-feedback steps: resolved-thread IDs `[]`, issue + review comments fetched; the 16
posted findings all target other files, except one that references this file's
`create_from_task` at ~line 2080 — outside my range).

## What the slice contains

All new code; the file does not exist on `origin/main`.

- Module doc (1–28): n8n is the workflow source of truth; ScreenPipe stores only the review
  record at `<data dir>/automation-flows.json` (11, 65); activation is the only switch-on path
  (16–18); switch-off waits for a running execution (RunningWait, 186–208, default 1 s poll /
  90 s deadline).
- Constants (60–134): `FLOW_TAG`, `BUILDING_TAG`; strict key allowlists for what n8n's create
  endpoint accepts (`WORKFLOW_KEYS`/`NODE_KEYS`/`SETTINGS_KEYS`, 89–134). `availableInMCP` is
  deliberately excluded with a rationale (132–133) — an n8n MCP client could otherwise run a
  Flow outside the Review Screen; covered by test `no_flow_is_offered_to_n8n_mcp_clients`
  (`tests/automation_flows_test.rs:2831`).
- `FlowActivationKey` (140–184): random per-process UI credential (two v4 UUIDs, 244 bits —
  entropy claim checks out), redacted `Debug` (180–184), constant-time `matches` (169–177;
  length short-circuit leaks only the documented fixed length). Refused without the desktop UI
  (214, 1457-1464).
- `FlowsState` (210–231) + `router()` (244–302): all 15 routes, one shared `reqwest::Client`
  (3 s connect / 20 s total, 256–260), `write_lock` for store/import serialization (223–225),
  health task aborted when the router drops (`AbortOnDrop`, 233–240; the spawned task's state
  copy is taken before `health_task` is set, so no self-abort cycle — 274–277).
- `require_json` middleware (304–319): state-changing requests must carry
  `Content-Type: application/json` — a CSRF backstop so a cross-site form/simple request cannot
  switch a Flow off.
- Wire types (325–419): serde casing verified field-by-field — `Flow` (342), `FlowSummary`
  (333), `LastExecution` (326), `SourceMoment` (375), `ActivateRequest` (388),
  `FromTaskRequest` (414) are `camelCase`; `FlowNode` (362–370) is single-word fields plus an
  explicit `rename = "type"`; `FlowEdge` (381–385) and `ActivationEvent` (1077–1084) are
  consistent. My initial suspicion of a casing mismatch was wrong — re-read and confirmed
  consistent.
- `FlowError` (425–473) + `IntoResponse` (475–599): every variant maps to a typed JSON error
  with stable codes; exhaustive match.
- `N8nApi` (605–773): the only code that talks to n8n (13, per doc). `send` maps 401/403 to
  `412 n8n_unauthorized` (648–650); `all_pages` paginates with a 40-page bound and a
  self-repeating-cursor guard (671–688); `tag_id` recovers from a concurrent tag create via 409
  (715–719); `retag` is idempotent (744–753).

## How it fits the whole PR

This file is the backend half of Automation Flows; the app half
(`apps/screenpipe-app-tauri/components/automation-flows/`, `lib/`) and the chat skill consume
this contract. The slice defines the contract everything else in the PR codes against: the
`Flow` JSON shape (343–360), the error codes the Review Screen and the skill prose enumerate
(425–599), and the user-only activation/retry credential that design rule 3 ("Nothing runs
without the user", `README.md:155-162`) is enforced with. The router nests into the engine's
authenticated local API (`server.rs:1499-1509`), inheriting the local-API-key auth; the slice
adds only the JSON content-type and activation-key layers on top.

## Checks I ran (all during this session)

- `cargo check -p screenpipe-engine` → finished in 1m58s, no errors; the two warnings are
  dead code in `crates/screenpipe-core/src/workflows/pipeline.rs:47` and
  `crates/screenpipe-engine/src/routes/health.rs:333` — not this slice.
- `cargo test -p screenpipe-engine --test automation_flows_test` → **107 passed, 0 failed**
  (7.78s). Slice-relevant coverage confirmed by reading the tests:
  `state_changing_routes_take_only_json_requests` (`tests/automation_flows_test.rs:2004`,
  methods × missing/plain/form/charset content types), `the_local_api_key_alone_cannot_activate_a_flow`
  (1917, wrong and local-API-key values for `ACTIVATION_HEADER` refused),
  `refused_api_key_returns_412_unauthorized_not_unreachable` (819), `list_follows_n8n_pages_to_show_every_flow`
  (1359), `activation_needs_the_version_the_user_reviewed` (1977), CORS origin predicate tests
  in `server.rs` (1927–1971).
- `cargo test -p screenpipe-engine --lib automation_flows` → 5 passed (derive_status, demo
  fixture importability, workflow-id path-injection guard).

## Findings (posted — see comments file)

1. **P2** — the single `write_lock` (223–225) is held across the up-to-90 s `unpublish` wait in
   `deactivate_flow` (1545→1554), `delete_flow` (1601–1608) and `update_flow` (1690–1698);
   every other state-changing route takes the same lock (1484, 1584, 1648, 1675, 1913, 1963,
   1994, 2038, 2094, `health.rs:315`), so one Flow with a hung execution blocks "Turn on",
   creation, dismiss/restore and drafts for *unrelated* Flows for up to 90 s. `retry.rs` is the
   only writer that does not take it (consistent with the separate double-retry finding another
   reviewer posted on `retry.rs:63-66`).
2. **P3** — `N8nApi::send` (641–651) collapses diagnostics: a non-JSON error body becomes
   `Value::Null` (645) so the user sees a bare "n8n answered 502"; and all 401/403s become
   "paste a valid API key" guidance (648–650) even when the key is valid and n8n refuses the
   operation for another reason (API access disabled for the user's role, plan-gated endpoint).

## Notable observations (not posted)

- `FlowError::Internal` echoes internal detail strings (store paths, serde errors) to the HTTP
  client (589–595). Local-only API behind the local key, and the chat skill benefits from the
  detail — acceptable, but worth knowing the log and the response carry the same text.
- Outside my range but adjacent (for the middle-third reviewer): `list_flows` (1383–1402) calls
  `last_execution` per workflow sequentially — an N+1 of n8n calls per list request; fine at
  demo scale (a few flows), noticeable at dozens given each call can take up to 20 s.
- `valid_workflow_id` (933–941, just below the boundary) guards URL-path injection for ids
  spliced into n8n URLs and is unit-tested (2240–2245); handlers that take ids from the request
  path route through `load_any_flow` (1442) or an explicit check (`delete_flow`, 1576). The
  base URL itself is normalized by `screenpipe_connect::connections::n8n::instance_url`
  (`n8n.rs:47-54`, trailing slash and `/api/v1` suffix trimmed), so `format!("{}/api/v1{path}")`
  (635) cannot double-slash.
- The file header's line 3 ("add this header … even outside screenpipe repo") is the
  pre-existing repo convention — present on `origin/main` in e.g. `server.rs` — not something
  this PR introduced. (Note `AGENTS.md` overrides it: the header must not be added outside this
  repository.)
- Design-rule conformance: the slice's constants and guards implement README.md design rules
  1, 3 and 6 as documented (`README.md:155-162`).

## What I did not check

- The Tauri side of `FlowActivationKey` handling (`expose()` consumers) — outside my files.
- UI/mock parity of the wire contract (browser-mock loop) — out of slice; the serde shapes
  match the codes the skill prose and UI error components document, but I did not diff them
  field-by-field against the TypeScript types.
- Behavior against a real n8n instance (tests use a wiremock fake); n8n-specific status codes
  (e.g. 409 on duplicate tag) are taken from the fake's behavior.
