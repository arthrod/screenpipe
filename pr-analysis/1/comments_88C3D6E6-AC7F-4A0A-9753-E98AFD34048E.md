## Review: `ScreenPipeTrigger.node.ts` (polling cadence & event dedup)

Nice node overall — identity-based cursors, cursor written only after a successful poll, and the
332-line outside-in test suite are all the right shape. I verified the wire contracts against the
engine (`ContentItem` tag/content shape, `AudioContent.chunk_id`/`transcription`/`timestamp`,
`Flow.lastExecution.startedAt` camelCase serialization, `{data}`/HTTP-200-`{error}` on the pipe
routes) — they all match. `bun test` in `packages/n8n-nodes-screenpipe` passes (56/56) and
`bun run typecheck` is clean. Findings below.

---

**[P2] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:241` — one empty search page wipes the keyword dedup set and refires old events.**

`cursor.seen` is *replaced* every poll with the keys of the current page
(`seen: hits.filter(...)`). Trace: poll 1 returns hits A, B (B fires, `seen = [A, B]`); poll 2
returns `data: []` (a 200, not an error — errors throw and keep the cursor); `latest` is
unchanged but `seen` becomes `[]`; poll 3 re-reads the same 2-minute window, finds A and B
absent from `seen`, and **B fires a second time**. The doc comment promises "skips the
transcriptions already seen" (:225) and the class doc promises "each event fires once" (:30-31).
Any transient empty response over an unchanged window breaks it. Fix: merge with the previous
set before pruning, e.g. build the union of `previous?.seen` and the current window's keys, then
keep only entries whose hit is still within `latest - LATE_TRANSCRIPTION_MS`. A regression test
is one `said.data = []` between two non-empty polls — the current suite (test
"emits once per new transcription…", screenpipe-trigger.test.ts:108-141) never exercises an
empty page mid-stream.

---

**[P2] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:287-289` — window source silently drops events once ≥200 frames accumulate, and can end the poll with a stale `active` flag.**

The since-cursor fetch is ascending with `limit: PAGE_SIZE (200)` and no pagination. Focused
frames arrive at roughly 1/s, so ~200 frames is ~3 minutes — after n8n is paused, deactivated,
or down longer than that, the *oldest* 200 of the gap are returned and the newest are truncated
away: transitions in the dropped region never fire, and `cursor.active` is left at the 200th
frame's state (:298), so the next real "becomes active" edge can be suppressed or fabricated.
The keyword source self-heals from the same truncation because its dedup is identity-based over
a re-read window; this source has no such recovery. Either loop the pagination until the page is
short, or fetch newest-first and reverse so the cursor's `active` always reflects the freshest
state (documenting that gap-time events are best-effort). The existing tests only ever add a
handful of frames between polls (framesRecorded, screenpipe-trigger.test.ts:72-90), so this is
uncovered.

---

**[P3] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:329` — pipe source permanently skips runs beyond the newest 50 between polls.**

`pipeRan` reads only the latest 50 executions and advances the cursor to the newest id seen, so
if more than 50 runs land between two polls (long downtime, or a very chatty pipe), the older
ones are never emitted and never will be — unlike the keyword source, whose re-read window
recovers truncated events. For a "pipe ran" trigger, replaying hundreds of stale runs after days
offline is arguably unwanted, but that tradeoff should be a deliberate, documented decision (in
the property description at :113 or the `pipeRuns` comment at :336), not an accident of `50`.

---

**[P3] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:423-431` — no `timeout` on the API call: a stalled ScreenPipe request holds the poll forever.**

`ctx.helpers.httpRequest` is called without a `timeout`. For a poll trigger the consequence is
worse than for a one-shot node: n8n does not overlap polls, so one hung request against a wedged
ScreenPipe (or a `baseUrl` that black-holes) stalls this trigger indefinitely with no event and
no error. The package already has the precedent (`NOTIFY_TIMEOUT_MS = 5000`,
ScreenPipe.node.ts:19, applied at :312), and the same gap was flagged on
`ScreenPipeAiTrigger.node.ts:198-206` earlier in this PR — worth fixing package-wide so every
read is bounded. A failed/timeout poll is safe here (the cursor is only written after
`source.since` resolves, :145-147), so the timeout can be aggressive.

---

**[P3] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:231-233` — keyword polls re-download up to 200 full transcription payloads each poll, and keyword event text is unbounded.**

Each poll re-reads the whole 2-minute window of audio with no `max_content_length`/`fields`
bound, while the window source caps its text via `MAX_TEXT_LENGTH` (:20-21, :273). At the demo's
5-second cadence that is ~24 re-downloads of the same window per 2 minutes — fine on localhost,
but the re-read is the price of identity dedup, so trimming the payload is free wins (e.g.
`fields` to drop `file_path` etc., which the search route supports). Related inconsistency:
`keywordEvent` (:257) forwards the raw transcription while window events are cut at 500 chars —
if the constant's comment ("Screen text in an event is cut… to this many characters") states the
intended event contract, apply it consistently or say why keyword text is exempt (note that
middle-truncation could split the keyword itself, which is a reason to leave it unbounded).

---

**[P3] `packages/n8n-nodes-screenpipe/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.ts:369-375` — the self-watch guard does not cover mutual watching, which still loops forever.**

`flowIdOf` refuses a Flow watching *itself*, but Flow A watching Flow B while Flow B watches
Flow A is a live lock: A's run updates A's `lastExecution.startedAt`, which fires B; B's run
updates B's, which fires A; each iteration is a real workflow execution with no rate limit.
Local cycle detection is impossible from inside one node, but the hazard deserves at least a
sentence in the "Flow ID" property description (:122) next to the self-reference rule, since the
error message at :372 shows the authors already think about runaway activation.
