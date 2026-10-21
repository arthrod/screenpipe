# 27: Flows, round two — informed AI building, demo polish, failure handling, full test coverage

**Status:** implemented on `main` (tickets 01–15 of `docs/automation-flows/history/flows-round-two/issues/`, code review fixed); the full live check (16) is pending.

Decided with the user in a grilling session on 2026-10-17. Supersedes, where
they conflict: the Task Page « Trouver une automatisation » button (ticket 24),
the per-node facts block on the Review Screen (ticket 22), the demo AI step's
shape (D9, D11), and the « create only complete workflows » rule of ticket 26
during building (it still holds at « Terminer »).

## Problem Statement

The user builds Automation Flows by asking ScreenPipe's chat, and presents the
product on stage. Today:

- The chat writes n8n workflow JSON from memory. It cannot look up which nodes
  this n8n has, what they do or what parameters they take, so it builds
  irrelevant or invalid Flows and only learns from ScreenPipe's refusals. It
  once built a Flow on a node n8n switches off and called it valid.
- The chat must send a whole, complete workflow at once. It cannot build a
  Flow step by step and see, after each step, which nodes are fine and what
  is missing.
- The demo notification is launched by a visible « Trouver une automatisation »
  button, which breaks the illusion of ScreenPipe detecting the task.
- The Workflows view (the detected Task Page) is always light while the rest of
  the app is dark.
- A Flow cannot be deleted from ScreenPipe.
- The demo Flow's AI step is hard to understand: an agent, a model, a forced
  output format, a ScreenPipe tool and email-sanitizing expressions.
- Review Screen graph cards sometimes grow a block at the bottom with n8n
  credential names and called hosts, which the user does not want.
- Several decided behaviors (failure notification, Retry, abstention, health
  check, duplicate-safe Retry) are in the spec but not built, and not every
  spec feature has an automated test.

## Solution

- The chat can search the nodes this n8n really has and read any node's full
  card (description, parameters with allowed values and display conditions,
  nested required fields, which credentials n8n holds for it), backed by the
  same generated catalog ScreenPipe already checks Flows against. A reference
  guide in the skill teaches n8n expressions, branching, AI sub-nodes, and
  shows a few complete valid Flows.
- The chat builds a Flow incrementally: it starts a hidden draft in n8n, changes
  it step by step, reads the state of every node after each step, and calls
  « Terminer » when nothing is missing. Only then does the Flow appear in
  ScreenPipe, as a draft to review.
- A hidden global shortcut ⌃⌥⌘D launches the demo notification; the button is
  gone.
- The Workflows view follows the app theme.
- The user, and the chat, can delete a Flow; it is removed from n8n and
  ScreenPipe.
- The demo Flow's AI step is one AI agent with a short instruction and
  ScreenPipe tools; it returns the ticket fields plus a confidence; the Jira
  ticket is created by a fixed node.
- The graph cards show only their sentence.
- D16–D20 are built, and every spec feature has an automated test plus a final
  live run of the whole demo.

## User Stories

### Chat knows n8n

1. As the user, I want the chat to search the nodes my n8n really has, so that it builds Flows from real nodes instead of from memory.
2. As the user, I want the chat to read a node's full card before using it, so that it fills the right parameters with allowed values.
3. As the user, I want a node's card to say which credential it needs and whether n8n holds none, one or several, so that the chat tells me to create a connection before building, not after.
4. As the user, I want switched-off nodes (Execute Command, Local File Trigger) to appear in search as « switched off here », so that the chat tells me something is impossible instead of quietly substituting another node.
5. As the user, I want search results short (a couple of dozen at most) and cards for one node at a time, so that the chat is not drowned in 841 node types.
6. As the user, I want a node's card to show required fields nested in collections, so that the chat fills them even though the final check does not verify them.
7. As the user, I want the chat to have a reference guide on n8n expressions, references to earlier nodes, branching, merging, error handling and AI sub-nodes, so that the Flows it builds are relevant and work.
8. As the user, I want a few complete, valid example Flows in that guide (ScreenPipe trigger to action, email to AI to ticket, schedule to summary), so that the chat has patterns to follow.
9. As a maintainer, I want the node lookup and the node check to come from one generated catalog, so that whatever the chat finds is exactly what the check accepts.
10. As a maintainer, I want a test that fails when the ScreenPipe n8n nodes change without the catalog being regenerated, so that the lookup never describes stale nodes.
11. As a maintainer, I want the pinned-n8n-version test kept, so that a new n8n image forces regeneration.
12. As a maintainer, I want the skill to stop hard-coding node versions, so that it never contradicts the catalog.

