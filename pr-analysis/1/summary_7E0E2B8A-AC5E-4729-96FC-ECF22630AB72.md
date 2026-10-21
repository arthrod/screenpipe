# Reviewer summary — pii-release-gate benchmark slice (reviewer-bench-pii-method)

**Headline: the assigned slice files are NOT part of PR #1's diff — they exist only on the base branch (`arthrod/screenpipe:main`) via an upstream sync. I reviewed their content there; it is numerically clean. Nothing was posted on the PR conversation.**

## 1. Slice/PR mismatch (the material fact for the lead reviewer)

Every check below was run in this session:

- `git diff origin/main...HEAD -- docs/benchmarks/pii-release-gate/` → **empty output**.
- GitHub API `gh api repos/arthrod/screenpipe/pulls/1/files` (paginated) → 234 changed files, **zero** under `docs/benchmarks/` (PR metadata: base `arthrod/screenpipe:main`, head `KylianAUBRY/screenpipe_LH:main` @ `0b6c5f9d1`, cross-repo).
- Local HEAD == PR head (`0b6c5f9d1`); `docs/benchmarks/pii-release-gate/` does not exist in the working tree or HEAD tree (`git ls-tree HEAD -- docs/benchmarks/` shows only `SCR-164-frame-thumbnails.md`).
- Not a lost merge: both parents of HEAD's merge commit (`873c5355f`, `c62ecd19f`) lack the files (`git cat-file -e <parent>:docs/benchmarks/pii-release-gate/EDGE-CASES.md` → absent for both).
- The files exist at `origin/main` (`d75ccaedd`) and were added there by `5ce7edfcd` ("Gate captured data on PII completion receipts (#7634)") — an upstream-sync commit inside `35ed62162..origin/main`, i.e. on the **base** branch after this PR branched (merge-base `35ed62162` lacks them).

So my focuses (EDGE-CASES mapping, DERIVED-UPLOADS enumeration, run.py timing, fixtures PII, plot.py vs RESULTS.md, machine.json, merge-readiness-metrics vs RESULTS.md) were evaluated against `origin/main:docs/benchmarks/pii-release-gate/*` — extracted to `/tmp/pii-slice-review/` via `git show origin/main:<path>`; no repository file was modified.

## 2. What the slice is

