# 10: ScreenPipe Trigger starts a workflow on a keyword, a window or a pipe/Flow

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decision D12 in `SPEC.md`). Demo use not decided.

**What to build:** A deterministic polling trigger node in the ScreenPipe
node package. Modes: a keyword appears in the audio transcription; a given
app or window becomes active; a given pipe or Flow fires. It keeps a cursor
between polls so each event fires once, and emits `{mode, matchedAt, text,
app, window}`.

**Blocked by:** 07.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Package tests against a fake ScreenPipe API: the keyword mode emits once per new match and advances its cursor; the window mode fires on change only; the pipe mode fires on a new execution.
  `test/screenpipe-trigger.test.ts` runs `poll` against `fakeScreenpipe`, carrying the node's static
  data between polls. Covered: package.json entry + polling trigger shape; keyword (activation fires
  nothing, one event per new matching transcription, case/accent-insensitive, no repeat, cursor moves
  forward); window (fires on the switch to the window, not while it stays in front, again after
  leaving and coming back; reads focused screen frames only); pipe (one event per new execution,
  oldest first, a run finishing is not a new run; editing the pipe id starts over); Flow (fires on a
  new `lastExecution.startedAt`; refuses to watch its own workflow); "Fetch Test Event" (latest event,
  cursor untouched; nothing yet → error saying what to do); errors (HTTP 403 → `NodeApiError`, cursor
  kept; pipe routes' HTTP 200 `{error}` → `NodeApiError`).
  `cd packages/n8n-nodes-screenpipe && bun test`: 38 pass (11 new). `bunx tsc --noEmit -p tsconfig.json`: clean.
- [x] Manual check in the local n8n: saying the keyword aloud starts an example workflow. Verified by the orchestrator with `say` through the recorded system audio: « Pamplemousse » fired the keyword mode; the window mode fired 1 s after TextEdit came to the front; the pipe mode fired on execution 171 of `repeated-workflow-detector`; the Flow mode fired on each run of a throwaway Flow (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
  Done by the agent: `bun run install-n8n` built and installed the package; n8n 2.42.2 lists
  `CUSTOM.screenPipeTrigger` ("ScreenPipe Trigger", group trigger, `polling: true`, properties
  `pollTimes` (added by n8n), `event`, `keyword`, `appName`, `windowName`, `pipeId`, `flowId`), icon
  resolved. No workflow was created, activated or published.

## Behavior

- Node `screenPipeTrigger`, folder `nodes/ScreenPipeTrigger/`, credential `screenpipeApi`. Icon reuses
  `nodes/ScreenPipe/screenpipe.png`. Poll frequency is n8n's "Poll Times".
- Output, one item per event: `{mode, matchedAt, text, app, window}`; pipes add `executionId` and
  `status`, Flows add `status`. `app`/`window` are `null` outside the window mode.
- Keyword: `GET /search?content_type=audio&order=ascending&start_time=…` (no `q`: matching is done in
  the node, "contains", case and accents ignored). Cursor = newest transcription seen; each poll
  re-reads 2 minutes before it (late transcriptions) and skips the ones already seen.
- Window: `GET /search?content_type=ocr&focused=true&order=ascending&start_time=…` (ScreenPipe's
  event-driven capture marks every frame focused and captures app switches). Fires on each frame
  where app name and window title ("contains", both optional, at least one set) start matching.
- Pipe: `GET /pipes/<id>/executions?include_output=false`; cursor = last execution id. Fires when a
  run starts.
- Flow: `GET /automation-flows/<n8n workflow id>`; cursor = `lastExecution.startedAt`. Several runs
  between two polls fire once (ScreenPipe exposes only the last one).
- Activation fires nothing from before. Editing the trigger's settings (not its schedule) resets the
  cursor. The cursor is written only after a successful read.
- ScreenPipe's `/search` caches identical queries for 30 s, so an event can show one poll late.

## Pending human: manual check

1. In n8n, create a scratch workflow: "ScreenPipe Trigger" (credential "ScreenPipe API (local)" with
   the ScreenPipe API key pasted), Trigger On "Keyword Said", Keyword e.g. `banane bleue`, Poll Times
   "Every Minute", followed by any node (e.g. "No Operation").
2. Say the keyword near a recorded microphone, wait about a minute, click "Fetch Test Event": expect
   one item with `mode: "keyword"` and the transcription.
3. Activate the scratch workflow (human decision), say the keyword again, and check within two
   minutes that one execution appears; say nothing more and check no further execution appears.
4. Deactivate and delete the scratch workflow. Do not touch `spNovaFlow000001`.