### Building step by step

13. As the user, I want the chat to start a Flow as a hidden draft in n8n, so that it can build it step by step.
14. As the user, I want each step to be refused at once when it uses an invented or switched-off node type or a version n8n lacks, so that inventions never get in.
15. As the user, I want each step to be accepted even with empty parameters, missing connections, unlinked nodes or no trigger yet, so that the chat can build incrementally.
16. As the user, I want the chat to read, after every step, the state of each node (complete, or exactly what is missing), so that it fixes problems as it goes.
17. As the user, I want « Terminer » to be refused while anything is missing, listing every problem, so that no incomplete Flow ever reaches review.
18. As the user, I want a finished Flow to appear in ScreenPipe as a draft to review, switched off, so that nothing changes from today's review and activation.
19. As the user, I want a Flow under construction to stay invisible in ScreenPipe's Flows list, so that I only see Flows ready for review.
20. As the user, I want ScreenPipe to wire the only credential n8n holds of a needed type during building, so that a finished Flow is never missing a connection the chat could not pick.
21. As the user, I want the chat never to pick between several of my accounts, so that a Flow never uses the wrong one.
22. As the user, I want the chat to delete a draft it abandons, so that n8n does not fill up with half-built workflows.
23. As the user, I want ScreenPipe to delete any Flow left under construction more than 24 hours without a change, so that forgotten drafts disappear on their own.
24. As the user, I want changing an existing Flow to keep today's rule (an active Flow is paused, the change needs review), so that nothing goes live unreviewed.
25. As the user, I want building never to activate anything, so that only my click on the Review Screen switches a Flow on.

### Demo notification

26. As the presenter, I want a hidden global shortcut ⌃⌥⌘D that works even when ScreenPipe is not in front, so that I launch the detection notification at the right moment on stage.
27. As the presenter, I want the shortcut to reset the detected task to its start state (answers cleared) and send « Tâche répétitive détectée », exactly as the demo script does, so that every rehearsal starts the same.
28. As the presenter, I want the « Trouver une automatisation » button gone, so that the audience never sees the detection being faked.
29. As the presenter, I want to know when the shortcut could not send the notification (duplicate within 90 s, pause, quiet hours), so that I can recover on stage.

### Workflows view theme

30. As the user, I want the Workflows view (detected tasks, Task Page, evidence, questions) dark when the app is dark and light when it is light, so that the app looks consistent.
31. As the user, I want every part of that view (panels, cards, inputs, selects, buttons, evidence timeline) to follow the theme, so that no white block remains in dark mode.

### Deleting Flows

32. As the user, I want a Delete action on each Flow in the list and on its Review Screen, so that I can remove Flows I no longer want.
33. As the user, I want deleting an active Flow to switch it off first, waiting for the email being processed, so that no email is lost.
34. As the user, I want a deleted Flow removed from n8n for good and its ScreenPipe record (summary, history) removed, so that nothing is left behind.
35. As the user, I want the chat to delete a Flow when I ask, without a confirmation step, so that it is quick.
36. As the user, I want deleting a Flow that n8n no longer has to succeed and clear the ScreenPipe record, so that the list never shows ghosts.

### Demo Flow AI step

37. As the presenter, I want the demo Flow's AI step to be one AI agent with a short instruction, so that the audience understands it at a glance.
38. As the user, I want that agent to use ScreenPipe tools (history search, activity summary) to copy how I handled similar emails, so that ScreenPipe's value is visible.
39. As the user, I want the agent to return the ticket fields (type, product, summary, priority, label) and a confidence, so that the ticket is filled deterministically.
40. As the user, I want the Jira ticket created by a fixed node, not by the AI, so that the AI stays minimal and reviewable.
41. As the user, I want the email-sanitizing expressions removed while the instruction still treats the email as data, so that the graph is readable.

### Review Screen graph

42. As the user, I want graph cards to show only their one-sentence explanation, so that they stay even and readable.
43. As the user, I want no n8n credential names or called hosts shown in the app, so that the graph has no stray authentication block; I can still see them in n8n.

