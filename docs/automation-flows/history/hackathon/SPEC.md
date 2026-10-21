# Automation Flows — hackathon spec

Status: ready for implementation (grilled 2026-10-17). Direction lives in
`AGENTS.md`; vocabulary in `CONTEXT.md`; build order and risks in
`BUILD_SPEC.md`; problem, user stories and test seams in
`automation-flows-spec.md` (the `ready-for-agent` ticket). This file holds the decisions and contracts the implementation
follows.

## User journey

1. A notification (scripted for the demo) announces a Detected Task.
2. Clicking it opens the Task Page (existing detected-workflow page): what was
   detected, Evidence timeline, "View in timeline", Clarification Questions.
3. All Clarification Questions must be answered; this enables "Créer
   l'automatisation".
4. Creating the Flow imports the n8n workflow inactive (scripted for the demo)
   and opens the Review Screen in the Automations tab.
5. The user reviews, optionally opens the n8n workflow in n8n, and activates.
6. Optional: the user asks the chat for a change; the Flow pauses, is updated,
   needs review, and is re-activated by the user.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The Flow backend is Rust routes in `screenpipe-engine` under `/automation-flows/*` (port 3030). They are the only code that talks to the n8n API. | User choice: most integrated; reuses local auth and SecretStore. Cost: the engine is linked into the Tauri app, so route changes need `bun run dev:tauri`; iterate with `cargo test -p screenpipe-engine`. |
