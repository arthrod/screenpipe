# Review screen prototype

`review-screen.html` is a throwaway, standalone HTML mockup of the Automation Flow
review screen for the support reference case (Gmail → Jira). It is a visual
reference for the front-end integration, not production code.

Open it directly in a browser (double-click). It has no build step and no
dependencies besides Google Fonts. State lives in memory.

## What it shows

- The "New automation" notification, in the screenpipe pop-up style
  (Open / Later). Open leads to the review page.
- Automations tab > **Recommendations**: rows grouped by state (Waiting for
  you, Running, Dismissed) with the My tasks status square.
- Review page:
  - the title, where the Flow was learned from, and its status;
  - VIEW GRAPH and TURN ON;
  - one sentence and 3 checks that summarise what the Flow automates;
  - the questions the AI could not settle. TURN ON stays disabled until
    they are answered, and "Other answer…" opens a free-text field;
  - the rules, collapsed.
- Running state: PAUSE and an empty Activity list. Real runs come from n8n.

The styling copies the real app: Inter for text, uppercase mono buttons,
uppercase section labels and 1 px borders.

## Test controls

The bottom bar is not part of the design:
- **Simulate ▾ → Show the notification** triggers the pop-up again.
- **Reset everything** goes back to the initial state.
- **◐** switches between light and dark.

No demo emails are included. The rules, the questions and the "same choices as
you on 7 emails" score are scripted.

## Differences from the AGENTS.md direction

The UX choices were made during prototyping and are open to discussion with
the team:
- There is no modification chat; open points are handled as questions with a
  free-text answer.
- VIEW GRAPH opens a simplified step list here; in the app it should open the
  workflow in n8n.
- The evidence timeline, the rendered n8n graph with AI sentences, and View in
  timeline are not mocked yet.
