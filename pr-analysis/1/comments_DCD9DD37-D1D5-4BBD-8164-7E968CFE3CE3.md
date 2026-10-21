# Review comments — engine wiring slice (server.rs, lib.rs, Cargo.toml, routes/mod.rs, bin)

No blockers found in this slice; the route registration, middleware order, and
auth on the new `/automation-flows` routes are correct (details verified in the
review). Two minor items:

---

**P3 (nit) — `crates/screenpipe-engine/src/lib.rs:43-44`**

`flow_checks` and `n8n_nodes` are exported `pub` but have no users outside the crate: a workspace-wide grep finds references only in `automation_flows.rs` and `lib.rs` itself, and the new integration tests (`tests/automation_flows_test.rs`) import only `automation_flows` items (`FailureReports`, `FlowActivationKey`, `HealthSchedule`, `RunningWait`, `ACTIVATION_HEADER`). Making them `pub(crate)` keeps the engine's public API surface minimal, which matters here because `pub mod automation_flows` must stay public anyway (the desktop app imports `screenpipe_engine::automation_flows::FlowActivationKey`, and `SCServer`'s new public field leaks that type). While touching these lines: the three modules are inserted after `auth_key`, breaking the file's otherwise-alphabetical module order (`automation_flows` sorts before `auth_key`; `flow_checks` and `n8n_nodes` belong later in the list).

---

**P3 (nit) — `crates/screenpipe-engine/src/server.rs:437`**

`SCServer::new` defaults `flow_health_schedule` to `Some(Default::default())`, so *every* embedder — including the headless CLI, since `bin/screenpipe-engine.rs` only uses `SCServer::new` and never touches the new fields — spawns the periodic n8n health-check task at router build. I verified the behavior is benign: without n8n secrets it degrades to a cheap `not_configured` report every 15 minutes, and notification delivery backs off with a cap at the 15-minute schedule (`Pacing::next_delay`). But a CLI user who has n8n secrets stored (the CLI does create a secret store when `encrypt_secrets` is on) will get background polling of their n8n plus failure notifications aimed at the desktop app's port 11435, with no CLI flag to turn it off. If CLI silence is intended, the field doc's framing ("`None` never runs it in the background (tests)") suggests wiring `None` (or a config flag) for the CLI bin; if CLI polling is a feature, a one-line comment on the `new()` default saying so would prevent the next reader from "fixing" it.
