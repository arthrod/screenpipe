# Slice review — Activity Ledger rendering + ledger tests vs engine contract (PR #1)

Reviewer: reviewer-ui-app-ledger
Slice: `apps/screenpipe-app-tauri/components/activity-ledger.tsx` (pagination / large-row performance) and `apps/screenpipe-app-tauri/components/activity-ledger.test.tsx` (tests vs engine `activity_ledger` route contract).

## Headline: this slice is NOT part of the PR diff

- `git diff origin/main...HEAD -- apps/screenpipe-app-tauri/components/activity-ledger.tsx apps/screenpipe-app-tauri/components/activity-ledger.test.tsx` → **empty output** (no changes).
- Both files are tracked and present in HEAD *and* origin/main (`git cat-file -e HEAD:<path>` / `origin/main:<path>` both succeed); working tree clean.
- `gh pr view 1 --json files --jq '.files[].path' | grep -i ledger` → exit 1: GitHub's changed-file list for PR #1 does not include either file.
- `git log --oneline $(git merge-base origin/main HEAD)..HEAD -- <both files>` → no commits: the PR side never touched these files since merge-base 35ed6216.
- Branch topology measured: `git rev-list --count` → 41 commits on origin/main not in HEAD, 315 on HEAD not in origin/main. origin/main has 7 newer ledger-file commits the PR branch lacks (e.g. `5ce7edfcd` "Gate captured data on PII completion receipts (#7634)", `028ef9363` (#7411), `d93bec3ff` (#7137), `b29647ddf` (#6807), `b063e71c1` (#7062), `9f7e915d7`, `c39fa5f8d`). Because the PR side never modified the files, a three-way merge keeps main's newer versions — no conflict and no silent reversion for this slice.

**Consequence for the lead reviewer:** findings below describe pre-existing code at the PR head, not changes this PR introduces. After merge, main's newer ledger code wins; any of these findings may already be fixed by `5ce7edfcd` et al. on origin/main (I did not diff those fix commits' contents against my findings — not run).

Everything else I reviewed stands at the PR head (HEAD = 0b6c5f9d1).

## Contract verification (focus 2): tests match the engine route — VERIFIED

Compared the test mocks/assertions field-by-field against `crates/screenpipe-engine/src/routes/activity_ledger.rs`:

- Query params asserted by tests (`depth=task`, `include_artifacts=true`, `refresh=false` — `activity-ledger.test.tsx:594-605`, and the `refresh=false` request assertion at `activity-ledger.test.tsx:2081-2088`) match `ActivityLedgerQuery` (`routes/activity_ledger.rs:31-49`, snake_case enum at `:22-29`, `refresh` default true with the documented desktop-opt-out at `:44-53`).
- Mock response `LEDGER_ARTIFACTS_RESPONSE` (`activity-ledger.test.tsx:304-340`) matches the engine's consumed subset: interval `start_at/end_at/app_name/evidence` vs `ActivityLedgerInterval` (`routes/activity_ledger.rs:82-101`); evidence `source_type/source_id/occurred_at/frame_id/app_name/window_title/browser_url` vs `ActivityLedgerEvidence` (`:67-80`, all optional-when-null, which the UI type `browser_url?: string | null` at `activity-ledger.tsx:142` accepts). Timestamp formats (`Z` in mocks, RFC3339 `+00:00` from `to_rfc3339()` — asserted at `routes/activity_ledger.rs:587`) both parse via `new Date()`.
- Test run: `cd apps/screenpipe-app-tauri && bun x vitest run --config vitest.config.ts components/activity-ledger.test.tsx` → **56/56 passed** (single file, scoped run — not the full frontend suite).
- Caveat (P3, posted): the mock intervals omit ten engine-required fields (`id, task_id, parent_task_id, kind, title, category, state, confidence, producer, evidence_count`, `routes/activity_ledger.rs:82-101`). Harmless today because the hand-rolled UI types (`activity-ledger.tsx:109-126`) declare only the consumed subset, but nothing binds those TS types to the engine's oasgen schema — an engine-side rename of a consumed field (e.g. `occurred_at`) would pass these tests while breaking production.

## Performance / rendering findings (focus 1) — all pre-existing

1. **P2 — no pagination/virtualization by design; cost scales with whole-range entry count.** All entries render (`groupByDay` → `groupedEntries.map` at `activity-ledger.tsx:2202-2272`), each a full `<article>` with tooltip + icon subtree (`ActivityEntryArtifacts`, `:2243-2248`). The no-pagination behavior is intentional — `activity-ledger.test.tsx:1877-1899` asserts there is *no* "Generate more results" control — so the risk rests entirely on the native generator's per-range entry volume, which is unbounded in anything I read (the engine caps only the `/activity-ledger` query at 31 days, `routes/activity_ledger.rs:129-131`; I could not find a bound on `getActivityHistory` output in this slice). On the 7d/custom presets with dense days this renders hundreds of interactive rows at once.
2. **P2 — O(entries × intervals) artifact matching with per-pair Date parsing.** `artifactsForHistoryEntry` (`activity-ledger.tsx:522-683`) is memoized per entry (`:1182-1185`) but every rendered entry iterates the full-range `ledgerIntervals` array (`:2245`), parsing `interval.start_at`/`end_at` strings per pair (`:534-535`) and per evidence row (`:552`). Per fetch/generation cycle that is E×I `new Date()` parses on the main thread. Pre-parsing intervals once per fetch, or sorting intervals by start and windowing per entry, removes the quadratic factor.
3. **P3 — `new Intl.DateTimeFormat` constructed per entry per render.** `formatEntryTime`/`formatEvidenceTime` (`activity-ledger.tsx:438-450`) build a fresh formatter on each call; `formatEntryTime` is called in render for every entry (`:2231`). Formatter construction is expensive; module-level cached formatters fix it. Same pattern in `formatDay` (`:1296`) and `formatPreviewRange` (`:862-865`), bounded by day-group/tooltip counts.
4. **P3 — `groupByDay` copies the day array per entry** (`activity-ledger.tsx:1303-1310`: `[...(groups.get(key) ?? []), entry]`) — O(n²) allocations per day group; push-into-array is equivalent and linear.
5. **P3 — "Yesterday" header mislabels on DST-transition days.** `formatDay` (`activity-ledger.tsx:1290-1301`) compares local-midnight timestamps to `today - 86_400_000`; across a DST boundary the gap is 23 or 25 hours, so the previous day shows as a weekday name instead of "Yesterday" (cosmetic).
6. **P3 — custom range > 31 days silently loses artifact icons.** The engine rejects such ranges with 400 (`routes/activity_ledger.rs:129-131`), the UI converts any non-ok `/activity-ledger` response to `{intervals: []}` with no surfacing (`activity-ledger.tsx:1568-1573`), and no test covers a long custom range. I did not verify how `/activity-summary` behaves for the same range, so I scope this claim to the ledger artifacts only.

## What I could not check

- Whether origin/main's newer ledger commits already address findings 1–6 (contents of those commits not read).
- Any bound on `commands.getActivityHistory` output size (native side outside this slice).
- `/activity-summary` and `/meetings` contracts (outside the assigned route).
- Did not run the full frontend suite or any Rust tests; only the single vitest file named above.

## Posted comment

Posted as one review comment (`gh pr review 1 --comment --body-file`) containing the slice-not-in-diff note, the contract verification result, and findings 1–6 with severity tags. Existing PR feedback (all `coderabbitai[bot]`, plus bot-skip notices from `codeant-ai[bot]`/`qodo-code-review[bot]`) touches none of these files — nothing duplicated.
