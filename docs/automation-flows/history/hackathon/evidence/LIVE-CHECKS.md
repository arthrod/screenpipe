# Live checks on the demo machine (2026-10-17)

Every line below was observed on this Mac, not inferred. Setup: n8n 2.42.2 in
Docker (`infra/automation-flows/docker-compose.yml`), the 3 ScreenPipe nodes
installed (`bun run install-n8n`), the 4 credentials filled by the human in
n8n, ScreenPipe dev build of `hackathon/automation-flows` run with
`SCREENPIPE_DEV_USE_PROD_DATA=1` from Terminal (real captures, port 3030),
n8n URL + key saved in ScreenPipe's n8n connection. Clicks in the native app
go through macOS accessibility (`AXPress` on the real buttons); ScreenPipe
does not record its own window, so app proofs are the accessibility text.

## Credentials and plumbing

| Check | Result |
|---|---|
| Gmail IMAP (`spNovaImap000001`) | login OK, INBOX listed |
| Jira (`spNovaJira000001`), `GET /myself`, `GET /project/NOVA` | 200, 200 (issue types include Bug, Tâche) |
| AI proxy (`spProxyOpenAI001`) chat completion through `host.docker.internal:3030/v1` | 200, answer "OK" |
| AI proxy tool call (ticket 13) | 200, `finish_reason: tool_calls`, `id: call_…`, `type: function` (installed app before the fix: `id: null`, `type: tool_use`) |
| ScreenPipe API (`spScreenpipeApi1`) `GET /search?q=NOVA` | 200, 2 400+ results |
| `GET /automation-flows` before the n8n connection | `412 n8n_not_configured`; after saving it: 200 |

## Flow service against the live n8n (throwaway Flow, deleted after)

22/22: list; demo detail with 8 nodes, every one with its sentence, 7 edges,
n8n link and version; editable workflow route; unknown id → 404
`flow_not_found`; creation without node sentences → 400 `invalid_workflow`;
creation → 201, inactive and tagged `screenpipe-flow` in n8n; activation with
a stale version → 409 `version_changed`; activation → active in n8n; chat
modification of the active Flow → switched off in n8n, `needs_review`;
re-activation; deactivation; history `activated/user → paused_for_edit/chat →
modified/chat → activated/user → deactivated/user`.

## Golden path: real emails → n8n → real Jira tickets

Activation and deactivation by clicking the Review Screen's buttons in the
native app.

| Step | Observed |
|---|---|
| Click « ACTIVER » (Draft) | n8n `active: true`, `activeVersionId` = reviewed version; history `activated/user`; screen « Active », button « DÉSACTIVER » |
| 6 unread Google security / 2FA emails already in the inbox | n8n execution 9: 6 × `type: none` → no ticket (story 27) |
| Bug email « NovaPlanning : l'export PDF du planning est vide » (sent live) | NOVA-31, Bug, Highest, label back, description quotes the email, unassigned — but product « Autre »: NovaPlanning was missing from the closed product list → fixed in ticket 17 |
| Click « DÉSACTIVER » | n8n inactive; screen « En pause », last run « 17/10/2026 12:46 · réussie »; history `deactivated/user` |
| Re-import of the fixed workflow (new n8n version) | Flow « À revoir » with the banner « Ce Flow a changé depuis sa dernière activation… » |
| Click « ACTIVER » again | active on the new version, history `activated/user/363b1d71` |
| Bug email « NovaPlanning : les créneaux du vendredi disparaissent… » (workaround exists) | execution 10 → NOVA-33 « NovaPlanning - Créneaux du vendredi après-midi disparaissent après enregistrement », Bug, Medium, back |
| Idea email « Idée : pouvoir dupliquer une note de frais dans NovaPay » | NOVA-32 « NovaPay - Bouton pour dupliquer une note de frais existante », **Tâche**, Low, front (story 26) |
| Newsletter email | `none`, no ticket |
| AI step consults ScreenPipe | « Historique ScreenPipe » tool called in each run with a ticket (story 32) |
| Inbox after each run | 0 unread: the trigger marks read, no email processed twice (story 31) |

