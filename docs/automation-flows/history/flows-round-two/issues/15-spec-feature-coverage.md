# 15: Every spec feature has an automated test

**What to build:** Every feature of the hackathon spec and of ticket 27 is mapped to the automated test that covers it, at the highest seam (Flow service routes against the fake n8n, app components in the browser-mock, the workflow JSON contract, the demo trigger function), and the missing tests are written.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14

**Status:** done (live items handed to ticket 16)

- [x] A feature → test table is committed next to the spec: `docs/automation-flows/history/flows-round-two/coverage.md`.
- [x] Every row names a passing automated test; gaps are filled. What only a live run can check is listed at the end of the table (« Only checkable live ») for ticket 16.
- [x] All suites pass: engine, n8n nodes, workflow and catalog tests, app vitest suites touched by the spec.

## Gaps found and filled

All seen failing first by breaking the behavior (mutation), then restored:

- `lib/__tests__/notification-actions.test.ts` › « Relancer » on a failed Flow run retries it, then opens the Flow's Review Screen (D17) — and « Relancer » that n8n refuses says why and leaves the user where they are. Failed with the post-call navigation removed.
- `components/__tests__/pipe-store-flows-tab.test.tsx` › shows no control that fakes the detection (27-28). Failed with a « Trouver une automatisation » button put back next to the bell.
- `components/automation-flows/__tests__/api.test.ts` › reads the engine's last health check with a plain GET… and browser mock › answers the health check with n8n reachable, and unreachable in that state (D19). Failed with the client sending a POST.
- `infra/automation-flows/workflows/novadesk-support-tickets.test.ts` › a failed run keeps its email in n8n so Retry has it (27-47). Failed with `saveDataErrorExecution: "none"` in the workflow.
- `crates/screenpipe-core/src/agents/pi.rs` › `automation_flows_skill_deletes_a_flow_when_asked_without_confirmation` (27-35).

## Test-environment fixes

- `apps/screenpipe-app-tauri/vitest.config.ts`: the test workers get `--no-experimental-webstorage` on Node versions that know it (Node 25+ ships its own `localStorage`, undefined without `--localstorage-file`, which hid jsdom's). Done in the config rather than the script so `bun run test:vitest` and direct `bunx vitest run <files>` both work, without `NODE_OPTIONS`; older Node gets no flag. Seen: `components/workflows/workflow-block-types.test.tsx` 2 failed before, 2 passed after (threads and `--pool forks`).
- `infra/automation-flows/demo/reset.test.ts`: the child processes run from a fresh temp cwd, so Bun never loads a repo-root `.env`. Seen: with a `.env` holding `N8N_API_KEY`, 2 failed before, 18 passed after; 18 passed without a `.env`.
- `bun install`: every needed `node_modules` was present in this checkout (`packages/workflows-ui` resolves its deps through the app's aliases); nothing installed.

## Tests run

On `ticket-15` (from `main` 2f77a4125), Node 26.8.1, Bun 1.3.14:

- `cargo test -p screenpipe-engine --test automation_flows_test` → 101 passed, 0 failed
- `cargo test -p screenpipe-engine --lib` → 1785 passed, 0 failed, 10 ignored
- `cargo test -p screenpipe-core --lib automation_flows` → 7 passed (1 new)
- `cargo test -p screenpipe-connect --lib n8n` → 6 passed
- `cd packages/n8n-nodes-screenpipe && bun test` → 47 pass, 0 fail (4 files)
- `bun test infra/automation-flows` → 70 pass, 0 fail (5 files; 1 new)
- `cd apps/screenpipe-app-tauri && bun x vitest run --config vitest.config.ts components/automation-flows lib/automation-flows components/workflows lib/workflows lib/notifications lib/__tests__/notification-actions.test.ts components/__tests__/pipe-store-flows-tab.test.tsx components/chat/markdown-block.test.tsx app/notification-panel/page.test.tsx` → 70 files passed, 1 skipped; 741 tests passed, 1 skipped
- `cd apps/screenpipe-app-tauri && bun run test:vitest` (full suite, no `NODE_OPTIONS`) → first run: 620 files / 7041 tests passed, 1 failed: `lib/workflows/cloud-editing.test.tsx` › keeps the document view without writes when policy is 'View only…' (cloud workflow editor, unrelated to Flows; passes alone twice — load-dependent flake). Second run: 620 files passed, 1 skipped; 7042 tests passed, 1 skipped, 0 failed.
- Not re-run: native `bun run test:tauri shortcuts::tests` / `owned_browser` (no native change here; last green in tickets 03 and round-one 20).

## Live check (ticket 16)

The 13 items in `docs/automation-flows/history/flows-round-two/coverage.md` › « Only checkable live ».