| D2 | Review material storage is hybrid (default; the user did not object): one AI sentence per node in the n8n node `notes` field; summary, source Detected Task id, activation log and reviewed n8n `versionId` in a ScreenPipe-side JSON file. | n8n stays the source of truth for the workflow; n8n has no activation-event API. |
| D3 | The Task Page reuses `WorkflowDetail` (`packages/workflows-ui/src/workflows-app.tsx:658`) and the existing `screenpipe://workflows?workflow=wf-…` deeplink (`src-tauri/src/notifications/workflow.rs:328`). Clarification Questions are mandatory only for Flow creation; the rest of the page is unchanged. | Detection UI already exists; AGENTS.md forbids rebuilding it. |
| D4 | Demo Flow creation is fully scripted: answers are saved but ignored; the pre-built n8n workflow and its pre-written review material are imported as is. | User choice: maximum reliability. |
| D5 | Creation chat (Add) and modification chat use the existing ScreenPipe chat (Pi agent) plus an `automation-flows` skill that calls `/automation-flows/*`. | Live AI with no new chat UI. |
| D6 | Frontend: a "Flows" tab in the Automations section (`components/pipe-store.tsx:380`), all code in `apps/screenpipe-app-tauri/components/automation-flows/`; its only seam is one typed client over `/automation-flows/*`. Plain and basic, built to be replaced. | User request: simple, easily replaceable frontend. |
| D7 | One Flow = one n8n workflow. A chat modification of an active Flow unpublishes it and updates the same n8n workflow in place; the "version" is n8n's `versionId`. Edits made directly in the n8n editor are not auto-paused; the app only flags them. Verified on n8n 2.42.2: switch on = `POST /api/v1/workflows/{id}/publish` with `{versionId}` (publishes exactly the reviewed version); switch off = `POST …/unpublish` (`activate`/`deactivate` still exist but are deprecated). A workflow carries `versionId` (latest draft) and `activeVersionId` (the published one): an edit creates a new draft while the published version keeps running, so `reviewOutdated` = `active && versionId !== activeVersionId`. | User choice: simplest version model. |
| D8 | Task Page Evidence is key frames extracted from the team's screen recording (`.mov`, 2026-10-17 04:05–04:15), embedded in the demo fixture. Implementation note: `packages/workflows-ui/src/screenshots.ts:19` strips `dataUrl` for positive `frameId`s and `:9` drops non-positive ones, so the fixture images must go through `loadWorkflowScreenshot` (or that serialization needs a narrow exception). | User choice. |
| D9 | The demo n8n workflow: IMAP trigger (unread only, marks read — this is the dedupe) → one n8n AI Agent with a structured output `{type: Bug\|Tâche\|none, product, summary, description, steps, expected, impact, priority, label: back\|front}` → stop if `none` → deterministic title `<product> - <summary>`, description = the AI's write-up for developers (summary, steps to reproduce, expected result or need, impact) and the email's sender, date and subject as source, never the pasted email (changed 2026-10-18), unassigned → Jira create issue in `NOVA`. | AI only for judgment (AGENTS.md "keep AI minimal"). |
| D10 | Two scripted Clarification Questions: « Les idées d'amélioration (comme NOVA-27) doivent-elles aussi devenir des tickets ? » (expected: oui, en Tâche) and « Comment choisis-tu la priorité ? » (expected: bloquant = Highest, contournement possible = Medium, idée = Low). Free-text answers in the existing UI. | User choice: keep the demo short. |
| D11 | The AI Agent has one tool: the custom **ScreenPipe** node (`usableAsTool`), used to find how the user handled similar emails before (the screen captures of the ticket creations) and copy those conventions. Chat model: n8n OpenAI Chat Model with base URL `http://host.docker.internal:3030/v1` and the local ScreenPipe API key. | User choice. The proxy forwards the body verbatim (`routes/cloud_proxy.rs:25`), so `tools` should pass. Consequence: the demo machine must hold those ScreenPipe captures. |
| D12 | Custom n8n nodes live in one package `packages/n8n-nodes-screenpipe` with a shared "ScreenPipe API" credential: **ScreenPipe** (action + tool), **ScreenPipe Trigger** (deterministic) and **ScreenPipe AI Trigger**. Whether the triggers are shown in the demo is not decided. | AGENTS.md requires the two triggers; the demo needs the data node. |
| D13 | The n8n API URL and API key are two new fields (`api_url`, `api_key` secret) on ScreenPipe's existing n8n connection (`crates/screenpipe-connect/src/connections/n8n.rs`); the routes read them from there. | User choice: Connections UI and SecretStore for free. |
| D14 | n8n runs from `infra/automation-flows/docker-compose.yml`, image pinned to `n8nio/n8n:2.42.2`, bound to `127.0.0.1:5678`. Built custom nodes are copied into `infra/automation-flows/custom-nodes/` (gitignored). | Pinned instance: n8n credentials are not portable. |
| D15 | Demo: 3 minutes on stage + 2 minutes Q&A. The modification chat is shown live if it passes rehearsal. | User answer. |
| D16 | A failed Run triggers a ScreenPipe notification (n8n Error Workflow → `POST localhost:11435/notify`, deeplink to the Flow's Review Screen) and the Flow shows red in the list. No automatic pause on failure. | User choice (grilling "how can an n8n workflow fail"): a transient Jira/proxy outage must not switch the Flow off. |
| D17 | A Failed Run is never lost: the IMAP trigger still marks emails read (dedupe), n8n keeps the failed Run with its input, and the user can **Retry** it (`POST /api/v1/executions/{id}/retry`) from the Review Screen and from the D16 notification, which names the email's sender and subject. | User choice: no lost email without changing the dedupe. |
| D18 | The AI may abstain: its output gains `confidence: high\|low`; low confidence creates no ticket and sends a ScreenPipe notification "À trier à la main" (sender, subject, the AI's reason). The Review Screen shows the Flow's Activity: per handled email, the outcome (ticket, ignored, abstained, failed) and the reason. | User choice: a silent wrong "no ticket" is the worst failure; abstaining beats guessing. |
| D19 | ScreenPipe runs a Flow health check at app start and every 15 min: n8n reachable (else a banner "n8n injoignable, tes Flows ne tournent pas"), and Failed Runs since the last check become notifications. This catches failures that happened while the app (proxy + notify server) or n8n was down. | User choice: the D16 notification cannot fire when the app itself is the thing that is down. |
| D20 | Retry is idempotent: every ticket gets a label `mail-<first 8 hex of a hash of the email's Message-ID>`, and the workflow searches Jira (JQL) for that label before creating; if found, it skips creation and the Run succeeds. | User choice: a Jira timeout after creation would otherwise duplicate the ticket on Retry. |
| D21 | Every AI in the hackathon scope uses the user's ChatGPT subscription: the chat (ChatGPT preset), the n8n AI nodes and the ScreenPipe AI Trigger (`chatgpt/<model>` on the local proxy, ticket 25). Supersedes the ScreenPipe Business model of D11 and line « AI proxy from the n8n container » below. | User choice, 2026-10-17: `auto` (claude-haiku-5-5) is not smart enough to build Flows or judge in the nodes. |
| D22 | A chat-built Flow is never invented or half-built: ScreenPipe refuses, before n8n sees it, a node type this n8n does not load (invented, or switched off like Execute Command), a version it lacks, an empty required parameter, a node connected to nothing, no trigger, and a credential the node needs that n8n does not hold. It checks against `infra/automation-flows/n8n-catalog.json`, generated from the pinned image. Credentials still never come from the chat (ticket 22): a needed one is wired only when n8n holds exactly one of its type (ticket 26). | User report, 2026-10-17: the chat built a Flow on `n8n-nodes-base.executeCommand`, which n8n 2.x switches off, called it valid, then swapped it for an HTTP Request that did something else. |

## Demo data (from the team's recording)

Dedicated Gmail inbox (`servicedesk.novadesk@gmail.com`, IMAP app password
entered by a human in n8n only) and Jira Cloud project `NOVA` ("NovaDesk —
Équipe technique"). Three recorded repetitions:

| # | Email (sender, subject) | Ticket created by hand |
|---|---|---|
| 1 | Arthur Noteris, "Export des contacts vide dans NovaCRM" (04:04) | NOVA-25, Bug, "NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls)", Highest, assignee Nils Laeremans, label `back` |
| 2 | Loris Omont, "NovaPay refuse les montants avec centimes" (04:09) | NOVA-26, Bug, "NovaPay - Montant avec virgule refuse dans une note de frais", Medium, assignee Arthur Noteris, label `back` |
| 3 | Nils L., "Idée : filtrer les clients par date de dernière relance" (04:12) | NOVA-27, Tâche, "NovaCRM - Filtre "Derniere relance" enregistrable dans la liste clients", Low, assignee Arthur Noteris, label `front`, Demandeur Nils Laeremans |

Observed conventions: summary is `<Product> - <short summary>`; Bug for a
defect, Tâche for an improvement idea; the description quotes the email; the
inbox also holds a Google security alert that gets no ticket.

Detected Task fixture id: `wf-novadesk-support-tickets`.

## Contract: `/automation-flows/*` (screenpipe-engine)

Auth: the existing local API auth. n8n access: `api_url` + `api_key` from the
n8n connection (D13), header `X-N8N-API-KEY`, n8n public API `/api/v1`. Flows
are the n8n workflows tagged `screenpipe-flow`.

```ts
type FlowStatus = "draft" | "active" | "paused" | "needs_review";

type FlowSummary = {
  id: string;                 // n8n workflow id
  name: string;
  status: FlowStatus;
  lastExecution: { status: "success" | "error" | "running"; startedAt: string } | null;
};

type Flow = FlowSummary & {
  n8nUrl: string;             // `${api_url}/workflow/${id}`, for "View graph"
  sourceTaskId: string | null; // wf-… id, for the link back to the Task Page
  // Ticket 22: first evidence moment of the source Detected Task in the
  // workflow catalog (earliest evidence entry or recorder frame; frameId null
  // when it has no recorder frame), for « Voir dans la timeline »; null otherwise.
  sourceMoment: { frameId: number | null; timestamp: string } | null;
  summary: string;            // plain-language explanation
  // `facts` (ticket 22): what the AI did not write, read from the node: the
  // names of its n8n credentials ("Identifiant n8n : <name>") and, for an
  // HTTP Request, "<METHOD> <host>" (or "<METHOD> (adresse calculée à l'exécution)").
  nodes: { id: string; name: string; type: string; position: [number, number]; sentence: string | null; facts: string[] }[];
  edges: { from: string; to: string }[];   // from n8n `connections`, by node id
  versionId: string;
  reviewedVersionId: string | null;
  // Active and n8n runs something the user did not activate: activeVersionId
  // !== versionId (edited in n8n after publishing, D7) or activeVersionId !==
  // reviewedVersionId (published in n8n without the Review Screen, ticket 22).
  reviewOutdated: boolean;
  // by "api": switched off by a local caller without the UI credential.
  activationLog: { at: string; event: "activated" | "deactivated" | "paused_for_edit" | "modified"; versionId: string; by: "user" | "chat" | "api" }[];
};
```

Status derivation (from n8n `active` + stored `reviewedVersionId`):
`active` if n8n active; else `draft` if never activated; else `needs_review`
if `versionId !== reviewedVersionId`; else `paused`. Sticky-note nodes are
excluded from `nodes`. `sentence` is the node's `notes`.

| Route | Effect |
|---|---|
| `GET /automation-flows` | `FlowSummary[]` |
| `GET /automation-flows/:id` | `Flow` |
| `POST /automation-flows/from-task` `{taskId, answers}` | Demo: maps `taskId` to the bundled fixture (unknown → 404); imports it inactive, tags it, stores summary + `sourceTaskId`. Idempotent per `taskId`. Returns `Flow` (`draft`). A pre-imported copy that already has a local record is only linked to the task (history, reviewed version and on/off state kept, `200`); only a copy with no record is switched off. |
| `POST /automation-flows` `{workflow, summary}` | Chat creation: imports `workflow` (n8n JSON with per-node `notes`) inactive and tagged, without any node `credentials` and without `settings.availableInMCP`. Returns `Flow`. |
| `GET /automation-flows/:id/workflow` | For the chat: `{id, versionId, summary, workflow}`, the n8n workflow reduced to what an update accepts (no `active`, no tags). |
| `PUT /automation-flows/:id` `{workflow, summary?}` | Chat modification: refuses (`400 invalid_workflow`, nothing changed) a workflow without nodes or connections or with a non-sticky node lacking `notes`; if active, unpublish first (log `paused_for_edit`); update in place with `publishIfActive=false`; log `modified`; both events `by: "chat"`. n8n's 400 → `400 invalid_workflow` with its message. Each node's `credentials` come from the current n8n workflow for nodes that keep their name and type, none for new or retyped nodes, never from the request. Returns `Flow`. |
| `POST /automation-flows/:id/activate` `{versionId}` | Only from the user's click (ticket 14): needs header `x-screenpipe-flow-activation` with the app's UI credential (`403 activation_requires_user` otherwise) and the reviewed `versionId` (`400 version_required` when missing, `409 version_changed` when n8n moved on). n8n publish of that version; `reviewedVersionId = versionId`; log `activated`. |
| `POST /automation-flows/:id/deactivate` | n8n unpublish; log `deactivated`, `by: "user"` with the UI credential header, `"api"` without. Open to any authenticated caller. |
| `POST /automation-flows/:id/failures` `{executionId \| null, error?}` | D16, called by ScreenPipe's n8n error workflow (tag `screenpipe-flow-errors`, created once, switched off, named in every Flow's `settings.errorWorkflow` at creation and chat change). Reads the execution (`includeData=true`; a run of another workflow or an unknown one → `404`), sends `POST <notify server>/notify` with the email's sender and subject, the failing step and its error, id `automation-flow-failure:<flow>:<execution>` and a `screenpipe://flows/<id>` deeplink. Changes nothing in n8n. Returns `{notified, reason?}`. |
| `GET /automation-flows/:id/activity` | D18, ticket 13: the Flow's latest 20 n8n executions (`includeData=true`), newest first, running ones left out: `{executionId, startedAt, outcome, reason, email: {sender, subject} \| null, ticket}[]`. `outcome`: `failed` (n8n status not success; `reason` = « Échec à l'étape « step » : error »), `ticket` (a step output Jira's created issue `{key, self: …/rest/api/…/issue/…}`, or a D20 search found `issues[0]`; `ticket` = its key), `abstained` (the AI's `output.confidence` is not `high`), `ignored` (the AI answered, no ticket), `done` (no AI answer: a Flow without an AI decision). `reason` = the AI's `output.reason`. `retried`: a failed run whose retry succeeded (n8n `retrySuccessId`) or that a listed run is `retryOf`. Reads only. |
| `POST /automation-flows/:id/runs/:run/retry` `{}` | D17, ticket 12: n8n `POST /executions/:run/retry`, waiting up to 180 s for the retried run. Only a run of that Flow (else `404 run_not_found`) that ended without finishing and has no successful retry (else `409 run_not_failed`). `loadWorkflow: true` only when n8n's saved Flow is the reviewed version or the one n8n publishes; otherwise the run is retried as it ran (an unreviewed chat change never runs). Returns the retried run as an Activity row; n8n refusing → `502 n8n_failed`; still running after the wait → `504 retry_still_running`. Open to any local caller (the failure notification's « Relancer » `api` action calls it, then opens the Review Screen). |
| `GET /automation-flows/health` / `POST /automation-flows/health` | D19, ticket 14 (flows-round-two): the engine checks at start, every 15 min, every 30 s while n8n is unreachable or a notification is pending. `GET` = last result, no n8n call (`n8n: "unknown"` before the first); `POST` = check now. `{checkedAt, n8n: reachable \| unreachable \| unauthorized \| not_configured \| failed \| unknown, notified[], pendingNotifications[], deletedDrafts[]}`. A check notifies (same notice and id as `/failures`) each `error`/`crashed` run of a Flow that stopped since the last complete check (first check: 24 h back), never twice: `<data dir>/automation-flows-health.json` records notified runs, shared with `/failures`. It deletes building drafts unchanged (n8n `updatedAt`) for 24 h, in n8n and the store. The app shows « n8n injoignable, tes Flows ne tournent pas » while `n8n` is `unreachable`. |