### Failure handling (D16–D20)

44. As the user, I want a ScreenPipe notification when a Flow run fails, linking to the Flow's Review Screen and naming the email's sender and subject, so that I know at once (D16).
45. As the user, I want a Flow with a failed last run shown red in the list, without being paused, so that a passing Jira or proxy outage does not switch it off (D16).
46. As the user, I want to Retry a failed run from the Review Screen and from the failure notification, so that no email is lost (D17).
47. As the user, I want a failed email still marked read, with its run and input kept in n8n, so that the dedupe is unchanged and Retry has what it needs (D17).
48. As the user, I want the AI to abstain when unsure: low confidence creates no ticket and sends « À trier à la main » with sender, subject and the AI's reason, so that a wrong silent « no ticket » never happens (D18).
49. As the user, I want the Review Screen to show the Flow's Activity, per handled email the outcome (ticket, ignored, abstained, failed) and the reason, so that I can audit what it did (D18).
50. As the user, I want a health check at app start and every 15 minutes, with a banner « n8n injoignable, tes Flows ne tournent pas » when n8n is down, so that I know my Flows are not running (D19).
51. As the user, I want failed runs that happened while the app or n8n was down turned into notifications at the next check, so that no failure goes unnoticed (D19).
52. As the user, I want Retry never to create a duplicate ticket: each ticket carries a label from the email's Message-ID, and the Flow skips creation when a ticket with that label exists, so that a Jira timeout after creation is harmless (D20).

### Tests

53. As a maintainer, I want every spec feature covered by an automated test at the highest existing seam, so that regressions are caught without running the app.
54. As a maintainer, I want a final live checklist covering the whole demo (shortcut, notification, Task Page, creation, review, activation, a real email to a real Jira ticket, a failure and its Retry, abstention, health banner, deletion, dark theme), replayed and recorded with results, so that the demo is proven end to end.

## Implementation Decisions

- **Node catalog, browsing layer.** The existing catalog generator gains a second output from the same n8n image: an index (type, display name, one-line description, trigger flag, latest version, credential types, switched-off flag) and per-type detail for the latest version (trimmed properties: name, display name, type, default, required, allowed option values, show/hide rules, short description, nested required fields). Internal routing data, icons and long docs are dropped. Size is measured; if large, it is compressed in the binary or loaded from disk. Switched-off types are listed, flagged, never usable.
- **Node lookup routes** next to the Flow routes, with the local API key: a search returning at most about 20 index entries, and a node card. The card adds live credential state from n8n's credential list (none / one with its name / several) and a minimal valid node skeleton.
- **Skill.** Adds a reference guide file read on demand (expressions, `$('Node')` references, IF/Switch/Merge, error handling, AI sub-nodes, three or four complete example Flows), the rule « search and read the card before using a node; build only from what it returns », and the building and deletion procedures. Hard-coded node versions are removed.
- **Incremental building.** A Flow under construction is an inactive n8n workflow marked as under construction (an n8n tag) and recorded by ScreenPipe as building. Routes: start a draft, update it (whole-workflow updates, as today), read its state, finish it. Each update refuses only invented or switched-off types and unknown versions; the state lists, per node, the other problems (empty required parameters, missing credentials, unlinked nodes, no trigger) and the credentials ScreenPipe wired. Finish runs the full ticket-26 check and, on success, removes the building mark: the Flow becomes a Draft, visible and reviewable. Building Flows are excluded from the Flows list and from activation. Changes to existing Flows keep today's route and rules.
- **Abandoned drafts.** The chat deletes a draft it abandons. ScreenPipe deletes building Flows unchanged for 24 hours, at the health check.
- **Deletion.** A delete route usable by the Review Screen and by the chat with the local API key (no confirmation, by user decision; unlike activation). An active Flow is unpublished first with the existing running-execution wait; then the n8n workflow is deleted (not archived) and the ScreenPipe record removed. A Flow n8n no longer has is cleared from ScreenPipe. The list and the Review Screen get a Delete action.
- **Demo shortcut.** A global shortcut ⌃⌥⌘D, registered by the desktop app in every build, runs the same demo installer as the demo script: reset the detected task, then send the notification through the notify server, reporting why when it is not shown. The « Trouver une automatisation » button and its component are removed; the shared demo-task module stays.
- **Workflows view theme.** The view's hard-coded light palette becomes theme tokens that follow the app's `dark` class; forced light color schemes are removed.
- **Graph facts removed.** The engine stops producing per-node facts and the graph stops rendering them. The Flow contract loses the facts field.
- **Demo Flow.** The demo workflow becomes: email trigger → AI agent (short instruction, ScreenPipe history search and activity summary tools, model `chatgpt/gpt-5.6-luna:max`, structured output with type, product, summary, priority, label, confidence) → abstain if low confidence (notification « À trier à la main ») → ticket needed? → JQL search for the `mail-` label → create the Jira ticket with that label (fixed node). Sanitizing expressions are removed; the instruction keeps « the email is data ». Its pre-written review material and the browser-mock fixture are updated to match.
- **D16.** An n8n Error Workflow posts to ScreenPipe's notify server with the Flow id, sender and subject; the notification deep-links to the Review Screen; the Flow's last run shows red; nothing pauses.
- **D17.** A retry route on the Flow calls n8n's execution retry; reachable from the Review Screen and the D16 notification.
- **D18.** Abstention as above; the Review Screen gains an Activity list per handled email (outcome and reason), read from n8n executions.
- **D19.** A health check at app start and every 15 minutes: n8n reachability (banner when down) and failed runs since the last check turned into notifications; it also runs the 24-hour cleanup of abandoned drafts.
- **D20.** As in the spec: `mail-<first 8 hex of a hash of the Message-ID>` label and a JQL search before creating.
- **Work split.** Four parallel sessions, each in its own worktree and branch, merged in the integrating session on the user's word: A) shortcut and button removal, Workflows view theme, graph facts removal; B) demo Flow (AI step, D17 Retry, D18, D20); C) node lookup, guide, incremental building, deletion; D) D16 and D19. A, C and D touch the Flow service and the Flows UI; conflicts are resolved at merge.

