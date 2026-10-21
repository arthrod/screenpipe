# Slice review: AGENTS.md, CLAUDE.md, CONTEXT.md (PR #1)

## What this slice changes

Three additive doc changes (+100 lines, 0 deletions), part of the Automation Flows feature:

- **AGENTS.md:9-17** — new `## Automation Flows` section placed before "Read on demand". It defines the feature in one sentence and makes the Design rules binding: an agent must read `README.md` ("Design rules" at README.md:155) before touching five path groups: `crates/screenpipe-engine/src/automation_flows*`, `apps/screenpipe-app-tauri/components/automation-flows/`, `apps/screenpipe-app-tauri/lib/automation-flows/`, `packages/n8n-nodes-screenpipe/`, `infra/automation-flows/` (AGENTS.md:12-16). It points to `CONTEXT.md` for vocabulary and `docs/automation-flows/history/` for design history (AGENTS.md:17).
- **CLAUDE.md:11-19** — new `## Agent context` section with two sub-pointers: issue tracker (`.scratch/<topic>/`, `docs/agents/issue-tracker.md`) and domain docs (`docs/agents/domain.md`). The pre-existing `@AGENTS.md` import (CLAUDE.md:9) is unchanged, so the Automation Flows section reaches Claude through it.
- **CONTEXT.md** — new 80-line glossary: 11 terms under "Language" (Detected Task, Evidence, Clarification Question, Task Page, Automation Flow, n8n workflow, Review Screen, Run, Abstention, Activity, Activation), a "Flow states" section (Draft, Paused, Needs Review), and four "Relationships" invariants (CONTEXT.md:74-80).

## How it fits the PR

These are the agent-facing contract for the 234-file Automation Flows PR. They are consistent with each other and with the feature docs: README.md's "Design rules" section ends with a pointer block (README.md:167-173) naming the same code paths, `CONTEXT.md`, and `docs/automation-flows/history/` as AGENTS.md:12-17 — near-verbatim, no drift. `docs/agents/domain.md:5-7` (new in this PR) independently points back to `CONTEXT.md` as the glossary, so the vocabulary has two inbound references, both correct. CONTEXT.md's intro ("The feature is described in `README.md`", CONTEXT.md:3-5) is accurate.

## Verification performed (all run this session)

- **Pointers resolve**: existence loop over all 11 referenced paths — every one EXISTS in the PR head, including `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, `CONTEXT.md`, `README.md`.
- **Design rules exist**: `grep -n "Design rules" README.md` → line 155; read README.md:140-200 to confirm content.
- **Vocabulary vs code naming**:
  - Detected Task `wf-…` id: `crates/screenpipe-engine/src/routes/workflows.rs:34,38` (prefix check + `wf-{sha256}` generation). ✓
  - Run: route `/:id/runs/:run/retry`, `crates/screenpipe-engine/src/automation_flows.rs:297`. ✓
  - Activity: route `/:id/activity` (`automation_flows.rs:296`) + `automation_flows/activity.rs`. ✓
  - Abstention: engine emits outcome `"abstained"` (`automation_flows/activity.rs:128`), typed in `apps/screenpipe-app-tauri/components/automation-flows/api.ts:72`. ✓ (UI renders it as "Sort by hand", `labels.ts:62-63` — a deliberate plain-language label, not vocabulary drift.)
  - Clarification Question: exact capitalized term `clarificationQuestion` + prose "every Clarification Question before creation" in `packages/workflows-ui/src/platform.ts:47`; answers stored per `automation_flows.rs:69,418,1062`. ✓
  - Task Page / Review Screen / Evidence: `packages/workflows-ui/src/workflows-app.module.css:301`, `workflow-step-evidence.tsx:20`; `flow-review.tsx:7` and five sibling component headers; `automation_flows.rs:372-373,1264-1267`. ✓
  - Paused / Needs Review / Draft definitions match `derive_status` exactly: `automation_flows.rs:1145-1160` (`draft` = never reviewed; `needs_review` = reviewed version ≠ n8n version; `paused` = reviewed, current, not active). ✓
- **Header rule**: none of the three files is source code; AGENTS.md:45-48 exempts agent-facing artifacts anyway. No header required — consistent.

## Findings (details in comments file)

1. **P2 — AGENTS.md:12-16**: the binding gate lists five path groups but omits major Automation-Flows code this very PR modifies: `packages/workflows-ui/` (12 files — Task Page/creation UX), `crates/screenpipe-core/assets/skills/automation-flows/` (2 files — the chat skill that must itself encode the Design rules), `apps/screenpipe-app-tauri/src-tauri/src/` (6 files incl. `automation_flows.rs`, `shortcuts.rs`), and `crates/screenpipe-engine/src/routes/chatgpt_proxy.rs`. Counts from `git diff --name-only origin/main...HEAD`. An agent editing those areas is never told the Design rules are binding.
2. **P2 — CLAUDE.md:11-19 vs CLAUDE.md:3**: CLAUDE.md:3 declares "Conventions live in one file so they cannot drift", but this PR adds agent-context conventions (issue tracker, domain docs) only to CLAUDE.md. AGENTS.md:6 claims it is "loaded into every agent's context" — those agents never see the new pointers. The Automation Flows section is fine (it lives in AGENTS.md and imports into CLAUDE.md); the new section is the drift.
3. **P2 — CONTEXT.md:60-72**: "Flow states" defines 3 of the 5 statuses `derive_status` produces (`automation_flows.rs:1145-1160`): `active` and `dismissed` have no entries, though the Review Screen exposes Dismiss/Restore (`flow-activation.tsx:7`) and dismissed is exactly the kind of term (dismissed vs rejected vs archived) this file exists to pin. The three definitions present are accurate.

No P0/P1: the slice is additive markdown; no security, performance, or runtime surface. Nothing in my slice was already covered by the PR's existing review comments (all 15 are on other files).

## Not run

- No tests apply to this slice (pure docs; no CI job exercises these files beyond markdown presence). I did not run any test suite — none is named by the ask and none covers these files.
