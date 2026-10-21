# 07: Chat builds a Flow step by step

**What to build:** The chat starts a hidden draft in n8n, changes it step by step and, after each step, reads the state of every node: complete, or exactly what is missing (empty required parameters, missing credentials, unlinked nodes, no trigger), and which credential ScreenPipe wired. A step using an invented or switched-off node type or an unknown version is refused at once. « Terminer » is refused while anything is missing, listing every problem; once accepted, the Flow appears in ScreenPipe as a Draft to review, switched off. A draft under construction is invisible in the Flows list and cannot be activated. The chat deletes a draft it abandons.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 05

**Status:** done, live check pending: build a throwaway Flow from the chat on the running app (rebuilt engine) and watch it stay hidden until « Terminer »

- [x] Routes: start a draft, update it, read its state, finish it.
- [x] Drafts carry an under-construction mark in n8n and a building state in ScreenPipe; they are excluded from the list and from activation.
- [x] Updates refuse only invented or switched-off types and unknown versions; the state lists the other problems per node and the wired credentials.
- [x] Finish runs the full ticket-26 check; on success the Flow becomes a Draft.
- [x] Changing an existing Flow keeps today's route and rules.
- [x] The skill documents the building procedure, including deleting an abandoned draft.
- [x] Engine integration tests cover each step, the state, a refused and an accepted finish, hiding and non-activation.

## What was built

- Routes (local API key, JSON, next to the Flow routes):
  `POST /automation-flows/drafts` `{workflow, summary?}` → `201` state;
  `PUT /automation-flows/drafts/:id` (whole workflow, one step) → state;
  `GET /automation-flows/drafts/:id` → state (read-only);
  `POST /automation-flows/drafts/:id/finish` `{summary?}` → the Flow.
- State: `{id, name, building, versionId, n8nUrl, summary, complete,
  nodes[{name, type, complete, missing[], credentials[{type, name}]}],
  problems[]}`. `missing` holds the ticket-26 problems of that node plus a
  missing `notes`; `problems` holds the missing trigger (or no nodes) and the
  missing summary. Reading the state wires on a copy only; « Terminer »
  saves a credential n8n gained since the last step.
- A draft is an inactive n8n workflow tagged `screenpipe-flow` and
  `screenpipe-flow-building` (ticket 14 can find it by that tag), recorded
  with `building: true`. Either mark hides it from the list; the Flow routes
  (`GET`/`PUT /:id`, `/:id/workflow`, activate, deactivate) answer `409
  flow_under_construction`, and the draft routes answer `409
  flow_not_under_construction` for a finished Flow. `DELETE /:id` deletes a
  draft like any Flow.
- A step refuses (`400 invalid_workflow`, n8n untouched) only invented or
  switched-off types and unknown versions (`flow_checks::inspect` →
  `Report::inventions`); `check_and_wire` now reads the same report, with
  unchanged messages.
- « Terminer » runs `check_and_wire` plus the Review Screen needs (notes per
  node, summary), lists every problem, then names ScreenPipe's error workflow
  (ticket 11), saves if that or a wiring changed the draft, removes the
  building tag and sets `building: false`. Nothing is ever published.
- Skill: « Build a Flow step by step » section, four API rows, the two 409
  errors; « Create a Flow » now builds through drafts (`POST
  /automation-flows` stays as the one-shot path).

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test` → 83 passed
  after merging main (8 new: start hidden and marked, half-built steps with
  per-node state and wired credential, refused inventions at start and per
  step, refused « Terminer » listing every problem, accepted « Terminer » →
  listed Draft, credential wired at « Terminer », no activation/read/change
  of a draft, deleting an abandoned draft, error workflow named at
  « Terminer »). Seen red first: start (405), error workflow (0 error
  workflows); the refusal and activation guards were each disabled once and
  their tests failed.
- `cargo test -p screenpipe-engine --lib -- flow_checks automation_flows n8n_nodes` → 13 passed.
- `cargo test -p screenpipe-core --lib automation_flows` → 6 passed (1 new).
- `cd packages/n8n-nodes-screenpipe && bun test test/skill-parameters.test.ts` → 4 passed.

## Live check (ticket 16)

On the running app with a rebuilt engine: ask the chat for a small Flow;
confirm it calls `/automation-flows/drafts` step by step, that the draft is
in n8n (tag `screenpipe-flow-building`, switched off) but not in the Flows
list, that « Terminer » makes it appear as a Draft with an `errorWorkflow`
setting, and that an abandoned draft is deleted. Delete the throwaway Flow
afterwards.
