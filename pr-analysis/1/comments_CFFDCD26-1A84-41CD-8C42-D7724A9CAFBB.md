## Review — hackathon issue docs 08–14

Slice: `docs/automation-flows/history/hackathon/issues/08…14`. Verification run this session:
`cd packages/n8n-nodes-screenpipe && bun test` → 56 pass / 0 fail;
`cargo test -p screenpipe-engine --lib routes::cloud_proxy` → 6 passed (matches issue 13 exactly);
`cargo test -p screenpipe-engine --test automation_flows_test` → 107 passed / 0 failed at HEAD
(issues 08/14 quote point-in-time counts of 25/31; the suite grew with later tickets). The
engine/skill/node behavior claims in these seven docs check out against the code in detail
(update route, create route, activate guard, trigger polling queries, 30 s `/search` cache TTL
at `server.rs:841`, proxy tool-call normalization). The findings below are the ones worth
acting on.

---

**`docs/automation-flows/history/hackathon/issues/08-chat-modification.md:39` — P2 (docs record a UI entry point that no longer exists at this PR's head)**

This line (and the checked box at line 20, the banner sentence at :41-43, and the runbook steps
at :94) describe a Review Screen "Demander une modification" button. At the PR head there is
none: `api.requestChange` (`apps/screenpipe-app-tauri/components/automation-flows/api.ts:429`)
has no production caller — the repo-wide grep finds only its definition and tests
(`__tests__/api.test.ts:187`, mocked at `flows-tab.test.tsx:54`) — the only `ChatButton` use is
"New Flow" (`flows-tab.tsx:59-64`), and `flow-review.tsx` has no chat/change affordance. The
quoted history strings are gone too: `labels.ts:14-34` now renders "Paused for a change" /
"Changed … by the chat" in English, and the prompt at `api.ts:473-475` is English. The chat
modification flow itself is real and live-verified (engine `PUT /automation-flows/:id` at
`automation_flows.rs:1663-1731`, skill rule 1, LIVE-CHECKS.md:96) — but a maintainer following
this doc, or the checked box "The banner and the button render and behave as expected", will
hunt for UI that later tickets in this same PR removed. Please add a short staleness note to
this issue (which tickets dropped the button and translated the copy), and either delete the
now-unreachable `requestChange`/`changeRequestPrompt` pair or give it a caller.

---

**`docs/automation-flows/history/hackathon/issues/09-chat-creation.md:32` — P3 (button description drifted with the same UI rework)**

"Flows list: « Ajouter » button … shared with « Demander une modification »" matches neither
the code nor the copy at HEAD: the button is "New Flow" (`flows-tab.tsx:59-64`, prompt
`CREATION_PROMPT` at `api.ts:460-461`, in English), and it is no longer shared — the
change-request button is gone (previous comment). Steps 2/4-6 of "Original steps" (:46-50)
similarly quote « Ajouter »/« Brouillon ». Same fix as issue 08: one staleness line so a reader
maps the old labels to "New Flow"/"Not on yet".

---

**`docs/automation-flows/history/hackathon/issues/08-chat-modification.md:33` — P3 ("ids dropped" is only true at workflow level)**

The parenthetical says the update body is reduced with "`active`, tags, ids dropped". Node-level
`id` and `webhookId` are kept — `NODE_KEYS` (`automation_flows.rs:97-116`) includes both — only
the workflow-level keys are reduced (`WORKFLOW_KEYS:89-96`, no `id`/`versionId`/`active`). The
claimed effect is correct (`active` and tags dropped, so the chat cannot switch a Flow on); only
the word "ids" overstates. Worth a two-word fix ("top-level ids") in a doc people will use to
re-derive the route's contract.

---

**`docs/automation-flows/history/hackathon/issues/12-demo-assembly.md:13 — P3 (blocked-by list points at a ticket whose status line is stale)`**

Issue 12 is the reproducibility record for the demo, and its dependency list is part of that:
blocker 05 still says `**Status:** ready-for-agent` (`issues/05-graph.md:11`) even though 05's
body records the implemented graph, a passing verification table, and a screenshot. The
substance is fine — every blocker is actually built — but the status field, the only
machine-scannable signal in this directory, contradicts the record. Flip 05's status line (and
while there, note that 14's test counts at `14-activation-user-only.md:55-67` are unscoped
point-in-time numbers: the same `automation_flows_test` suite reports 107 passed at this PR's
head).

---

Everything else in the slice verified clean: issue 10's polling claims match
`ScreenPipeTrigger.node.ts` line by line (no-`q` poll search :232, `LATE_TRANSCRIPTION_MS` 2-min
re-read :18, accent/case normalize :405-406, `content_type=ocr&focused=true` :273,
`include_output:false` :338, `/automation-flows/<id>` :362) and the "30 s `/search` cache" note
is accurate (`server.rs:841`); issue 11's cooldown/500-char-cut/`<activity>` injection-guard
claims match `ScreenPipeAiTrigger.node.ts` (:90-125, :131, :135-136, :250); issue 13's
description matches `cloud_proxy.rs` (:140, :150-151) with the named test passing 6/6; issue
14's invariant matches the code end to end (constant-time key compare `automation_flows.rs:
170-180`, 403 checked before n8n is read :1476-1485, 415 `json_required`, Tauri-side `OnceLock`
key handed over only by `get_flow_activation_key`, owned-browser IPC block at
`owned_browser.rs:1693`). Not re-run here: the live-evidence runs (demo machine, real
n8n/Gmail/Jira) and the frontend vitest counts quoted in 08/14.
