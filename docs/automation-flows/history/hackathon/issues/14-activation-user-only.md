# 14: Only a user click can activate a Flow (enforced by the server)

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (story 22, 34); AGENTS.md "nothing activates without an explicit user action". Found by an automated security review after ticket 08.

**What to build:** Today the chat agent (Pi) calls the Flow service with the
same local API key as the app, so it could call
`POST /automation-flows/:id/activate` itself; only the `automation-flows`
skill text forbids it. The server must refuse activation unless it comes from
the desktop UI after a user click: `versionId` becomes mandatory (400 when
missing), and the route rejects requests that do not carry the app's client
context (see `crates/screenpipe-engine/src/routes/request_origin.rs`,
`ExplicitApiClient` with sources App / MCP / API) or, better, moves behind a
UI-only credential or Tauri command. State-changing `/automation-flows` routes
also require `Content-Type: application/json`.

Orchestrator decision (2026-10-17): use the UI-only credential. The
`x-screenpipe-client` header defaults to App when missing, so a header check
alone does not stop the chat agent. The credential lives only in memory of
the app process (engine + Tauri side) and reaches the webview only through a
Tauri command; it is never put in an environment variable (child processes
such as Pi inherit them), a file, a log or the local API key. Deactivation
stays open to any authenticated caller (switching off is always safe). The
browser mock keeps working through its mock engine; the live web dev loop may
refuse activation, that is expected.

**Blocked by:** None (can start immediately).

**Status:** done (live-verified on the demo machine 2026-10-17: API-key-only activation → 403, no JSON → 415, the click activates, the chat refused to activate; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] Flow service tests: activate without `versionId` → 400; activate from an agent/pipe/MCP client context → 403; activate from the app context with the reviewed version → 200 (existing tests still pass).
- [x] The Review Screen's Activer still works (frontend tests and browser mock; the browser mock was exercised through its mock engine and mock Tauri IPC in `api.test.ts`, not opened in a browser).
- [x] A chat request asking to activate a Flow is refused by the server, not only by the skill (engine test with the local API key required; live chat check pending).

## What was built

- Engine (`crates/screenpipe-engine/src/automation_flows.rs`):
  `FlowActivationKey` (random per process, two v4 UUIDs, redacted `Debug`,
  constant-time comparison) and `ACTIVATION_HEADER`
  (`x-screenpipe-flow-activation`). `SCServer.flow_activation_key` (default
  `None`: the CLI refuses every activation) is passed to the router.
  `POST /:id/activate` answers `403 activation_requires_user` without the
  matching header (checked before n8n is read), then `400 version_required`
  when `versionId` is missing, `null` or empty. Every POST/PUT under
  `/automation-flows` answers `415 json_required` without
  `Content-Type: application/json` (a cross-site page cannot send that
  without a CORS preflight). Deactivation stays open to any authenticated
  caller.
- Tauri (`src-tauri/src/automation_flows.rs`): one key per app process in a
  `OnceLock`, set on the embedded engine in `server_core.rs`, handed to the
  webview only by the command `get_flow_activation_key`
  (`lib/utils/tauri.ts` regenerated). Never an env var, file, log or the API
  key.
- Client (`components/automation-flows/api.ts`): `activate` fetches the key
  through the command and sends it in the header (no header outside the
  desktop app, so the engine refuses); `deactivate` sends JSON; new typed
  code `activation_requires_user`.
- Browser mock: `get_flow_activation_key` returns a fictional key in mock
  mode (`null` in live mode); the mock engine refuses activation without it
  (403) or without a version (400), like the engine.
- `automation-flows` skill rule 1 and `SPEC.md` contract: the server refuses
  chat activation; give the Review Screen link instead.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 31 passed
  (new: `the_local_api_key_alone_cannot_activate_a_flow`,
  `activation_needs_the_version_the_user_reviewed`,
  `state_changing_routes_take_only_json_requests`,
  `without_the_desktop_app_no_flow_can_be_activated`; existing activation
  tests now click through the UI credential).
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed.
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 2 passed.
- `cd apps/screenpipe-app-tauri && bun run bindings:generate` then
  `bun run bindings:check` → `tauri_bindings_are_current ... ok` (regenerated
  `src-tauri/gen/schemas/` noise restored).
- `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx lib/workflows/automation-flows.test.ts components/workflows lib/dev/browser-runtime.test.ts`
  → 28 files passed (1 skipped), 275 tests passed.
- `bun x tsc --noEmit -p .` → no errors.

## Pending: live check in the real app (dev build, this branch)

1. `bun run dev:tauri` on this branch (signed in, n8n running), open a Draft
   Flow's Review Screen, click « Activer ». Check: it becomes Active and the
   history shows « activé » by the user. In the webview devtools, the
   `POST …/activate` request carries `x-screenpipe-flow-activation` (CORS
   allows any header; no preflight error).
2. « Désactiver » still works.
3. In the chat: « Active le Flow <id> ». Check: Pi does not activate it; if
   it tries `curl … /activate`, the engine answers `403
   activation_requires_user` and the Flow stays off.
4. From a terminal with the local API key:
   `curl -X POST -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"versionId":"<v>"}' http://localhost:<port>/automation-flows/<id>/activate`
   → 403.
