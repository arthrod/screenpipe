# Slice summary — workflows-ui guide files (reviewer-wui-guide)

Slice: `packages/workflows-ui/src/guide.ts`, `guide-video-panel.tsx`, `workflow-guide.tsx`, `workflow-guide.module.css`
PR: arthrod/screenpipe#1 ("kkkk"), base `main` @ `d75ccaed`, head @ `0b6c5f9d1` (this checkout).

## 1. Headline: the PR does not change any file in this slice

- `git diff origin/main...HEAD -- <4 files>` is **empty** (ran; exit 0, no output).
- All four blobs are byte-identical at the merge-base `35ed62162` and at the PR head `0b6c5f9d1` (`git ls-tree -r` on both refs):
  - `guide.ts` = `9c9257aa`, `guide-video-panel.tsx` = `744f08de`, `workflow-guide.tsx` = `d1828b56`, `workflow-guide.module.css` = `c9e80dae` at both refs.
- Local refs match the server: `gh pr view 1` reports `baseRefOid=d75ccaed…`, `headRefOid=0b6c5f9d1…` (= local `origin/main` and `HEAD`), `changedFiles=234`, `+34606/−600` — identical to local `git diff origin/main...HEAD --stat`.
- The slice assignment's stated focus ("Guide model changes: schema compatibility with existing saved guides") describes changes that are **not present** in this diff. The guide feature is only *adjacent* to the PR (CodeRabbit's summary table lists `packages/workflows-ui/src/*` generically).

Base-branch drift, for the lead reviewer: `origin/main` (`d75ccaed`) holds **newer, different** blobs of all four files (e.g. `guide.ts` = `f9fce244`); `origin/main` is *not* an ancestor of the PR head (`git merge-base --is-ancestor origin/main HEAD` → NO), and GitHub reports the PR `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`. For these four files specifically the merge will be clean (head blob == merge-base blob, only base changed → base version wins); the conflict is elsewhere. I did not simulate the merge to enumerate which files conflict.

## 2. Real finding for this slice: the PR's embedded-screenshot change breaks the guide paths it feeds

The PR changes `stageScreenshots()` (`packages/workflows-ui/src/screenshots.ts:8-20`, in the diff) to admit **embedded fixture screenshots with negative frameIds** (`frameId < 0` + `data:image/(jpeg|png|webp);base64,` prefix, via new `isEmbeddedScreenshot`). Demo workflows produce exactly these (`apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task.ts:136-168`: `--embeddedId`, `visualVerified: true`, webp data URLs). The unchanged guide code consumes that stream and was never taught about negative frameIds. Verified chain, command by command and file by file:

### P1 — `parseGuide` rejects negative `imageReview.frameId`; embedded picks can never be saved
- `packages/workflows-ui/src/guide.ts:68-71` (unchanged): `imageReview.frameId` must be `>= 0`.
- The PR now lets embedded screenshots flow into `guideScreenshot`/`guideSourceImages` results (`guide.ts:147-162`; demo shots are `visualVerified: true`, so the default finder at `guide.ts:161` selects them).
- User path: SOP editor → screenshot picker "Use screenshot" (`workflow-guide.tsx:565-592`, reachable since demo stages have 3 sources) writes `imageReview: {frameId: -1, …}` into the draft. Same via `reconnectGuideSources` (`guide-video.ts:88-92`, reached from `GuideSourceReview` / video panel `onReconnect`, `guide-video-panel.tsx:150`).
- Desktop persistence runs `parseGuide` **before** every write (`disk-storage.ts:161-166` `saveGuideToDisk`) → save throws "The guide draft was incomplete…"; every subsequent edit then fails to save ("Could not save. Retry before leaving.", `workflow-guide.tsx:92-109`). No corruption (throw is pre-write), but recovery is poor: "Remove screenshot" (`workflow-guide.tsx:550-562`) sets `includeImage:false/imageExcluded:true` **without clearing `imageReview`**, so the draft stays unsavable; only picking a positive-frameId screenshot or deleting the step recovers.
- Load path would also reject (`loadGuideFromDisk` → `parseGuide`, `disk-storage.ts:154-158`), but saves can't persist the poison, so existing saved guides are safe. **Schema compatibility of existing saved guides: intact** — `WorkflowGuide` v1 and `parseGuide` are unchanged, and the only `model.ts` change is an additive optional field (`openQuestionChoices?`). The break is forward-looking: the PR's own demo data cannot round-trip through guide saves.

