## Docs review: hackathon issue docs 22–27 (claims vs. code)

I audited the six issue docs against the code in this PR. The engine/UI/node fixes they
describe are really there, and the suites they cite pass at HEAD (`cargo test -p
screenpipe-engine --test automation_flows_test` → 107 passed, 0 failed; `bun test
infra/automation-flows` → 65 pass; `cd packages/n8n-nodes-screenpipe && bun test` → 56
pass). Four things to fix, all in the docs:

---

**[P2] `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md:154` — the demo Flow's model effort is `:low`, not `:max`**

This line and ticket 25 (`25-chatgpt-subscription-everywhere.md:16` and `:105-106`) say the
demo workflow's AI step runs `chatgpt/gpt-5.6-luna:max`, but the committed workflow pins
`chatgpt/gpt-5.6-luna:low` (`infra/automation-flows/workflows/novadesk-support-tickets.json:122`,
asserted by `novadesk-support-tickets.test.ts:118-119`) and `DEMO.md:103` agrees
("AI step `chatgpt/gpt-5.6-luna:low`"). `HANDOFF.md:62` also repeats the wrong `:max`. The
AI Trigger default and the skill's guidance really are `:max` (`ScreenPipeAiTrigger.node.ts:21`,
`SKILL.md:216`) — only the demo workflow differs, so this is not a global wording fix. Since
ticket 25 is the "claims match reality" evidence doc and 27 is the newest spec, a reader will
"fix" the workflow back to `:max` or distrust the evidence. Please state `:low` here and in
ticket 25 (ideally with the one-line reason the effort was lowered for the demo), or change
the workflow if `:max` was actually intended.

---

**[P3] `docs/automation-flows/history/hackathon/issues/23-review-fixes-ui-workflow-nodes.md:120` — the escaping sentence lost its escape targets**

"the activity JSON writes `<`/`>` as `<`/`>`" now reads "< is written as <": the intended
targets (`\u003c`/`\u003e`, or `&lt;`/`&gt;`) were stripped when the markdown was written.
The code is right (`ScreenPipeAiTrigger.node.ts:261` does
`.replace(/</g, "\\u003c").replace(/>/g, "\\u003e")`); only the doc sentence is empty.

---

**[P3] `docs/automation-flows/history/hackathon/issues/23-review-fixes-ui-workflow-nodes.md:117` — the "app fixture updated together" claim broke with the 8 s timeout change**

Commit `368a17b9a` changed the AI step's give-up to 8 s (`novadesk-support-tickets.json:126`
`"timeout": 8000`), but the user-facing sentence still says "more than 12 seconds is tried
once more" in two places: the workflow note (`novadesk-support-tickets.json:136` — already
flagged in this PR conversation) and, not yet flagged, the app fixture copy at
`apps/screenpipe-app-tauri/components/automation-flows/fixtures.ts:45` that the Review
Screen fixture renders. Fix both in the same commit so this ticket's "node sentence,
review summary and app fixture updated together" invariant actually holds again.

---

**[P3] `docs/automation-flows/history/hackathon/issues/26-no-invented-or-half-built-nodes.md:41` — the catalog has 840 node types, not 841**

The committed `infra/automation-flows/n8n-catalog.json` has `len(nodes) == 840` (the 1.6 MB
size checks out: 1,622,422 bytes; n8n `2.42.2` matches). Off-by-one drift, probably from a
round-two regeneration for the changed ScreenPipe nodes. Update the number so the doc
matches the artifact it describes.

---

Nothing else to add: the French→English UI switch, the facts removal, the `{noformat}`
sanitizing removal and the find-automation button removal are all supersessions that
ticket 27 itself declares (and `HANDOFF.md` records the translation), and ticket 24's doc
is explicit that the native app was never verified. The demo-shortcut-in-every-build
behavior is documented as a user decision in `27:184`; its production risk is already
raised elsewhere in this conversation.
