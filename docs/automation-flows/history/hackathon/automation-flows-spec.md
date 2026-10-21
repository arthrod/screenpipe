# Spec: Automation Flows (hackathon)

Status: ready-for-agent

Vocabulary: `CONTEXT.md`. Decision log, route/type contracts and code
pointers: `SPEC.md` (same folder). Build order and risks: `BUILD_SPEC.md`.

## Problem Statement

A support agent at NovaDesk turns every bug-report email into a Jira ticket by
hand. For each email they decide whether it is a bug, an improvement idea or
nothing, write a title in the form "Product - short summary", pick the type,
the priority and a back/front label, and quote the email in the description.
They do this several times a day, and the rules live only in their head.

ScreenPipe already notices repeated work, but the only way it can automate it
today is a pipe: a prompt that an AI runs on a schedule. The user cannot see
in advance what that prompt will do step by step, cannot check it, and cannot
trust it to behave the same way twice. Nothing tells them, in plain language,
what will happen to their emails and their Jira project once they say yes.

## Solution

ScreenPipe notifies the support agent that it found a repeated task. The
notification opens the Task Page: what was detected, the recorded repetitions
as screen captures, a link to the moment in the timeline, and a few
Clarification Questions that must be answered. Once they are answered,
ScreenPipe creates an Automation Flow: a real n8n workflow, imported switched
off, that reads new emails, lets an AI decide only what needs judgment (bug,
idea or nothing; product; summary; priority; label) and creates the Jira ticket
deterministically.

The agent lands on the Review Screen: a plain-language summary, a read-only
picture of the n8n graph with one sentence per step, a link to open the
workflow in n8n, and an Activate button. Nothing runs before they click it.
Later they can ask the ScreenPipe chat for a change; the Flow switches off,
is updated, is marked Needs Review, and runs again only after they activate it
again. All Flows created from the app are listed in the Automations tab with
their status, last run and activation history.

Custom ScreenPipe nodes for n8n let any workflow read the user's ScreenPipe
memory (the demo's AI step uses it to copy how the agent handled similar
emails before) and start on situations ScreenPipe observes (a keyword said
aloud, a window becoming active, a pipe or Flow firing, or an AI-evaluated
condition).

## User Stories

### Notification and Task Page

1. As a support agent, I want a notification when ScreenPipe finds a task I repeat, so that I learn about automation without looking for it.
2. As a support agent, I want the notification to open the Task Page of that task, so that I understand what was detected before anything is created.
3. As a support agent, I want the Task Page to describe the task in plain language, so that I can confirm ScreenPipe understood my work.
4. As a support agent, I want to see each recorded repetition as screen captures with their time, so that I can trust the detection is based on what I really did.
5. As a support agent, I want a "View in timeline" link on the evidence, so that I can see the full context of a repetition.
6. As a support agent, I want ScreenPipe to ask me Clarification Questions about the rules I follow, so that the automation does not guess what only I know.
7. As a support agent, I want to answer each question in free text, so that I can explain my rule in my own words.
8. As a support agent, I want the "Create automation" action to stay disabled until every question is answered, so that no Flow is built on missing information.
9. As a support agent, I want my answers to be saved, so that I do not lose them if I leave the page.
10. As a support agent, I want the rest of the Task Page to behave as before, so that answering questions is required only when I create an automation.

### Flow creation

11. As a support agent, I want one click to create the Automation Flow from the task, so that I do not have to build anything in n8n myself.
12. As a support agent, I want the new Flow to be switched off when it is created, so that nothing touches my emails or Jira before I review it.
13. As a support agent, I want clicking "Create automation" twice to keep a single Flow, so that I never end up with duplicate automations.
14. As a support agent, I want to land on the Review Screen right after creation, so that reviewing is the obvious next step.

### Review Screen

