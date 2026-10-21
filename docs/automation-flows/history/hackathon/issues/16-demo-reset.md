# 16: Demo reset restores the start state

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (story 50); ticket 12 ("Reset between rehearsals restores the start state (no leftover Flow, answers or unread demo emails)").

**What to build:** `bun infra/automation-flows/demo/reset.ts` (today it only
clears the saved answers) brings the demo machine back to the state before the
first click, so rehearsals can repeat:

- every Flow created from the demo task (`sourceTaskId`
  `wf-novadesk-support-tickets` in `<data dir>/automation-flows.json`) and the
  pre-imported copy (fixed id in the bundled workflow) is switched off and
  deleted in n8n, and its local record removed, so the Flows list is empty and
  "Créer l'automatisation" creates the Flow again;
- the Task Page answers are cleared (existing behavior);
- unread messages in the demo inbox are marked read, so the next activation
  only processes the email sent live. Use the IMAP credential already stored
  in n8n (`spNovaImap000001`) from inside the n8n container; never print,
  log or keep a secret outside a temporary file that is removed.

It prints what it did and fails loudly (non-zero exit) on anything it could
not restore. Workflows that are not demo Flows are never touched. The n8n API
key comes from ScreenPipe's n8n connection or an environment variable; never
from the repo.

**Blocked by:** None (can start immediately).

**Status:** done (merged; live-verified on the demo machine 2026-10-17)

- [x] Tests against fake n8n / ScreenPipe servers: demo Flows are switched off then deleted and their records removed; other workflows untouched; answers cleared; a failure exits non-zero with the reason.
- [x] On the demo machine (agent-verified by the orchestrator): after a full rehearsal, reset leaves an empty Flows list, empty answers and zero unread demo emails, and the next "Créer l'automatisation" works. Live run: `spNovaFlow000001` switched off, archived, deleted; record removed; 0 unread; exit 0 (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`; re-creation re-checked in the ticket 12 rehearsals).

## What was built

- `infra/automation-flows/demo/reset.ts`: `resetDemo(options)` plus the CLI.
  Each step runs even when an earlier one fails; every failure is printed
  (`FAILED …`) and the CLI exits 1 with the list.
  - n8n (public API, `X-N8N-API-KEY`): probes the API, then for every record
    with `sourceTaskId` `wf-novadesk-support-tickets` in
    `<data dir>/automation-flows.json` and for the bundled workflow's fixed id
    (`spNovaFlow000001`, read from `workflows/novadesk-support-tickets.json`):
    `unpublish` if active → `DELETE` → if n8n refuses, `archive` then
    `DELETE` → `GET` must answer 404. A record id that is not an n8n id is
    refused (same rule as the engine). Then names any other Flow still tagged
    `screenpipe-flow` (never touched).
  - Records: removes only the records whose workflow is gone (same JSON
    format, atomic replace); an unreadable store is reported and left as is.
  - Inbox: `docker exec -e N8N_RUNNERS_BROKER_PORT=5690 -e CRED_ID=… -e MAILBOX=… <container> sh -c <mark-read.sh>`.
    The credential id and mailbox come from the workflow's IMAP trigger.
    Fails if any unread email is left.
  - Answers: `clearAnswers` (unchanged behavior; no catalog → failure).
- `infra/automation-flows/demo/mark-read.sh` (runs inside the n8n container):
  `n8n export:credentials --id --decrypted` into a `mktemp -d` dir (umask
  077, removed by an EXIT trap; node also deletes the file as soon as it is
  read), then n8n's own `imapflow` (port 993 / TLS when absent) marks every
  `UNSEEN` message `\Seen` and prints `{"marked":n,"unread":n}`. Never prints
  the credential; 60 s IMAP timeout.
- API key: `N8N_API_KEY`, else ScreenPipe's n8n connection when saved in the
  legacy `<data dir>/connections.json`. The app normally keeps it in its
  encrypted secret store, which the script does not read, so the presenter
  exports `N8N_API_KEY`. Never printed (tested).

## Tests

`bun test infra/automation-flows` → 39 pass, 0 fail (3 files). Reset tests:
`bun test infra/automation-flows/demo/reset.test.ts` → 17 pass: a fake n8n
2.x server (Bun.serve; refuses deleting an active or non-archived workflow),
temp data/catalog dirs, an injected command runner; `mark-read.sh` run
locally with a fake `n8n` CLI and a fake `imapflow` module; the CLI run as a
subprocess with a fake `docker` on PATH that executes the container command
locally. Not run against the real n8n, Docker or Gmail.

## Live command (presenter, from the repo root, after each rehearsal)

```sh
printf 'n8n API key: '; read -rs N8N_API_KEY; echo; export N8N_API_KEY
bun infra/automation-flows/demo/reset.ts
```

Optional env: `N8N_API_URL` (default `http://localhost:5678`),
`N8N_CONTAINER` (default `automation-flows-n8n-1`), `SCREENPIPE_DATA_DIR`
(default `~/.screenpipe`, the data dir of the dev build run with
`SCREENPIPE_DEV_USE_PROD_DATA=1`), `SCREENPIPE_WORKFLOWS_DIR` (same default
as `demo.ts`). Then `bun infra/automation-flows/demo/demo.ts` starts the next
rehearsal. Expected last line: `Reset complete: no demo Flow, no saved
answers, no unread demo email.`
