# Reviewer slice summary — library.test.tsx + local-editor-parity.test.tsx (PR #1)

Reviewer: reviewer-lib-app-workflows-parity · 2026-10-20 · PR arthrod/screenpipe#1
(base `main` @ d75ccaedd = local `origin/main`, head `KylianAUBRY/main` @ 0b6c5f9d1 = local HEAD; cross-repo, OPEN)

## Headline

**Neither assigned file is part of this PR's diff, but the PR collides head-on with both of them at merge time.** The PR conflicts with `main` in exactly 5 files (`workflows-app.tsx` among them — the component both assigned test files exercise). Simulating both one-sided conflict resolutions on the auto-merged tree: taking upstream's side passes all tests but silently discards ~355 lines of this PR's Automation-Flow UI; taking this PR's side breaks one test in each assigned file with exact, reproduced failures. One P1 comment posted with reconciliation guidance.

## Slice reality (verified, not assumed)

Commands run and their outputs:

- `git diff origin/main...HEAD --stat -- apps/screenpipe-app-tauri/lib/workflows/library.test.tsx apps/screenpipe-app-tauri/lib/workflows/local-editor-parity.test.tsx` → **empty output** (no diff).
- `git log --oneline origin/main..HEAD -- .../library.test.tsx` → **no commits**; the file is byte-identical between the merge base (35ed62162, verified `git cat-file -e`) and HEAD.
- GitHub PR files API (`gh api --paginate repos/arthrod/screenpipe/pulls/1/files`, 234 paths, matches `changedFiles: 234`) → **neither filename appears**.
- `local-editor-parity.test.tsx` **does not exist at the PR head at all** (`git ls-files`, working-tree `ls`, and `git cat-file -e 35ed62162:...` all negative). It was introduced on the **base side** after the branches diverged (upstream #7695, commits 7f91fc740 / 0b1c87ddc; later touched by #7715/#7716). It exists at `origin/main` (174 lines) and will **appear in the merge result from the base side**.
- Why the slice assignment likely exists: the reversed two-dot diff (`git diff origin/main HEAD`) shows `library.test.tsx` "modified" (those changes are base-side, 41 commits in `HEAD..origin/main`) and `local-editor-parity.test.tsx` "deleted" (174 deletions) — artifacts of `main` moving ahead, not PR changes.

So there is no PR-introduced code in this slice to review; I reviewed both files at the versions that matter and treated their interaction with the PR's changes as the review target.

## What the files are (both read in full)

- `apps/screenpipe-app-tauri/lib/workflows/library.test.tsx` (155 lines at HEAD; 12 tests). Covers the assigned focus "catalog loading and error surfaces" well: load-error retention with a retry affordance instead of an empty state (`library.test.tsx:44-51`), skills fallback when installed-skill discovery fails (`:60-66`), Library stays reachable when the backend cannot load (`:67-73`), autosave serialization keeping the newest edit (`:116-130`), failed-save recovery across remount (`:132-145`), share gating (`:103-114`). Assertions are role/label-based — good quality. Minor pre-existing nits (not PR findings, not posted): an `act()` warning observed in my run for "shares saved recipe edits rather than its source workflow" (`:147-154`), and a fixed 400 ms sleep in the debounce test (`:124`).
- `apps/screenpipe-app-tauri/lib/workflows/local-editor-parity.test.tsx` (174 lines, read at `origin/main`; absent at HEAD). The "local-workflow-parity" guard: parameterize/rename variables with URL/code preservation, editor-driven variable creation + undo, persistence of variables/archive/versions, revision-checked restore with typing retention, legacy ID allocation, linked-workflow navigation, document archive/review filters, keyboard-driven more-actions menu.

## How the slice fits the PR — the actual finding

The PR modifies shared workflows-ui modules the assigned tests import: `packages/workflows-ui/src/workflows-app.tsx`, `model.ts`, `platform.ts`, `workflow-step-evidence.tsx/.module.css`, `workflows-app.module.css`, `rich-text.module.css`, `workflow-questions.tsx` (from the 234-file PR list). Meanwhile base evolved the **same** components (upstream #7715 "Simplify workflow actions to match Studio", #7716 "Studio document exports", #7695 "variables and document tools to local workflows").

Checks I ran this session (exact commands in the posted comment):

1. **Merge state**: `git merge-tree --write-tree origin/main HEAD` → exit 1; content conflicts in `apps/screenpipe-app-tauri/components/workflows/step-evidence.test.tsx`, `packages/workflows-ui/src/workflow-step-evidence.module.css`, `workflow-step-evidence.tsx`, `workflows-app.module.css`, `workflows-app.tsx`. GitHub corroborates: `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`.
2. **PR head as-is**: `bun x vitest run --config vitest.config.ts lib/workflows/library.test.tsx` in `apps/screenpipe-app-tauri` → **12/12 pass** (~1.9 s).
3. **Merge sim, conflicts → upstream side** (auto-merged tree from merge-tree + the 5 files from `origin/main`, harness in `/tmp`, no repo writes): same vitest command over both assigned files → **23/23 pass** — but every Automation-Flow change in those 5 files (pinned task header, `OpenAutomationButton`, review-request catalog reload, `timelineLabel`, evidence styling; 355 insertions across the 5 since merge base per `git diff --stat 35ed62162 HEAD`) would be silently dropped.
4. **Merge sim, conflicts → PR side**: **2 failures / 21 passes** —
   - upstream `library.test.tsx:94` ("a background workflow revision does not close its open SOP") → `Unable to find role="menuitem" and name "Open SOP"`: upstream opens SOPs via the "More workflow actions" menu (`workflows-app.tsx:741` at origin/main), the PR renders it as a direct button (`workflows-app.tsx:730` at HEAD);
   - upstream `local-editor-parity.test.tsx:145` → `expected <h2></h2> to be null`: upstream hides archived workflows by default and filters via the "Workflow status" combobox; the PR's merge-base-era `WorkflowsView` predates that behavior.

Both failures trace to `workflows-app.tsx` alone; the step-evidence overlays were not implicated in these two assertions.

## Notable risks

- **P1**: naive conflict resolution in either direction is bad (silent PR-feature loss vs. breaking two upstream test files). Posted with guidance: merge `origin/main` into the branch, port the Automation-Flow wiring onto upstream's current `workflows-app.tsx`, reconcile the "Open SOP" entry point and default archive visibility, then re-run both test files plus the step-evidence tests.
- The two assigned test files will run in CI on GitHub's merge-preview commit even though they are absent from this branch — failures will surface only at merge time if not fixed pre-merge.

## Not run / not checked (stated plainly)

- The full frontend suite (`bun run test` = vitest + bun runner) — only the two named test files were executed, at file scale, in three tree variants.
- The other three conflicted files' ideal union resolution (step-evidence) — owned by other slices; I only bounded the outcomes.
- CI status of the PR; Rust/engine code (outside slice).
- My merge sims model "take one side wholly", not a hand-merged union; a correct union may pass everything (the 21 other tests passed in the take-head sim).
