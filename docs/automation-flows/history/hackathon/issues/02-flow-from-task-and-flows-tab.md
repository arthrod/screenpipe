# 02: Create a Flow from the demo task and see it in the Flows tab

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (contracts in `SPEC.md`).

**What to build:** ScreenPipe can create the Automation Flow of the demo
Detected Task and show it. ScreenPipe's existing n8n connection gains an API
URL field and an API key field (secret). The Flow service exposes list, get
and create-from-task: create-from-task imports the bundled demo workflow into
n8n switched off and tagged, stores the summary and the source task id in the
local Flow record, and is idempotent per task. In the app, Automations gets a
third "Flows" tab, addressable by URL (tab + Flow id): the list shows name,
status (Draft) and last run; the Review Screen shows the summary, each node
with its sentence, a "View graph" link to n8n and a link back to the Task
Page. The Flows UI lives in its own module and talks to the rest of the app
only through one typed client; the browser mock returns fixture Flows. Plain
styling, built to be replaced.

**Blocked by:** None (can start immediately). Use a provisional bundled
fixture until 01 exports the final one.

**Status:** ready-for-agent

Implementation: branch `claude/wonderful-spence-c67d0b`. The engine bundles
ticket 01's `infra/automation-flows/workflows/novadesk-support-tickets*.json`
and adopts the copy `import-workflow.sh` already installed (fixed id
`spNovaFlow000001`) instead of importing a duplicate.

- [x] Flow service tests against a fake n8n: not configured → 412; n8n down → 502; create imports switched off and tagged; a second call returns the same Flow; unknown task → 404; sticky notes are not nodes; node sentences come from node notes; status is Draft.
- [x] The n8n connection shows the two new fields and stores the key as a secret.
- [x] The Flows tab and Review Screen render from the typed client (frontend tests).
- [x] The browser mock shows a fixture Flow without the native app.
- [x] A clear message appears in the Flows tab when n8n is not configured or unreachable.

## Verification

| Criterion | Command (exact) | Result |
|---|---|---|
| Flow service vs fake n8n (wiremock) | `cargo test -p screenpipe-engine --test automation_flows_test` | 11 passed, 0 failed: `not_configured_returns_412`, `n8n_down_returns_502`, `create_from_task_imports_switched_off_and_tagged` (also asserts Draft), `second_create_returns_the_same_flow`, `create_adopts_the_workflow_already_imported_by_the_import_script`, `create_again_after_the_workflow_was_deleted_in_n8n`, `unknown_task_or_flow_returns_404`, `review_nodes_come_from_n8n_notes_without_sticky_notes`, `list_shows_only_flows_with_status_and_last_run`, `status_is_derived_from_n8n_and_the_reviewed_version`, `review_is_outdated_while_n8n_runs_an_older_version_than_its_draft` (SPEC D7) |
| Status derivation, bundled fixture validity | `cargo test -p screenpipe-engine --lib automation_flows` | 3 passed, 0 failed |
| n8n connection fields + secret | `cargo test -p screenpipe-connect --lib connections::` | 110 passed, 0 failed, 1 ignored (includes `n8n::tests::api_url_is_plain_and_api_key_is_secret`, `api_key_is_stored_in_the_secret_store`, `test_checks_the_api_with_the_key_header`, `test_rejects_half_configured_api_and_empty_form`) |
| Flows tab + Review Screen from the typed client, error messages, browser mock (fixture = ticket 01 workflow), n8n form fields | `bun x vitest run --config vitest.config.ts components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx components/settings/__tests__/connection-credential-forms.test.tsx` (in `apps/screenpipe-app-tauri`) | 30 passed (api 12, flows-tab 10, pipe-store-flows-tab 2, connection forms 6) |
| Whole frontend suite | `NODE_OPTIONS=--no-experimental-webstorage bun run test` | vitest 6912 passed, 1 skipped; bun 398 pass, 0 fail (after merging the integration tip with tickets 03, 07, 13). Without the flag, 171 tests in 16 unrelated files fail on this machine (Node v26's built-in `localStorage` shadows jsdom's; none of those files import changed code). |
| Types | `bun run typecheck` | 0 errors |

Browser mock (`bun run dev:web`, then
`http://127.0.0.1:1420/home?section=pipes&tab=flows`; add
`&flowsState=not-configured` or `unreachable` for the error states):

- List: `docs/automation-flows/history/hackathon/screenshots/02-flows-list.jpg`
- Review Screen (`&flow=fxNovaDesk01`): `docs/automation-flows/history/hackathon/screenshots/02-review-screen.jpg`
- n8n not configured: `docs/automation-flows/history/hackathon/screenshots/02-n8n-not-configured.jpg`

Not verified here: the real n8n 2.42.2 import (no API key yet) and the
native app (`bun run dev:tauri`); both belong to ticket 01 / the golden path.
