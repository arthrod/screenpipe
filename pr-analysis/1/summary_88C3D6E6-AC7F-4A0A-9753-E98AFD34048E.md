# Review: `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts` (new file, 458 lines)

PR #1 (`arthrod/screenpipe`), slice focus: polling cadence and dedup of emitted events.

## What this slice is

A brand-new n8n polling trigger node (no AI), the deterministic counterpart to the
`ScreenPipeAiTrigger` node also added by this PR. `poll()` (ScreenPipeTrigger.node.ts:128-150)
dispatches to one of four event sources — keyword said, app/window became active, pipe ran,
Automation Flow ran (SOURCES map, :175-216). Each source keeps a cursor in the node's static
data (:142-147) so events fire once; a `signature()` of the node parameters (:154-157) resets
the cursor when the user edits what the trigger watches. Manual mode ("Fetch Test Event")
returns the newest match and deliberately leaves the cursor untouched (:135-139).

Fits the PR per README.md Design rules 4 and 7: "AI only where judgment is needed" and
"detection stays Screenpipe's" — this node is plain polling against ScreenPipe's localhost API.
Registered in `packages/n8n-nodes-screenpipe/package.json` (`n8n.nodes` includes
`dist/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.js`), and a test asserts that registration
(test/screenpipe-trigger.test.ts:95). Icon path `file:../ScreenPipe/screenpipe.png` (:38)
resolves because `scripts/build.ts:34-37` copies the png to `dist/nodes/ScreenPipe/`.

## Checks I ran

- `cd packages/n8n-nodes-screenpipe && bun test` → **56 pass, 0 fail** (4 files, includes
  `test/screenpipe-trigger.test.ts`, 332 lines of outside-in tests against a fake ScreenPipe API).
- `cd packages/n8n-nodes-screenpipe && bun run typecheck` → clean (`tsc --noEmit`, no output).
- Wire-contract verification against the engine (the node's correctness depends on these):
  - `/search` response shape `data[].content` matches `contents()` (:400-402):
    `ContentItem` is `#[serde(tag="type", content="content")]`
    (crates/screenpipe-engine/src/routes/content.rs:34-48).
  - Audio fields used by the dedup key exist: `chunk_id`, `transcription`/`text`, `timestamp`,
    `offset_index`, `start_time` (content.rs:149-167). OCR fields used exist: `frame_id`,
    `text`, `timestamp`, `app_name`, `window_name` (content.rs:123-146).
  - `/search` accepts `content_type`, `q`, `order`, `start_time`, `focused`, `max_content_length`,
    `limit` (crates/screenpipe-engine/src/routes/search.rs:121-196); default `order` is
    **descending** (crates/screenpipe-db/src/types.rs:710-718), which is what the
    activation/`latest` fetches at :180, :192, :288 rely on.
  - `/automation-flows/:id` serializes camelCase: `FlowSummary`/`Flow.last_execution` →
    `lastExecution`, `LastExecution.started_at` → `startedAt`
    (crates/screenpipe-engine/src/automation_flows.rs:323-336) — matches :378-386.
  - `/pipes/:id/executions` returns `{data}` or HTTP-200 `{error}`
    (crates/screenpipe-engine/src/pipes_api.rs:433-452) — matches the comment at :442 and the
    `page.data` reads; rows carry `id, pipe_name, status, started_at`
    (crates/screenpipe-engine/src/pipe_store.rs:227-235).

## Quality overall

Genuinely good: cursors are written only after a successful poll (:145-147), errors keep the
cursor (tested, test:307-322); dedup is identity-based (chunk ids + timestamps), not
timestamp-threshold-based, so server/host clock skew cannot refire events; API paths
encodeURIComponent user ids (:211, :338); the catch block strips the raw client error before
rethrowing so the API key cannot leak into the n8n UI (:432-438); self-watch of the containing
workflow is refused (:369-375, tested). Edge-triggered window detection (fire on rising edge
only, :295-299) is tested including refocus (:test 145-178).

## Notable risks (details in comments file)

1. **P2 — keyword dedup state is destroyed by any empty search page** (:241): `cursor.seen` is
   *replaced* each poll by the hits of the current page; one `/search` 200-with-`data:[]` wipes
   it, and every already-fired transcription still inside the 2-minute re-read window then
   refires on the next non-empty poll. Violates the documented "each event fires once" (:30-31)
   and "skips the transcriptions already seen" (:222-226). Fix is to merge with
   `previous.seen` before pruning.
2. **P2 — window source drops events after ≥200 accumulated frames and can end with a stale
   `active` flag** (:287-289, :297-298): ascending order + `limit: PAGE_SIZE`, no pagination.
   After n8n downtime of roughly a few minutes (screenpipe captures focused frames at ~1 fps,
   so 200 frames ≈ 3.3 min — rate not measured, estimate), the *newest* frames are truncated
   away: missed transitions, plus `cursor.active` left at the 200th frame's state, which can
   suppress or fabricate the next edge. Keyword self-heals from truncation (identity dedup +
   re-read); window does not.
3. **P3s** — pipe source permanently skips runs beyond the newest 50 between polls (:329);
   no `timeout` on the API call in `connect()` (:423-431) so a stalled ScreenPipe request holds
   the poll indefinitely (in-repo precedent `NOTIFY_TIMEOUT_MS`, ScreenPipe.node.ts:19,312;
   same class as the existing coderabbitai comment on `ScreenPipeAiTrigger.node.ts:198-206`);
   keyword polls re-download up to 200 full transcription payloads every poll (at the demo's
   5s cadence, ~24× re-read of the same 2-minute window) and keyword event text is unbounded
   while window text is capped by `MAX_TEXT_LENGTH` (:20-21 vs :257); mutual Flow watching
   (A watches B, B watches A) loops forever — the self-guard at :371 cannot see pairs.

## Cadence note (slice focus)

The node itself sets no poll interval — cadence comes from the workflow's `pollTimes`. The
"5 s" cadence named in the focus is the Gmail Trigger of the demo workflow
(infra/automation-flows/workflows/novadesk-support-tickets.json:16,83,467), not this file. At
5 s polling this node does one API call per poll per source, all localhost; the search route's
admission gate (503 + Retry-After, search.rs:447-449) would surface as a failed poll, which is
safe (cursor untouched). Nothing in the file misbehaves specifically at high frequency except
the repeated-window re-read noted above.

## Could not verify / not run

- Did not run against a live ScreenPipe instance or a real n8n; all findings are from code
  reading, the fake-API test suite, and engine source.
- Did not chase whether `/search` `start_time` is inclusive in SQL — boundary is protected by
  identity dedup (`seen`) and the `frame_id >` filter (:289), so it does not affect the findings.
- Frame capture rate for the window-truncation estimate is from general knowledge of
  screenpipe (~1 fps), not measured here.
- I found no in-repo path that provably returns an empty `/search` 200 over live data (errors
  take the throw path, which is safe); the P2 dedup wipe is a latent flaw in the invariant,
  demonstrated by trace, not by an executed reproduction.

## Existing PR feedback

fetch-pr-feedback (--pr 1) shows 15 line-specific comments, all coderabbitai; **none touch this
file**. Nearest is a no-timeout comment on `ScreenPipeAiTrigger.node.ts:198-206`; my P3 on
`connect()` cross-references it rather than repeating it.