15. As a support agent, I want a plain-language summary of what the Flow does and how, so that I understand it without knowing n8n.
16. As a support agent, I want a read-only picture of the workflow graph, so that I see the steps in order.
17. As a support agent, I want one short sentence under each step of the graph, so that every step is explained.
18. As a support agent, I want a link back to the Task Page and its evidence, so that I remember why this Flow exists.
19. As an advanced user, I want a "View graph" link that opens the workflow in n8n, so that I can inspect or edit every detail there.
20. As a support agent, I want to see the Flow's status (Draft, Active, Paused, Needs Review), so that I know whether it is running.
21. As a support agent, I want to see when the Flow last ran and whether it succeeded, so that I know it works.
22. As a support agent, I want an Activate button, so that the Flow runs only when I decide.
23. As a support agent, I want a Deactivate button, so that I can stop the Flow at any time.
24. As a support agent, I want an activation history (who, when, which version), so that I can tell what changed and when.

### Execution (reference case)

25. As a support agent, I want each new bug email to become one Jira ticket of type Bug, so that developers get the work without me.
26. As a support agent, I want an improvement idea to become a Jira ticket of type Task, so that ideas are tracked the same way.
27. As a support agent, I want emails that are neither (for example a security alert) to create no ticket, so that the board stays clean.
28. As a support agent, I want ticket titles in the form "Product - short summary", so that they match the convention I already use.
29. As a support agent, I want the priority and the back/front label set the way I would set them, so that tickets need no correction.
30. As a support agent, I want the email quoted in the ticket description, so that developers have the original report.
31. As a support agent, I want an email to be processed only once, so that a restart never creates a duplicate ticket.
32. As a support agent, I want the AI step to look at how I handled similar emails before, so that it follows my conventions rather than generic ones.

### Changing a Flow

33. As a support agent, I want an Add button in the Flows list that opens the ScreenPipe chat, so that I can describe a new automation in words.
34. As a support agent, I want a Flow created from the chat to go through the same Review Screen and explicit activation, so that the chat can never switch anything on.
35. As a support agent, I want a "Request a change" action that opens the chat about this Flow, so that I can change it without opening n8n.
36. As a support agent, I want a change to an active Flow to switch it off first, so that a half-reviewed version never runs.
37. As a support agent, I want a changed Flow to be marked Needs Review with updated explanations, so that I review exactly what will run.
38. As an advanced user, I want the app to flag a Flow I edited directly in n8n, so that I know its review is out of date.

### Flows list

39. As a support agent, I want an Automation Flows view in the Automations tab, so that all my Flows are in one place.
40. As a support agent, I want the list to show only Flows created from ScreenPipe, so that unrelated n8n workflows do not clutter it.
41. As a support agent, I want each row to show name, status and last run, so that I can spot a broken Flow at a glance.
42. As a support agent, I want to open a Flow from the list into its Review Screen, so that details and actions are one click away.

### Setup and ScreenPipe nodes

43. As a support agent, I want to enter the n8n address and API key once in ScreenPipe's Connections, so that ScreenPipe can manage my Flows.
44. As a support agent, I want a clear message when n8n is not configured or not reachable, so that I know what to fix.
45. As an n8n workflow author, I want a ScreenPipe node that searches my screen, audio and activity history, so that any workflow step or AI agent can use my ScreenPipe memory.
46. As an n8n workflow author, I want a ScreenPipe Trigger that starts a workflow on a keyword said aloud, a window becoming active, or a pipe or Flow firing, so that situations on my PC can start automations deterministically.
47. As an n8n workflow author, I want a ScreenPipe AI Trigger that starts a workflow when an AI judges a condition I wrote is met, so that fuzzy situations can start automations too.
48. As an n8n workflow author, I want a cooldown on the AI Trigger, so that one situation does not fire the workflow repeatedly.

### Demo

49. As a demo presenter, I want a script that fires the scripted notification for the demo task, so that the demo starts the same way every time.
50. As a demo presenter, I want a reset script that removes the demo Flow and the saved answers, so that I can rehearse repeatedly.
51. As a demo presenter, I want the whole journey to fit in 3 minutes, so that it fits the stage slot.

## Implementation Decisions