Every unpublish (deactivate, chat change of an active Flow, a pre-imported
copy left on) first waits while n8n reports a running execution of the
workflow (`GET /executions?workflowId=&status=running`), polling every 1 s up
to 90 s (ticket 21, `RunningWait`); still running at the deadline → `409
{error: "flow_running", detail}`, nothing changed.

Errors: `412 {error: "n8n_not_configured"}`, `412 {error: "n8n_unauthorized",
detail}` (n8n answered 401/403 to the API key), `502 {error: "n8n_unreachable"}`
(no answer: connection, timeout), `502 {error: "n8n_failed", detail}` (any other
non-2xx from n8n), `409 {error: "flow_running", detail}`,
`404` for an unknown Flow or task, `400 {error: "invalid_workflow", detail}` for
a chat change that cannot be applied, `415 {error: "json_required"}` for a
POST/PUT without `Content-Type: application/json`. Storage: one JSON file in
the ScreenPipe data dir, keyed by n8n workflow id.

UI credential (ticket 14): the chat agent, pipes and MCP clients share the
local API key with the app, so it cannot prove a user click. The desktop app
generates a random `FlowActivationKey` per process, gives it to the engine it
embeds and hands it to its webview only through the Tauri command
`get_flow_activation_key`; never in an environment variable (Pi inherits
them), a file or a log. An engine without it (CLI) refuses every activation.

