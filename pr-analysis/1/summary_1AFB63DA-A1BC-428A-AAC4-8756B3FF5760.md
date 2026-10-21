# Reviewer slice report: redact privacy tests (PR #1)

**Slice assigned:** `crates/screenpipe-redact/tests/privacy_release.rs` (privacy release integration test) and `crates/screenpipe-redact/tests/privacy_stress.rs` (stress test, retention over throughput).

## Headline finding: the slice is absent from PR #1

Neither assigned file exists in this PR, in the PR head checkout, or anywhere in the working tree. The slice list appears to be misrouted onto this PR; both files exist on `origin/main` (the PR's own base branch), added by a commit that landed *after* this PR branched.

### Evidence (every command run in this session)

1. `git diff origin/main...HEAD -- crates/screenpipe-redact/tests/privacy_release.rs crates/screenpipe-redact/tests/privacy_stress.rs` → **empty output** (no diff hunks).
2. `git diff origin/main...HEAD --name-only | grep -i redact` → exit 1 (no matches); same for `grep -i privacy`.
3. `find /Users/arthrod/temp/T/screenpipe -name "privacy_release.rs" -o -name "privacy_stress.rs"` → **no matches**. `ls crates/screenpipe-redact/tests/` → only `hybrid_frames.rs`, `opf_integration.rs`, `worker_integration.rs`.
4. GitHub-side confirmation: `gh pr view 1 --json files` (capped at 100 entries) has no redact/privacy path, and `gh pr diff 1` fails outright with `HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)` — so the local merge-base diff is the usable authoritative view.
5. Diff-base validity confirmed: `gh api repos/arthrod/screenpipe/commits/main --jq .sha` → `d75ccaed…`, identical to local `origin/main` (`git rev-parse origin/main`). PR head: `headRefOid 0b6c5f9d1…` (`gh pr view 1`) == local `git rev-parse HEAD`. Merge base: `git merge-base origin/main HEAD` → `35ed6216…` (2026-10-16 21:49:51 +0000).
6. Origin of the files: `git log --all --oneline -- crates/screenpipe-redact/tests/privacy_release.rs` → commit `5ce7edfcd` "Gate captured data on PII completion receipts (#7634)" (author Louis Beaumont, 2026-10-16 16:35:10 −0700 = 23:35:10 UTC). The same commit introduced `privacy_stress.rs`. `git branch -a --contains 5ce7edfcd` → contains `main` and `origin/main`; `git merge-base --is-ancestor 5ce7edfcd HEAD` → **NOT an ancestor of HEAD**. Timestamps confirm ordering: the commit landed on main ~1 h 46 m *after* this PR's merge base (21:49 UTC), i.e. the PR branched before the privacy work reached main and never picked it up.

**Conclusion:** the review plan was almost certainly built for the change in `5ce7edfcd` (upstream #7634, "Gate captured data on PII completion receipts"), not for PR #1. The lead reviewer should re-route this slice or re-derive slice lists from the actual PR diff.

## What PR #1 actually is (context)

234 files, +34,606/−600 vs merge base (`git diff origin/main...HEAD --stat`), all Automation Flows work: `crates/screenpipe-engine/src/automation_flows*`, `apps/screenpipe-app-tauri/components/automation-flows/`, `packages/workflows-ui/`, `packages/n8n-nodes-screenpipe/`, `infra/automation-flows/` — none of it touches `crates/screenpipe-redact` or the release-gate machinery my slice's focus describes. The PR body (`gh pr view 1 --json body`) is the untouched contribution template (title "kkkk"), so it makes no privacy-test claims that the absence could contradict. Zero overlap with my lane ⇒ no review findings of mine apply to this PR's content.

## Existing PR feedback (fetch-pr-feedback gates 1–3, --pr 1; receive-feedback step skipped as instructed)

Ran the skill's gates: PR context OK (`owner=arthrod repo=screenpipe`, PR author `arthrod` == current user, so all author comments excluded by design); resolved-thread IDs = `[]`; issue comments and review comments fetched via the skill's paginated `gh api | jq -s -f` commands (both exit 0).

- Issue comments (non-author): 4 — codeant-ai[bot] skipped review (>100 files), qodo-code-review[bot] paused/subscription, coderabbitai[bot] summary ×2.
- Line-specific review comments: **15, all from coderabbitai[bot]**, all on Automation Flows paths (`flow-activation.tsx`, `shortcuts.rs`, `chatgpt_proxy.rs`, `retry.rs`, `workflow-questions.tsx`, n8n nodes, DEMO.md, skills…).
- `jq 'map(select(.path | test("redact|privacy"; "i")))'` over those comments → `[]`. **No existing comment touches redact/privacy** — nothing of mine to deduplicate, and nothing already covers the absence finding either.

## Content assessment of the slice files (read from origin/main — NOT part of this PR)

Since the ask said to read the full files for context and the blobs exist on `origin/main`, I extracted them (`git show origin/main:…` → /tmp) and reviewed both in full. Line numbers below refer to those origin/main blobs (`/tmp/privacy_release.rs` 2390 lines, `/tmp/privacy_stress.rs` 938 lines).

**`privacy_release.rs` — matches its stated focus well.** It proves "no unredacted leak" against the *protected read pool* (`db.protected_reads()`), not the writer pool, which is the right observer: e.g. `randomized_revision_policy_delete_reinsert_sequences_never_release_stale_text` (762–826) runs a xorshift fuzz over insert/delete/discover/publish/policy-change sequences across 4 seeds × 500 steps and asserts `full_text LIKE '%SYNTHETIC_SECRET%'` count = 0 through the protected pool after *every* step. Other strong paths: pending capture invisible until certified (28–66), stale-revision and policy-change revocation (69–108), regex-only pipeline refusing `redact_required` (110–115), storage-export token admission (117–141), publication-write failure rollback via injected trigger (741–759), id delete/reuse never publishing stale text or image work (599–615), restart recovery (216–271, 828–933), derived-export streams (activities 1179–1338, feedback 1340–1426, parsed 1428–1503, local views 1962–2149), historical replay (2151–2305), and receipt migration from the draft schema (1916–1960). Quality concerns found are minor: heavy reliance on raw-SQL fixtures that must track schema evolution (e.g. it inserts `memories(…source…)` at 423 and `source_context` at 193 — I verified both columns exist in `20260310000000_create_memories.sql:5-6`); trigger-name coupling in the contract-change test at 1134; several `#[ignore]`d manual benchmarks co-located with CI tests (502–596, 1712–1756) which is intentional per their ignore messages.

**`privacy_stress.rs` — encodes "retention over throughput" literally and correctly.** All tests are `#[ignore]`d manual benchmarks emitting `PRIVACY_METRIC` lines. The invariants that *do* fail the run are retention/privacy ones: durable count must equal every capture (`assert_eq!(durable as usize, n + 3 * samples)` at 400 and 539) and the leak check through the protected pool must be 0 (408–417, skipped only for `mode == "off"` where no gate exists). Conversely, processing falling behind is *not* a failure: `drained` may time out (505–511) and the `ready == total` assertion only applies `if drained` (532–534) — retained-but-pending is the designed outcome, exactly matching the slice focus and AGENTS.md hot-path policy. Gate overhead is measured across off/disabled/ready/pending/sparse/discovery/failure/worker modes (200–258) with rusage-based CPU/RSS accounting (38–70) and a correct percentile helper (30–37; empty-input early return avoids the index panic). The `policy_identity_overhead` legacy-receipt mode installs a temp view by rewriting pooled read-only connections with `PRAGMA query_only=OFF/ON` (801–831) — clever but fragile (a recycled pool connection would lack the view); acceptable for an `#[ignore]`d manual bench. Nothing P0/P1 in either file's content.

**Important caveat:** these are content observations from the origin/main blobs. I did **not** run either file's tests (they are not in the PR under review; the meaningful stress tests are `#[ignore]`d manual release-build benchmarks requiring the `onnx-cpu` feature and model artifacts), and I did not check this PR's CI status. A passed/not-passed claim for the test suites would therefore be false and I make none.

## Posting decision

**Posted nothing** (`gh pr review` not invoked). Justification: the ask says to post if there is something worth posting and otherwise post nothing. My only finding — "the assigned files are not in this PR" — is a review-crew routing fact, not a defect of this PR's code; anchoring it on an unrelated Automation Flows PR whose body claims nothing about privacy tests would misinform the PR thread. It is fully reported here for the lead reviewer instead. There is also no duplication risk: no existing PR comment covers redact/privacy.
