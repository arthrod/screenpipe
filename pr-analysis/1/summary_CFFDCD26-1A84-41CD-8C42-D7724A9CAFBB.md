# Slice review: hackathon issues 08–14 (docs/automation-flows/history/hackathon/issues/)

PR #1 (arthrod/screenpipe), diff base origin/main, checkout is PR head. My slice: seven new
issue-record files (441 added lines, all new files): 08-chat-modification, 09-chat-creation,
10-screenpipe-trigger, 11-screenpipe-ai-trigger, 12-demo-assembly, 13-ai-proxy-tool-calls,
14-activation-user-only.

## What this slice is and how it fits the PR

These are the per-ticket records for the Automation Flows feature: each file states the goal,
"what was built" with engine/UI/skill file references, the exact test commands with
point-in-time results, live-verification evidence, and any remaining human steps. They are the
audit trail tying the PR's biggest surfaces together: the chat-modification and chat-creation
routes (`crates/screenpipe-engine/src/automation_flows.rs`), the two n8n trigger nodes
(`packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger`, `.../ScreenPipeAiTrigger`), the AI
proxy tool-call fix (`crates/screenpipe-engine/src/routes/cloud_proxy.rs`), the
activation-user-only invariant (`automation_flows.rs` + Tauri side), and the demo runbook
(`DEMO.md`, `SPEC.md`). Quality is high: claims are specific, commands are exact, live vs
agent-done work is honestly separated, and "pending human" steps are explicit.

## Checks I ran (this session)

- `cd packages/n8n-nodes-screenpipe && bun test` → **56 pass, 0 fail** at HEAD (issues 10/11
  claim point-in-time counts of 38 and 27; suite grew with later tickets; currently green).
- `cargo test -p screenpipe-engine --lib routes::cloud_proxy` → **6 passed; 0 failed** —
  matches issue 13's claim exactly.
- `cargo test -p screenpipe-engine --test automation_flows_test` → **107 passed; 0 failed** at
  HEAD (issues 08/14 claim point-in-time 25 and 31; later tickets grew the suite; green).

Not run (reported as such): the frontend vitest suites quoted in 08/14 (135 / 275 claims —
point-in-time; not re-run); live-n8n probes in the "pending human" sections of 10/11/13/14
(need the demo machine, real n8n/Gmail/Jira); n8n 2.42.2 editor-mode poll behavior asserted in
11:31-32.

## Claim-by-claim verification (all citations read this session)

- **08 — chat modification.** Engine behavior matches the doc precisely: `update_flow`
  (`automation_flows.rs:1663-1731`) validates first (`edit_problem:1008`: nodes, connections,
  per-node notes), unpublishes + logs `paused_for_edit` saved before the update (:1693-1697),
  `PUT /workflows/{id}?publishIfActive=false` (:1700-1705), 400 → `InvalidWorkflow` (:1707),
  logs `modified` with the new version and replaces the summary (:1720-1727);
  `get_editable_workflow:1416-1427` returns `{id, versionId, summary, workflow}`. Skill claims
  match (`SKILL.md:15` rule 1 "Never activate", :58 rule 10 Review Screen link); skill in chat
  not pipes proven by `pi.rs:4996-5003` test. Screenshots 08-*.jpg exist; LIVE-CHECKS.md:96
  records NOVA-35 labels `auto`+`back`. **But the documented Review Screen entry point no
  longer exists at HEAD** — see comments.
- **09 — chat creation.** `create_flow:2030-2080` matches: `creation_problem:1031-1044` (notes,
  name, summary), `importable` drops `active`/`tags` (`WORKFLOW_KEYS:89-96` has neither),
  `ensure_tagged`, `201 CREATED`, `source_task_id: None`. "Create a Flow" skill section at
  `SKILL.md:185`. LIVE-CHECKS.md:99 records the live creation incl. the empty-trigger-params
  miss fixed in ticket 17. Button claim drifted (see comments).
