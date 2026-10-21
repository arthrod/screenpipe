# Demo runbook — Automation Flows (3 minutes)

Everything here was rehearsed on the demo machine on 2026-10-17; timings and
proofs are in `evidence/LIVE-CHECKS.md`.

## Before the slot (once)

1. Docker Desktop running; `docker compose -f infra/automation-flows/docker-compose.yml up -d`
   from this checkout (`~/dev/screenpipe_LH`; project `automation-flows`, volume
   `automation-flows_n8n_data`; n8n at http://localhost:5678, ScreenPipe nodes
   installed with `cd packages/n8n-nodes-screenpipe && bun run install-n8n`,
   which must print `copied to …/dev/screenpipe_LH/infra/automation-flows/custom-nodes/…`).
2. **Log into n8n in Safari** (the default browser): « Open in n8n »
   opens there, and without a session it shows n8n's sign-in page.
3. Quit the installed Screenpipe app (with « Keep search available after
   quitting » off). From macOS **Terminal**, run the dev build on the real
   profile (screen permissions come from Terminal):
   ```bash
   cd ~/dev/screenpipe_LH/apps/screenpipe-app-tauri && SCREENPIPE_DEV_USE_PROD_DATA=1 ./src-tauri/target/debug-dev/screenpipe-app
   ```
   Build it first with `bun run build:tauri:dev` (with
   `NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT=1` in
   `apps/screenpipe-app-tauri/.env.local` when the account lacks the
   `workflows` flag). Sign in; Connections → n8n holds `http://localhost:5678`
   and the n8n API key.
4. Keep the Mac awake (`caffeinate -dis &`) and the sound as you want it.
5. On the **sender** Gmail account (the phone, aandreo.4202@gmail.com), set
   Settings → General → **Undo Send: 5 seconds** (the minimum): Gmail only
   sends after that delay. Prepare the bug email from
   `.scratch/hackathon/demo-email.md` as a draft (subject and body exactly as
   written there: that text passed the 20-run AI check).
6. Set the Jira profile language to English (Profile → Language), or the
   ticket's status shows « À faire ».

## Between rehearsals (start state)

From the repo root, Bun loads `N8N_API_KEY` (n8n → Settings → n8n API) and
`SCREENPIPE_LOCAL_API_KEY` (ScreenPipe → Settings → Privacy) from the
gitignored root `.env`:

```bash
bun infra/automation-flows/demo/reset.ts   # no demo Flow, no answers
bun infra/automation-flows/demo/demo.ts --no-notify   # re-install the task (9/9 real captures)
```

Expected last line of reset: « Reset complete: no demo Flow, no saved
answers. ». No mark-read step any more: the Gmail Trigger takes read and
unread mail, and a freshly created Flow only sees mail sent after it is turned
on. The notification server drops the same alert twice within 90 s: wait 90 s
after a previous run before `demo.ts`.

## On stage

| Time | Do | Observed in rehearsals |
|---|---|---|
| 0:00 | Problem (one sentence), then press **⌃⌥⌘D** (hidden global shortcut, works with ScreenPipe in the background), or run `bun infra/automation-flows/demo/demo.ts`. Both reinstall the task (answers cleared) and fire the same notification; when it is not shown (repeat within 90 s, pause, quiet hours) a toast says why and the Task Page opens. | not rehearsed live yet (round two 16) |
| 0:10 | Click « View task » on the notification. Task Page: 3 repetitions with the real captures (4:05–4:15), « View in timeline » on a capture. | Task Page in 4–7 s |
| 0:30 | Type the 2 answers; « Create automation » unlocks only at 2/2. Click it. | Review Screen in ~10 s |
| 0:50 | Review Screen: summary, « Learned from » captures, graph with one sentence per step; « Open in n8n » (n8n in Safari) for 5 s. | |
| 1:10 | Click « Turn on ». Send the bug email from the phone (the draft). | active in < 1 s |
| 1:20 | While it works (~10–20 s after Send: 5 s Undo Send, then Gmail poll every 5 s, AI ~4 s, Jira ~1 s), show the history line « Turned on by you ». | ScreenPipe notification « Ticket NOVA-xx created » with « Open in Jira » |
| 1:45 | Click « Open in Jira »: the ticket « NovaCRM - … », Bug, High, label `back`, sections Context → Acceptance criteria, unassigned. | NOVA-58–61: 8.6–12.6 s after the send (API); live rehearsal 18 Oct 14:54: NOVA-62 at +13.6 s |
| 2:00 | Open the ScreenPipe chat (the Review Screen has no « Change it » button any more) and send: `In the Automation Flow "NovaDesk: support emails → Jira tickets", add the label auto to every Jira ticket it creates.` | Flow paused, new version with `auto` in its Jira step |
| 2:25 | Automations → Flows → NovaDesk → banner « changed since it was last on » → « Turn on ». | On re-activation the Gmail trigger re-reads the previous email once; the duplicate check stops it (no second ticket, one extra Activity row). |
| 2:40 | (If time) a second email → ticket with labels `auto` + `back`. | live rehearsal 18 Oct 15:00: NOVA-63 at +8.0 s, labels `auto` + `back` |

