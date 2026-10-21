# 07: ScreenPipe node gives the AI Agent the user's memory

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decisions D11, D12 in `SPEC.md`).

**What to build:** A new n8n node package with a shared "ScreenPipe API"
credential (base URL, API key) and a ScreenPipe node with two operations,
search content and activity summary, usable both as a step and as an AI
Agent tool. The package is built and mounted into the local n8n. The demo
n8n workflow's AI Agent gets it as its tool and uses it to find how the user
handled similar emails before (the captures of the earlier ticket creations),
so the tickets follow those conventions.

**Blocked by:** 01.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Package tests against a fake ScreenPipe API: parameters and auth header are sent as expected; results are returned; HTTP errors surface as node errors.
- [x] The node appears in the local n8n palette and as a tool option of the AI Agent.
- [x] On the demo machine, the agent's tool call returns captures of the earlier tickets, and a new ticket follows the observed conventions. Tool returned the real NOVA-25 Jira captures; live runs created NOVA-32/33 in the « Produit - résumé » form (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
- [x] A build step copies the node into the mounted custom-nodes folder; built output is never committed.
- [x] The demo fixture (from 01) is re-exported with the tool wired in.
