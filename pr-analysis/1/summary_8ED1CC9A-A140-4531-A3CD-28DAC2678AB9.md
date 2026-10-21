# Reviewer slice report — a11y macOS split-out (clipboard_delivery.rs, input_focus.rs, text_buffer.rs)

Reviewer: reviewer-rust-a11y-macos-split · PR #1 (`arthrod/screenpipe`, head branch `main`, title "kkkk") · 2026-10-20

## Headline: the assigned slice is NOT part of this PR's diff

All three slice files are absent from the PR. They exist only on **origin/main**, added by commit
`0de3734d2` ("fix(a11y): retain input under backpressure and publish coherent focus", Louis
Beaumont, 2026-10-17), which is **not** in the PR head's history. Evidence (all commands run in
this session):

- `git diff origin/main...HEAD --stat -- crates/screenpipe-a11y/` → **empty** (no a11y file in the
  merge-base diff, which is what GitHub's "Files changed" shows). Same for the three individual
  paths.
- `git merge-base origin/main HEAD` → `35ed62162` (Ezra Ellette, 2026-10-16). `git rev-list --count
  35ed62162..origin/main` → **41** (the branch is 41 commits behind main).
- `git merge-base --is-ancestor 0de3734d2 HEAD` → not an ancestor; `--is-ancestor 0de3734d2
  origin/main` → ancestor. `git ls-tree 35ed62162 -- crates/screenpipe-a11y/src/platform/macos/` →
  empty (merge base predates the split).
- `git ls-tree HEAD -- crates/screenpipe-a11y/src/platform/macos/` → empty; working tree has only
  `macos.rs`, no `macos/` directory. HEAD's `macos.rs` is 3574 lines and contains **no**
  `mod clipboard_delivery / input_focus / text_buffer` declarations; origin/main's `macos.rs` is
  3675 lines and declares them at `macos.rs:30-32`.
- `gh pr diff 1` fails with **HTTP 406** ("Sorry, the diff exceeded the maximum number of lines
  (20000)") — GitHub's API cannot serve this PR's diff at all; the local merge-base diff is the
  only way to review it. (codeant-ai[bot]'s top-level comment independently says the PR changes
  more than 100 files.)
- PR scale vs merge base: `git diff origin/main...HEAD --stat` → 234 files changed, 34606
  insertions(+), 600 deletions(-).

Merge-safety reasoning (derived from the above tree states, not run as a merge): the merge base
lacks `macos/`, main adds it, the PR head does not touch it — a standard three-way merge keeps
main's versions with no conflict. The residual risk is process risk: this branch is being reviewed
and merged 41 commits stale, and its tree predates the a11y split entirely. Recommendation
(posted on the PR): merge `origin/main` into the branch before final review/merge.

Because the ask assigned these files as my slice, I reviewed their content from `origin/main`
(extracted via `git show origin/main:<path>` into /tmp; the files do not exist in this checkout).
Nothing below is introduced by this PR.

## What the three modules do (origin/main content, commit 0de3734d2)

`0de3734d2` splits 514 changed lines out of `macos.rs` into three focused modules plus a new e2e
test file (`macos_click_attribution_e2e.rs`, +206) and docs updates:

1. **`clipboard_delivery.rs` (304 lines)** — serialized clipboard snapshot admission
   (`ClipboardDelivery::capture_and_deliver`, lines 26-68): takes the dedup-gate mutex *before*
   reading the snapshot, suppresses generations ≤ the last successfully delivered one (line 38),
   and on a full output channel retains the exact event and retries with 20 ms bounded
   `send_timeout` (lines 41-67), honoring `stop` for shutdown (line 54). Only successful sends
   advance the watermark (lines 46-48, 58-61). `stable_snapshot` (lines 83-95) bounds torn-read
   retries at 3. Paste gestures (`generation = None`) intentionally bypass dedup (line 38 guard).
   Five concurrency/privacy tests (lines 97-304) cover full-channel retention, stop/disconnect
   watermark honesty, racing producers, overtake-during-read, and excluded-focus transitions.

2. **`input_focus.rs` (103 lines)** — a published, immutable focus snapshot (`InputFocus`,
   lines 7-28) whose `allowed` flag is computed once at resolve time via
   `config.should_capture_target`, defaulting to **denied** (`Default`, line 6). `with_allowed_focus`
   (lines 32-42) checks `allowed` before the native read and requires `Arc::ptr_eq` on a re-load
   after it, so a delayed clipboard read can never inherit an allowed context that changed
   mid-read. Loop-free and O(1) — no polling lives in this file. The "focused-element polls must
   be bounded" concern is satisfied in the caller, not here: the clipboard poller in `macos.rs`
   (lines 622-680, origin/main) sleeps in ≤100 ms interruptible slices with documented worst-case
   shutdown latency. Two tests cover privacy transitions and identity/privacy co-update.

3. **`text_buffer.rs` (244 lines)** — pure-Rust keystroke burst buffer (header line 3: "No native
   calls"). Attribution is frozen at input time (`push_burst`, lines 74-95); a focus/window change
   splits the burst. `capture` (lines 125-142) bounds only the *transition* queue (`pending`) to
   `capacity` and counts rejected characters instead of evicting accepted text. `take_ready`
   (lines 146-157) returns the retained retry first — preserving FIFO — and carries a `prepared`
   bool so PII redaction never runs twice on a retained event (comment lines 144-145). Three tests
   (lines 179-244) cover saturation accounting, a 6000-char single-burst Unicode case, and
   retry ordering/no-double-redaction.

## Findings

No P0/P1/P2 issues found **in the three slice files**. The code is careful, the invariants are
stated in comments, and the test coverage targets exactly the races the comments claim to prevent
(both `capture_and_deliver` tests and the `with_allowed_focus` test force the interleavings with
barriers/channels rather than sleeps). Three P3s, posted on the PR, clearly labeled as
out-of-diff:

- **P3** `clipboard_delivery.rs:31` — `capture_and_deliver` returns a bare `bool` conflating
  "delivered", "stale duplicate skipped" (both `true`), and "stopped / disconnected / focus
  excluded mid-read" (all `false`); the caller's single `debug!` (`macos.rs:573`, origin/main)
  cannot distinguish a common benign case (copy inside an excluded app → `false` every time) from
  a permanent consumer disconnect. Log-only concern; behavior is correct.
- **P3** `input_focus.rs:41` — the `ptr_eq` re-check is deliberately conservative and also discards
  a capture when the focus was *re-published* with a new `Arc` for the same app/window during the
  50 ms delayed copy read (`macos.rs:1344`, `KEY_C → delay 50 ms`, origin/main). Privacy-safe
  direction (loses captures, never leaks), but it is an occasional silent clipboard-event loss.
- **P3** `text_buffer.rs:53-61` + `125-142` — `chars` has no length cap; `capacity` bounds only the
  transition `pending` queue. Continuous same-app typing never satisfies `should_flush`
  (time-based, line 172-176), so `chars` grows for the whole uninterrupted session and is flushed
  as one giant event. Human typing rates make this a few KB in practice, so it is a hygiene issue,
  not a hot-path risk (growth happens on the tap callback thread via amortized `String::push`).

## What I could not check / did not run

- **AXCF ref memory safety** (the stated focus for `text_buffer.rs`): not applicable to this file —
  it contains no native calls and no CF/AX references (verified by reading the full file; header
  line 3 declares "No native calls"). The actual `cidre`/`AutoreleasePoolPage` ref handling lives
  in `macos.rs` (e.g. lines 586, 724 on origin/main), which is outside my slice and was **not
  audited**.
- **Tests not run.** The files do not exist at the PR head, so the checkout cannot compile them;
  running origin/main's tests would require checking out another commit (prohibited here). The
  ask named no test command. All test-related statements above are from reading the test code,
  not from executing it.
- I did not verify GitHub's PR page rendering directly (the 406 above is from `gh pr diff`); the
  merge-base diff is the local proxy for what the PR shows.
- Existing PR feedback checked to avoid duplication (fetch-pr-feedback, `--pr 1`): 4 top-level
  comments (codeant-ai skip notice, qodo paused notice, two coderabbitai posts) and 15
  line-specific coderabbitai comments — **none touch the a11y crate** (all in automation-flows
  paths). My posted comment duplicates nothing.
