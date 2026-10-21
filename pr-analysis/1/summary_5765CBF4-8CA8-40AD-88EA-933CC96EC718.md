# Review: vision_manager slice (PR #1)

Slice assigned: `crates/screenpipe-engine/src/vision_manager/manager.rs` (frame-drop under load), `crates/screenpipe-engine/src/vision_manager/monitor_watcher.rs` (display hot-plug), `crates/screenpipe-engine/tests/native_multi_monitor.rs` (multi-monitor native test).

## Headline finding: this slice has NO diff in the PR

`git diff origin/main...HEAD -- <the three slice files>` (the exact command the ask names) is **empty** (exit 0, no output). The PR introduces no change to any of the three files, and no PR-side commit touches `crates/screenpipe-engine/src/vision_manager/` at all (`git log origin/main..HEAD -- crates/screenpipe-engine/src/vision_manager/` is empty).

The changes my slice's focuses describe exist on the **base** branch, not in the PR:

- `origin/main` (arthrod/screenpipe `main`) = `d75ccaed`, PR base ref confirmed via `gh pr view 1` (`baseRefOid` matches).
- PR head = `0b6c5f9d1` (KylianAUBRY/screenpipe `main`), identical to this checkout's HEAD — confirmed via `headRefOid`.
- Merge-base = `35ed6216`. The PR head branched before the vision work landed on base and never merged it back.
- Base-side commits after the merge-base that touch the slice files:
  - `99f0fdb99` (Oct 16) "fix(health): expose unresolved focus and never-progressed capture" — adds `VisionManager::focus_resolution_degraded()` (5 lines) to `manager.rs`.
  - `4e82a52d8` "test(macos): exercise native multi-display focus and capture recovery" — adds `src/multi_monitor_vm_test.rs`.
  - `77001166c` (Oct 17) "Fix Retina capture dimensions and refresh live macOS display configurations" — the real substance: `manager.rs` replaces `monitor_sck_backends: DashMap<u32, bool>` with `monitor_configurations: DashMap<u32, CaptureConfiguration>` and `active_monitor_uses_sck()` with `active_monitor_needs_refresh()` (compare fresh topology vs. the immutable handle a task holds); `monitor_watcher.rs` rewrites the macOS reconcile loop (old lines ~1108–1140) from "upgrade CoreGraphics fallback when SCK recovers" to "refresh the recording task whenever `capture_configuration().should_replace()` says the Retina scale/layout or backend generation changed"; adds `tests/native_multi_monitor.rs` (573 lines) and deletes the 426-line `src/multi_monitor_vm_test.rs`. Base-side stat: 3 files, +607/−27.
- `tests/native_multi_monitor.rs` **does not exist in the PR head** (`git cat-file -e HEAD:...` fails); it exists only on base. The old VM test is absent from merge-base, head, and base alike — added and deleted entirely on the base side, so that is not a PR-side deletion either.

Consequences, verified:

- **Merging the PR does not lose or revert the base vision work.** `git merge-tree --write-tree origin/main HEAD` shows no conflict in any vision_manager file; since the head never modified them, the merge result keeps base's versions. (The same merge-tree run does report conflicts in two unrelated paths — `apps/screenpipe-app-tauri/components/workflows/step-evidence.test.tsx` and `packages/workflows-ui/src/workflow-step-evidence.module.css` — outside my slice, flagged for whoever owns those.)
- **Tip-to-tip diffing produces phantom reverts.** `git diff origin/main..HEAD` (two-dot) shows manager.rs (43 lines) / monitor_watcher.rs (18 lines) "changed" and the 573-line native test "deleted" — these are reversals of base-side work, not PR changes. This reviewer's own slice assignment was generated from exactly such a diff; any reviewer or tool diffing tip-to-tip will see the same mirage.

## On the assigned focuses

- "Frame-drop behavior under load" in `manager.rs`: I grepped both the PR-head version and the base-side diffs for frame-drop logic (`grep -ni "drop|frame"` over the head file; `git show 77001166c | grep -i drop`). No frame-dropping policy exists or changed in either; the head's `manager.rs:754-789` just spawns `event_driven_capture_loop` and logs failure. The only "Drop" hits in 77001166c are RAII/fixture impls. I found no change matching this focus on either side — reported as not found, not guessed.
- "Display-change handling (hot-plug)" in `monitor_watcher.rs`: real and substantial, but it lives in base's `77001166c`, not in this PR. The PR head retains the older reconcile loop (`monitor_watcher.rs:1111-1141` in this checkout), which only upgrades a CoreGraphics fallback when SCK recovers and does not react to same-ID Retina scale/layout changes.
- "Multi-monitor native test real-display assumptions": the test exists only on base. For context I read it in full (`git show origin/main:...`). It is deliberately well-gated: hard-requires `SCREENPIPE_ISOLATED_VM_TEST=1` and a `SCREENPIPE_DISPLAY_FIXTURE` binary, self-skips otherwise (base lines 538-545), asserts a 2-display topology up front (line 178), uses generous 12–20 s deadlines with 100 ms polls, and handles the OS clamping the cursor instead of assuming a literal off-display gap is possible (lines 262-297). Flakiness risk is modest and it never runs in ordinary CI — but again, it is not part of this PR.

## Code read for context (unchanged by the PR — no findings posted against it)

I read `manager.rs` (1336 lines) and `monitor_watcher.rs` (1834 lines) in full at the PR head. Quality is good: watch-dog thresholds are pure, unit-tested decision functions (`monitor_watcher.rs:188-302, 326-412`), user-pause intent is kept separate from task liveness (`manager.rs:168-183, 909-949`), DashMap iteration avoids holding refs across await (`manager.rs:838-876`), and the documented restart-cooldown/attended-window orderings have regression tests (`monitor_watcher.rs:1509-1622`). Since the PR does not modify this code, none of this is a PR finding and I posted nothing about it.

## Existing PR feedback checked

Ran fetch-pr-feedback for PR #1: 4 issue comments + 15 line-specific review comments, all from bots (coderabbitai/codeant/qodo), none touching my slice — no duplication risk. Full formatted artifact retained in this session's transcript.

## Not done / not run

- No test suite or build was run: the ask named no check to execute, and with an empty slice diff there is nothing PR-introduced to test. Everything above is git plumbing output and file reads from this session.
- I did not review the conflicts in the two workflows-ui paths beyond noting their existence.