### P2 — SOP editor cannot display embedded screenshots at all
- `workflow-guide.tsx:539-549` passes `source={image}` + `loadSource` → `SopScreenshot` dispatches to `ExactSopScreenshot` (`sop-screenshot.tsx:57-63`) → `useSourceScreenshot` always calls the platform loader with the negative frameId (`use-source-screenshot.ts:49-53`, no dataUrl short-circuit; file unchanged by the PR) → host `loadWorkflowScreenshot` returns `null` for `frameId <= 0` (`apps/screenpipe-app-tauri/lib/workflows/source-screenshot.ts:15`, unchanged, guard predates the PR — verified via `git show 35ed62162`) → the editor shows "This screenshot is no longer available." while ignoring the perfectly good `source.dataUrl`. This fires with **no user action** — a freshly generated demo SOP auto-selects the embedded shot. The PR's own `workflow-step-evidence.tsx:114` solves this exact problem (`load = isEmbeddedScreenshot(capture) ? undefined : …`) but the guide paths got no equivalent.

### P2 — video panel fires a doomed loader per embedded scene
- `guide-video.ts:25-35` (unchanged) emits scenes with both `image` (data URL) and a truthy negative `imageFrameId`; `guide-video-panel.tsx:167-171` (unchanged) then passes `load={loadScreenshot}` whenever `imageFrameId` is truthy → `LegacySopScreenshot` calls `load(-1)` when visible (`sop-screenshot.tsx:21-35`), which throws "Invalid screenshot reference." (`original-screenshot.ts:2-3`, unchanged) → guaranteed `failed=true`, a wasted host call, and the spurious "Original screenshot unavailable. Showing the saved preview." under every embedded scene image (the image itself still renders via `original || src`).
- Reachability is new: before the PR, `stageScreenshots` filtered `frameId > 0`, so scenes never carried negative frameIds.

All three manifest through **unchanged slice code** fed by PR-changed data; the fix belongs in this PR (extend `parseGuide`'s `imageReview` rule to accept negative frameIds backed by an embedded dataUrl, and gate the loader calls on `isEmbeddedScreenshot` like `workflow-step-evidence.tsx:114` already does).

## 3. Integration checks that came back clean

- Consumers of the slice modules in the PR diff: only `platform.ts` and `workflows-app.tsx`. `platform.ts` adds automation-flow fields only — `guides`/screenshot surface untouched. `workflows-app.tsx` diff contains **no added/removed line** referencing guide APIs (the one `platform.guides` hit is an unchanged context line; checked with `git diff | grep '^[+-]'`).
- `model.ts` diff = one additive optional field; nothing `parseGuide` validates against changed.
- Package typecheck (ran): `bunx tsc -p packages/workflows-ui/tsconfig.json --noEmit` → errors are pre-existing environmental classes only: `TS2307` for `*.module.css` imports in 8 files (incl. `workflow-guide.tsx:42` — the package tsconfig declares no CSS modules) and gt-react signature drift (`TS2554`/`TS2322` in `use-workflow-run-activity.ts`, `workflow-library.tsx`, `workflow-questions.tsx`). **No error in `guide.ts`, `guide-video-panel.tsx`, the CSS, or any PR-changed↔slice seam.** I did not run the frontend test suite (`bun run test`) — not meaningful for files the PR doesn't change; reported as not run.

## 4. Slice focus areas reviewed (no changes to flag, posting none for these)

- **Video panel playback/cleanup** (`guide-video-panel.tsx`): unmount aborts the in-flight controller and releases all retained preview blobs (`:54-61`); version retention caps at 3 with release of the evicted entry (`:77-86`); abort propagation into `platform.generate` with `release` on abort/unmount (`:99-126`); Escape-to-close scoped to the panel (`:68-70`); loader cleanup and blob revocation in `LegacySopScreenshot` (`sop-screenshot.tsx:21-46`). Sound. Only the embedded-scene loader issue above.
- **Keyboard accessibility** (`workflow-guide.tsx`): step actions are native `<details>/<summary>` with Escape-to-close + summary refocus (`:462-473`); move up/down with disabled bounds and an sr-only live announcement (`:162-187`, `:232-234`); post-delete/post-add focus lands on a step textarea via rAF with correct last-step index math (`:508-514`, `:644-650`); outline links carry `href` (`:410-421`). Minor nits (outside-`pointerdown` dismissal has no focus-out counterpart; delete has no live announcement) — not worth posting on a PR that doesn't touch the file.
- **Guide layout CSS** (`workflow-guide.module.css`): `.layout[hidden]` pairs with the `videoOpen` hide (`:573`, `workflow-guide.tsx:407`); responsive/container-query duplication is pre-existing organization; no findings.

## 5. Existing PR feedback consulted (per fetch-pr-feedback, steps 1–4)

Bot comments from codeant-ai, qodo-code-review, coderabbitai (2 issue comments, 15 line comments). **None touch any of my four files**; nothing to deduplicate. Posted comment avoids coderabbitai's covered topics (flow-activation version race, shortcuts.rs, retry.rs, chatgpt_proxy.rs, DEMO.md, demo JSON, AiTrigger, workflow-questions createFromTask, workflows-app.module.css dark-mode buttons).