- **Flow service in the ScreenPipe engine.** New local API routes under `/automation-flows`, behind the existing local auth. They are the only code that talks to the n8n public API. Interface: list Flows, get one Flow, create from a Detected Task (`taskId`, `answers`), create from a full n8n workflow (chat), update in place (chat), activate, deactivate. Errors: "n8n not configured" (412), "n8n unreachable" (502), unknown Flow or task (404).
- **Flow model.** Derived from n8n plus a small ScreenPipe-side record. Shape (encodes the decision):

  ```ts
  type FlowStatus = "draft" | "active" | "paused" | "needs_review";
  type Flow = {
    id: string; name: string; status: FlowStatus; n8nUrl: string;
    sourceTaskId: string | null; summary: string;
    nodes: { id: string; name: string; type: string; position: [number, number]; sentence: string | null }[];
    edges: { from: string; to: string }[];
    versionId: string; reviewedVersionId: string | null; reviewOutdated: boolean;
    lastExecution: { status: "success" | "error" | "running"; startedAt: string } | null;
    activationLog: { at: string; event: "activated" | "deactivated" | "paused_for_edit" | "modified"; versionId: string; by: "user" | "chat" }[];
  };
  ```

  Status: `active` if n8n says active; otherwise `draft` if never activated, `needs_review` if the n8n version differs from the last activated one, else `paused`. `reviewOutdated` flags an active Flow edited directly in n8n (not auto-paused).
