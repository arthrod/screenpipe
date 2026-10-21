# Review: hackathon issue docs 22–27 (evidence/claims audit)

Slice: the six history docs `docs/automation-flows/history/hackathon/issues/22…27*.md`
(all new in this PR, 2008 insertions across the issues dir). Focus per ask: verify each
doc's claims against the code actually in the PR, and check ticket 27's round-two scope
list is complete.

## Verdict

The docs are unusually well-evidenced: nearly every file path, symbol, test name and
behavior they claim exists at PR head and works. I found **one substantive contradiction**
(demo AI model effort `:max` in tickets 25/27 vs `:low` in the committed workflow), and
three small staleness nits. Four comments posted; nothing else worth posting — the
French→English UI switch and the facts/{noformat}/button removals are all supersessions
that ticket 27 itself declares, so they are history as designed, not doc bugs.

## Checks actually run this session

- `cargo test -p screenpipe-engine --test automation_flows_test` → **107 passed, 0 failed**
  (exit 0). Tickets 22/26 recorded 47/51 passing; the suite grew with round-two; all green
  at HEAD. This is the definitive check for "engine review fixes actually applied".
- `bun test infra/automation-flows` → **65 pass, 0 fail** (docs recorded 50; suite grew).
- `cd packages/n8n-nodes-screenpipe && bun test` → **56 pass, 0 fail** (docs recorded 47).
- ~20 targeted `git grep` / `git ls-tree` / `git show HEAD:` inspections (all cited below).
- **Not run:** the app vitest suites (tickets 22/23/24 claim 397/1045/105 passes), the
  cargo lib unit tests (`flow_checks` 9, `chatgpt_proxy` 15 — I verified the test
  attributes exist via grep and the integration suite passes, but did not execute the lib
  tests), and the docs' historical live checks (not reproducible here). Test-count claims
  in the docs are historical records; current counts are higher and green.

## Per-ticket findings

### 22 — engine review fixes applied? YES, all verified at HEAD
- Deactivate logs `by: "user"` only with `x-screenpipe-flow-activation`:
  `crates/screenpipe-engine/src/automation_flows.rs:138` (header const), `:1459`
  (`from_user`), used at `:1540`/`:1579`/`:1643`; retry too
  (`automation_flows/retry.rs:35`).
- `review_outdated` = active && (running != versionId || running != reviewedVersionId):
  `automation_flows.rs:1313-1314` — exactly the doc's formula.
- `keep_user_credentials`: `automation_flows.rs:976`.
- `create_from_task`: `automation_flows.rs:2085`.
- `upstream_error` → `502 n8n_failed`: `automation_flows.rs:492`.
- `availableInMCP` dropped: comment `automation_flows.rs:132`; regression tests
  `tests/automation_flows_test.rs:2832-2875`.
- `source_moment`: `automation_flows.rs:1251-1274` — earliest moment, positive recorder
  frame ids only (`filter(|id| *id > 0)`), frame wins tie
  (`min_by_key(... (at, frame_id.is_none()))`) — matches the doc word for word.
- Client codes: `components/automation-flows/api.ts:41-42` (`by: "user"|"chat"|"api"`),
  `:173`/`:175` (`n8n_failed`, `flow_running`).
- 9 of the 10 named integration tests exist verbatim;
  `each_step_lists_the_facts_the_ai_did_not_write` is gone because round-two ticket
  `flows-round-two/issues/01-review-graph-without-facts.md` removed the facts feature —
  ticket 27:5-9 explicitly supersedes "the per-node facts block on the Review Screen
  (ticket 22)". Correct history, no action.
- Context: the UI these French labels describe (« Désactivé hors de Screenpipe », « a
  changé depuis que vous l'avez ouvert ») is now English — the switch is recorded in
  commit `ef8603938` ("Flows front from the dev branch, in English") and
  `HANDOFF.md:129-131`. No action.

### 23 — UI/workflow-node fixes applied? YES, with two doc nits (posted)
- `SectionLabel` remains without uppercase (`common.tsx:168`); `ACTION_BUTTON` gone.
- `openTimelineMoment` (`lib/workflows/timeline.ts:12`, used by `api.ts:415-416`);
  Review Screen button now reads "View in timeline" (`flow-learned-from.tsx:67,223`).
- AI Trigger look-back from `max(now − lookback, lastFiredAt)`:
  `ScreenPipeAiTrigger.node.ts:102`.
- Escaping is real: `.replace(/</g, "\\u003c").replace(/>/g, "\\u003e")`
  (`ScreenPipeAiTrigger.node.ts:261`) — but the doc sentence at `23:120` lost its escape
  targets ("writes `<`/`>` as `<`/`>`") — posted (P3).
- The "node sentence, review summary and app fixture updated together" claim (`23:117`)
  broke after commit `368a17b9a` (8 s timeout): both the workflow note
  (`novadesk-support-tickets.json:136` — already flagged by coderabbitai) **and the app
  fixture** `components/automation-flows/fixtures.ts:45` still say "more than 12 seconds".
  The fixture spot is new — posted (P3).
- Item 2's contract ("keep sending the old id, so the engine answers 409 and the user
  reloads", `23:24-26`) is not what ships: `flow-activation.tsx:60-69` catches
  `version_changed` and activates the newest version in the same click. Coderabbitai
  already flagged that behavior as a security issue; I did not duplicate it, but note the
  ticket doc records the stricter intent the code diverges from.
- Jira `{noformat}` work (item 5) was built and later removed by the round-two demo
  rewrite (ticket 27:154; current workflow uses ADF + `slice` caps, see
  `novadesk-support-tickets.json:375`). Superseded, no action.

### 24 — find-automation button evidence: HONEST, superseded
- Referenced screenshots exist: `docs/automation-flows/history/hackathon/screenshots/24-find-automation-button.jpg`
  and `24-find-automation-task-page.jpg` (verified via `git ls-tree`).
- Doc is explicit about the gap: "Status: done (browser mock verified; native app not
  run)" (`24:9`, `24:61-63`).