Fixture: `infra/automation-flows/workflows/` holds the n8n workflow JSON
(with node `notes`) and its review JSON (summary); the engine embeds both at
build time (`include_str!` in `automation_flows.rs`), and
`infra/automation-flows/import-workflow.sh` imports the same file. The workflow
JSON is exported from the demo n8n instance after its credentials are bound
once, so it carries that instance's credential ids (ids are not secrets).

## Contract: frontend (`components/automation-flows/`)

- `api.ts`: the typed client above, over `localFetch`; the browser mock
  (`bun run dev:web`) returns fixture Flows.
- `pipe-store.tsx`: third tab "Flows"; `?tab=flows&flow=<id>` opens a Flow.
- List: name, status badge, last run; "Ajouter" opens the ScreenPipe chat with
  a prefilled creation prompt.
- Review Screen: summary; read-only graph (`@xyflow/react`, already a
  dependency) with each node's sentence; "Voir le graphe" (n8n URL);
  "Voir la tâche" (Task Page); status, last run, activation history;
  Activer/Désactiver; "Demander une modification" (opens the chat with the
  Flow id in the prompt); a "needs review" banner when applicable.
- Task Page (packages/workflows-ui): a mode where Clarification Questions are
  required; "Créer l'automatisation" is disabled until all are answered; it
  calls a new optional platform method `createAutomationFlow(taskId, answers)`
  (desktop: `POST /automation-flows/from-task`, then navigate to the Review
  Screen).