Total measured without narration: 105–110 s for the whole journey in
rehearsals 1–3 (`evidence/LIVE-CHECKS.md`). **Show the ticket in Jira before
starting the chat change** (row 1:45 before 2:00): a pause while an email is
being processed orphaned the run in rehearsal 3 (fixed by ticket 21; keep the
order anyway, it reads better).

## Fallback if the chat change does not finish (> 30 s)

Say what it does while it finishes, and show the result from rehearsal
instead: the Review Screen of a modified Flow shows « Needs review », the banner,
and the history lines « Paused for a change by the chat » /
« Changed by the chat » (screenshots/AX text in `evidence/LIVE-CHECKS.md`,
rehearsal 0). Then click « Turn on » on the current Flow and continue; the
Flow keeps working without the change.

## If something goes wrong

- **No ticket 30 s after the email:** a hung AI call is cut after 8 s and
  tried once more; if n8n still shows no run or a running one, keep talking
  over the Review Screen and show the Jira ticket of a previous rehearsal
  (NOVA-61).
- **A rehearsal stopped mid-typing left text in the answers:** the draft lives
  in the app's session; clear the fields by hand or relaunch the app.

## Known limits

- The Workflows view needs the PostHog `workflows` flag or the local build
  override above.
- A failed run notifies « Flow “…” failed » with « Retry »; an unsure AI
  sends « Sort by hand »; with n8n down the Flows tab says n8n is unreachable.
  None of these is rehearsed live yet (round two 16).
- Do not run the installed app and the dev build together (one DB writer).

## Email → ticket timings (18 Oct, n8n side, sent through the Gmail API, no Undo Send)

Workflow `novadesk-support-tickets.json`: Gmail Trigger (OAuth, 12 poll times
= every 5 s, read and unread, INBOX), AI step `chatgpt/gpt-5.6-luna:low`
(8 s timeout, 1 retry), no ScreenPipe tools. "Sent" is the email's Date
header (second precision); "start" is n8n's run start.

| Email | Sent (UTC) | Run start | AI step | Ticket | Notification |
|---|---|---|---|---|---|
| 1 (poll every 10 s) | 12:13:59 | +11.5 s | 4.6 s | NOVA-57 at +17.6 s | shown |
| 2 | 12:14:48 | +7.3 s | 4.1 s | NOVA-58 at +12.6 s | shown |
| 3 | 12:15:10 | +5.3 s | 4.1 s | NOVA-59 at +10.4 s | shown |
| 4 | 12:15:27 | +3.3 s | 4.4 s | NOVA-60 at +8.6 s | shown |
| 5 | 12:15:52 | +3.3 s | 4.3 s | NOVA-61 at +8.6 s | shown |

On stage add the 5 s Undo Send: expect 13–18 s from the click on Send to the
notification. The 10 s poll (email 1) was too slow for the 20 s budget.
AI step alone, 20 runs on the demo email (direct to the proxy, same prompt
and schema): 20/20 Bug, NovaCRM, high, High, `back`, every section filled,
3.3–5.5 s (median ≈ 4.0 s).
