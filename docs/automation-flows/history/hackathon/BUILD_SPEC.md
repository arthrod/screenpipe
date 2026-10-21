# Hackathon build spec

Working document for the team. Not agent context: product direction lives in
`AGENTS.md`; this file holds build/ops decisions and open items. Contracts and
the decisions that closed the open items below live in `SPEC.md`. Current state and
next steps for whoever picks this up: `HANDOFF.md`.

## Definition of done (user decision: everything live)

Everything in the hackathon scope must be live for the demo:

- notification -> task page (real evidence timeline + mandatory clarification
  questions) -> Flow creation -> review screen
- plain-language summary on the review screen
- rendered n8n graph with one AI sentence per node
- View graph (n8n) and View in timeline
- modification chat (active Flow: pause -> inactive version -> re-review ->
  re-activate)
- activate/deactivate via the n8n API
- Automation Flows view in the Automations tab: app-created list, Add (creation
  chat), detail with basic stats + activation history
- both ScreenPipe n8n nodes built
- real Gmail -> AI -> Jira execution

Not built for the hackathon (product direction only): the background
detection -> Flow creation loop. The demo notification and proposal are
scripted; the finished product uses the `workflow-*` detection pipeline.

## Open decisions (decide at build)

- **Activation history source**: n8n has no activation-event API. Recommended:
  app-side activation log (declared duplication of state). Alternative: derive
  from executions (no true history).
- **Which ScreenPipe node(s) are demoed**: both are built; the deterministic
  one is the safer live demo; the AI trigger may be shown in the graph only.
- **Jira mapping + dedupe**: recommended Support project, Bug/Task issue type,
  criticality -> Priority, service -> label/component, dedupe by `Message-ID`
  (label or JQL check). To confirm.
- **n8n provisioning**: self-hosted Docker locally; pin the image; API key in
  env/SecretStore; verify container -> host AI proxy and ScreenPipe API.
- **Demo accounts + evidence**: dedicated Gmail (IMAP app password) + Jira
  Cloud project; record the real repetitions session.
- **n8n API/auth details**: public API key, workflow tag/namespace, import
  idempotency, activate/deactivate verification.

## Build order (recommended)

1. Golden path: n8n + credentials + pre-built workflow imported inactive +
   activate via API + real Gmail -> AI -> Jira. Go/no-go.
2. Notification -> review screen on a fixture; real evidence timeline.
3. Rendered graph + AI node sentences + View graph + View in timeline.
4. Automation Flows view (list/add/detail) in the Automations tab.
5. Both ScreenPipe nodes; demo whichever passes rehearsal (the deterministic
   one is the safer fallback).
6. Modification chat (pause -> re-review -> re-activate).
7. Rehearse the full demo; reset + backup.

## Risks

- All-live in one day is not supported by agent estimates; the golden path is
  the gate. Do not let UI/node work delay it.
- n8n credentials are not portable across instances/volumes; pin the instance.
- IMAP polling latency and backlog drain; dedupe by Message-ID.

## Historical context

The raw conversation that produced the spec (formerly `CONVERSATION_NOTES.md`,
same folder) is kept out of the public repository, per its own containment
rule; it is not authoritative.