## Contract: `automation-flows` skill (Pi)

`crates/screenpipe-core/assets/skills/automation-flows/SKILL.md`: how to
list, read, create and modify Flows through `/automation-flows/*`; every node
gets a one-sentence `notes`; never call `activate`; end by giving the user the
Review Screen link. Rehearsed modification: « Ajoute l'étiquette `auto` à
chaque ticket créé ».

## Contract: n8n nodes (`packages/n8n-nodes-screenpipe`)

- Credential `screenpipeApi`: `baseUrl` (default
  `http://host.docker.internal:3030`), `apiKey`.
- **ScreenPipe** (`usableAsTool: true`): operations `searchContent` (`GET
  /search`: q, content_type, app_name, window_name, start_time, end_time,
  limit) and `activitySummary` (`GET /activity-summary`). Text truncated.
- **ScreenPipe Trigger** (polling, cursor in static data): mode `keyword`
  (term in audio transcription), `window` (app/window becomes active), `pipe`
  (new execution of a pipe). Emits `{mode, matchedAt, text, app, window}`.
- **ScreenPipe AI Trigger** (polling): `conditionPrompt`, `lookbackMinutes`,
  `cooldownMinutes`; each poll sends the recent activity summary to the AI
  proxy and fires when it answers `{met: true, reason}`.

