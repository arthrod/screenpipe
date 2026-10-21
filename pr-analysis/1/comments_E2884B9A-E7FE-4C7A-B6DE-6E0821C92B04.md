## README.md — Design rules survived, but the condensation silently dropped three binding clauses

Context for all three comments: the old README on `origin/main` had no "Design rules"; this PR
introduces them — full form in `754fbfbfa`/`cf02d9d34` (7 rules + preamble + "Known limits"),
condensed in `c2030bcb0`, unchanged since. The same PR adds an `## Automation Flows` section to
`AGENTS.md` making these rules **binding** for five directories, so the final wording is the
contract the other ~100 files in this PR are coded and reviewed against. All 7 rules survive;
the dropped enforcement language did not. (Existing PR feedback checks: none of the current
review comments touch README.md.)

---

**[P2] `README.md:155-171` — Binding Design rules lost three enforcement clauses during the condensation.**

Comparing the rules in `cf02d9d34` to HEAD: (1) rule 3 dropped *"The chat can create and change
Flows, but never turns them on."* — HEAD's "Only the user turns a Flow on, from the Review Screen"
(`README.md:161`) implies it, but chat Flow creation is a headline feature of this PR
(`README.md:112-119`, screenshots 6–7), and this sentence is the one explicit line an agent
modifying the chat path must not cross. (2) Rule 5 dropped *"Invented, switched-off or incomplete
nodes are refused"* — the refusal norm that made the rule enforceable is gone
(`README.md:166-167`). (3) Rule 6 dropped *"Screenpipe connects the only credential of the type a
node needs, or refuses the Flow"* and reworded the scope from "never come from the chat" to
"never given to the AI" (`README.md:168`). The dropped credential mechanism is still enforced in
code — `crates/screenpipe-engine/src/flow_checks.rs:99-102` wires exactly the one credential n8n
holds of a needed type and refuses otherwise — and was user-documented in `cf02d9d34`'s "Known
limits" section, which this rewrite also deleted, so the one-credential contract is now documented
nowhere. Since AGENTS.md points every agent at exactly this section, please restore the three
clauses (they cost four lines) or move the full rule text to `CONTEXT.md` and link it from here.

---

**[P2] `README.md:1` — the repo front page no longer states the license or the privacy/telemetry policy.**

The replaced README carried the source-available/LICENSE.md references and license terms, the
"Privacy and security" section, and the cloud/telemetry FAQ (PostHog analytics default-on, Sentry);
`grep -in "license|privacy|telemetry|analytics" README.md` at HEAD now matches only line 148 (a
settings navigation path). The only privacy statement left is scoped to Flows — "Only what an AI
step sends to its model, and what your Flow sends to other apps, leaves the machine"
(`README.md:66-68`) — which is accurate for the Flow data path (n8n is bound to `127.0.0.1:5678`,
`infra/automation-flows/docker-compose.yml:16`) but is not a substitute for the front-door
disclosures. Making the front page feature-only is a defensible hackathon call, but please keep
one short paragraph at the bottom — what Screenpipe is, a link to `LICENSE.md`, and a one-line
local-first/telemetry disclosure — so the repository's entry point still carries the legal and
privacy pointers.

---

**[P3] `README.md:1` — nine translations are now orphaned and stale.**

`docs/translations/` still holds README-{ja,zh_CN,fr,es,pt_BR,de,uk,ko,ru}.md translating the old
front page, and `docs/translations/README.md:7` still links `[English](../../README.md)`. The new
README no longer links the translations and they describe content that no longer exists. Either
keep a one-line "Translations" pointer in the README or note in `docs/translations/README.md`
that the translations trail the pre-Flows README. (Checked for breakage elsewhere: no other
in-repo markdown links into root-README anchors, so nothing else is affected.)

---

**Verified while reading, no action needed:** every factual claim I checked in the new README
matches the code — the three node names and their trigger events/cooldown
(`ScreenPipeTrigger.node.ts:35,57-73`, `ScreenPipeAiTrigger.node.ts:31,62`,
`ScreenPipe.node.ts:27`), "each event fires once" consistent with the cursor dedup at
`ScreenPipeTrigger.node.ts:330-332`, n8n bound to `127.0.0.1:5678`
(`docker-compose.yml:16`), `install-n8n` building and restarting the container
(`packages/n8n-nodes-screenpipe/scripts/build.ts:5-11,65`), the "ScreenPipe API" credential
(`credentials/ScreenPipeApi.credentials.ts:9-23`), the Settings → Privacy → Security API-key path
(`privacy-section.tsx:936-977`), all eight screenshots under `docs/automation-flows/screenshots/`,
and the `#quick-start` anchor.
