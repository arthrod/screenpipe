# Slice summary — README.md (large rewrite, 160 added / 409 removed)

PR #1 (https://github.com/arthrod/screenpipe/pull/1), diff base `origin/main`, checkout = PR head.
Reviewer: reviewer-docs-readme. Focus: *verify the binding Design rules survived and no policy was
silently dropped.*

## What this slice changes

`README.md` is replaced wholesale (diff `git diff origin/main...HEAD -- README.md`, 569 lines
touched, 160+/409−). The upstream product front page (download banner, what-is-screenpipe, install,
specs, privacy/security, comparisons, pricing, FAQ, translations, contributor guide) becomes a
single-feature README: "Screenpipe × n8n: Automation Flows" (README.md:1-178).

Within the PR the file evolved over 7 commits (`git log origin/main..HEAD --oneline -- README.md`):
754fbfbfa (long feature README appended to the old one, with `### Design rules`) → cf02d9d34
("README is only about Automation Flows"; full 7-rule Design rules + preamble + "Known limits") →
c2030bcb0 ("a short README for the jury"; rules condensed, Known limits / Engine API / Set-it-up
detail dropped) → presentation polish → HEAD.

The Design rules matter beyond docs: this PR also adds an `## Automation Flows` section to
`AGENTS.md` (diff vs origin/main, +10 lines) that declares the README's "Design rules" **binding**
for anyone touching `crates/screenpipe-engine/src/automation_flows*`,
`apps/screenpipe-app-tauri/components/automation-flows/`,
`apps/screenpipe-app-tauri/lib/automation-flows/`, `packages/n8n-nodes-screenpipe/` and
`infra/automation-flows/`. The old `origin/main:AGENTS.md` had no such section and the old
`origin/main:README.md` had no Design rules section — both the rules and their binding status are
introduced by this PR.

## Focus check 1: did the binding Design rules survive?