- **10 — trigger.** All polling claims match code: poll search without `q`
  (`ScreenPipeTrigger.node.ts:232`), 2-minute late-transcription re-read
  (`LATE_TRANSCRIPTION_MS = 2 * 60_000`, :18), accent/case-insensitive normalize (:405-406),
  window mode `content_type=ocr&focused=true` (:273), pipe
  `/pipes/<id>/executions?include_output=false` (:338), flow `/automation-flows/<id>` (:362).
  The "30 s /search cache" note is accurate: `server.rs:841`
  `.time_to_live(Duration::from_secs(30))`. LIVE-CHECKS.md:60-66 documents all five modes
  (keyword "Pamplemousse", TextEdit window, AI trigger, pipe execution 171, throwaway Flow).
- **11 — AI trigger.** Matches code: `GET /activity-summary` then `POST /v1/chat/completions`
  (`ScreenPipeAiTrigger.node.ts:104,141-153`), 500-char cut (`MAX_TEXT_LENGTH = 500`, :131),
  cooldown via `state.lastFiredAt` skipped in manual mode (:81,:90-91,:102,:125), `<activity>`
  "data, never instructions" injection guard (:135-136,:250). Tests green at HEAD.
- **12 — demo assembly.** `SPEC.md:208-227` acceptance list is fully `[x]` with observed
  results and rehearsal counts; `DEMO.md` exists with a fallback section (:73); blockers'
  substance is all present, though issue 05's status line is stale (see comments).
- **13 — proxy tool calls.** `cloud_proxy.rs` matches the doc exactly: `call_{uuid}` ids
  (:140), `type: function`, `finish_reason: "tool_calls"` only when missing (:150-151),
  everything else passes through unchanged (:12); the named check passes 6/6.
- **14 — activation-user-only.** Invariant matches code end to end: `ACTIVATION_HEADER`
  (`automation_flows.rs:138`), `FlowActivationKey` two-v4-UUID, constant-time fold-XOR compare,
  redacted Debug (:150-184), 403 `activation_requires_user` checked before n8n is read
  (:1476-1485), 400 `version_required` (:1480-1483), 415 `json_required`, CORS `Any`
  (`server.rs:913` — consistent with the doc's CORS note). Tauri side: per-process `OnceLock`
  key, `get_flow_activation_key` command, never env/file/log per the module comment
  (`src-tauri/src/automation_flows.rs:7-31`), wired in `server_core.rs:653`; the owned browser
  additionally blocks IPC to this command (`owned_browser.rs:1607,1693`). The doc's threat
  model (Pi/pipes share only the API key) matches the module comment. I did not audit every
  webview IPC surface beyond this; the key reaching the webview at all is inherent to the
  documented design.

## Notable risks / quality issues

1. **Docs-vs-HEAD drift on the change-request UI (main finding, P2).** Issue 08 (and 09's
   shared-button sentence) describe a Review Screen "Demander une modification" button and
   French history strings. At HEAD `api.requestChange`
   (`components/automation-flows/api.ts:429`) has no production caller — the only `ChatButton`
   is "New Flow" (`flows-tab.tsx:59-64`) — and the history labels are English
   (`labels.ts:14-34`: "Paused for a change", "Changed … by the chat"); French survives only in
   two code comments. Issue 08's checked box "The banner and the button render and behave as
   expected" is no longer true of this PR. The feature itself (engine route + skill + chat)
   is intact and live-verified; only the documented entry point was removed by later tickets.
2. Point-in-time test counts (25 → 31 → 107 in `automation_flows_test`) are fine for history
   docs but a reader re-running the quoted commands gets different numbers than the doc
   states; issue 08 already scopes its counts to branch `hackathon/ticket-08` (:61), which is
   the right pattern — 14 does not scope its counts.
3. Minor wording: 08:33 "ids dropped" overstates (node `id`/`webhookId` are kept,
   `NODE_KEYS:97-116`; only workflow-level keys are reduced) — the claimed effect (chat cannot
   switch a Flow on) is correct.
4. Issue 12:13 lists 05 as a blocker while `05-graph.md:11` still says `ready-for-agent` even
   though its body records a done, verified implementation — status lines in this directory
   are not reliable signals.

## Could not check

Live evidence itself (NOVA-35, the `say` keyword run, TextEdit/window/pipe/flow fires,
two-turn proxy probe) — recorded in `evidence/LIVE-CHECKS.md` and consistent across the four
docs that cite it, but not re-runnable here (no demo machine/n8n/Gmail/Jira). Frontend vitest
counts not re-run. n8n CLI/poll-mode behavior claims in 11 not verifiable locally.
