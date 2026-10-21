# Handoff — Automation Flows (hackathon)

Last updated: 2026-10-18, `main` after round two (tickets 25–27 and
`docs/automation-flows/history/flows-round-two/`), pushed.
Read this first, then `AGENTS.md` (Hackathon mode), `CONTEXT.md`, `SPEC.md`,
`automation-flows-spec.md`, the ticket files in `issues/`, round two's spec
(`issues/27-flows-round-two.md`), its tickets and feature → test table
(`docs/automation-flows/history/flows-round-two/issues/`, `docs/automation-flows/history/flows-round-two/coverage.md`),
`DEMO.md` (runbook) and `evidence/LIVE-CHECKS.md` (every live check with its
observed result).

## Flow front merge (branch `hackathon/flow-front`, 2026-10-17)

The teammate front (archived `dev`) is being merged onto this one; plan and
decisions in `flow-front-merge.md`. Not in `main` until approved, through a PR.

- **English:** everything ScreenPipe writes is English (Flows screens, Task
  Page creation block, chat skill, engine fact lines, demo task, notification,
  Flow and node names, node sentences, summary). What was recorded stays as it
  is: the French emails and Jira tickets in the captures and their quoted
  subjects, and the AI's instructions and vocabulary (it answers « Tâche »
  for an idea). The NOVA project's issue types are English, so « Prepare the
  ticket » sends « Task » instead of « Tâche », which Jira refuses.
- **Re-import the workflow** after pulling (`infra/automation-flows/import-workflow.sh`):
  node names changed, so did the AI tool name (« screenpipe history », also
  renamed in its instructions) and the IMAP trigger's static data key.
- **Engine:** Dismiss / Restore (`POST /automation-flows/:id/dismiss|restore`,
  status `dismissed`, 409 `flow_active` while on). Written without a Rust
  toolchain: run `cargo test -p screenpipe-engine --test automation_flows_test`
  before merging.

## Where the work is

- **Branch:** `main` on `origin` (KylianAUBRY/screenpipe_LH) is the
  integration branch since 2026-10-17 (it took `hackathon/automation-flows`
  unchanged, see "Teammate divergence"); round two was built on `main`.
  `hackathon/automation-flows` stops at round one plus tickets 25–26.
- **Checkout:** `~/dev/screenpipe_LH`. The old checkout on the Desktop sits in
  iCloud Drive, which evicted its 534 MB git pack: git hangs there. Do not
  work in it; the user's app may still run from it until rebuilt here.
- **Process:** `/mattpocock-skills:implement-spec`: one implementer per ticket
  in its own worktree (`tdd` skill), merged `--no-ff` into the integration
  branch, pushed after every merge; then an independent code review (standards,
  spec, correctness/security) whose findings became tickets 21–23.

## Ticket state

| # | Ticket | State |
|---|---|---|
| 01–13 | Golden path, Flow service, Task Page, activation, graph, chat, nodes, proxy | done, **live-verified** on this Mac |
| 14 | Server-enforced user-only activation | done, live-verified |
| 15 | Task Page evidence from this Mac's real captures (9/9) | done, live-verified |
| 16 | Demo reset restores the start state | done, live-verified |
| 17 | NovaPlanning product; skill names CUSTOM.* node types and every parameter | done, live-verified |
| 18 | Flow service hardening (refused key, creation off, fresh screens) | done, live-verified |
| 19 | Task Page: creation mode only where it works, drafts | done, live-verified |
| 20 | Agent browser cannot open the app's own pages | done, live-verified |
| 21 | Switching a Flow off waits for the running execution | done, live-verified |
| 22 | Review fixes, engine (who deactivated, outside activation, credentials, facts, sourceMoment, n8n_failed, no MCP) | done, live-verified |
| 23 | Review fixes, UI/workflow/nodes (DESIGN.md, reviewed version, timeline link, Jira markup, AI trigger) | done, live-verified |
| 24 | « Trouver une automatisation » button (scripted detection, next to the bell) | superseded by round two 03 (⌃⌥⌘D) |
| 25 | The user's ChatGPT subscription answers every AI (`chatgpt/gpt-5.6-luna:max`) | done, live-verified |
| 26 | No Flow on an invented or half-built n8n node | done, live-verified |
| 27 | Round two spec → `docs/automation-flows/history/flows-round-two/issues/01`–`16` | 01–15 done (tests); 16, the full live check, pending |
| 12 | Demo assembly + rehearsal | 5 rehearsals; journey 105–110 s; acceptance list checked in `SPEC.md`; see `DEMO.md` |

Also fixed from rehearsals: IMAP catch-up seed (an email arriving around
activation was missed), reset retries while n8n is still unpublishing, the AI
step times out after 30 s and retries (a hung proxy call held an email for 10
minutes).

## Gotchas (each cost time already)

- **Branch base:** agent worktrees are cut from `origin/main`. Since
  2026-10-17 `main` holds this branch's content, so that base is safe; still
  start implementers with
  `git switch -c hackathon/ticket-NN hackathon/automation-flows`.
- **Engine changes need the dev build.** The ScreenPipe running from
  `/Applications` does not contain our routes or the proxy fix. Live checks:
  quit the installed app, then `cd apps/screenpipe-app-tauri && bun run dev:tauri`
  on this branch, signed in (the AI proxy needs the cloud token).
- **Dev builds are isolated by default** (`~/.screenpipe-dev`, API on port
  3130). The n8n credentials point at port 3030 and the AI tool needs the real
  captures, so run the dev build with `SCREENPIPE_DEV_USE_PROD_DATA=1`, from
  macOS Terminal (screen permissions), never next to the installed app.
