# 04: Activate and deactivate a Flow from the Review Screen

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (Flow model and status derivation in `SPEC.md`).

**What to build:** The Review Screen gets Activate and Deactivate. They switch
the n8n workflow on and off through the Flow service. Activation records the
activated version; both actions append to the activation history. The
Review Screen and the Flows list show the derived status (Draft, Active,
Paused, Needs Review), the last run from n8n's executions, and the activation
history (when, what, which version, by whom).

**Blocked by:** 02.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Flow service tests against a fake n8n: activate records the version and a history entry; deactivate adds a history entry; status derivation covers Draft, Active, Paused, Needs Review and the "edited in n8n" flag; the last execution is mapped.
- [x] Review Screen buttons call the typed client and refresh; status, last run and history render (frontend tests).
- [x] No code path activates a Flow without a user click.
- [x] Against the local n8n: activating from the app makes the workflow process a new email; deactivating stops it. Clicks on « ACTIVER » / « DÉSACTIVER » in the native app; emails became NOVA-31…35 while active; while off, an email stayed unread with no execution for 2 min (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).

## What was built

- `POST /automation-flows/:id/activate` `{versionId}`: n8n `POST /workflows/{id}/publish`
  `{versionId}` with the version shown on the Review Screen; records `reviewedVersionId`;
  logs `activated` by `user`. `409 {error: "version_changed"}` if n8n's version moved since
  the screen loaded (nothing published); `502 {error: "activation_failed", detail}` with
  n8n's message if n8n refuses. Already running that version: no call, no log.
- `POST /automation-flows/:id/deactivate`: n8n `POST /workflows/{id}/unpublish`; logs
  `deactivated` with the version that stopped running. Already off: no call, no log.
- Review Screen: "Activer" (Draft, Paused, Needs Review), "Désactiver" (Active),
  "Activer cette version" (Active and edited in n8n). History lines read
  "Activé par vous · <date> · version <8 chars>".
- Browser mock (`bun run dev:web`): activate/deactivate switch the fixture Flow in memory.

## Tests (run on `hackathon/ticket-04` after merging integration tip 1cb60fdcc)

```
cargo test -p screenpipe-engine --test automation_flows_test        # 19 passed
cargo test -p screenpipe-engine --lib automation_flows              # 3 passed
cd apps/screenpipe-app-tauri
NODE_OPTIONS=--no-experimental-webstorage bun x vitest run \
  components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx \
  components/workflows/task-page-create-flow.test.tsx lib/workflows/automation-flows.test.ts   # 52 passed
bun x tsc --noEmit                                                  # clean
```

## Pending human: last acceptance item (real n8n, Gmail, Jira)

Not run by the agent: it publishes a workflow and sends email. About 15 minutes.

Before you start:

- n8n 2.42.2 runs on `127.0.0.1:5678`, with the owner account, an API key, and the IMAP,
  Jira, OpenAI (proxy) and ScreenPipe API credentials filled in.
- ScreenPipe → Connections → n8n holds `api_url` `http://localhost:5678` and the API key.
- Ticket 13 (AI proxy tool-call ids) is merged; without it the AI step fails as soon as the
  agent calls the ScreenPipe tool.
- In the support inbox, mark every email you do not want ticketed as read: on activation the
  IMAP trigger processes the unread ones.

Steps:

1. Run the app from this branch (or the integration branch after merge):
   `cd apps/screenpipe-app-tauri && bun run dev:tauri`.
2. Open Automations → Flows → "NovaDesk : emails support → tickets Jira". If it is missing,
   create it from the Task Page ("Créer l'automatisation"). Check: status "Brouillon", and
   n8n shows the workflow not published.
3. Click "Activer". Check: status "Active"; history "Activé par vous · … · version …";
   in n8n the workflow is published.
4. From another account, send one bug-report email to the support inbox. Wait 2 minutes.
   Check: one successful execution in n8n → Executions; one new Bug ticket in Jira NOVA
   titled "Produit - résumé", email quoted, unassigned; the email is now read; reopening the
   Flow shows "Dernière exécution : … · réussie".
5. Click "Désactiver". Check: status "En pause"; history adds "Désactivé par vous";
   n8n shows the workflow not published.
6. Send a second bug-report email. Wait 3 minutes. Check: no new execution in n8n, no new
   Jira ticket, the email stays unread.
7. Clean up: delete the test Jira ticket(s); mark the second email read (or delete it) so
   the demo does not ticket it on the next activation.

Record here: date, version shown in the history, n8n execution id, Jira key, and whether
step 6 stayed silent.
