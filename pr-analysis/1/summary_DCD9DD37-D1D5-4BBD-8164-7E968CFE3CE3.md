# Slice review: engine wiring for Automation Flows (PR #1)

Slice: `crates/screenpipe-engine/src/server.rs` (route registration, 32 lines),
`lib.rs` (module exports), `Cargo.toml` (new dependency),
`bin/screenpipe-engine.rs` (CLI), `routes/mod.rs` (route module registry).
Focus: middleware order and auth on the new routes.

## What this slice changes

This slice is the connective tissue that mounts the new Automation Flows
feature into the engine:

- **server.rs +32** — four new public config fields on `SCServer`
  (`flow_activation_key`, `flow_running_wait`, `flow_failure_reports`,
  `flow_health_schedule`, server.rs:321-331), their defaults in `new()`
  (server.rs:434-437), and one `router.nest("/automation-flows", …)` call
  (server.rs:1498-1512).
- **lib.rs +3** — `pub mod automation_flows; pub mod flow_checks;
  pub mod n8n_nodes;` (lib.rs:43-45).
- **Cargo.toml +2** — `flate2 = "1.1"` (Cargo.toml:20-21) for gunzipping the
  embedded n8n node catalog (`n8n_nodes.rs:116`).
- **routes/mod.rs +1** — `pub mod chatgpt_proxy;` (routes/mod.rs:12).
- **bin/screenpipe-engine.rs: no changes.** `git diff origin/main...HEAD` on
  the file is empty and `git log origin/main..HEAD` on it is empty. The ask
  expected "new subcommands and help text accuracy"; there are none to review.
  The CLI is affected only through `SCServer` defaults (see CLI section below).

## Verdict: clean wiring, no blockers

I found no correctness, security, or ordering defect in this slice. Two P3
comments posted (public-surface hygiene on lib.rs; a defaults question on
server.rs). Detail per focus area:

### Middleware order and auth on new routes (the focus) — correct

- The nest at server.rs:1500 happens before the later `.layer(...)` calls, so
  the new routes sit inside the full middleware stack, including the API-auth
  middleware (server.rs:1611-1723). `/automation-flows` was deliberately NOT
  added to `is_api_auth_exempt_path` (server.rs:365-375) — with API auth
  enabled every flow call needs the key. Strictest choice; no bypass.
- Pipe tokens: `is_api_auth_token_authorized` (server.rs:378-388) accepts
  `sp_pipe_*` tokens, but `pipe_permissions_layer`
  (pipe_permissions_middleware.rs:65-116) then enforces
  `is_endpoint_allowed(method, path)`, and the default allowlist
  (screenpipe-core/src/pipes/permissions.rs:125-149) has no
  `/automation-flows` entries — default-permission pipes get 403. Only an
  explicit user-approved allow rule grants access. Correct use of the
  existing model.
- Activation auth: `from_user` (automation_flows.rs:1459-1465) requires the
  `x-screenpipe-flow-activation` header AND `state.activation_key` to be
  `Some` (`.zip`), so the CLI default `None` (server.rs:434) refuses every
  activation — exactly what the server.rs:321-324 doc comment claims. Covered
  by tests `the_local_api_key_alone_cannot_activate_a_flow` and
  `without_the_desktop_app_no_flow_can_be_activated`.
- CSRF: the flows router layers `require_json`
  (automation_flows.rs:299, 303-316) — unsafe methods must send
  `application/json`, which cross-site form posts cannot.
- Ordering trap avoided: `flow_activation_key` is cloned into the router at
  build time, and the desktop app sets it right after `SCServer::new`
  (server_core.rs:651-653), before the server starts and builds the router.
  No captured-`None` bug.
- The n8n error-workflow callback (`POST /automation-flows/:id/failures`)
  authenticates via the `screenpipeApi` n8n credential
  (ScreenPipeApi.credentials.ts:36 sends `Authorization: Bearer <apiKey>`),
  and the code documents the fallback when it can't: failures still surface
  through the 15-minute health check (failures.rs:109, 342).
