**P2 (branch hygiene / review integrity) — PR-level, no line anchor: this branch is missing the vision-manager work that already landed on `main`, so tip-to-tip diffs show phantom reverts**

Per the PR's own diff (`git diff origin/main...HEAD`, base `d75ccaed` = this PR's `baseRefOid`, head `0b6c5f9d1` = `headRefOid`), none of `crates/screenpipe-engine/src/vision_manager/manager.rs`, `.../monitor_watcher.rs`, or `crates/screenpipe-engine/tests/native_multi_monitor.rs` are changed by this PR — the three-dot diff for them is empty, and no commit on this branch touches `vision_manager/`. The vision changes exist on `main` after this branch diverged (`git merge-base` = `35ed6216`) and were never merged back:

- `99f0fdb99` — health: `VisionManager::focus_resolution_degraded()`
- `77001166c` — "Fix Retina capture dimensions and refresh live macOS display configurations": `monitor_sck_backends` → `monitor_configurations`, `active_monitor_needs_refresh()`, the monitor-watcher reconcile loop now refreshes tasks on same-ID Retina scale/layout changes (not just SCK recovery), and adds the 573-line `tests/native_multi_monitor.rs`.

Anyone diffing the two tips directly (rather than GitHub's merge-base view) will see `manager.rs`/`monitor_watcher.rs` "reverted" by 43/18 lines and the 573-line native multi-monitor test "deleted" — those are reversals of `main`'s work, not changes this PR makes. Tooling and reviewers fed such a diff will chase mirages; this reviewer's slice assignment was generated from exactly one.

Verified safe for the merge itself: `git merge-tree --write-tree origin/main HEAD` reports no conflict in any vision file, and since this branch never modified them, merging keeps `main`'s versions — no vision regression ships via this PR. The same merge-tree run does show real conflicts in `apps/screenpipe-app-tauri/components/workflows/step-evidence.test.tsx` and `packages/workflows-ui/src/workflow-step-evidence.module.css`.

Suggested fix: merge `origin/main` into this branch before further review. That clears the phantom vision diffs, resolves the two real conflicts, and puts the PR's 234-file diff on a honest footing.
