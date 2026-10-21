# 01: Review graph without the facts block

**What to build:** On the Review Screen, every graph card shows only its one-sentence explanation. No n8n credential name and no called host appear anywhere in the app; the user still sees them in n8n (« Voir le graphe »). The Flow the service returns no longer carries per-node facts.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** None (can start immediately)

**Status:** done, live check pending: open the demo Flow's Review Screen in the running app and confirm no card shows « Identifiant n8n » or a host (Jira, Gmail, AI model, ScreenPipe tool nodes).

- [x] The Flow service no longer returns per-node facts for any Flow (chat-built or from a task).
- [x] Graph cards render only the sentence; no extra block appears under any node, including credentialed and HTTP Request nodes.
- [x] Engine integration tests and graph component tests that asserted facts now assert their absence.
- [x] Browser-mock fixtures carry no facts.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 51 passed (new `no_step_shows_n8n_credentials_or_called_hosts` red before the change, green after; covers from-task create, GET with an added fixed-URL HTTP Request node, and a chat-built Flow).
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed (the `url_host` unit test went with the code).
- `cd apps/screenpipe-app-tauri && bunx vitest run components/automation-flows` → 4 files, 80 tests passed (new « shows only the sentence under each step » red before, green after).
- `bunx tsc --noEmit -p .` in apps/screenpipe-app-tauri → no errors in components/automation-flows.
