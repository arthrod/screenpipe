# Slice review — demo catalog, demo orchestration, and their tests (PR #1)

Slice: four NEW files in `infra/automation-flows/demo/`, all additions (no deletions):
- `catalog.ts` (76 lines) — read/validate/clear/write the desktop workflow catalog file
- `catalog.test.ts` (93 lines, 6 tests)
- `demo.ts` (89 lines) — CLI demo entry: install scripted task + fire notification
- `recorded-evidence.test.ts` (145 lines, 6 tests)

Out of slice but read as dependencies: `apps/screenpipe-app-tauri/lib/automation-flows/demo-task/{detected-task,catalog,recorded-evidence}.ts`, `apps/screenpipe-app-tauri/lib/workflows/disk-storage.ts`, `packages/workflows-ui/src/{screenshots,workflow-answers,catalog}.ts`, `apps/screenpipe-app-tauri/src-tauri/src/notifications/routes.rs`, `CONTEXT.md`, `README.md` Design rules, `docs/automation-flows/history/flows-round-two/coverage.md`.

## What the slice changes

**`catalog.ts`** — script-side writer for the desktop-owned catalog file the engine serves at GET `/workflows/catalog` (`crates/screenpipe-engine/src/server.rs:1016,1040`). `catalogDir()` (catalog.ts:27-33) honors `SCREENPIPE_WORKFLOWS_DIR`, throws off-macOS, defaults to `~/Library/Application Support/screenpi.pe/workflows` — verified `screenpi.pe` is the default bundle id (`apps/screenpipe-app-tauri/src-tauri/tauri.conf.json:4`). `readCatalog` (catalog.ts:44-60) validates `schemaVersion === 5` + `analysis.workflows` array — byte-for-byte the same predicate as the app's `isStoredWorkflowAnalysis` (`disk-storage.ts:42-46`) — falls back to `catalog.backup.json`, and throws "unreadable … left untouched" when a file exists but neither parses (demo.ts catches, exits 1). `writeCatalog` (catalog.ts:68-76) writes backup-then-atomic-rename; the header comment's claim that this matches the app's writer is accurate — `disk-storage.ts` `replaceWithBackup` does backup rename first (`disk-storage.ts:83-86`) then primary (`:92`).

**`demo.ts`** — CLI orchestrator: build the task with recorder frames found via the local search API (`buildDemoTask` → `findRecordedFrames`), print per-capture evidence outcome, install into the catalog, then POST the notification to `SCREENPIPE_NOTIFY_URL` (default `http://localhost:11435/notify`). Flags: `--no-notify`, `--embedded`, `--print`. Success detection for the notification couples to the exact message `"Notification sent successfully"` — verified this IS the engine's contract (`apps/screenpipe-app-tauri/src-tauri/src/notifications/routes.rs:602`), already relied on by `demo-shortcut.test.ts:29` and the `automate-my-work` pipe prompt.

**`catalog.test.ts`** — pins the shared task/catalog contract: 3 repetitions × (Gmail email, Jira form, Jira ticket); all 9 embedded webp images exist, readable at the exact repo path, and < 80 KB; embedded negative frameIds survive `serializeWorkflowData` + `sanitizeWorkflowAnalysis`; reinstall resets answers and bumps revision without touching other workflows; `clearAnswers` clears only the demo task's answers; backup/primary behavior incl. unreadable-file refusal.

**`recorded-evidence.test.ts`** — spins a fake ScreenPipe `/search` (Bun.serve, port 0, stopped in afterEach) replicating engine search semantics, and covers: found captures get recorder frameId+exact timestamp while the rest keep embedded images; Bearer auth sent when key present; nearest-frame selection across >1 page of results; Gmail-vs-Jira surface attribution (a Gmail frame quoting the ticket is rejected for the Jira capture); one frame to one capture (dedup by nearest key frame); HTTP 500 / no-match / unreachable / 401 all fall back to embedded with a printed reason.

## How it fits the whole PR

This is the hackathon demo tooling half of the Automation Flows work, sharing all task/catalog code with the app's ⌃⌥⌘D demo shortcut (`detected-task.ts:9-10` says so; the shortcut lives in `apps/.../demo-shortcut.ts`, another slice). The `upsertTask` revision bump (`demo-task/catalog.ts:26`, "A newer revision makes a stale open Task Page reload before saving answers") is exactly the mechanism that fixed local issue #17 — `docs/automation-flows/history/flows-round-two/issues/17-create-automation-stale-task-page.md` (« Create automation » fails when the Task Page stayed open across a demo reinstall; first click fails on stage). This slice's `clearAnswers` + `writeCatalog` preserve that revision-bump invariant, and `catalog.test.ts:37-63` pins it. The engine contract claims in the header comments all verified (backup order, per-request read `crates/screenpipe-engine/src/automation_flows.rs:216-218`, schema-5 predicate).

## Focus items — outcomes