## Demo script (3 min, to rehearse)

| Time | Step |
|---|---|
| 0:00 | Problem: the support agent turns every bug email into a Jira ticket by hand. |
| 0:15 | Notification → Task Page: 3 repetitions with captures, "View in timeline". |
| 0:40 | Answer the 2 questions → "Créer l'automatisation". |
| 1:00 | Review Screen: summary, graph with one sentence per node, quick "Voir le graphe" in n8n. |
| 1:30 | Activer. Send a new bug email from a phone. |
| 1:45 | Chat: « Ajoute l'étiquette `auto`… » → paused → needs review → Activer. |
| 2:30 | The ticket appears in Jira with the right type, title and priority. |

## Acceptance (demo machine)

Observed on the demo machine on 2026-10-17 (details: `evidence/LIVE-CHECKS.md`):

- [x] The notification opens the Task Page of `wf-novadesk-support-tickets`.
  Pressing « Voir la tâche » in the app's notification panel opened it in 4–8 s (rehearsals 0–5).
- [x] "Créer l'automatisation" stays disabled until both answers are filled.
  `enabled=false` at 0 and 1 answer, `true` at 2 (rehearsals 1–5).
- [x] After creation, n8n holds one inactive workflow tagged `screenpipe-flow`; a
  second click does not create a second one. Checked through the n8n API in every rehearsal; a
  second click returned the same Flow (rehearsal 0).