- **Storage split.** n8n holds the workflow, its state, and one explanatory sentence per node (the node's notes field). ScreenPipe keeps, per Flow, only what n8n cannot: the summary, the source task id, the last activated version and the activation log, in one local JSON file. Flows are the n8n workflows carrying a dedicated tag. Sticky notes are not shown as nodes.
- **Versioning.** One Flow is one n8n workflow. A chat change to an active Flow deactivates it, updates the same workflow in place, and logs both events; the version is n8n's version id. Activation records the activated version.
- **Scripted creation for the demo.** Creating a Flow from the demo task imports a bundled, pre-built workflow and its pre-written review material as is; the answers are stored but ignored. Creation is idempotent per task. The bundled workflow is exported from the demo n8n instance after its credentials are bound once (credential ids are instance-specific, not secret).
- **n8n connection.** ScreenPipe's existing n8n connection gains two fields, the API URL and the API key (secret). The Flow service reads them from there.
- **Task Page adaptation.** The existing detected-workflow page gains a mode where Clarification Questions are required, plus a "Create automation" action enabled only when all are answered. The page calls a new optional platform capability "create automation flow (task id, answers)"; the desktop platform implements it with the Flow service, then navigates to the Review Screen. The existing notification deeplink opens the page.
- **Demo Detected Task and evidence.** A scripted Detected Task (stable id) describes the three recorded repetitions, with two Clarification Questions (ideas → Task?; how is priority chosen?). Its evidence is key frames extracted from the team's screen recording and embedded in the fixture; the screenshot serialization needs a narrow path so embedded images survive.
- **Flows UI module.** A self-contained module in the desktop app, mounted as a third "Flows" tab of the Automations section and addressable by URL (tab + Flow id). Its only dependency on the rest of the app is one typed client over the Flow service, so it can be replaced wholesale. List (name, status, last run, Add) and Review Screen (summary, read-only graph with the existing graph library, View graph, back to the task, status, last run, activation history, Activate/Deactivate, Request a change, Needs Review banner). Plain styling.
- **Chat.** No new chat UI. Add and "Request a change" open the existing ScreenPipe chat with a prefilled prompt. A new `automation-flows` skill teaches the agent to list, read, create and update Flows through the Flow service, to give every node a one-sentence note, never to activate, and to finish with the Review Screen link.
- **The demo n8n workflow.** Email trigger on unread messages that marks them read (dedupe) → one AI Agent with structured output (type Bug/Task/none, product, summary, priority, label back/front) and the ScreenPipe node as its tool → stop on none → deterministic title, quoted description, unassigned → Jira issue in the demo project. The chat model uses ScreenPipe's local OpenAI-compatible proxy.
- **ScreenPipe n8n nodes.** One package with a shared ScreenPipe API credential (base URL, API key) and three nodes: ScreenPipe (search content, activity summary; usable as an AI tool), ScreenPipe Trigger (polling with a stored cursor: keyword in transcription, window becomes active, pipe/Flow fired), ScreenPipe AI Trigger (polling: condition prompt, look-back window, cooldown; fires when the AI answers that the condition is met). Whether the triggers appear in the demo is not decided.
- **Local n8n.** Docker, image pinned to 2.42.2, bound to localhost only; custom nodes mounted read-only from a gitignored folder. Credentials and the API key are created by a human in the n8n UI and never stored in the repo.

## Testing Decisions

- A good test drives a seam from the outside and asserts observable behavior: HTTP responses and the requests sent to the fake dependency, rendered UI and user interactions, node outputs. No assertions on private functions, internal state or call order inside a module.
- **Seam 1 — Flow service HTTP contract** (main seam). Engine-level tests call the `/automation-flows` routes with a fake n8n server (`wiremock`, already used by the engine's tests; same style as the engine's endpoint tests). Cases: not configured → 412; n8n down → 502; create from task imports inactive and tagged, second call returns the same Flow; unknown task → 404; status derivation for draft / active / paused / needs_review / reviewOutdated; activate records the version and logs; chat update of an active Flow deactivates first and logs paused_for_edit + modified; sticky notes excluded; node sentences come from node notes.
- **Seam 2 — Frontend through the typed client.** Vitest + Testing Library with the client mocked at its boundary (prior art: the workflows UI tests for questions and step evidence; browser mock for manual checks). Cases: "Create automation" disabled until every question is answered, then calls the platform capability; Review Screen renders every node with its sentence, status, last run and history; Activate/Deactivate call the client and refresh; Needs Review banner; n8n-not-configured message.
- **Seam 3 — ScreenPipe n8n nodes against a fake ScreenPipe API.** Package tests run each node's execute/poll entry point against a local fake HTTP server (no prior art in the repo; new package). Cases: search maps parameters and auth header; keyword trigger emits once per new match and advances its cursor; window trigger fires on change only; AI trigger fires only when the condition is met and respects the cooldown; errors surface as node errors.
- **Seam 4 — Golden path acceptance (manual, demo machine).** Real n8n, Gmail and Jira: notification → Task Page → answers → creation → Review Screen → Activate → a bug email becomes one correct ticket, an idea becomes a Task, a non-ticket email creates nothing → chat change leaves the Flow inactive and Needs Review → re-activate. Recorded as a checklist with results before the demo.
- Targeted runs only: the engine crate's tests, the app's frontend tests, the node package's tests. Native app checks use only the app's scripts.

## Out of Scope

- The background detection → Flow creation loop; the demo task, notification and questions are scripted.
- Generating the n8n workflow with AI from the task and answers; answers do not change the demo result.
- Reimplementing the n8n editor or a trigger section in the app.
- Gmail and Jira through ScreenPipe's Connections (they are configured in n8n).
- Any scenario other than bug-report email → Jira ticket.
- Assignment rules, commenting on duplicate bugs instead of creating tickets, and attachments.
- Auto-pausing a Flow edited directly in n8n (it is only flagged).
- Windows/Linux validation, releases, publication.

## Further Notes

- Demo: 3 minutes on stage + 2 minutes Q&A; the chat change is shown live only if it passes rehearsal. Script and acceptance list: `SPEC.md`.
- Demo data: dedicated Gmail inbox and Jira project from the team's recording (three repetitions: two bugs, one idea; one non-ticket email in the inbox).
- Risks to clear first in the golden path: n8n 2.x draft/published semantics versus activate/deactivate and version ids; tool calling through ScreenPipe's local AI proxy; credential binding on API import; the demo machine must hold ScreenPipe captures of the repetitions for the AI step's look-up.
- Local n8n 2.42.2 is already running on this Mac (`127.0.0.1:5678`). Remaining human setup: n8n owner account and API key, IMAP / Jira / AI / ScreenPipe credentials in n8n, n8n URL + key in ScreenPipe Connections.