1. **catalog.ts: "products/skill types match issue #17 vocabulary"** — the file contains no "products" or "skill types" (the phrase doesn't map to anything in the diff; noted as a slice-focus mismatch like the one the workflows-ui reviewer hit). What I checked instead: the file's vocabulary follows `CONTEXT.md` ("Detected Task", "workflow catalog"), and its reinstall path preserves the issue-17 revision semantics. Fork `arthrod/screenpipe` has issues disabled (`gh issue view 17` → "repository has disabled issues"); upstream `mediar-ai/screenpipe#17` is "[search] multimodal embeddings" — unrelated. The relevant issue #17 is the local history doc above.
2. **catalog.test.ts consistency** — consistent with implementations; all 6 tests pass; assertions match `upsertTask`/`clearAnswers`/`readCatalog`/`writeCatalog` semantics including revision math (prior 4 + reinstall → 5) and backup-then-primary order.
3. **demo.ts evidence capture order** — sequential by design: `findRecordedFrames` awaits each capture and each capture's before/after side (`demo-task/recorded-evidence.ts:68-69,78-81`), matching the engine's 503 search limiter (comment at `recorded-evidence.ts:45-46`); lookups are returned/printed in `EVIDENCE_CAPTURES` order; install happens only after all lookups, notification only after install succeeds. No ordering defect found. (Worst case latency of 9 sequential captures × 2 searches × 5 s timeout exists but is a demo-script tradeoff, not a bug.)
4. **recorded-evidence.test.ts: images exist and are referenced by exact path** — PASS. Ran `ls`/`wc -c`: all 9 `r1-email.webp`…`r3-ticket.webp` exist under `apps/screenpipe-app-tauri/public/automation-flows/demo-evidence/` (max 51,284 bytes < the test's 80,000 guard at `catalog.test.ts:22`), names match `EVIDENCE_IMAGES`, and `EVIDENCE_DIR` (`demo.ts:27-28`) resolves from `infra/automation-flows/demo/` to that exact `public/` path via `EVIDENCE_PATH = "/automation-flows/demo-evidence"` (`detected-task.ts:16`).

## Checks run (this session)

- `bun test infra/automation-flows/demo/catalog.test.ts infra/automation-flows/demo/recorded-evidence.test.ts` → **12 pass / 0 fail**, 70 expect calls, 805 ms.
- `bun test infra/automation-flows` (the command `docs/automation-flows/history/flows-round-two/coverage.md:22-24` documents for these areas) → **65 pass / 0 fail** across 5 files, 4,647 expect calls, 2.4 s (includes sibling files owned by other reviewers).
- `wc -c apps/screenpipe-app-tauri/public/automation-flows/demo-evidence/*.webp` → 9 files, 24,582–51,284 bytes.
- gh preflight: `command -v gh` / `gh --version` / `gh auth status` → gh 2.102.0, authenticated `arthrod` on github.com.
- fetch-pr-feedback --pr 1 executed through its Formatted-artifact gate: 4 summary + 13 line-specific comments, all from bots; **none touch any of my four files** (nearest: `infra/automation-flows/workflows/novadesk-support-tickets.json:136`, a different file).
- Greps cited above for: `screenpi.pe` identifier, `"Notification sent successfully"`, `isStoredWorkflowAnalysis`, `disk-storage` backup order, `/workflows/catalog` route, CI workflow coverage of `infra/`.

## Notable risks and quality issues

1. **P2 — none of these tests run in CI.** `.github/workflows/test-frontend.yml:91` (`bun run test:bun`) → `apps/screenpipe-app-tauri/scripts/run-bun-tests.ts:14` calls `collectBunTestFiles(appRoot)` with appRoot = `apps/screenpipe-app-tauri` (`scripts/bun-test-files.ts` walks only that root); `rg -l "infra/automation-flows" .github/workflows/` → no matches; vitest runs from the app root and excludes bun:test files by design. The coverage doc records `bun test infra/automation-flows` as a manual command only. These files pin the issue-17 regression protection, so a future break ships green. Verified the fix is one CI step: `bun test infra/automation-flows` passes in 2.4 s. Posted.
2. **P3 — the 503 branch in `recorded-evidence.test.ts` is unreachable in that test.** The client (`findRecordedFrames`) is strictly sequential, so with `maxConcurrent = 1` every request arrives with `inFlight === 0` (`recorded-evidence.test.ts:25` never fires); deleting the whole 503-retry loop (`demo-task/recorded-evidence.ts:48-55`) would still pass. Posted.
3. Verified-not-bugs (not posted): notify success-string coupling matches `routes.rs:602`; writeCatalog's plain `JSON.stringify` vs the app's `serializeWorkflowData` is equivalent here because demo screenshots either have negative frameIds or empty dataUrls by construction (`detected-task.ts:161-168`); `readCatalog`'s found-but-unreadable throw is surfaced by demo.ts with exit 1.
4. Not checked: `reset.ts`/`reset.test.ts` (another slice); the app-side demo-shortcut consumer; real-engine 503 behavior end-to-end (only the fake server).

## Comments posted

See `comments_82A5ED8B-DC09-4BE0-A754-48242CBB74FA.md` — 2 comments (P2 CI gap, P3 dead 503 branch). Nothing duplicates existing PR feedback (verified: no existing comment touches any of the four files).