- [x] The Review Screen shows every non-sticky node with its sentence. 8 of 8, plus the fixed
  facts (credentials, Jira host).
- [x] Activer makes the n8n workflow active; Désactiver reverses it; both appear
  in the activation history. « Activé par vous » / « Désactivé par vous »; a deactivation outside
  the app reads « Désactivé hors de Screenpipe ».
- [x] A new bug email becomes one NOVA ticket; a non-ticket email creates none. NOVA-31…40;
  6 Google security alerts and a newsletter created none.
- [x] A chat modification of an active Flow leaves it `needs_review` and inactive. Rehearsals
  0–4; with an email being processed, the change waits for it (ticket 21).

## Human setup (agents must not do these)

1. Start Docker Desktop, then `docker compose -f infra/automation-flows/docker-compose.yml up -d`.
2. Create the n8n owner account and an n8n API key.
3. In n8n, create the credentials: IMAP (Gmail app password), Jira Software
   Cloud (email + API token), OpenAI (base URL `http://host.docker.internal:3030/v1`,
   ScreenPipe local API key), ScreenPipe API.
4. In ScreenPipe → Connections → n8n: `api_url` `http://localhost:5678` and the API key.
5. If the demo runs on this Mac: re-record the 3 repetitions with ScreenPipe on (D11).

## Verified on the local n8n 2.42.2

- Activation API: see D7 (`publish`/`unpublish`, `versionId` vs `activeVersionId`).
- Node types available for the demo workflow (latest versions): IMAP Email
  trigger `emailReadImap` 2.2, `jira` 1, `if` 2.3, `set` 3.5, `stickyNote` 1,
  AI Agent `@n8n/n8n-nodes-langchain.agent` 3.1, OpenAI Chat Model
  `lmChatOpenAi` 1.3, Structured Output Parser `outputParserStructured` 1.3,
  HTTP Request `httpRequest` 4.5.
- Instance-level MCP endpoint: `http://localhost:5678/mcp-server/http`
  (Bearer token); registered in Claude Code for this project (local scope).

- AI proxy from the n8n container (`http://host.docker.internal:3030/v1`, model `auto`): chat completions 200, tool calls returned. `GET /models` is 404, so n8n's OpenAI credential test shows a red error on Save; that is expected. Tool calls come back non-OpenAI-shaped (`type: "tool_use"`, no `id`, no `finish_reason`): the n8n AI Agent may not parse them; if it fails, normalize the response in the engine's cloud proxy before falling back to a plain ScreenPipe step.
- Demo n8n workflow (ticket 01): `infra/automation-flows/workflows/novadesk-support-tickets.json`
  (fixed id `spNovaFlow000001`, tag `screenpipe-flow`, `settings.availableInMCP: true`) and its
  review JSON beside it; (re)import switched off with `infra/automation-flows/import-workflow.sh`
  (`docker cp` + `n8n import:workflow`; refuses if the workflow is active). Import upserts by id,
  forces `active: false`, sets a new `versionId`, matches tags by name and keeps credential ids.
- Jira step = HTTP Request `httpRequest` 4.5 with the predefined `jiraSoftwareCloudApi`
  credential, `POST https://kylianaubry.atlassian.net/rest/api/2/issue` with `project.key`,
  `issuetype.name`, `priority.name`, `labels`, no `assignee`. Not the `jira` 1 node: its create
  operation only sends `project.id`, `issuetype.id` and `priority.id`, which cannot be resolved
  without the token and cannot switch between Bug and Tâche.
- OpenAI Chat Model through the proxy: `responsesApiEnabled: false` (the proxy has no
  `/v1/responses`) and model in `id` mode with value `auto` (no `/v1/models`).
