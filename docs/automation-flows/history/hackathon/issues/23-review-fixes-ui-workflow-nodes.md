# 23: Review fixes — Review Screen, Task Page, demo workflow, n8n nodes

Spec: stories 4–5, 16–22, 30, 47–48; `docs/DESIGN.md`; AGENTS.md (Review
Screen: « View in timeline »). From the independent code review of
2026-10-17. Runs in parallel with ticket 22 (engine), which adds
`Flow.nodes[].facts: string[]`, `Flow.sourceMoment: {frameId: number | null,
timestamp: string} | null`, `by: "api"` and the codes `flow_running`,
`n8n_failed` — code against that contract (mock it in tests); ticket 22 owns
`api.ts` types, so add only what you need and expect a merge.

**What to build:**

1. **DESIGN.md compliance** (`apps/screenpipe-app-tauri/components/automation-flows/`):
   no casing forced by CSS (`uppercase` in `common.tsx` `SectionLabel` /
   `ACTION_BUTTON`): labels in sentence case (« Activer », « Voir le
   graphe », …); the « Active » status badge is not phosphor (phosphor only
   while work is running); brand spelled « Screenpipe » in user-facing copy
   of the app (Flows UI, Task Page question block in
   `packages/workflows-ui/src/workflow-questions.tsx`, the n8n connection
   description in `crates/screenpipe-connect/src/connections/n8n.rs`). n8n
   node names (« ScreenPipe Trigger ») stay as specified.
2. **Activer publishes what the user read.** The Review Screen keeps the
   `versionId` of the user's last explicit load; when a background refresh
   (ticket 18) brings another version, show the « a changé » banner and keep
   sending the old id, so the engine answers 409 and the user reloads.
3. **Facts under each step.** Render `facts` under the node's sentence in the
   read-only graph (small, muted).
4. **« Voir dans la timeline ».** On the Review Screen, when `sourceMoment` is
   set, a « Voir dans la timeline » action opens that moment (same opening path
   the Task Page evidence uses). On the Task Page, the evidence play button
   shows the visible text « Voir dans la timeline » in creation mode.
5. **Jira description cannot carry markup** (`infra/automation-flows/workflows/novadesk-support-tickets.json`,
   « Préparer le ticket »): the email body goes inside `{noformat}` with any
   `{noformat}` removed from it, HTML stripped from the `textHtml` fallback,
   and the whole description capped (e.g. 20 000 chars) so Jira never refuses
   it. Keep `bun test infra/automation-flows` in sync (add injection cases).
   Keep the review JSON in sync if its sentence changes.
6. **AI Trigger** (`packages/n8n-nodes-screenpipe/nodes/ScreenPipeAiTrigger/`):
   the look-back starts at `max(now - lookback, lastFiredAt)` so one episode
   does not fire again after the cooldown; screen text is escaped so it
   cannot close the `<activity>` delimiter.

**Blocked by:** None.

**Status:** done (live: sentence-case buttons, facts, « Voir dans la timeline », NOVA-40 with inert markup; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)
against ticket 22's contract (`facts`, `sourceMoment`); merge after or with ticket 22.

- [x] Frontend tests for 1–4; `bun x tsc --noEmit -p .` clean.
  `components/automation-flows/__tests__/flows-tab.test.tsx`: no element in the list or the Review
  Screen carries a CSS casing class, labels are sentence case; an Active Flow's status square is not
  phosphor, a running one is (Review Screen and list); a background read that brings another version
  shows « a changé depuis que vous l'avez ouvert », Activer still sends the loaded id, the 409 reload
  counts as the user's, the next click sends the new id; « Voir dans la timeline » calls
  `openTimeline(sourceMoment)`, is hidden without a moment, says when the timeline cannot open.
  `flow-graph.test.tsx`: facts listed under the sentence, none for a node without facts.
  `api.test.ts`: `openTimeline` uses `search_navigate_to_timeline` with the frame or `null`, refuses
  invalid moments, reports native errors. `components/__tests__/pipe-store-flows-tab.test.tsx`:
  re-opening the Review Screen link of the Flow on screen loads it afresh (no « a changé » banner).
  `components/workflows/demo-task-evidence.test.tsx`: on the creating Task Page the recorder-frame
  button shows the words « Voir dans la timeline » and opens frame 4242.
  `task-page-create-flow.test.tsx`: heading « Aidez Screenpipe à bien comprendre cette tâche ».
- [x] `bun test infra/automation-flows` and `cd packages/n8n-nodes-screenpipe && bun test` with the new cases.
  Workflow: the whole email sits in one `{noformat}` block it cannot close (7 closer variants incl.
  `{no{noformat}format}`, `{{{noformat}noformat}noformat}`, in from/subject/body), HTML-only email
  quoted as text (tags, `<style>`, `<script>` gone, entities decoded, decoded `&#123;noformat&#125;`
  still neutral), huge bodies/subjects capped ≤ 20 000 chars with the closing tag kept. AI Trigger:
  after a 5 min cooldown with a 15 min look-back the next check asks for `[lastFiredAt, now]` only,
  the full window comes back once the look-back has passed the firing; screen text with
  `</activity>` cannot close or reopen the block and the block still parses back to the same JSON.