- Argument wiring verified param-by-param against
  `automation_flows::router`'s signature (automation_flows.rs:244-252): 7
  args, same order; `RunningWait`/`HealthSchedule` are `Copy`,
  `FailureReports`/`FlowActivationKey` are `Clone` — matches how each is
  passed (server.rs:1504-1510).

### Doc comments on the new fields are accurate

Verified against implementations: RunningWait default deadline 90 s
(automation_flows.rs:205-207); HealthSchedule default 15 min / 30 s retry
(automation_flows/health.rs `impl Default`); `FailureReports::for_api_port`
reads `SCREENPIPE_FOCUS_PORT` (11435 fallback) and builds
`http://host.docker.internal:{api_port}` (failures.rs:42-53) — matching the
server.rs:325-331 comments, including the "(in Docker)" scoping.

### Cargo.toml — `flate2` justified (check run)

`cargo tree -p screenpipe-engine -i flate2` confirms the in-line comment:
flate2 v1.1.9 was already in this crate's tree through
`png v0.18.1` ← `image v0.25.10` (arboard/tesseract/etc.), so the direct dep
adds zero new compile cost and resolves to the same version. Used once, at
n8n_nodes.rs:116 (`GzDecoder` over the embedded catalog) — one-shot startup
unpack, appropriate crate choice. Nit not posted: it is declared directly
(`"1.1"`) while its neighbors use `workspace = true`; the root
`[workspace.dependencies]` has no flate2 entry, so this is the current
option short of adding one.

### routes/mod.rs — registration used and reachable

`chatgpt_proxy` is consumed by `cloud_proxy.rs:34-35` (model-based
delegation) and mounted at `POST /v1/chat/completions`
(server.rs:1272-1276, with the 50 MB body limit). Registration is necessary
and correct. CodeRabbit's existing comment on that module's missing client
timeout (chatgpt_proxy.rs:152-160) is on a file outside my slice; not
duplicated.

### CLI behavior via defaults (bin untouched)

`bin/screenpipe-engine.rs` gets `flow_activation_key: None` → all activations
refused (matches the field doc "the CLI ... refuses every activation"), and
`flow_health_schedule: Some(Default::default())` → the CLI also spawns the
periodic health check. Without n8n secrets this degrades to a cheap
"not_configured" report every 15 min (health.rs:266-282); the CLI does create
a secret store when encryption is on (bin:1506-1549), so a CLI user with n8n
configured gets real 15-min polling and failure notifications aimed at
`127.0.0.1:11435/notify`, with delivery retries backed off and capped at the
15-min schedule (health.rs `Pacing::next_delay`). Benign, but it is a silent
background-task default for every `SCServer` embedder — posted as P3.

## Checks run in this session

- `git diff origin/main...HEAD -- <5 slice files>` (+ `--stat`, `--numstat`,
  `git log origin/main..HEAD -- <bin>`): slice is +38 lines across 4 files;
  bin file untouched.
- `cargo check -p screenpipe-engine` → exit 0 ("Finished `dev` profile");
  only pre-existing dead_code warnings in files outside this slice
  (routes/health.rs:333, screenpipe-core pipeline.rs:47).
- `cargo test -p screenpipe-engine --test router_contract_test
  --test automation_flows_test` → 107 + 1 passed, 0 failed. These cover the
  mounted router end-to-end against a wiremock fake n8n, including the
  activation-credential refusals.
- `cargo tree -p screenpipe-engine -i flate2` → flate2 already present via
  png (dependency-justification check above).
- Greps cited inline for: exempt paths, pipe allowlist, module users, secret
  store wiring, `flow_activation_key` set sites.

Not run: the full workspace test suite and the frontend suite (out of slice
scope; the crate-level suite above is the narrowest boundary proving this
wiring).