**All 7 rules survive at HEAD** (README.md:155-171: n8n source of truth; edit in n8n; nothing runs
without the user; AI only where judgment is needed; only real complete nodes; credentials never
given to the AI; detection stays Screenpipe's). Command: extracted the `## Design rules` section
from `git show` of 754fbfbfa, cf02d9d34, c2030bcb0 and HEAD.

**But the condensation from cf02d9d34 → c2030bcb0 silently dropped binding clauses:**

| Dropped content | Where it lived | Still true in code? |
|---|---|---|
| Preamble "These rules apply to every change to Automation Flows, for contributors and coding agents alike" | cf02d9d34 / 754fbfbfa rules header | Partially replaced by the new AGENTS.md section (agents only, 5 paths) |
| Rule 3: "The chat can create and change Flows, but never turns them on." | cf02d9d34 rule 3 | Preserved only by inference from README.md:161 ("Only the user turns a Flow on, from the Review Screen"); notable because chat Flow creation is a headline feature of this PR (README.md:112-119) |
| Rule 5: "Invented, switched-off or incomplete nodes are refused" | cf02d9d34 rule 5 | Refusal norm implied but no longer stated (README.md:166-167) |
| Rule 6: "Screenpipe connects the only credential of the type a node needs, or refuses the Flow" (scope also reworded "never come from the chat" → "never given to the AI") | cf02d9d34 rule 6 | **Still enforced**: `crates/screenpipe-engine/src/flow_checks.rs:99-102` ("wires … the only credential a node needs when n8n holds exactly one of its type"), header flow_checks.rs:6-16. Also user-documented in cf02d9d34's "Known limits" ("One credential per type … Screenpipe refuses the Flow"), which the rewrite deleted — so this contract is now documented nowhere |
| "Known limits" section (one-credential refusal + activity labels tuned for email Flows) | cf02d9d34:246-280 | Gone entirely; the activity-label caveat documented a real limitation |

## Focus check 2: was other policy silently dropped?

The replaced front page carried user-facing policy that now exists nowhere in README.md:
`grep -in "license|privacy|telemetry|analytics" README.md` at HEAD matches only line 148 (a
settings navigation path). Gone vs `origin/main:README.md`: source-available/LICENSE.md references
and license terms, the "Privacy and security" section, the telemetry/cloud FAQ (PostHog
default-on, Sentry), pricing/licensing terms. The only privacy statement left is Flows-scoped:
"Only what an AI step sends to its model, and what your Flow sends to other apps, leaves the
machine" (README.md:66-68). Likely intentional for a hackathon front page (commit cf02d9d34 "docs:
README is only about Automation Flows"), but the license pointer loss is worth one paragraph.

Also orphaned: `docs/translations/` still holds 9 translations of the old front page
(README-ja, -zh_CN, -fr, -es, -pt_BR, -de, -uk, -ko, -ru) and `docs/translations/README.md:7` still
links `[English](../../README.md)`; the new README no longer links them and they describe content
that no longer exists. No other in-repo file links into root-README anchors
(`grep -rn --include="*.md" -E "\]\(((\.\./)+)?README\.md#" crates apps packages docs scripts` →
only `CONTRIBUTING.md:362` linking `apps/screenpipe-app-tauri/README.md#fast-browser-ui-development`,
unrelated), so nothing else breaks.

## Factual claims — verified against the repo (all passed)

- Three n8n nodes with matching display names: `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:35` ("ScreenPipe Trigger"), `nodes/ScreenPipeAiTrigger/ScreenPipeAiTrigger.node.ts:31` ("ScreenPipe AI Trigger"), `nodes/ScreenPipe/ScreenPipe.node.ts:27` ("ScreenPipe"). Trigger events match the README table (Keyword Said / App or Window Becomes Active / Pipe Runs / Automation Flow Runs, ScreenPipeTrigger.node.ts:57-73); AI Trigger has "Cooldown (Minutes)" (ScreenPipeAiTrigger.node.ts:62).
- "Each event fires once" (README.md:54): consistent with the cursor dedup in ScreenPipeTrigger.node.ts:330-332 (`fresh = runs.filter(run.id > lastSeen)` over a PipeCursor) and the comment at line 225 ("skips the transcriptions already seen"). Source-level check only — I did not run the node.
- "n8n runs on your computer (127.0.0.1)" (README.md:66): `infra/automation-flows/docker-compose.yml:16` binds `127.0.0.1:5678:5678`.
- Quick start: `infra/automation-flows/docker-compose.yml` exists; `bun run install-n8n` exists (`packages/n8n-nodes-screenpipe/package.json:10` → `scripts/build.ts --install`) and "builds them and restarts n8n" per `scripts/build.ts:5-11` and the `docker restart` at line 65.
- "ScreenPipe API" credential with Base URL + API Key: `packages/n8n-nodes-screenpipe/credentials/ScreenPipeApi.credentials.ts:9-23`.
- "Settings → Privacy → Security" API-key path (README.md:148): `apps/screenpipe-app-tauri/components/settings/privacy-section.tsx:936-939` has the Security block and `:970-991` the api_key input.
- All 8 screenshot files exist under `docs/automation-flows/screenshots/` (1-task-page.png … 8-screenpipe-nodes-in-n8n.png); `CONTEXT.md`, `docs/automation-flows/history/` and all four code pointers in the footer (README.md:173-178) exist. `#quick-start` anchor matches `## Quick start` (README.md:129).

## Not verified (stated, not guessed)

- I did not run the n8n nodes, docker compose, or the app; the trigger "fires once" and quick-start behaviors are source-read, not executed.
- I did not verify the completeness of the privacy claim at README.md:66-68 (e.g. whether the repetitive-task *detection* path sends anything off-device); the demo section (README.md:44-46) says detection is hand-triggered in the demo, which matches the existing coderabbit feedback on `docs/automation-flows/history/hackathon/DEMO.md`.

## Fit with the whole PR

The README is the PR's policy anchor: it defines the 7 Design rules that AGENTS.md makes binding
for the five feature directories, and the existing PR feedback (coderabbitai line comments,
fetched via the fetch-pr-feedback gates — 14 line-specific comments, **none on README.md**) cites
these rules repeatedly. So wording drift in the Design rules is not cosmetic; it changes the
contract the other ~100 files are reviewed against. Nothing I post below duplicates existing PR
comments.

## Quality issues (severity)

- **P2** README.md:155-171 — three binding clauses dropped in the condensation (chat-never-activates; invented/incomplete-nodes-refused; credential connect-or-refuse mechanism), the last still enforced in flow_checks.rs:99-102 but now undocumented.
- **P2** README.md:1 — front page no longer states license, privacy, or telemetry policy.
- **P3** README.md:1 — 9 orphaned/stale translations under docs/translations/.