A manual benchmark evidence pack for the upstream PII release gate (screenpipe#7634): `run.py` drives ignored Rust benchmark tests (`privacy_stress` binary) across scale/model/identity suites; `fixtures.py` renders synthetic screenshots; `plot.py` regenerates two committed charts from committed JSONL; `RESULTS.md` / `EDGE-CASES.md` / `DERIVED-UPLOADS.md` / `MERGE-READINESS.md` are three dated revisions of measurements (Oct 14/15 M5 Max release profile; Oct 16 M1 Max debug profile), each with an explicit "historical snapshot" banner (e.g. RESULTS.md:3) pointing at MERGE-READINESS.md for current validation.

## 3. Verification I ran (all passed)

Numbers were recomputed from the committed raw JSONLs, not trusted from prose:

- **plot.py aggregation == RESULTS.md capture table**: median-of-3 run p95s and min–max ranges match all 8 modes exactly (off 0.651 [0.589,0.817] … discovery 7.855 [5.942,8.068]) — ran the same filter/median as plot.py:12-14 over `scale-results.jsonl`.
- **Case-count integrity**: run.py matrices give 12+24+5 = 41 scale cases (run.py:31), 7 model cases with images (run.py:36-45), 4 identity cells (run.py:47-50) — exactly RESULTS.md:7's "41 scale cases and seven model/stress cases … four policy-ID sensitivity cases"; scale-results.jsonl has 41 lines, model-results.jsonl 7, identity-results.jsonl 4.
- **RESULTS.md every table traced**: queue/status medians (4×2), read-latency (8 cells incl. 1-run 1m rows, n=1 confirmed), storage db/wal (5 rows), capture CPU-per-insert (8 modes), identity search/count/capture/db/wal/RSS (4 cells), repeat table (incl. text-2 original 57.27/91.06/98.80, pending 131), model-init RSS (6), image table (3 resolutions: first-call, p50/p95/max, worker s and images/s), large-fields (2.321/36.978/569.292 s), mixed final counts (145 released / 41 image pending / 179 text-surface pending) — **all match** the raw records.
- **MERGE-READINESS.md tables 1 & 2 + ONNX scheduling == merge-readiness-metrics.json**: e.g. broad FTS 12,542.53/1,710.28, latest 22.846/0.308, count 1,795.79/678.52, capture 3.129/1.728, db bytes 2,948,968,448/667,574,272; gate-absent control 9 values; one-shot 2,908.877 ms vs 11 windows avg 264.346 max 267.027 — all match.
- **DERIVED-UPLOADS.md medians/ranges == its own 18 raw sample lines** (DERIVED-UPLOADS.md:32-49 vs table :13-17), and arithmetic holds: 18,000 timed writes = 3 cases × 2 journal states × 3 runs × 1,000; 175 targeted tests = 30+143+2 (DERIVED-UPLOADS.md:56-58,63).
- **EDGE-CASES.md mapping**: all 24 referenced test names exist at `origin/main` under `crates`/`apps` (git grep), as does `privacy-processing-status.test.tsx`.
- **Referenced SHAs exist**: `4891123c` (machine.json:13 source_base), `b40eda11d` (DERIVED-UPLOADS.md:5), `497df0c721` (DERIVED-UPLOADS.md:65) — all resolve to commit objects.
- **DERIVED-UPLOADS.md:65's 52-vs-49-byte claim verified**: `MANUAL_SCREEN_CAPTURE_RECOVERY_DETAIL` = "quit and reopen screenpipe to restore screen capture" (52 bytes, `overlay_health.rs:43-44` at origin/main) vs `assert!(expected.len() <= 49)` in `overlay_failure_details_are_brief_specific_and_privacy_safe` (`apps/screenpipe-app-tauri/src-tauri/src/health.rs:3074`, assertion at ~3157) — a statically failing test on the base branch, honestly disclosed by the doc.

**fixtures.py contains no real PII** (focus satisfied): content is fully hardcoded — "Jordan Example", `jordan@example.test` (reserved `.test` TLD), `sk_test_0123456789abcdef0123456789` (sequential placeholder hex); deterministic, no randomness, no network, no reads besides the required font path (fixtures.py:8-15).

## 4. Findings (detail in comments file; none posted)

- **P2** — The Oct-16 M1 Max measurement set has the weakest environment record: MERGE-READINESS.md records no source revision and no binary hash anywhere in the file (env only in prose, MERGE-READINESS.md:3); machine.json was never extended for it. The Oct-14/15 set by contrast is exemplary (machine.json:2-29).
- **P3** — run.py:12: harness-written machine.json lacks git rev / binary hash / profile; the committed machine.json was evidently hand-enriched, so the raw harness artifact under-records environment.
- **P3** — run.py:24-25: unknown test name → KeyError abort (losing that case's results.jsonl record); success gate is a brittle literal `'1 passed; 0 failed'`; phase presence checked but not sample counts. run.py:22-26: malformed `PRIVACY_METRIC` line aborts before the record is appended (per-case .log survives).
- **P3** — No harness-level warmup anywhere in run.py; the docs disclose uncooled filesystem caches and equal-reader capture comparisons (RESULTS.md:11, README.md:28-29), but whether the Rust binary warms up internally is **not verifiable from this slice's files**.
- **P3** — merge-readiness-metrics.json: sparse `concurrent_latest` p95 701.43 ms (MERGE-READINESS.md:29) is n=4; the five-observation caveat (MERGE-READINESS.md:17) covers the reads table but not the reader column's tiny n.
- **P3** — plot.py:13,27: empty selections crash with opaque `StatisticsError`/`StopIteration` (manual tool; low impact).

## 5. Not checked / not run

- The Rust/JS test suites themselves (out of scope for this doc-review slice; not requested). Correctness claims rest on the docs' own recorded command results, which I did not re-execute.
- That `binary_sha256` (machine.json:12) corresponds to a build of `source_base` — would require rebuilding; not done.
- Hardware/OS claims (M5 Max/18 cores/macOS 26.6.2 vs M1 Max/10 cores/macOS 26.4) — taken as recorded; internally consistent across machine.json and RESULTS.md:5 but externally unverifiable here.
- DERIVED-UPLOADS.md:19 process observations ("7.17 seconds", "no compiler processes") — not reconstructible from committed raw data.
- `excluded-fixture-run.jsonl` and the *.png artifacts — outside my seven-file list; only their cross-references were checked.

## 6. Why nothing was posted on the PR

`gh pr review 1 --comment` was pre-authorized but **not used**: the slice files are not in PR #1's diff, so review comments would anchor to paths absent from the PR and land on the automation-flows author's conversation as noise. The findings belong to the base branch / upstream PR #7634 owners. The comments file records what would have been posted so the lead reviewer can redirect it.
