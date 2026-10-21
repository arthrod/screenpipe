# Slice review: `routes/frames.rs`, `routes/search.rs`, `routes/health.rs` — PR #1

**Headline: this slice is empty. The PR does not change any of the three assigned files. Nothing was posted to the PR.**

## What I ran

All claims below come from commands executed in this session on the PR-head checkout
(`HEAD` = `0b6c5f9d1`, `origin/main` = `d75ccaedd`, repo `arthrod/screenpipe`):

- `git diff origin/main...HEAD -- crates/screenpipe-engine/src/routes/frames.rs
  crates/screenpipe-engine/src/routes/search.rs crates/screenpipe-engine/src/routes/health.rs`
  → **empty output** (merge-base `35ed62162` → head `0b6c5f9d1`: no change in any of the three).
- `git diff 35ed62162 HEAD -- <each file>` → **0 lines for each of the three**; the PR-head
  versions are byte-identical to the merge-base versions.
- `gh pr view 1 --json files` (GitHub's own file list, capped at 100 of 234 files) → none of the
  three appear; the local three-dot diff (234 files, +34606/−600) is the authoritative full list
  and does not contain them either.
- `git log 35ed62162..origin/main -- <the three files>` → the commits that *do* touch them are
  all on the **base side**: `5ce7edfcd` ("Gate captured data on PII completion receipts #7634"),
  `99f0fdb99` ("fix(health): expose unresolved focus and never-progressed capture"),
  `b1266c89f` ("fix(health): measure continuous focus faults and verify disk-full recovery"),
  `3abd1dfaf` (autofix).

## Why the ask's premise does not hold, and what the two-dot difference actually is

The ask's focus areas ("Frames route change: payload size limits", "Search route change:
cancellation propagation", "Health route change: reflects new flow health truthfully") describe
changes that do not exist on the PR side of these files. The tree-to-tree difference
(`git diff origin/main HEAD`, 19 insertions / 196 deletions across the three files) exists only
because the base branch advanced past the merge-base after the PR head diverged — the PR head
simply **lacks** newer base-side work:

- `crates/screenpipe-engine/src/routes/frames.rs`: base has `require_image_release` — a
  `503 privacy_pending` gate on `get_frame_thumbnail`, `thumbnail_for_candidate`,
  `get_frame_data`, `try_nearest_frame`, and `run_frame_ocr` when protected reads are enabled and
  image privacy release (PII redaction) has not completed, plus a
  `!protected_reads_enabled()` filter on the frame image cache. The PR head does not contain it.
- `crates/screenpipe-engine/src/routes/search.rs`: base has the `SearchPrivacy` completeness
  block on `SearchResponse`, a `release_epoch()` folded into the search-cache key with a
  `privacy_epoch` entry check, and a `503 privacy_pending` error path. The PR head lacks all of it.
- `crates/screenpipe-engine/src/routes/health.rs`: base has the shared `vision_persistence_stalled`
  predicate (treating never-progressed capture after warm-up as a stall) with regression tests, the
  `vision_focus_unresolved` response field with a `focus_unresolved` degraded reason and its test.
  The PR head has the older semantics ("`last_db_write_ts == 0` means warming up").

None of this matches the focus areas either: the base-side frames change is privacy release
gating (not payload size limits), the base-side search change is privacy-completeness metadata and
cache invalidation (not cancellation propagation), and the base-side health change is vision
capture/DB-write stall truthfulness (not flow health).

## Merge-safety check (the real risk, verified)

A cross-branch PR can silently revert base-side work only if the head also touched the same
files. Here the head did not, but I verified rather than assumed:

- `git merge-tree --write-tree origin/main HEAD` → exit 1 (conflicts exist) but the conflicted
  paths are only `packages/workflows-ui/src/workflow-step-evidence.{tsx,module.css}`,
  `packages/workflows-ui/src/workflows-app.{tsx,module.css}`, and
  `apps/screenpipe-app-tauri/components/workflows/step-evidence.test.tsx` — **none of my three
  files conflict**.
- In the merged tree (`d1ad1fe1b7e1fbe0620bf6f1662442c9d7661846`):
  `require_image_release` survives in frames.rs (6 occurrences), `SearchPrivacy` survives in
  search.rs (4), `vision_focus_unresolved` survives in health.rs (6). So merging this PR under any
  standard strategy keeps the base-side privacy and health-truth fixes intact. **No regression
  risk from this PR on these files.**

## Fit within the whole PR

The PR adds Automation Flows (engine routes under `crates/screenpipe-engine/src/routes/{workflows,chatgpt_proxy,cloud_proxy,mod}.rs`,
flow lifecycle in `crates/screenpipe-engine/src/automation_flows/*`, app UI). The only
"flow health" work in the PR lives in `crates/screenpipe-engine/src/automation_flows/health.rs`
and `apps/screenpipe-app-tauri/components/automation-flows/health-banner.tsx` — different paths
from my assigned `routes/health.rs`, and presumably covered by another reviewer's slice, so I did
not review them here. No PR-side code in my three files interacts with the new flow machinery.

## Existing feedback checked (per fetch-pr-feedback, gates 1–3)

I ran the fetch-pr-feedback steps with `--pr 1` (resolved-thread GraphQL + both paginated comment
fetches; all exit 0): 15 line-specific comments, all from `coderabbitai[bot]`, none on my three
files (they cover `flow-activation.tsx`, `notification-actions.test.ts`, `shortcuts.rs`,
`n8n-guide.md`, `SKILL.md` ×2, `pi.rs`, `automation_flows/retry.rs`, `chatgpt_proxy.rs`, `DEMO.md`
×2, `novadesk-support-tickets.json`, `ScreenPipeAiTrigger.node.ts`, `workflow-questions.tsx`,
`workflows-app.module.css`), plus summary comments from `codeant-ai[bot]`, `qodo-code-review[bot]`,
and `coderabbitai[bot]`. Nothing in them needs duplicating, and I posted nothing (see comments file).

## Not checked / out of scope

- I did not review `automation_flows/health.rs` or `health-banner.tsx` (outside my assigned paths).
- I did not compile or run tests for these files — no PR-side change exists to test.
- Whether the upstream base commits themselves are sound (e.g. the base-side
  `vision_persistence_stalled` semantics reversing the head's "warming up" comment) is a question
  about the base branch's history, not about this PR; both sides carry their own tests.