- The button was later removed by round-two ticket 03 (ticket 27:48-49, 151);
  `find-automation-button.tsx` is not in the tree; `lib/automation-flows/find-automation.ts`
  survives as the shortcut's engine (`lib/automation-flows/demo-shortcut.ts:14,54`,
  `components/automation-flows/demo-shortcut-listener.tsx:16`) — exactly the "shared
  demo-task module stays" carve-out in `27:151`. No action.

### 25 — ChatGPT-subscription claims vs `chatgpt_proxy.rs`: ACCURATE except the model effort (posted)
Verified: dispatch `routes/cloud_proxy.rs:34-35` (`chatgpt/` prefix → chatgpt_proxy);
`CODEX_URL = chatgpt.com/backend-api/codex/responses` (`chatgpt_proxy.rs:32`);
`store:false, stream:true` (`:270`, `:632`); OpenAI-shaped errors (`:566-567`); 503
`chatgpt_not_connected` (`:86,:93`); 429→usage-limit mapping (`:426`, test `:870-879`);
`chatgpt/<model>:<effort>` suffix + request override (`:291`, test `an_effort_suffix_sets_the_reasoning_effort`
`:676`); `read_chatgpt_oauth_token` pub (`screenpipe-core/src/pipes/mod.rs:1697`);
cloud_proxy 6 tests; chatgpt_proxy 15 test fns (doc's "14 tests" + later "15 passed" both
appear in the doc — the effort test was added by the luna section); Effort "Max" slider +
`pi_set_thinking_level` (`src-tauri/src/pi.rs:5710`); known-limit `/v1/local/chat/completions`
→ `api.openai.com` (`local_chat.rs:50`).
**Contradiction:** the doc says the n8n AI step runs `chatgpt/gpt-5.6-luna:max`
(`25:16`, `25:105-106`) but the committed workflow pins `chatgpt/gpt-5.6-luna:low`
(`novadesk-support-tickets.json:122`, asserted in `novadesk-support-tickets.test.ts:118-119`)
and `DEMO.md:103` agrees with `:low`. Ticket 27:154 repeats the wrong `:max`. The AI
Trigger default (`ScreenPipeAiTrigger.node.ts:21`) and the skill (`SKILL.md:216,235`)
do say `:max` — only the demo workflow differs. Posted (P2). Note the fixture
(`fixtures.ts:45`) no longer carries a model string at all, so ticket 25:53-55's
"fixture: model and wording" is half-stale too (wording survived the translation).

### 26 — no invented/half-built nodes: VERIFIED, one number off (posted)
- `infra/automation-flows/n8n-catalog.ts` + generated `n8n-catalog.json` exist; catalog
  header `n8n: 2.42.2` matches the doc; `excluded` = executeCommand, localFileTrigger,
  executeCommandTool — matches the doc's Execute Command story.
- **841 is off by one: `len(catalog.nodes) == 840`** (`26:41` claims 841; 1.6 MB is right,
  1,622,422 bytes). Posted (P3).
- `flow_checks.rs` has exactly 9 `#[test]` fns (grep count) — matches "9 passed";
  `check_nodes` runs in create (`automation_flows.rs:1687`) and update (`:2047`), after
  `keep_user_credentials`, per the docstring `:975-977`; also at finish
  (`automation_flows/failures.rs:127`).
- Pinned-image regression test exists (`n8n-catalog.test.ts:21-24`, plus same-image
  cross-check `:45`).

### 27 — round-two scope list complete: YES
- 54 stories map onto decisions + tickets `docs/automation-flows/history/flows-round-two/issues/01–15`
  (all present) + `coverage.md`; status line "implemented on main (tickets 01–15 …); the
  full live check (16) is pending" is accurate — `16-full-live-check.md` is the pending
  live check, and it already surfaced bug `17-create-automation-stale-task-page.md`
  ("fixed in bcb3e74c0, live check pending"), which postdates the spec and doesn't need a
  line in 27.
- Spot-verified round-two outcomes at HEAD: button gone, engine facts gone, demo workflow
  rewritten (AI agent "Read the email (AI)", abstention "Confident enough"/"Sort by hand",
  JQL dedupe with `mail-` hash label, fixed "Create the Jira ticket" node — see
  `novadesk-support-tickets.json` node names and `:309`/`:375`).
- The "shortcut active in every build by user decision" (`27:184`) is real
  (`shortcuts.rs:529` registers unconditionally) and honestly recorded as a decision;
  the production risk of that decision is already posted by coderabbitai on
  `shortcuts.rs:527-536` — not duplicated.

## Risks / quality

1. The only fact-level error that can mislead future work is the `:max`/`:low` split
   (ticket 25 is the evidence doc a maintainer audits against reality; ticket 27 is the
   newest spec). Everything else is declared supersession.
2. Historical test counts in these docs (47/50/51/47…) are stale but directionally honest
   — current counts are higher and all green (I ran the three suites above).
3. I could not verify the "live check" tables (issues 25/26) — they describe one-off
   runs against a running n8n/ChatGPT on 2026-10-17 with scratch scripts not in the repo;
   the docs say so themselves. Not falsifiable from this checkout.