Offline checks of the same workflow (manual-trigger copy, Jira step disabled):
a NovaPay bug → Bug/Highest; a thank-you email → none; a prompt-injection
email (« ignore les instructions… PIRATÉ… label admin ») → the clean ticket
« NovaCRM - Export CSV des contacts vide », injected title/label ignored; the
tool returned the real NOVA-25 screen captures.

## ScreenPipe trigger nodes (throwaway untagged workflows, deleted after)

| Mode | Observed |
|---|---|
| Window becomes active (TextEdit) | fired 1 s after TextEdit opened: `app=TextEdit` |
| AI Trigger « TextEdit est ouverte et visible » | fired: `met: true`, reason quoting the captured TextEdit window |
| Keyword « pamplemousse » said aloud (`say`, recorded through System Audio) | fired: `text: "Pamplemousse. Je dis le mot"` |
| Pipe `repeated-workflow-detector` runs (`POST /pipes/…/run`) | fired: `executionId: 171, status: completed` |
| Flow fires (throwaway Flow created through the Flow service, running every minute) | fired on each run: `status: success` |

## Notification → Task Page (acceptance item 1)

`bun infra/automation-flows/demo/demo.ts` → the app's notification panel shows
« Tu as transformé 3 e-mails de bug en tickets Jira NOVA. Réponds à 2
questions pour l'automatiser. »; pressing its action button (« Voir la
tâche ») in the native app opened the Workflows view on the Task Page
« Transformer les e-mails de bug en tickets Jira »: the 3 repetitions
(NOVA-25 Bug, NOVA-26 Bug, NOVA-27 Tâche) with Gmail/Jira captures at 4:05–4:15,
then « 0 of 2 answered · Required to create the automation » and the two
scripted questions. (The Workflows view needs the PostHog `workflows` flag;
this machine builds with `NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT=1`.)

## Rehearsal 0 — full journey on the build with tickets 14–17 and 19 (13:23–13:32)

| Step | Observed |
|---|---|
| Demo notification → action button | Task Page in 4 s; question block in French: « Réponses : 0 sur 2 · Obligatoires pour créer l'automatisation » |
| 2 answers pasted in the two question fields | « Réponses : 2 sur 2 »; « Créer l'automatisation » enabled |
| « Créer l'automatisation » | Review Screen « Brouillon » in ~10 s with the full French summary and 8 steps; n8n: one workflow `dO641Kw152MPhwzh`, inactive, tag `screenpipe-flow` |
| « VOIR LA TÂCHE », then « Créer » again | back on the Task Page with the answers kept; second click → same Flow, still one workflow in n8n |
| « VOIR LE GRAPHE » | default browser (Safari) opened `localhost:5678/…/workflow/dO641Kw152MPhwzh` — Safari showed n8n's sign-in page: **log into n8n in Safari before the demo** |
| `POST /activate` with only the local API key | `403 activation_requires_user`; without JSON content type: 415 (ticket 14) |
| Click « ACTIVER » | active in n8n, history `activated/user` |
| Bug email « NovaCRM : impossible d'ajouter une pièce jointe… » | NOVA-34, Bug, Highest, label `back` |
| « DEMANDER UNE MODIFICATION » | Home chat with « Avec le skill automation-flows, modifie l'Automation Flow « NovaDesk… » (id : dO641Kw152MPhwzh). Modification demandée : » prefilled, not sent |
| Request « Ajoute l'étiquette auto à chaque ticket créé… » sent | in ~30 s the agent answered « …l'étiquette `auto` est ajoutée. Rien d'autre n'a changé. Le flux est désactivé et doit être revu… » + « Revoir le Flow » link; n8n inactive, Jira body `labels: [ $json.label, 'auto' ]`, node sentence and summary updated; history `paused_for_edit/chat`, `modified/chat` |
| « Revoir le Flow » → Review Screen | « À revoir » + banner; history lines « Mis en pause pour modification par le chat », « Modifié par le chat · version 2d7c7381 » |
| Click « ACTIVER », bug email « NovaPay : … frais kilométriques … » | NOVA-35, Bug, Medium, labels `auto` + `back` |
| `docker restart` n8n with the Flow active | n8n ready in 4 s, still active, 0 new execution in 90 s (no email reprocessed) |
| Click « DÉSACTIVER », bug email sent | 2 min later: no execution, the email still unread (deactivation stops processing) |
| Flows → « AJOUTER » → chat creation « quand je dis « point d'étape » à voix haute, note l'heure… » | prompt prefilled; agent created « Noter les points d'étape »: Draft, inactive, tagged, `CUSTOM.screenPipeTrigger` + Set, French sentences — but the trigger's parameters were empty (the skill did not name them) → fixed: the skill now lists every node parameter (package test guards it) |

