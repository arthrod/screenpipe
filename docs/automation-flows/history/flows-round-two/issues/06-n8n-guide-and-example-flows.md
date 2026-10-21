# 06: n8n reference guide and example Flows for the chat

**What to build:** The chat has a reference guide it reads on demand: n8n expressions, references to earlier nodes, IF/Switch/Merge, error handling, AI sub-nodes, and three or four complete example Flows (ScreenPipe trigger to action, email to AI to ticket, schedule to summary). The skill no longer hard-codes node versions.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 05

**Status:** done, live check pending: the chat reads the guide and builds from it (see below)

- [x] The guide file ships with the skill and is linked from it.
- [x] Every example Flow passes the Flow check (a test runs them through it).
- [x] No node version is hard-coded in the skill; it points to the lookup instead.
- [x] The skill's existing tests still pass.

## What was built

- `crates/screenpipe-core/assets/skills/automation-flows/n8n-guide.md`:
  expressions, items and `$('Node')` references, IF/Switch/Filter/Merge,
  error handling (`retryOnFail`, `onError`, Stop and Error), AI sub-nodes
  (chain vs agent, `ai_*` connections, output parser, tools, data-not-
  instructions), and three complete `body.json` examples: A) keyword said
  aloud → ScreenPipe search → Aggregate → Jira (no AI); B) IMAP email → Basic
  LLM Chain + parser → Switch → two Jira types, error output → Stop and
  Error; C) weekday schedule → two parallel ScreenPipe searches → Merge →
  chain summary → Jira. Jira project/issue type ids are placeholders the
  guide says to ask for. Every version is the catalog's latest.
- Installed for the chat only: `ensure_screenpipe_skill` writes the guide
  beside `SKILL.md` (Pi only copies `SKILL.md` otherwise; its prompt tells
  the model to resolve a skill's relative links against the skill folder,
  and a folder with `SKILL.md` is not scanned further, so the guide is not a
  skill of its own).
- `SKILL.md` (four small edits): links the guide from « Change a Flow »
  step 2 and « Create a Flow » step 3; the OpenAI Chat Model and ScreenPipe
  node versions now say « version from its card ».

## Tests run

- `cargo test -p screenpipe-core --lib automation_flows` → 5 passed (2 new:
  guide installed beside SKILL.md and linked, covers the topics; no
  `typeVersion` number in SKILL.md). Both seen red first (guide missing;
  `typeVersion: 1.3` in the skill).
- `cargo test -p screenpipe-engine --test automation_flows_test` → 70
  passed (new `every_example_flow_of_the_guide_passes_the_flow_check`: each
  ```json block of the guide is posted to `POST /automation-flows` against
  the fake n8n and must come back `201 draft`; seen red with an empty guide,
  and with the Switch set to a version n8n lacks).
- `bun test infra/automation-flows/ packages/n8n-nodes-screenpipe/test/skill-parameters.test.ts`
  → 64 pass, 0 fail.

## Live check (ticket 16)

In the chat, ask for a new Flow (e.g. « chaque soir, un résumé de ma journée
dans Jira »): the chat reads `n8n-guide.md` (Pi read tool on
`.pi/skills/automation-flows/n8n-guide.md`) and the node cards, and the Flow
it sends is accepted. Optional: import example B or C in n8n (inactive) and
run it once by hand to confirm the Merge `chooseBranch`/`output: empty` and
the Jira error output behave as the guide says; only the check, not a run,
is tested here.
