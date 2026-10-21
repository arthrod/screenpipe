# 17: Demo workflow knows NovaPlanning; skill uses the real node types

Spec: stories 28, 33–34, 45–47. Found live on 2026-10-17: the first real
email run (n8n execution 9) turned a NovaPlanning bug email into NOVA-31
« Autre - Export PDF du planning hebdomadaire vide… », because the closed
product list only had NovaCRM, NovaPay, NovaDesk. The recorded tickets on the
demo machine also use NovaPlanning (NOVA-29). Spec audit gap 7: the
`automation-flows` skill names the ScreenPipe node types
`n8n-nodes-screenpipe.*`, but this n8n loads them as `CUSTOM.*`.

**What to build:**

- Add NovaPlanning to the product enum of the structured output parser, the
  system message, and the "Ticket nécessaire" allowlist regex of
  `infra/automation-flows/workflows/novadesk-support-tickets.json`; keep its
  tests in sync.
- `crates/screenpipe-core/assets/skills/automation-flows/SKILL.md`: node types
  `CUSTOM.screenPipe`, `CUSTOM.screenPipeTool` (AI Agent tool),
  `CUSTOM.screenPipeTrigger`, `CUSTOM.screenPipeAiTrigger`.

**Blocked by:** None.

**Status:** done (live: NOVA-33 « NovaPlanning - … »; a chat-created Flow got `CUSTOM.screenPipeTrigger` with its keyword; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] `bun test infra/automation-flows` passes with NovaPlanning accepted end to end (parser enum, IF allowlist).
- [x] Live: a NovaPlanning bug email becomes « NovaPlanning - … ».
