# Review slice — `docs/automation-flows/history/hackathon/CONVERSATION_NOTES.md` lines 1–1200

Slice of PR #1 (arthrod/screenpipe, head = this checkout, diff base origin/main). The file is a
2325-line addition (verified: `git diff origin/main...HEAD --stat -- <file>` → "2325 insertions");
I reviewed lines 1–1200 and read them in full (three Read calls: 1–400, 401–800, 801–1200).
Lines 1200–2325 belong to another reviewer.

## What this slice is

Raw transcript of the hackathon kickoff conversation (French/English mix), prefixed by a
disclaimer header (lines 4–12) that declares the file "not a source of truth", names the
authoritative documents (`AGENTS.md`, `BUILD_SPEC.md`), and lists "known superseded decisions".
Content: initial pitch, fact-check findings, three rounds of validated decisions (Q1–Q24,
atomic points 01–29, repo-content round R1–R17), a full English "Hackathon Guideline" draft
(lines 529–639), and the "final text" drafts for AGENTS.md/CLAUDE.md (lines 1012–1067).

## Decisions in this slice that later became code (verified in HEAD)

- **R5/R7 — chat-created automations + an automations page** (lines 903–907, 915–920) → shipped:
  `crates/screenpipe-core/assets/skills/automation-flows/` chat skill and the Flows list view
  (BUILD_SPEC.md "Automation Flows view in the Automations tab"; screenshots/02-flows-list.jpg).
- **R6 — review screen direction** (lines 909–913): plain-language explanation, timeline with real
  captures, workflow visible and editable, explicit activation → shipped review screen
  (`apps/screenpipe-app-tauri/components/automation-flows/`, version-checked `activate()`;
  screenshots/02-review-screen.jpg). "Editable" is satisfied via the chat-modification path and
  n8n itself; the in-app graph is read-only (BUILD_SPEC.md "View graph (n8n)").
- **R8 — workflows (trigger included) live in n8n, edited there** (lines 922–927) → shipped engine
  proxies to n8n; activation is a separate user click with a version check.
- **R9/R10 — real Gmail + real Jira; AI nodes via the ScreenPipe Business proxy** (lines 929–939)
  → shipped `infra/automation-flows/workflows/novadesk-support-tickets.json` (Gmail trigger, AI
  agent node, `httpRequest` "Create the Jira ticket") and the local ChatGPT-compatible proxy
  (`crates/screenpipe-engine/src/routes/chatgpt_proxy.rs`). Gmail shipped over OAuth (see
  contradiction below), not the IMAP decided here.
- **R16 — delete `PLAN.md`** (line 1001) → executed: `git ls-files docs/automation-flows/history/hackathon/`
  contains no PLAN.md.
- **Q12 answer (line 358) — "we don't touch pipes, the system is n8n-based"** → honored: no pipes
  were added for flows; the demo logic lives in the n8n workflow plus custom ScreenPipe n8n nodes.
- **Header disclaimers (lines 4–9) match reality**: the transcript's "final text" AGENTS.md draft
  (lines 1012–1054) never shipped — current AGENTS.md has no "Hackathon mode" section — and the
  header explicitly flags those drafts as superseded.

## Contradictions with the final implementation (my findings)

1. **P1 — published content that the file itself says must never be public** (line 10): "If the
   repository is made public, remove this file first: it contains product strategy and
   intermediate trade-offs." `gh repo view arthrod/screenpipe --json visibility` →
   `{"isFork":true,"visibility":"PUBLIC"}`. The PR publishes the file on that public fork,
   contradicting its own containment rule. The content matches the description: team composition
   (line 183 "on est 5"), Business-subscription usage, jury-facing demo tactics and the
   real-vs-scripted honesty table (lines 586–599), and an internal session ID (line 12).
2. **P2 — the header's superseded-decisions list is wrong on Gmail and incomplete on the scripted
   proposal** (line 9): the list names "OAuth for Gmail" as superseded, but the transcript's
   validated decision is IMAP + app password (line 518 "IMAP + mdp"; restated lines 606, 737), and
   the shipped workflow uses `n8n-nodes-base.gmailTrigger` (OAuth) — node dump of
   `infra/automation-flows/workflows/novadesk-support-tickets.json`; documented in DEMO.md:102.
   So IMAP is what was superseded and OAuth is what shipped — the list names the reverse.
   Additionally the list omits the reversal of lines 1022–1025 ("The proposal comes from real
   detection output, not fabricated data"): the shipped demo injects a scripted task
   (`apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task.ts:13,186`, saved via
   `lib/workflows/desktop-platform.ts:99-108`), and BUILD_SPEC.md declares "The demo notification
   and proposal are scripted". The list is the reader's map to the transcript; both errors
   actively mislead.

Corroborating (outside my slice, for the lead to route): the authoritative BUILD_SPEC.md itself
still carries the stale IMAP wording — line 41 "dedicated Gmail (IMAP app password)" and line 63
"IMAP polling latency and backlog drain" — while DEMO.md:102 documents the Gmail Trigger switch.
Coderabbit's 15 posted comments do not touch CONVERSATION_NOTES.md or BUILD_SPEC.md, so neither
finding duplicates existing feedback.

## Existing PR feedback checked (to avoid duplication)

Ran fetch-pr-feedback gates for PR 1 with `--include-author` (PR author == current user `arthrod`,
so the default exclusion would hide everything): resolved-thread GraphQL → `[]`; issue comments →
4 (codeant-ai[bot] skip notice, qodo paused, coderabbitai summary + one CI-fix note); review
comments → 15, all coderabbitai[bot], covering flow-activation auto-activate, retry-credential
provenance, demo shortcut in production, Jira retry idempotency, "Connexions" wording, rule 9/10
reference, pi.rs skill marker, double retry, proxy/AI-trigger timeouts, DEMO.md email path and CLI
fallback, the 12 s-vs-8 s node note, create-from-task update path, and dark-mode contrast. None
overlap my two findings. Note: my first review-comments fetch failed (`jq: Cannot index boolean
with string`) because the parallel heredoc writes raced; re-running the filter against the saved
raw API output (`gh api --paginate repos/arthrod/screenpipe/pulls/1/comments`, 15 objects, all
well-formed) succeeded — the data was fine, the temp filter file was not.

## Not checked / out of scope

- Lines 1200–2325 (other reviewer's slice) — not reviewed.
- Whether line 10's content concern extends to the other hackathon docs (SPEC.md, HANDOFF.md,
  flow-front-merge.md, issues/*) — I only verified what lines 1–1200 contain plus BUILD_SPEC/DEMO
  corroboration; a repo-wide secrecy pass was not requested and was not run.
- No tests exist for or are affected by this docs-only slice; none were run. The only commands
  behind findings above are the greps/Reads/API calls cited inline.
