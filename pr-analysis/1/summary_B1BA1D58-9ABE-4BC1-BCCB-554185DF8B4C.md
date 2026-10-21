# Reviewer slice: web eval scripts (step controls, block types, schedule toggle, enterprise entry)

**Headline: none of the four slice files is part of PR #1's diff — and all four evals PASS when run against the PR-head code.** No PR-diff findings in this slice; nothing was posted on the PR.

## 1. The slice is not in the PR diff (verified)

PR #1: base `main` @ d75ccaedd, head @ 0b6c5f9d1 (this checkout, branch `KylianAUBRY/main`); GitHub computes the diff through merge-base 35ed62162. Evidence gathered this session:

- `git diff origin/main...HEAD --stat -- <the four files>` → **empty**.
- `git diff 35ed62162 HEAD --name-only -- apps/screenpipe-workflows-web/` → **empty**; the whole directory is identical between merge-base and HEAD (`git ls-tree HEAD` shows all four files tracked at blob level).
- `git log --oneline -5 HEAD -- apps/screenpipe-workflows-web/scripts/eval-step-controls.cjs` → only d3bebe820 ("fix(workflows): align local step controls and timing disclosure (#7648)"), which is already in main's history.
- `git diff origin/main HEAD --name-only -- apps/screenpipe-workflows-web/scripts/` *does* list them, but those deltas come from **main-side** commits the PR does not contain (notably 6f39a0f2b "Simplify workflow actions to match Studio (#7715)"). The PR head is simply behind main for these files.
- The PR touches nothing under `.github/` (`git diff origin/main...HEAD --name-only -- .github/` → empty), so CI wiring for these evals is unchanged.

Why the slice still matters: the PR modifies `packages/workflows-ui/` (`workflows-app.tsx`, `workflow-questions.tsx`, `platform.ts`, `model.ts`, CSS), and these four evals drive exactly those surfaces through the web preview (port 1431) and the desktop browser-mock (port 1420) — see `apps/screenpipe-app-tauri/README.md:56-75`. Whether the PR's UI changes broke them was unverified until I ran them (below).

## 2. What each file is, assessed against its focus lens

All four are Playwright browser checks with the repo header, writing screenshots to `/tmp`, exiting non-zero on failure.

- `apps/screenpipe-workflows-web/scripts/eval-step-controls.cjs` — editor step controls: hover-only reveal (lines 26-35), actions menu (40-52), timing disclosure (58-72), insert/delete/autosave (75-94), keyboard + drag reorder, undo, reload persistence (96-122), touch/narrow + reduced motion (124-143). **Keyboard accessibility coverage is real**: Tab-from-focus assertions (43-45), Escape closes the menu and returns focus to the handle (46-47), keyboard-focus reveals timing and Escape closes the tooltip (66-71), Alt+ArrowDown/Up reorder with autosave (102-107), insert focuses the new title (83, 98). Minor gaps (pre-existing): menu items are exercised only via focus()+Tab and mouse clicks; "Add step after 1" and "Delete step 2" are mouse-only (82, 91); drag reorder is pointer-only by explicit comment (110-112); no in-menu arrow-key navigation assertion.
- `apps/screenpipe-workflows-web/scripts/eval-workflow-block-types.cjs` — all five block kinds via the combobox (33-41), keyboard select "i"+Enter (43-45), undo (46-47), reload persistence (52-54), touch fit (55), menu dismissal with focus retention + Alt+ArrowDown reorder (56-62), desktop and touch contexts (15-16). **Parity with the desktop test** (`apps/screenpipe-app-tauri/components/workflows/workflow-block-types.test.tsx`, also untouched by this PR): the desktop test covers one behavior the web eval lacks — a failed save retains the new type for retry and "Retry save" recovers (test lines 34-45, sessionStorage recovery + retry). The web eval never exercises a failing save; I did not verify whether the `/preview` harness can simulate one. The web eval conversely asserts screenshot preservation (39) and keyboard selection that the desktop test lacks, so the two are complementary, not duplicates.
- `apps/screenpipe-workflows-web/scripts/eval-schedule-toggle.mjs` — the **mixed/off/failure matrix the focus names is fully present**: off via keyboard Space with `:focus-visible` assertion (25-26), persisted `[false,false,false,false]` (27), reload persistence (28), mixed seed `[true,false,true,true]` + "Some tasks are off" (29-31), enable confirmation dialog flow (32-36), Chat workspace hides the toggle and back restores it (37-41), saving state with disabled toggle (42-43), failure state + "Retry automatic updates" (44-48), unavailable/checking (49-50), compact/narrow responsive assertions (52-57).
- `apps/screenpipe-workflows-web/scripts/eval-enterprise-workflows-entry.mjs` — asserts the unauthenticated device stays behind the workspace gate (28-29), cloud source is the default without a query-string override (42-43), and cloud denial exposes zero cached workflows (55). **It contains no member read-only enforcement checks** (no assertion that members cannot edit/save workflows). That scope exclusion is documented, not accidental: `apps/screenpipe-app-tauri/README.md:71` says these browser checks "do not establish packaged-app or live member authorization." Pre-existing scope; not a PR regression.

