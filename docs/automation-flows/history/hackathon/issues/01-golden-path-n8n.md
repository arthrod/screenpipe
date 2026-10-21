# 01: Golden path — a bug email becomes a Jira ticket through n8n

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decisions D7, D9, D11 in `SPEC.md`).

**What to build:** In the local n8n, the demo n8n workflow exists, tagged as an
Automation Flow and switched off: it reads unread emails from the dedicated
support inbox (marking them read, which is the dedupe), asks one AI Agent
(chat model = ScreenPipe's local OpenAI-compatible proxy) for a structured
answer `{type: Bug | Tâche | none, product, summary, priority, label: back | front}`,
stops on `none`, and creates a Jira issue in the `NOVA` project titled
`<product> - <summary>`, with the email quoted in the description and no
assignee. Every node carries a one-sentence explanation in its notes, and a
plain-language summary of the whole workflow is written. This ticket also
settles the two platform unknowns the Flow service depends on.

**Blocked by:** None (can start immediately). Requires the human setup first:
n8n owner account and API key, and the IMAP, Jira and OpenAI-compatible
credentials created in the n8n UI by a human. Agents never enter these
secrets.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] With the workflow switched on, a bug email sent to the inbox creates exactly one Bug ticket in `NOVA` with the title convention, a priority, a back/front label and the quoted email. NOVA-33, NOVA-34, NOVA-35 (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
- [x] An improvement-idea email creates a Tâche; a non-ticket email (e.g. a security alert) creates nothing. NOVA-32 (Tâche); 6 Google security alerts and a newsletter → no ticket.
- [x] Restarting n8n does not reprocess an email already read. `docker restart` with the Flow active: 0 new execution in 90 s.
- [x] One request with `tools` through ScreenPipe's local AI proxy returns a tool call; the result is recorded in the spec's risks.
- [x] Documented in `SPEC.md`: how n8n 2.42.2's public API switches a workflow on and off (activate vs publish) and which version id changes on an edit; D7 updated if the mapping differs.
- [x] The workflow (with node notes) and its summary are exported as the bundled demo fixture for the Flow service; the export contains no secrets.
