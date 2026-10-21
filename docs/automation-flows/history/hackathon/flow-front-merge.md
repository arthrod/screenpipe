# Flow front merge (branch `hackathon/flow-front`)

Decisions of 2026-10-17 for putting the dev-branch front (archived on
`origin/dev`) onto `main`'s Automation Flows. `main`'s architecture stays: the
engine `/automation-flows/*` routes, the inline n8n graph with one sentence
per node, the activation history, the Task Page questions. This branch was
merged into `main` on 2026-10-18.

## Where the review happens (2026-10-17, round 3)

- **Workflows → Task Page is the review.** The questions the AI could not
  settle are answered there, each with suggested answers (choices from the
  task, `openQuestionChoices`) above a free-text answer that stays. "Create
  automation" is the only confirm action (also on Enter): it saves the
  answers, creates the Flow switched off and opens its Review Screen. Once
  the Flow exists, the Task Page says so and offers "Open automation"
  (remembered per task on this device, checked against the Flow service).
- **Automations → Flows is for looking and switching.** Summary, "Learned
  from", the graph with its sentences, history; Dismiss, Open in n8n, Turn on /
  Pause, Restore. No review notices (« needs review », « changed since you
  opened it »), no Change it: a Flow changed elsewhere shows as Paused and
  Turn on switches on the version n8n holds.
- Merged into `main` on 2026-10-18 at the user's request. Main's round-two
  UI (Delete, Retry, Activity, health banner) is ported into this layout in
  English; the graph lays out main's branching demo workflow (Sort by hand
  above, the Jira retry loop below).

## Language and design

- Everything the user sees is in English: the Flows screens, the Task Page
  creation copy, the chat prompts, the engine's fact lines, the demo task,
  notification, Flow name, node names and sentences, and the summary.
- The AI instructions of the n8n workflow stay as they are, French vocabulary
  included (the AI answers « Tâche » for an idea). The ticket must match the
  Jira project, whose issue types are English: « Prepare the ticket » turns
  « Tâche » into « Task » (Jira refuses « Tâche »).
  Re-import the workflow (`infra/automation-flows/import-workflow.sh`) after
  pulling this branch.
- `docs/DESIGN.md` applies: sentence-case buttons (mono), square bordered
  boxes, errors inline (no toasts).

## Flows list

- Tab "Flows". Subtitle: "Automations screenpipe built from work you repeat.
  Nothing runs until you turn it on."
- Grouped by status with counts: Needs review, Not on yet, On, Paused,
  Dismissed (last, with Restore on the row). Rows show the name, the last
  run and the status square only (the group names the status), and a chevron.
- "New Flow" (was « Ajouter ») opens the chat to create a Flow.

## Status words

draft → "Not on yet", active → "On", paused → "Paused", needs_review →
"Needs review", dismissed → "Dismissed".

## Review screen, top to bottom

1. Sticky header: name; status and last run; Dismiss (when not on) · Turn on
   / Pause (Restore when dismissed).
2. Banners: needs review, changed since opened, edited in n8n, errors.
3. What this Flow does: a short summary (at most 3 sentences).
4. Learned from: one card per repetition of the source task, with its
   captures as a strip (email → form → ticket), its date, apps and title;
   "View task" next to the heading. A capture opens large in a dialog, with
   "View in timeline" for recorder frames only (embedded demo images come
   from another machine's recording).
5. How it works: the inline graph (node name, sentence and fixed details; no
   n8n node type), then "Edit it in n8n" as a small link.
6. "Something wrong, or a better way?": "Change it" opens the chat, the human
   writes the fix, the Flow pauses and comes back as Needs review.
7. History, newest first: "Turned on by you · Sat, Oct 17, 10:35" (no version
   id).

Dropped from the dev branch: questions on the review screen (they stay on the
Task Page, free text), Change answers, the ready line and replay score, the
local history store, the test-notification and reset buttons (use
`infra/automation-flows/demo/demo.ts` and `reset.ts`), the
`screenpipe://automation-flow` deeplink.

## Dismiss

- Engine: a `dismissed` flag on the Flow record, `POST
  /automation-flows/:id/dismiss` and `/restore`, status `dismissed` while set.
  An active Flow must be paused first (409 `flow_active`). Logged in the
  activation history as `dismissed` / `restored`, by the user.
- Restore returns the Flow to the status it would have without the flag.

## Next steps

1. The user tests the front in the browser and sends tweaks.
2. Three commits on `hackathon/flow-front` (engine Dismiss; English content;
   front rework), then push.
3. The teammate who runs the demo (his machine has the recordings, n8n and
   Rust) runs the engine tests, re-imports the workflow and rehearses.
4. PR into `main`, reviewed by a teammate.
5. Polish: loading and error states, light/dark, keyboard.
6. Later: answer pills on the Task Page, rules in a new form.
