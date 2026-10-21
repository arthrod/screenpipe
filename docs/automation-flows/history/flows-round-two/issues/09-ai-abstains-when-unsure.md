# 09: AI abstains when unsure (D18)

**What to build:** When the AI's confidence is low, the demo Flow creates no ticket and sends a ScreenPipe notification « À trier à la main » with the email's sender, subject and the AI's reason.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 08

**Status:** done, live check pending: an ambiguous email produces the notification and no ticket (see below)

- [x] Low confidence takes a branch that creates no ticket.
- [x] That branch posts a notification to ScreenPipe's notify server with sender, subject and reason.
- [x] The workflow contract test covers the branch.
- [ ] An ambiguous email produces the notification and no ticket (live, noted).

## What changed

`infra/automation-flows/workflows/novadesk-support-tickets.json`:

- « Format de la réponse » gains a required `reason` (string, 1 to 200
  chars); the instruction gains one line « reason : une phrase qui explique
  ton choix, surtout ton hésitation. » (9 lines). Ticket 13 (Activity) can
  read the same field for every outcome.
- New IF « Confiance suffisante » right after the agent: only
  `confidence` equal to `high` (case-sensitive, strict) goes on to « Ticket
  nécessaire »; anything else (low, missing, `High`) is unsure.
- New HTTP Request « À trier à la main » on the false branch, connected to
  nothing after it: `POST http://host.docker.internal:11435/notify` with the
  header `Host: localhost:11435`. The notify server (src-tauri `server.rs`)
  answers 403 to any non-local Host (DNS-rebinding guard); checked from the
  running container with a read-only GET `/notifications`: default Host 403,
  `Host: localhost:11435` 200. Port 11435 = the dev build run with
  `SCREENPIPE_DEV_USE_PROD_DATA=1` (same as `demo.ts`); an isolated dev build
  listens on 11535.
- Payload: `id` `automation-flow:spNovaFlow000001:abstained:<execution id>`
  (the server drops a repeated id, so n8n retries never duplicate it), title
  « À trier à la main », body « L'IA n'est pas sûre d'elle : aucun ticket n'a
  été créé, triez cet email vous-même. » then `De :`, `Objet :`, `Raison :`
  paragraphs, `type: pipe`, `priority: high`, `transient: false` (stays in
  the bell). Each field is collapsed to one line, cut at 200 chars and
  Markdown-escaped: the notification renders Markdown with clickable links,
  so an email could otherwise put a link in it. No action button: the Review
  Screen deeplink from a notification is ticket 11's work.
- The node retries 3 times (2 s apart) and does not swallow errors: if
  ScreenPipe stays down, the run fails (visible to tickets 11/14) rather than
  dropping the email silently.
- Review summary, node notes (agent, parser, two new nodes) and the
  browser-mock fixture match.

## Live check (ticket 16)

1. Import and activate the demo Flow, send an ambiguous email to the support
   inbox (e.g. « Bonjour, depuis hier je ne comprends plus comment marchent
   les relances, c'est normal ? »).
2. Expect no NOVA ticket and the ScreenPipe notification « À trier à la
   main » with the sender, the subject and the AI's reason, shown as plain
   text. In the n8n execution: the agent output has `confidence: low` and a
   `reason`, the false branch of « Confiance suffisante » ran, « À trier à la
   main » got `success: true`.
3. If the notification is missing: check the request reached the app (n8n
   execution output), the 403 Host guard (n8n must keep the `Host` header),
   and the app's port (11435 vs 11535).
4. A clear bug email still creates its ticket (confidence high).

## Tests run

After `git merge main` into `ticket-09`:

- `bun test infra/automation-flows/workflows` → 25 pass, 0 fail (4 new: unsure gate, notification request, Markdown escaping, huge/empty email; field-list and closed-answer tests extended)
- `bun test infra/automation-flows` → 64 pass, 0 fail
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bunx vitest run components/automation-flows` → 3 files, 84 passed (fixture-vs-bundled-workflow drift test included)
- `cargo test -p screenpipe-engine --lib flow_checks` → 9 passed (incl. `the_demo_workflow_passes_untouched`)
- `cargo test -p screenpipe-engine --test automation_flows_test` → 69 passed
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 3 passed
