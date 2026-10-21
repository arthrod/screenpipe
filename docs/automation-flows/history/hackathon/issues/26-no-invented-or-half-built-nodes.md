# 26: The chat never builds a Flow on an invented or half-built node

User report (2026-10-17): asked for a Flow that shows parrot.live in a Mac
Terminal every 5 minutes, the chat (gpt-5.6-luna) built it on
`n8n-nodes-base.executeCommand` and called the node valid. n8n 2.x switches
that node off by default (`NODES_EXCLUDE` default: Execute Command, Local File
Trigger), so the Flow could never run. Corrected, the chat swapped it for an
HTTP Request that fetched the page instead of opening a window. User rule: the
AI never invents a node, and never leaves one incomplete for lack of a
connection or a parameter. SPEC D22.

**Status:** done, live-verified on this Mac (app rebuilt from `83aed53e5`).

## What ScreenPipe refuses now

`POST /automation-flows` and `PUT /automation-flows/<id>` (the chat's routes;
not `from-task`, whose workflow is pre-built) answer `400 invalid_workflow`
before n8n sees anything, `detail` listing every problem:

| Problem | Example detail |
|---------|----------------|
| Node type n8n switches off | « Ouvrir un terminal »: `n8n-nodes-base.executeCommand` is switched off in this n8n; no node here can do that |
| Node type n8n does not have | « Terminal »: `n8n-nodes-base.openTerminal` is not a node type this n8n has; never invent one |
| Version n8n does not have | « Requête »: `n8n-nodes-base.httpRequest` has no version 9 here (versions: …) |
| Required parameter empty | « Envoyer »: required parameter `sendTo` is empty |
| Credential n8n does not hold | « Slack » needs a `slackApi` credential and n8n has none: the user must create it in n8n first |
| Several credentials of the type | … n8n has 2 (« Gmail », « Gmail perso »): ScreenPipe does not choose between the user's accounts |
| Node connected to nothing | « Ouvrir un terminal » is connected to no other node |
| No trigger | the workflow has no trigger node, so it would never run |

A credential a node needs and lacks is wired when n8n holds exactly one of its
type (e.g. the ScreenPipe API credential on a ScreenPipe node). Credentials
still never come from the chat's request (ticket 22, item 4).

## How

- `infra/automation-flows/n8n-catalog.ts` reads the running n8n container
  (`n8n-nodes-base` and `@n8n/n8n-nodes-langchain` `dist/types/nodes.json`,
  the excluded list from `NODES_EXCLUDE` or n8n's default, the `<name>Tool`
  twins n8n adds for AI Agent tools) and the ScreenPipe nodes, and writes
  `n8n-catalog.json` (n8n 2.42.2: 841 types, 1.6 MB): versions, trigger,
  required credentials, required parameters, and the display rules and
  defaults that switch them on. n8n's public API lists credentials but not
  node types, hence the generated file. Regenerate after changing the image;
  `n8n-catalog.test.ts` fails when the pinned image and the catalog differ.
- `crates/screenpipe-engine/src/flow_checks.rs`: the check (display rules
  evaluated like n8n for plain values, `@version` and the common `_cnd`
  conditions; a rule it cannot evaluate never refuses). HTTP Request's
  `predefinedCredentialType` counts as a needed credential.
- `automation_flows.rs`: `check_nodes` after `keep_user_credentials`, before
  any write (a refused change leaves an active Flow running).
- Skill `automation-flows`: rules 4 (credentials), 5 (only real, complete
  nodes; nothing here runs commands on the Mac) and 6 (never swap the request
  for something else; say what is missing).

Calibration before the Rust port: a prototype of the same check passed the
demo workflow and the four workflows in this n8n, and refused each bad case
above.

## Tests run

- `cargo test -p screenpipe-engine --lib flow_checks` → 9 passed.
- `bun test infra/automation-flows/n8n-catalog.test.ts` → 3 passed.
- `cargo test -p screenpipe-engine --test automation_flows_test` → 51 passed
  (3 new: an edit with Execute Command, a credential-less retyped model and an
  unconnected node is refused untouched; an invented node type is refused
  before n8n sees it; the only ScreenPipe API credential is wired).
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 2 passed;
  `bun test` in `packages/n8n-nodes-screenpipe` → 47; workflow tests → 20.

## Live check (2026-10-17, this Mac)

`POST /automation-flows` on the running app:

- the original Parrot Flow (schedule → Execute Command) → `400`: « Ouvrir un
  terminal avec parrot.live »: `n8n-nodes-base.executeCommand` is switched
  off in this n8n; no node here can do that;
- schedule + Slack, unconnected, empty, no Slack credential → `400` naming
  both unconnected nodes, `select` and `text` empty, and the missing
  `slackApi` credential;
- n8n holds 4 workflows before and after: nothing was created.

## Known limits

- Only top-level parameters are checked; a required field inside a
  collection is not.
- With several credentials of one type the chat cannot build a node that
  needs it; the user keeps one, or builds that node in n8n.
