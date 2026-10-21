# 10: Duplicate-safe ticket creation (D20)

**What to build:** Every ticket carries the label `mail-<first 8 hex of a hash of the email's Message-ID>`, and the demo Flow searches Jira for that label before creating; when a ticket already exists it skips creation and the run succeeds.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** 08

**Status:** done, live check pending: the same email run twice gives one ticket, and a failed creation goes back through the search (see below)

- [x] The label is computed from the Message-ID and set on every ticket.
- [x] A JQL search runs before creation; a hit skips creation and ends the run successfully.
- [x] The workflow contract test covers both paths.
- [ ] Running the same email twice creates one ticket (live, noted).

## What changed

`infra/automation-flows/workflows/novadesk-support-tickets.json`:

- Label: `mail-` + FNV-1a 32-bit of the trimmed `metadata['message-id']`
  (n8n's IMAP "simple" item puts every header except cc/date/from/subject/to
  under `metadata`, lowercased; read in the 2.42.2 container's
  `EmailReadImap/v2/utils.js`). An email without a Message-ID hashes
  `from|date|subject` instead, so it never shares the label of every other
  email that has none. The hash is plain JS (`Math.imul`, `reduce`), so the
  test's evaluator and n8n agree. The same expression appears in the search
  and in the create body, and the test checks that both give the same label.
- « Ticket nécessaire » → **« Chercher le ticket de cet email »** (HTTP,
  `POST /rest/api/3/search/jql`, `project = NOVA AND labels = "mail-…"`,
  `maxResults: 1`, Jira credential, retries 3×, no `onError`) →
  **« Ticket déjà créé ? »** (IF `($json.issues ?? []).length > 0`): yes →
  nothing (the run ends with no error); no → « Créer le ticket Jira ». A Jira
  answer with no `issues` list counts as "not found", so the email is never
  dropped.
- « Créer le ticket Jira » now reads the AI's fields from
  `$("Analyser l'email (IA)").item.json.output` (its input is the search
  answer) and adds the `mail-` label next to `back`/`front`.
- **Retry safety, beyond the ticket text.** n8n's Retry pops the failed
  node's run and runs *that node* again with the same input
  (`execution.service.js`, 2.42.2). With only a search before creation, a
  create that timed out after Jira saved the ticket would be resent blindly
  on Retry, which is the case D20 is meant to prevent. So the create node has
  `onError: continueErrorOutput` and no `retryOnFail`. Its error output goes
  to **« Création à vérifier »** (IF `$runIndex < 2`), which loops back to the
  search: a ticket Jira did create ends the run, otherwise it is created
  again. After the third refusal, **« Création refusée par Jira »** (Stop and
  Error) fails the run with Jira's reason (`$json.error.message`, or the
  plain-text `$json.error` when n8n could not build the request). If Jira
  stays down, the run fails on the search step, so a Retry of that run is
  safe.
- Review summary (1 184 chars, under the 1 200 limit), node notes and the
  browser-mock fixture (`components/automation-flows/fixtures.ts`: nodes,
  positions, edges) match.

Expressions checked with the real `n8n-workflow` 2.42.2 `vm` expression
engine (n8n's default; scratch script loading the main checkout's
`packages/n8n-nodes-screenpipe/node_modules/n8n-workflow`): "foobar" →
`mail-bf9cf968` (FNV-1a test vector) in both the JQL and the ticket labels,
the gate gives 1/0, `$runIndex`, and the Stop and Error message for an object
error, a string error, and no error.

## For ticket 12 (Retry)

- A run that failed on « Chercher le ticket de cet email » (Jira down) is safe
  to retry.
- A run that failed on « Création refusée par Jira » means Jira refused the
  ticket three times. A Retry runs the Stop and Error again and fails again,
  so that email needs a fix and a new run, or a ticket made by hand.

## Live check (ticket 16)

1. Import and activate the demo Flow, send a bug email: the NOVA ticket has
   labels `back`/`front` **and** `mail-<8 hex>`.
2. Mark that email unread again in Gmail (or deactivate and activate the Flow
   so the IMAP catch-up picks it up): the second run ends successfully after
   « Ticket déjà créé ? » (true branch), and there is still one ticket.
3. In the n8n execution, « Créer le ticket Jira » resolved
   `$("Analyser l'email (IA)").item` through the search and the IF (paired
   items).
4. Optional: point « Créer le ticket Jira » at a wrong path (e.g.
   `/rest/api/3/issueX`) in a copy: three create attempts, two re-searches,
   then the run fails on « Création refusée par Jira » with Jira's 404
   reason. This also checks that `$('…').item` resolves on the loop's second
   pass.
5. Known limit: Jira's search index can lag a second or two behind a create.
   A create that timed out *and* is not yet indexed could still be created
   twice in the loop.

## Tests run

After `git merge main` (ticket 06/07 included) into `ticket-10`:

- `bun test --env-file=/dev/null infra/automation-flows/workflows` → 30 pass, 0 fail (5 new: label from the Message-ID, label without a Message-ID, search before creating, existing ticket ends the run, failed creation re-checked then stopped; Jira body, summary and node-version tests updated)
- `bun test --env-file=/dev/null infra/automation-flows` → 68 pass, 1 fail. The failure is `n8n-catalog.test.ts` « ScreenPipe n8n nodes … »: `Cannot find package 'n8n-workflow'` because the worktree has no `packages/n8n-nodes-screenpipe/node_modules`. Environmental, and that package is untouched here.
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bunx --env-file=/dev/null vitest run components/automation-flows` → 3 files, 85 passed (fixture-vs-bundled-workflow drift test included). Run 3 times; a first cold run once failed `flow-graph.test.tsx` « lets the reviewer zoom… » and passed on every rerun.
- `cargo test -p screenpipe-engine --lib flow_checks` → 9 passed (incl. `the_demo_workflow_passes_untouched`)
- `cargo test -p screenpipe-engine --test automation_flows_test` → 83 passed
- `cargo test -p screenpipe-core --lib automation_flows` → 6 passed
- Scratch check, not committed: the label, JQL, gate, `$runIndex` and Stop and Error expressions evaluated with `n8n-workflow` 2.42.2's `vm` engine (results above).

Environment note: in the main checkout, some files of
`apps/screenpipe-app-tauri/node_modules` are evicted by iCloud Drive
(`ls -lO` shows `compressed,dataless`, e.g. `chai/lib/chai/core/assertions.js`
reads empty), so vitest there fails on every file with `fn is not a
function`. The runs above use a fresh `bun install --frozen-lockfile
--ignore-scripts` in this worktree.