- **Workflows view needs the PostHog `workflows` flag.** The Task Page lives
  there. On a demo machine whose account lacks the flag, put
  `NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT=1` in
  `apps/screenpipe-app-tauri/.env.local` (gitignored) and rebuild. It only
  shows the view; background workflow AI still needs its explicit opt-in.
- **Docker Desktop** reports bind mounts as `/host_mnt/Users/…`;
  `install-n8n` strips that prefix (it refused to copy before).
- **n8n 2.42.2:** switch on/off = `publish`/`unpublish` with `versionId`
  (`activate`/`deactivate` are deprecated). CLI runs inside the container need
  `-e N8N_RUNNERS_BROKER_PORT=5690`. Polling triggers only run from the
  editor's "Fetch Test Event", not `n8n execute`.
- **Vitest on Node 26:** `vitest.config.ts` turns off Node's webstorage in
  test workers (it hid jsdom's `localStorage`); no prefix needed any more.
- **iCloud Drive:** never put a checkout or an agent worktree under Desktop or
  Documents: iCloud evicts `node_modules`, `target` and git packs, and git or
  builds then hang. Agent worktrees take 6–10 GB each; remove merged ones.
- **Keys for scripts:** the gitignored root `.env` holds `N8N_API_KEY` and
  `SCREENPIPE_LOCAL_API_KEY`; Bun loads it from the repo root.
- **Custom nodes:** `cd packages/n8n-nodes-screenpipe && bun run install-n8n`
  builds, copies into `infra/automation-flows/custom-nodes/` (gitignored) and
  restarts n8n. Install from a branch that has all three nodes.

## Local environment (this Mac)

- n8n: `docker compose -f infra/automation-flows/docker-compose.yml up -d`,
  http://localhost:5678 (owner account exists; the human knows the login).
  Log into it in Safari (default browser) before a demo.
- Credentials in n8n (ids are referenced by the workflow), all filled and
  live-tested: `spNovaImap000001` Gmail IMAP, `spNovaJira000001` Jira,
  `spProxyOpenAI001` ScreenPipe AI proxy, `spScreenpipeApi1` ScreenPipe API.
- ScreenPipe Connections → n8n holds `http://localhost:5678` and an n8n API
  key.
- The dev build runs from Terminal with `SCREENPIPE_DEV_USE_PROD_DATA=1`
  (see `DEMO.md`); `apps/screenpipe-app-tauri/.env.local` sets
  `NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT=1`.
- `ZZ Probe - vérification des identifiants` in n8n: untagged, inactive,
  re-runs a credentials check (`n8n execute --id=spProbeVerify001`); safe to
  delete.
- Secrets never go in the repo.

## Known limits (not fixed, judged minor or team decisions)

- The Flows UI and the Task Page creation block are hard-coded English in
  JSX, not through the app's localization (`useGT`) (was French until the
  Flow front merge).
- The « Flow runs » mode of the ScreenPipe Trigger fires once when several
  runs happen between two polls (it watches the last execution).
- The Flows list is the n8n workflows tagged `screenpipe-flow`: a workflow
  tagged by hand in n8n shows up too.
- The agent's browser can still open the n8n editor (no cookies unless the
  user shares browser sessions); a version published there is flagged on the
  Review Screen (« Activer cette version »).
- Task Page drafts live in the app session (lost on app restart; `reset.ts`
  cannot clear them).
- The Flow service holds its write lock while it waits for a running
  execution (up to ~90 s): other activations/creations queue meanwhile.
- The node catalog (`infra/automation-flows/n8n-catalog.json`, `n8n-nodes.json.gz`)
  describes the pinned n8n image; regenerate it with
  `bun infra/automation-flows/n8n-catalog.ts` after changing the image or the
  ScreenPipe nodes (its test fails until then). Community nodes are unknown to
  it and refused; required fields nested in collections are shown in node
  cards but not checked at « Terminer ».
- HTML-only emails: numeric entities above U+FFFF (emoji) are garbled in the
  Jira description.
- A credential a chat-built node needs is wired only when n8n holds exactly
  one of its type; none or several is a refusal the user must resolve in n8n.
- Jira NOVA holds the rehearsal tickets NOVA-31…42.

## Open decisions

- **Failure handling (D16–D20) is built** (round two 09–14): failure
  notification through ScreenPipe's n8n error workflow, « Relancer » (user
  only), abstention « À trier à la main » with the Activity list, health check
  at engine start and every 15 min (banner, missed failures, 24 h draft
  cleanup), duplicate-safe tickets via a `mail-<hash>` label and a JQL search.
  Checked by tests only until round two 16 runs live.
- **Teammate divergence (settled 2026-10-17):** `main` had another Review
  Screen ("Recommendations" tab, questions on the Review Screen, notification
  opens the Review Screen, demo backend) by a teammate, plus the « Find an
  automation » button and its `repeated-workflow-detector` Pipe. User
  decision: those four commits moved to
  `archive/main-before-automation-flows` (tip `1196dd10a`), and `main` took
  this branch's content unchanged (merge `-s ours`, no force-push, so their
  commits stay in `main`'s history). Ported since: the « Find an automation »
  button, as « Trouver une automatisation » running the scripted detection
  (ticket 24; the archive's `repeated-workflow-detector` Pipe was not ported).
  Pieces worth porting later from the archive: Flows grouped by state, the
  « if → then » rules with « de vous » for rules from the user's answers,
  choice pills for the questions.
- Whether the n8n trigger nodes appear in the 3-minute demo (D12).