Commands and results (from the worktree, base `origin/hackathon/automation-flows` 1b097784c, merged,
already up to date):

- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows components/workflows lib/workflows components/__tests__`
  → 97 files passed, 1 skipped; 1045 tests passed, 1 skipped (twice in a row). One earlier full run
  had a one-off failure of the unchanged `flow-graph.test.tsx` « offers no editing » test under
  parallel load; it passes alone (3/3) and in the two later full runs.
- `cd apps/screenpipe-app-tauri && bun x tsc --noEmit -p .` → no output (clean).
- `bun test infra/automation-flows` → 50 pass, 0 fail.
- `cd packages/n8n-nodes-screenpipe && bun test` → 45 pass, 0 fail; `bunx tsc --noEmit -p tsconfig.json` → clean.
- `cargo test -p screenpipe-connect --lib n8n` → 6 passed, 0 failed.
- The Jira description expression was also evaluated with n8n 2.42.2's own expression engine
  (`n8n-workflow` `Expression.resolveWithoutWorkflow` after `initializeGlobalContext`): plain, HTML
  and nested-closer emails render as expected with exactly two `{noformat}` tags; 1 MB bodies,
  200 000 `{`/`<`/spaces, 30 000 `<style` and 20 000 `{noformat` each take ≤ 1 ms (linear regexes,
  input sliced to 100 000 chars first).

## What was built

- **DESIGN.md** (`components/automation-flows/common.tsx`, `flow-review.tsx`, `flow-activation.tsx`,
  `flows-tab.tsx`): `ACTION_BUTTON` (uppercase + tracking) and the uppercase `SectionLabel` are gone;
  the copy was already sentence case, so buttons now read « Activer », « Désactiver », « Voir le
  graphe », « Voir la tâche », « Demander une modification », « Ajouter ». `StatusBadge` takes
  `running`: Active = filled neutral square (`foreground`), phosphor only while `lastExecution` is
  `running` (the last-run line says « en cours »). Brand « Screenpipe » in the Task Page French
  heading, the n8n connection description (`n8n.rs`), and the review copy (summary and the sentences
  of the AI model and Screenpipe tool steps; node names keep « ScreenPipe »).
- **Activer publishes what the user read**: `useFlowsLoad` ready state carries `read` (data of the
  last foreground load, or `replace(data, { read: true })`); background reads and action results
  update only `data`. `FlowActivation` sends `read.versionId`, shows « Ce Flow a changé depuis que vous
  l'avez ouvert… » while the shown version differs (and Activer is offered); its 409 reload is marked
  read. `pipe-store.tsx` remounts `FlowsTab` on every navigation so the chat's « Revoir le Flow » link
  to the Flow already on screen is an explicit load (one click at demo step 2:25, no 409 detour).
- **Facts**: `FlowNode.facts: string[]` (contract field) rendered under the sentence as a small mono
  muted list labelled « Détails fixes »; tolerates an engine that omits it. Fixture carries facts.
- **« Voir dans la timeline »**: `Flow.sourceMoment` (contract field), `flowsApi.openTimeline(moment)`
  through the new `lib/workflows/timeline.ts` (`openTimelineMoment(frameId | null, timestamp)`, the
  `search_navigate_to_timeline` handoff now shared with `desktopWorkflowsPlatform.openCapturedMoment`).
  Review Screen button (clock icon, failure message) when `sourceMoment` is set. Task Page:
  `WorkflowStepEvidence` gets `timelineLabel`; `workflows-app.tsx` computes creation mode once and
  passes « Voir dans la timeline » there, so the recorder-frame button shows the words (embedded
  demo images still have no timeline button: they are not recorder frames).
- **Jira description** (« Préparer le ticket »): a constant first line, then `{noformat}` with De /
  Date / Objet / body, then `{noformat}`. Body = `textPlain`, else `textHtml` with style/script text,
  tags and entities handled; every `{noformat…}` token removed and any rebuilt `{noformat` broken into
  `{no format`; content capped at 19 800 chars plus « […] email tronqué ». Node sentence, review
  summary and app fixture updated together.
- **AI Trigger**: automatic checks look back from `max(now − lookback, lastFiredAt)` (a test in the
  editor still uses the whole window; nothing to check when the window is empty); the activity JSON
  writes `<`/`>` as `<`/`>`. Look-back description updated.

## Notes

- Live check for the orchestrator (not done here: the Browser pane's preview only runs the main
  checkout's config, so no browser-mock screenshots): buttons now render in sentence case — drive
  them by « Activer », « Désactiver », « Activer cette version », « Demander une modification »,
  « Voir le graphe », « Voir la tâche », « Voir dans la timeline », « Ajouter » (no longer
  « ACTIVER » etc.). Check the Active square is neutral and turns phosphor while an email is being
  processed; facts and « Voir dans la timeline » appear once ticket 22's engine is merged.
- Re-import the bundled workflow (`infra/automation-flows/import-workflow.sh`) so n8n holds the new
  description expression; send an email whose body contains `{noformat}` and a link to confirm the
  Jira ticket shows it as plain text.
- Merge with ticket 22: identical `facts`/`sourceMoment` lines in `api.ts`; take ticket 22's fixture
  facts if they differ (the format of a fact string is the engine's).