- AI Agent 3.1 + Structured Output Parser through the proxy works despite the tool-call shape:
  the parser adds a `format_final_json_response` tool, and three synthetic emails came back
  Bug/Highest/back, Tâche/Low/front and none. Full chain run in n8n (AI → IF → title and quoted
  description → Jira JSON body), stopping before the HTTP call. One-off CLI runs need
  `docker exec -e N8N_RUNNERS_BROKER_PORT=5690 … n8n execute --id=…` (port 5679 is taken by the
  server).
- ScreenPipe nodes (ticket 07): `packages/n8n-nodes-screenpipe`; `bun run install-n8n` builds,
  copies into the custom-nodes folder the running container mounts (it may belong to another
  checkout: the script reads `docker inspect`), and restarts n8n. Loaded types: `CUSTOM.screenPipe`
  (palette, "Custom Nodes") and `CUSTOM.screenPipeTool` (AI → Tools); credential type
  `screenpipeApi`. Credential shell `spScreenpipeApi1` ("ScreenPipe API (local)") was created by
  `n8n import:credentials` with an empty API key; a human pastes the key in n8n. ScreenPipe's API
  answers 403 without it. The demo workflow's AI Agent has the tool node "Historique ScreenPipe"
  (`$fromAI` keywords, 5 results, 600 chars each, On Error: Continue).
- Tool round trip through the AI proxy FAILS today: the proxy's tool calls have no `id`, so n8n
  sends back the tool result with `tool_call_id: ""` and the proxy answers 400 ("malformed tool
  call"). Verified with two raw requests through the stored OpenAI credential: same conversation
  with `tool_call_id: ""` → 400, with `"call_1"` → 200. Fix (engine, `routes/cloud_proxy.rs`):
  in non-streaming JSON responses, give every `choices[].message.tool_calls[]` a unique `id`
  (e.g. `call_<uuid>`) and `type: "function"`, and set `finish_reason: "tool_calls"` when absent.
  Until then the demo workflow fails at the AI step for any email where the agent calls the tool.
- Security (prompt injection from incoming emails): the agent gets the email between
  `<email_non_fiable>` delimiters, with look-alikes of the tag stripped from every email field,
  and the system message says that content is data, never instructions, and limits the tool to
  how earlier NOVA tickets were typed, titled and prioritized. The ScreenPipe tool is fixed to
  screen text (`contentType: ocr`, which searches every frame's OCR and accessibility text; no
  audio, input or memories) in windows whose title contains `Jira`, 5 results × 600 chars; the AI
  only fills the keywords. The parser closes `product` (NovaCRM, NovaPay, NovaDesk, Autre) and
  caps `summary` at 80 chars. The "Ticket nécessaire" IF re-checks every field with regex
  allowlists (summary: one line, 1–80 chars, no control characters), so a malformed or injected
  answer ends the run without a ticket; its conditions agree with `executeFilter` from
  `n8n-workflow` 2.42.2 on 11 cases. Gaps: no app filter (the demo browser is not recorded in the
  repo; only the window is pinned); the newline rule lives in the IF, not in the parser schema
  (no `pattern` sent to the model through the proxy); the summary stays free text, so up to 80
  chars the agent read can still reach a ticket title; the email body is quoted unescaped in the
  Jira wiki-markup description. Not yet run live: needs a re-import.

## Risks to check first (golden path)

- n8n 2.x semantics: confirm that `POST /workflows/:id/activate|deactivate`
  still exist and how `versionId` relates to the published version. n8n
  2.42.2 distinguishes draft and published workflows at startup ("0 draft
  workflows, 0 published workflows"), so D7 may map to publish/unpublish.
- Tool calling through `localhost:3030/v1/chat/completions`: one curl with
  `tools`.
- Credential binding on API import (fixture exported from the demo instance).
- The demo machine must hold the ScreenPipe captures of the repetitions.
