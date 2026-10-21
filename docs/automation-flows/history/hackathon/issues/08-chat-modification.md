# 08: Ask the chat to change a Flow; it pauses and needs review

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decisions D5, D7 in `SPEC.md`).

**What to build:** "Demander une modification" on the Review Screen opens the
existing ScreenPipe chat with the Flow id in a prefilled prompt. A new
`automation-flows` skill teaches the agent to read the Flow, edit its n8n
workflow while keeping a one-sentence note on every node, update the summary
if needed, and send the result to the Flow service's update route; it never
activates and ends with the Review Screen link. The update route switches an
active Flow off first, updates the same n8n workflow in place and records
both events in the history. The Review Screen shows a Needs Review banner
until the user activates again.

**Blocked by:** 04.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Flow service tests against a fake n8n: updating an active Flow switches it off first and records "paused for edit" then "modified"; the status becomes Needs Review; updating a Draft keeps it Draft.
- [x] The banner and the button render and behave as expected (frontend tests).
- [x] The rehearsed request « Ajoute l'étiquette `auto` à chaque ticket créé » changes the workflow in n8n, leaves the Flow Needs Review and switched off; after re-activation, the next ticket carries the label. Done in ~30 s by the in-app chat; NOVA-35 has labels `auto` + `back` (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
- [x] The skill never calls activate.

## What was built

- `PUT /automation-flows/:id` `{workflow, summary?}` (engine):
  - checks the edit first: nodes and connections present, every non-sticky node has a
    `notes` sentence; otherwise `400 {error: "invalid_workflow", detail}` and nothing
    changes in n8n;
  - if the Flow is active: n8n `POST /workflows/{id}/unpublish`, logs `paused_for_edit`
    (version that stopped running, `by: "chat"`), saved at once;
  - n8n `PUT /workflows/{id}?publishIfActive=false` with the workflow reduced to what n8n
    accepts (`active`, tags, ids dropped: the chat cannot switch a Flow on);
  - logs `modified` (new n8n `versionId`, `by: "chat"`); replaces the summary when given.
  - n8n's 400 → `400 invalid_workflow` with n8n's message. If n8n refuses after the
    switch-off, the Flow stays switched off (Paused) with `paused_for_edit` logged.
- `GET /automation-flows/:id/workflow` → `{id, versionId, summary, workflow}`: what the
  chat edits and sends back.
- Review Screen: "Demander une modification" opens the Home chat with an editable,
  not-sent prompt: « Avec le skill automation-flows, modifie l'Automation Flow « <nom> »
  (id : <id>). Modification demandée : ». The existing Needs Review banner and the
  history lines "Mis en pause pour modification par le chat" / "Modifié par le chat"
  show the result; the banner goes away on Activer.
- Skill `crates/screenpipe-core/assets/skills/automation-flows/SKILL.md`, installed in
  every chat session (not in background pipes): list/read/update through
  `/automation-flows/*`, one French sentence per node, never activate, ends with
  `[Revoir le Flow](screenpipe://flows/<id>)`. Creation section is a marked placeholder
  for ticket 09.
- Chat links `screenpipe://flows/<id>` open the Flow's Review Screen (Home chat: in place;
  Chat overlay: brings Home up on it).
- Browser mock (`bun run dev:web`): `PUT /automation-flows/<id>` mirrors the engine.

Screenshots (browser mock, after Activer then a chat PUT):
`docs/automation-flows/history/hackathon/screenshots/08-review-screen-needs-review.jpg`,
`docs/automation-flows/history/hackathon/screenshots/08-review-screen-history.jpg`.

Known limit: a Flow link clicked in the Chat overlay while Home is already open on
another page brings Home to Automations, not always to the Flow itself. The
"Demander une modification" path uses the Home chat, where the link opens the Flow.

## Tests (run on `hackathon/ticket-08` after merging integration tip 06e093157)

```
cargo test -p screenpipe-engine --test automation_flows_test        # 25 passed
cargo test -p screenpipe-engine --lib automation_flows              # 3 passed
cargo test -p screenpipe-core --lib automation_flows_skill          # 1 passed
cd apps/screenpipe-app-tauri
NODE_OPTIONS=--no-experimental-webstorage bun x vitest run \
  components/automation-flows lib/workflows/automation-flows.test.ts \
  components/__tests__/pipe-store-flows-tab.test.tsx components/workflows/task-page-create-flow.test.tsx \
  components/chat/markdown-block.test.tsx components/__tests__/markdown-web-link.test.tsx   # 8 files, 135 passed
bun x tsc --noEmit -p .                                             # clean
```

## Pending human: the rehearsed chat change (real n8n, chat, Gmail, Jira)

Not run by the agent: it needs the dev build, the real chat, a published workflow and an
email. About 20 minutes.

Before you start:

- Same setup as ticket 04's pending steps: n8n 2.42.2 on `127.0.0.1:5678` with its
  credentials, ScreenPipe → Connections → n8n filled in, ticket 13 merged.
- The ScreenPipe chat answers (AI provider configured).
- In the support inbox, every email you do not want ticketed is marked read.

Steps:

1. Run the app from this branch (or the integration branch after merge):
   `cd apps/screenpipe-app-tauri && bun run dev:tauri`. The engine routes changed: an
   older running build does not have them.
2. Open Automations → Flows → "NovaDesk : emails support → tickets Jira". If it shows
   "Brouillon" or "En pause", click "Activer". Check: status "Active".
3. Click "Demander une modification". Check: the Home chat opens; the composer holds
   « Avec le skill automation-flows, modifie l'Automation Flow « NovaDesk : emails
   support → tickets Jira » (id : spNovaFlow000001). Modification demandée : »;
   nothing is sent yet.
4. Type « Ajoute l'étiquette `auto` à chaque ticket créé » after it and send.
5. Watch the chat's tool calls. Check: it reads `/automation-flows/spNovaFlow000001/workflow`,
   sends one `PUT /automation-flows/spNovaFlow000001`, never calls `/activate`, and ends
   with a « Revoir le Flow » link.
6. In n8n, open the workflow. Check: not published; node « Créer le ticket Jira »
   `jsonBody` ends with `labels: [ $json.label, 'auto' ]`; its note mentions `auto`.
7. Click « Revoir le Flow » in the chat. Check: the Review Screen opens; status
   "À revoir"; banner "Ce Flow a changé depuis sa dernière activation"; history adds
   "Mis en pause pour modification par le chat" then "Modifié par le chat"; the
   sentence under « Créer le ticket Jira » mentions `auto`.
8. Send one bug-report email to the support inbox. Wait 3 minutes. Check: no new
   execution in n8n, no new Jira ticket, the email stays unread.
9. Click "Activer". Check: status "Active"; banner gone; history adds "Activé par vous"
   with the new version.
10. Wait 2 minutes. Check: one new Jira ticket from that email, with labels `back` or
    `front` and `auto`.
11. Clean up: delete the test Jira ticket. To give the demo its original workflow back:
    click "Désactiver", then run `infra/automation-flows/import-workflow.sh` (it refuses
    an active workflow); the Flow then shows "À revoir" until the next Activer.

Record here: date, the version ids in the history, n8n execution id, Jira key and its
labels, and whether step 8 stayed silent. If the chat edits the wrong node or forgets a
note, paste its final message here: the route refuses missing notes, so a 400 in the chat
is expected behaviour, not a crash.