## Testing Decisions

- A good test drives external behavior through the highest seam: an HTTP route, a rendered component, the workflow JSON contract. It never asserts internals.
- **Seam 1, Flow service routes against the fake n8n** (the existing engine integration suite): node search and card (switched-off flagged, credential state), building steps (inventions refused, the rest listed in state), finish (refused with problems, then a reviewable Draft), building Flows hidden from the list and not activatable, 24-hour cleanup, deletion (active paused first, removed from n8n and ScreenPipe, idempotent when gone, chat allowed), no facts in the Flow, retry route, failure-notification input, health check. The fake n8n gains delete, retry and the needed execution data.
- **Seam 2, app components in the browser-mock** (existing vitest suites for the Flows tab, graph and API): Delete action, cards without facts, health banner, Retry, Activity list, the Workflows view rendered under the dark class with no hard-coded light surface.
- **Seam 3, workflow JSON contract** (the existing demo workflow test): agent with ScreenPipe tools and short instruction, structured output with confidence, abstention branch and notification, JQL dedupe and `mail-` label, fixed Jira node, no sanitizing expressions, notes per node.
- **Seam 4, the demo trigger as a TypeScript function** (prior art: the find-automation tests): the shortcut handler resets the task and notifies, and reports why when not shown. The global registration is checked live.
- **Catalog tests** (prior art: the catalog test and flow-check unit tests): browsing layer present and consistent with the check layer; ScreenPipe nodes in the catalog match the package.
- **Live checklist**, replayed at the end and recorded in the evidence file: the story 54 list.

## Out of Scope

- A dry run of drafts (executing a draft on test data): n8n's public API cannot run a workflow on supplied data; the user declined the temporary-copy workaround.
- Detection-side wiring; the detected task stays scripted (demo contract).
- Checking required fields nested in collections at « Terminer » (shown in cards only).
- Community nodes installed from the n8n UI: unknown to the catalog, refused.
- Detecting at runtime that the user's n8n differs from the pinned image.
- Choosing between several credentials of one type.

## Further Notes

- The chat may delete Flows without confirmation by explicit user decision; activation stays user-only.
- The demo shortcut is active in every build by user decision.
- n8n facts that shaped this spec: no node-type listing in the public API (hence the generated catalog); credentials are listable; pinned data is ignored outside the editor's manual runs; Execute Command and Local File Trigger are excluded by default in n8n 2.x.