## 3. Verification run in this ask (the ask's check, at full scale)

All four evals were executed against the PR-head code (`0b6c5f9d1`, clean tree, `packages/workflows-ui` node_modules copies verified identical to `packages/workflows-ui/src` via `diff -rq` — so the runs exercised the PR's modified UI):

1. `bun install --frozen-lockfile` in `apps/screenpipe-workflows-web` and `apps/screenpipe-app-tauri` (tracked `bun.lock` files untouched; `git status` clean after).
2. Web preview: `bunx next dev -p 1432` from this checkout (port 1431 was already occupied by an unrelated process, PID 31200, which I did not touch), then:
   - `WORKFLOWS_PREVIEW_URL=http://127.0.0.1:1432/preview node scripts/eval-step-controls.cjs` → **PASS, exit 0** ("PASS idle, hover… PASS no browser exceptions").
   - `WORKFLOWS_PREVIEW_URL=http://127.0.0.1:1432/preview node scripts/eval-workflow-block-types.cjs` → **PASS, exit 0** (desktop + touch + no browser exceptions).
3. Desktop browser-mock: `bun run dev:web` (port 1420), then `WORKFLOW_SCHEDULE_URL=http://127.0.0.1:1420 bun apps/screenpipe-workflows-web/scripts/eval-schedule-toggle.mjs` → **PASS, exit 0** (on/off/mixed/confirmation/saving/failure/unavailable/compact/narrow).
4. Restarted mock with `NEXT_PUBLIC_SCREENPIPE_E2E=true bun run dev:web`, then `CLOUD_WORKFLOWS_URL=http://127.0.0.1:1420 bun apps/screenpipe-workflows-web/scripts/eval-enterprise-workflows-entry.mjs` → **PASS, exit 0**.
5. All background servers stopped afterward; `git status --porcelain` shows only the untracked `pr-analysis/` directory. No repository files modified.

## 4. Notable for the lead reviewer

- **CI gives no signal for these evals on this PR.** `.github/workflows/test-frontend.yml:18,38` path-trigger the enterprise eval only when its own path changes (runner at line 145); the PR changes `packages/workflows-ui` but not the eval paths, so none of the four run in CI. They pass locally (section 3), so no action needed for this PR — but the coverage hole (shared-UI changes don't trigger web evals) is pre-existing CI config worth a follow-up.
- **PR hygiene (outside my slice, flagged for the lead):** the PR title is "kkkk" and the body is the unfilled template (checked via `gh pr view 1`). AGENTS.md requires eval commands and results in PR bodies for changed behavior.
- **Existing PR feedback:** fetch-pr-feedback (excluding author `arthrod` = current user) found only bot content — codeant-ai skip notice, qodo billing notice, and 15 coderabbitai comments (2 summary + 13 line-specific on automation-flows/shortcuts/retry/proxy/skills/workflows-ui). **None touch my slice files**, so nothing of mine risked duplicating them.

## 5. Not run / could not verify

- Whether the `/preview` harness can simulate a failed editor save — so I could not confirm the failed-edit/retry parity gap (section 2, block types) is closeable in the web eval; it is currently uncovered, that much is verified by reading both files.
- Member read-only enforcement itself: out of scope by the eval's own documented limits (`apps/screenpipe-app-tauri/README.md:71`); no desktop/Rust/native checks were run (not part of this slice).
- The process occupying port 1431 was not identified beyond `lsof` (node, PID 31200); I worked around it on port 1432 rather than disturb it.

## 6. Decision on posting

No comments posted on the PR. The slice contains zero PR-diff changes, and the one genuinely new information this review produced — the four evals pass at PR head — is a verification record, not a severity-tagged finding, so per the ask's "if you found nothing worth posting, post nothing" it lives here instead of the PR thread.
