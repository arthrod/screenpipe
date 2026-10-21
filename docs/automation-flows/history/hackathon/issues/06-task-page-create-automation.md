# 06: Mandatory Clarification Questions unlock "Create automation"

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decision D3 in `SPEC.md`).

**What to build:** On the Task Page, when the host can create Automation
Flows, the Clarification Questions become required and a "Créer
l'automatisation" action appears. It stays disabled until every question is
answered. Clicking it saves the answers, asks the host to create the Flow
from the task (a new optional platform capability; the desktop host calls the
Flow service's create-from-task) and navigates to the Flow's Review Screen.
Hosts without the capability keep today's page unchanged.

**Blocked by:** 02, 03.

**Status:** done (branch `hackathon/ticket-06`)

- [x] The action is disabled with zero or one answer and enabled with both (frontend tests).
  `components/workflows/task-page-create-flow.test.tsx` drives the demo task through `WorkflowsApp`
  (0 answers: disabled, 1: disabled, 2: enabled, a blank answer: disabled again). Browser mock:
  `assets/06-task-page-disabled.jpg` (0 of 2 answered) and `assets/06-task-page-enabled.jpg` (2 of 2).
- [x] Clicking it creates exactly one Flow and opens its Review Screen; clicking again opens the same Flow.
  A double click calls the host once (test). Desktop host: `POST /automation-flows/from-task` through
  ticket 02's `flowsApi.createFromTask`, then `/home?section=pipes&tab=flows&flow=<id>`
  (`lib/workflows/automation-flows.test.ts`). The Flow service is idempotent per task (ticket 02).
  Browser mock: click → Review Screen of `spNovaFlow000001`; "Voir la tâche" → Task Page with the
  saved answers → click again → same Review Screen; also from an Automations view left on the Flows list.
- [x] Answers are persisted. They are saved through the existing writer before the host is asked
  (test reads them back from the saved catalog; browser mock: `userCorrection` holds both answers,
  revision 1 → 2). A failed creation keeps the answers and shows why (n8n not configured, n8n
  unreachable, unknown task), then allows a retry.
- [x] Pages rendered without the capability are unchanged; existing workflows UI tests pass.
  Without `createAutomationFlow`: no action, "All optional", "Not sure" checkboxes (test).
  `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run --config vitest.config.ts components/workflows
  lib/workflows components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx`
  (from `apps/screenpipe-app-tauri`): 530 passed, 1 skipped. `bun test infra/automation-flows`: 22 pass.
  `bun x tsc --noEmit` (app): clean.

## Implementation notes

- Platform capability: `WorkflowsPlatform.createAutomationFlow?(taskId, answers)` in
  `packages/workflows-ui/src/platform.ts`; `answers` is `[{question, answer}]` (non-empty answers,
  including "Anything else we should know?" when filled). The host creates the Flow and opens it.
- Task Page (`WorkflowQuestions`, prop `createFlow`): progress reads "· Required to create the
  automation", the "Not sure" shortcut is hidden (it does not answer a required question), and
  "Save answers" becomes the secondary button next to "Créer l'automatisation".
- Desktop host: `apps/screenpipe-app-tauri/lib/workflows/automation-flows.ts`, wired into
  `desktopWorkflowsPlatform` and into the browser-mock platform (`integrated-workflows.tsx`), so
  `bun run dev:web` exercises the real desktop path against the mocked Flow routes. Navigation sets
  the URL, emits `navigate`, and sends `switch-pipes-tab` for an Automations view already mounted
  behind Workflows.
- Known limit: a Detected Task with zero Clarification Questions shows no questions section, so no
  action either (the demo task has two).
- Browser mock loading: `bun infra/automation-flows/demo/demo.ts --print` into localStorage key
  `screenpipe:fictional-workflow-editor-preview`, then open
  `/home?mode=workflows&reviewRequest=<any>&workflow=wf-novadesk-support-tickets`. Dismiss the mock's
  "Upgrade your history storage" dialog first: it swallows clicks.
