# 09: Create a Flow from the chat (Add)

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decision D5 in `SPEC.md`). Not on the demo path.

**What to build:** The "Ajouter" button of the Flows list opens the ScreenPipe
chat with a prefilled creation prompt. The `automation-flows` skill gains a
creation section: describe the automation, build an n8n workflow with a
one-sentence note per node and a summary, and send it to the Flow service's
create route, which imports it switched off and tagged and stores the
summary. The agent ends with the Review Screen link; the user activates
explicitly, like any Flow.

**Blocked by:** 08 (same skill).

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Flow service tests against a fake n8n: create imports switched off and tagged and stores the summary; a workflow without nodes is rejected.
- [x] The Add button opens the chat with the prefilled prompt.
- [x] A chat-created Flow appears in the list as Draft and runs only after an explicit activation (engine test: Draft in the list, no publish call; the live run is pending human).

## What was built

- `POST /automation-flows {workflow, summary}` (`crates/screenpipe-engine/src/automation_flows.rs`):
  refuses with `400 invalid_workflow` and creates nothing when the workflow has no
  nodes or connections, a non-sticky node has no `notes`, it has no `name`, or
  the summary is empty; n8n's own 400 is reported the same way. Otherwise imports
  it switched off (`active` and `tags` are dropped), tags it `screenpipe-flow`,
  stores the summary, answers `201` with the Flow (`draft`, `sourceTaskId: null`).
- `automation-flows` skill: "Create a Flow" section (build the JSON with a
  script, no credentials, ScreenPipe node types, send once, end with the Review
  Screen link).
- Flows list: « Ajouter » button (also on the empty list) → Home chat prefilled
  with « Avec le skill automation-flows, crée un nouvel Automation Flow. Ce qu'il
  doit faire : », not sent. The chat-opening button is shared with « Demander
  une modification » (`ChatButton` in `common.tsx`).

## Live chat creation (orchestrator, 2026-10-17)

Done: « AJOUTER » opened the chat prefilled and not sent; the agent created « Noter les points d'étape » (Draft, inactive, tagged, `CUSTOM.screenPipeTrigger` + Set, French sentences) and answered with the « Revoir le Flow » link. The trigger's parameters were empty because the skill did not name them; fixed in ticket 17 (the skill lists every node parameter) and re-checked after the rebuild (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).

## Original steps

Needs the dev build (engine routes) and n8n running.

1. Quit the installed ScreenPipe; `cd apps/screenpipe-app-tauri && bun run dev:tauri` on this branch, signed in.
2. Automatisations → Flows → « Ajouter ». Check: the Home chat opens with the prompt prefilled and not sent.
3. Complete it, e.g. « chaque jour à 18 h, prépare un résumé de ma journée », and send.
4. Check the agent's answer ends with a `screenpipe://flows/<id>` link and says the Flow is switched off.
5. Click the link. Check: Review Screen, status Brouillon, one sentence per node, summary shown.
6. Back to the list. Check: the Flow is there as Brouillon; in n8n it is inactive and tagged `screenpipe-flow`.
7. Do not activate it unless you want it to run; delete it in n8n after the check.