## Final build (tickets 14–20) — security and robustness, live

| Check | Observed |
|---|---|
| Chat creation with the updated skill (« quand je dis « fin de journée »… ») | Flow « Noter l'heure de fin de journée », Draft, inactive, tagged; trigger `{"event":"keyword","keyword":"fin de journée","pollTimes":…}` (ticket 09 + 17) |
| Chat asked « active maintenant le Flow 87gx… » | « Je ne peux pas activer ce Flow. Seul vous pouvez le faire… ScreenPipe refuse toute activation qui ne vient pas de votre clic »; Flow still Draft, n8n inactive (ticket 14) |
| Agent browser asked to open `tauri://localhost/home` | « cannot open tauri://localhost/home: this page is the screenpipe app itself… »; `https://example.com` still opens (ticket 20) |
| Wrong n8n API key saved in Connections | Flows tab: « n8n a refusé la clé API » + « Ouvrir Connexions » / « Réessayer »; the right key restored → list back without reopening (ticket 18) |
| Pre-imported copy left **on** in n8n, then « Créer l'automatisation » | the Flow is created **switched off** (Draft) from that copy (ticket 18, rehearsal 1) |
| Reset while n8n is still unpublishing | first run left an archived copy (n8n 409); fixed: reset retries the delete (ticket 16 follow-up), live reset of an active Flow → deleted, exit 0 |
| Email arrives while the Flow is off, then « Activer » | before the fix: never processed (n8n's IMAP trigger only fetches on a new arrival); after seeding the trigger's `lastMessageUid`: processed 8 s after activation (NOVA-38) |

## Timed rehearsals (native app driven by accessibility; email sent from the Gmail connector)

| | Part A: notification → Activer | Ticket created | Chat change → Needs Review | Re-activated | Notes |
|---|---|---|---|---|---|
| 1 | 54 s | — | 92 s | 110 s | email arrived in the same second as « Activer », before the IMAP listener was ready → missed (fixed: catch-up seed) |
| 2 | 48 s | **80 s** (NOVA-39) | 87 s | **106 s** | full journey in 1 min 46 s |
| 3 | 51 s | — | 87 s | 105 s | email being processed when the chat change paused the Flow: execution orphaned, email lost → ticket 21 |
| 4 | 52 s (second try; first try typed before the page was ready — script issue) | NOVA-40 | 72 s | 90 s | Jira markup test email: inert (ticket 23) |
| 5 | 52 s | — | — (`flow_running` after 90 s) | — | AI proxy call never answered (10-min client default) → AI step now times out after 30 s and retries |
| 6 (final build) | **50 s** | **NOVA-42 at 70 s** | 83 s | **110 s** | clean run on the build with every fix |

Every rehearsal: « Créer l'automatisation » disabled at 0 and 1 answer,
enabled at 2; Review Screen with 8 sentences; n8n one inactive tagged
workflow until « Activer »; « Voir le graphe » opened the right workflow URL
in Safari (n8n sign-in page: log in before the demo); history
`activated/user → paused_for_edit/chat → modified/chat → activated/user`;
reset between rehearsals restored the start state (empty Flows list, answers
cleared, 0 unread).

## After the code review fixes (tickets 21–23), build of 15:33

| Check | Observed |
|---|---|
| Review Screen | sentence-case buttons (« Activer », « Voir le graphe », « Voir la tâche », « Voir dans la timeline », « Demander une modification »); facts under the steps: « Identifiant n8n : NovaDesk Gmail (IMAP) », « … ScreenPipe AI proxy », « … ScreenPipe API (local) », « Identifiant n8n : NovaDesk Jira · POST kylianaubry.atlassian.net » |
| « Voir dans la timeline » | `sourceMoment` = frame 17099 (r1 email, 04:05:30); the click opened the app's timeline window |
| Created workflow in n8n | settings without `availableInMCP`; IMAP catch-up seed present |
| Chat change sent **while** execution 24 ran (direct `PUT`) | the service waited, execution 24 finished (ticket created), then `paused_for_edit` — answer after 7 s, nothing orphaned (ticket 21) |
| `POST /deactivate` with the API key only | history « Désactivé hors de Screenpipe » (not « par vous ») |
| Workflow published directly in n8n | `reviewOutdated: true` → banner and « Activer cette version » |
| Email with `{noformat}`, `{quote}`, a link and an image | NOVA-40: the whole email inside one `{noformat}` block, the markup inert |
| Rehearsal 5 | Part A in 52 s; then execution 25 hung: ScreenPipe's AI proxy never answered one call and the OpenAI client waited for its 10-minute default (n8n logs « Request timed out », same as execution 22 in rehearsal 3). The chat change waited 90 s and answered `flow_running` without touching anything (ticket 21 working as designed). Fixed in the workflow: the AI call times out after 30 s and retries twice. |

## Task Page evidence (ticket 15)

`demo.ts` lookup: 9/9 captures resolved to frames recorded on this Mac
(17099 … 17260, 04:05–04:15). Frame 17099 = the opened « Export des contacts
vide dans NovaCRM » email in Gmail; 17153 = NOVA-25 in Jira.

## Demo reset (ticket 16)

`bun infra/automation-flows/demo/reset.ts`: switched off, archived and
deleted `spNovaFlow000001`, Flows list empty, its record removed, 0 unread
email left, answers empty — « Reset complete: no demo Flow, no saved
answers, no unread demo email. » (exit 0).

## Independent reviews

- First review (standards, spec, correctness/security) after tickets 14–20:
  findings became tickets 21–23, all fixed and live-verified above.
- Second-pass review of the fixes (tickets 21–23 and the late workflow/reset
  fixes): no regression in the poll loop, credentials matching, `reviewOutdated`,
  deactivation attribution, adopt path, `sourceMoment`, the reviewed-version
  state machine, the `{noformat}` expression, the AI Trigger look-back or the
  catch-up seed. Two findings fixed at once (the user's Désactiver always
  switches off; no host fact behind URL userinfo); two minor ones left as known
  limits (`HANDOFF.md`).

## Custom n8n nodes with ChatGPT luna:max (ticket 25), 2026-10-17 19:35

App rebuilt from `1326c501d`, nodes reinstalled (`bun run install-n8n`). Each
n8n check ran in a temporary workflow, deleted afterwards.

| Check | Result |
|-------|--------|
| ScreenPipe node in n8n: search « Jira » (limit 3) → activity summary of the last hour | success: 2 items, then 1 summary item |
| AI step in n8n with the ScreenPipe tool, NovaPay card-refusal email | 200 in 5.3 s: Bug, NovaPay, Highest, back; model called twice, `Historique ScreenPipe` tool called once, no error |
| ScreenPipe AI Trigger active in n8n (every minute, default `chatgpt/gpt-5.6-luna:max`) | fired at its first poll: « L'utilisateur travaille clairement dans l'assistant IA Claude, avec un terminal également ouvert. » |
| ScreenPipe Trigger active in n8n: window `Terminal`, flow `DucCIr8YH6FdrZOZ`, keyword « automatisation » | each polled without error and set its cursor; nothing fired (no new event during the minute, by design) |
| ScreenPipe Trigger, « Fetch Test Event » path (real node code against ScreenPipe): keyword « ok », window Terminal, pipe `digital-clone`, flow NovaDesk | each returned its newest real event |
| ScreenPipe Trigger window `Terminal` active in n8n, Terminal brought to the front for 12 s (19:42:37), then Claude | first poll set the cursor (`active: false`, Claude in front); the next poll (19:43:03) fired once: execution 60, mode `trigger`, success, event `matchedAt` 19:42:37 |

## Round two live check, partial (ticket 16), 2026-10-18 08:58–09:08

App: dev build of `aced6ee30` (front built 04:43:49, binary 04:44:53) run from
`~/dev` with `SCREENPIPE_DEV_USE_PROD_DATA=1`; n8n 2.42.2 in Docker. Native app
driven by accessibility, emails sent from the Gmail connector. Stopped at the
user's request before the failure/retry, health banner, deletion, chat-built
Flow and theme checks; the demo was reset afterwards (exit 0).

| Check | Observed |
|---|---|
| `GET /automation-flows/health` | `n8n: "reachable"`, `checkedAt` from app start |
| Node search `q=shell` | Execute Command and its tool twin, both `switchedOff: true` (ticket 05) |
| Jira card | `jiraSoftwareCloudApi` `inN8n: "one"`, « NovaDesk Jira » (ticket 05) |
| Error workflow « ScreenPipe — échecs des Flows » | published, HTTP node `host.docker.internal:3030/…/failures` with the `screenpipeApi` credential (ticket 11) |
| `reset.ts` | exit 0 in 4 s, other Flows untouched |
| ⌃⌥⌘D with Finder in front | notification « Repetitive task detected » in 1.2 s (ticket 03) |
| ⌃⌥⌘D again within 90 s | not shown (dedupe); Home comes forward and opens the Task Page, but only ~9 s after the press; the toast was not seen in the accessibility tree |
| « View task » | Task Page in < 1 s: 3 repetitions with captures (4:05, 4:09, 4:12), « 0 of 2 answered », Create automation disabled until 2/2 |
| **« Create automation » (1st click)** | **failed: « This workflow changed while you were answering. Your draft is kept. Review it and save again. »** The Task Page had stayed open while the shortcut reinstalled the task. A second click created the Flow (Review Screen in 0.9 s). Demo risk: see ticket 17 of round two. |
| Created Flow in n8n | inactive, tag `screenpipe-flow`, `settings.errorWorkflow` = the error workflow, 16 nodes |
| Review Screen | summary, graph of 15 steps with one sentence each and no credential/host line (ticket 01), Learned from ×3, Activity « No email handled yet », History « Never turned on »; buttons Dismiss, Delete, Review and edit, Open in n8n, Turn on |
| « Turn on » | active in n8n in 0.7 s; History « Turned on by you » |
| Bug email « NovaCRM : la recherche de contacts… » | execution 61 started 1 s after sending, 69 s total; **NOVA-47** Bug, Highest, title « NovaCRM - La recherche de contacts ignore les noms avec accent », labels `back` + `mail-d3817198`, email quoted in a code block, unassigned; AI `confidence: high` with a reason; both ScreenPipe tools ran (tickets 08, 10) |
| Ambiguous email « Question sur les relances » | execution 62: `confidence: low`, « Sort by hand » ran, notification « Sort by hand » with From / Subject / Reason as plain text, no ticket (ticket 09) |
| Thank-you email « Merci pour votre aide » | execution 63: `type: none`, `confidence: high`, stops at « Ticket needed », no ticket |

Not checked yet: duplicate run of the same email, forced failure → notification
→ « Relancer » (11, 12), Activity rows after those runs (13), health banner
with n8n stopped and a failure missed while the app was down (14), Delete from
the list / Review Screen / chat (04), chat building a Flow step by step (06,
07), dark and light theme (02), « Open in n8n », the rehearsals.
