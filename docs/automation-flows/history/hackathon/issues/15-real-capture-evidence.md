# 15: Task Page evidence from the machine's real captures

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (stories 4, 5); `SPEC.md` D8 and "Demo data"; ticket 03 (what exists today).

**What to build:** The demo Detected Task shows each recorded repetition with
the real ScreenPipe captures of the machine it runs on, like the finished
product would. When `bun infra/automation-flows/demo/demo.ts` installs the
task, it looks up, through the local ScreenPipe API, the frames of the three
recorded repetitions (`SPEC.md` "Demo data": NOVA-25, NOVA-26, NOVA-27 created
on 2026-10-17 between 04:00 and 04:20 local time, in Gmail then Jira windows)
and stores their `frameId`s and real timestamps in the task's evidence, so the
Task Page loads them live and "View in timeline" opens those exact moments.
When a frame cannot be found (another machine, deleted data, API down), that
step keeps today's embedded key frame, so the demo never shows a broken
image. The lookup is deterministic code, no AI.

**Blocked by:** None (can start immediately).

**Status:** done (merged; live-verified on the demo machine 2026-10-17 12:59)

- [x] Tests against a fake ScreenPipe API: found frames are written with their `frameId` and timestamp; a missing frame or an API error keeps the embedded image for that step; the auth header is sent.
  `bun test infra/automation-flows`: 27 pass, 0 fail (5 new in `demo/recorded-evidence.test.ts`, fake `/search` on `Bun.serve`).
- [x] The Task Page renders a live `frameId` capture and an embedded fallback (frontend test through the existing screenshot loading path, `packages/workflows-ui/src/screenshots.ts`).
  `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/workflows/demo-task-evidence.test.tsx components/workflows/step-evidence.test.tsx lib/workflows/source-screenshot.test.ts`: 30/30.
  The new case saves the catalog with `serializeWorkflowData`, renders `WorkflowsApp`, loads the found frame through the app's real
  `loadWorkflowScreenshot` (`/frames/:id/metadata` then `/frames/:id`, `localFetch` mocked), keeps the two embedded images, and
  "Open recording" calls `openCapturedMoment(frameId, timestamp)` only for the found frame. No frontend change was needed: it passed
  as soon as the fixture could carry a recorder frame.
  Wider suites: `bun x vitest run components/workflows lib/workflows`: 513 passed, 1 skipped. `bun x tsc --noEmit -p .`: no errors.
- [x] On the demo machine (agent-verified by the orchestrator): the installed task points at real frames of NOVA-25/26/27 and "View in timeline" lands on them.
  First live run: `Evidence: 0/9`, every search `HTTP 503` — the engine serves only a couple of searches at once and the lookup sent 18 in parallel.
  Fixed (orchestrator): searches run one at a time and a 503 is retried; new test "finds every capture when ScreenPipe serves one search at a time" (fake server answering 503 beyond one in flight).
  Second live run: `Evidence: 9/9` — r1 17099/17137/17153, r2 17162/17180/17188, r3 17213/17238/17260 (04:05–04:15). Frame 17099 is the opened "Export des contacts vide dans NovaCRM" email in Gmail, 17153 is NOVA-25 in Jira (checked visually through `GET /frames/:id`).

## What was built

- `infra/automation-flows/demo/recorded-evidence.ts`: `findRecordedFrames(captures, api)`. For each of the 9 captures it calls
  `GET /search?content_type=ocr` twice, inside `DEMO_RECORDING` (2026-10-17 04:00–04:20 +02:00): the nearest match before the
  key frame time (`order=descending`, `end_time` = key frame) and the nearest after (`order=ascending`), 20 rows each, so long runs
  of matching frames elsewhere cannot push the right one off the page. Match rules: the email = the quote's words in
  `window_name` (Gmail titles an opened email with its subject; the inbox list does not match); the Jira form and the ticket = the
  quote's words in `q` (the ticket quote includes `NOVA-2x`). A row counts only on the right surface (`gmail`/`mail.google.com`,
  `jira`/`atlassian.net` in app, window title or URL), so a Jira notification email is never the Jira capture. The nearer of the two
  sides wins. A frame two captures match goes to the capture whose key frame is nearest (the Task Page dedupes by `frameId`, so
  sharing would hide a capture). Never throws: unreachable API, 401/403 (hint: `SCREENPIPE_LOCAL_API_KEY`), other HTTP errors or no
  match return a reason, and that capture keeps its embedded key frame. 5 s timeout per request.
- `detected-task.ts`: `EVIDENCE_CAPTURES`, `DEMO_RECORDING`; `buildDetectedTask(dataUrl, now, recorded)` writes a found capture as the
  engine writes recorder frames (`frameId`, exact recorder `timestamp`, `dataUrl: ""`, `visualVerified: true`) and uses that time in
  the stage evidence, procedure and timing run. Unfound captures keep their negative ID and embedded WebP.
- `demo.ts`: `buildDemoTask(now, api)`; the CLI reads `SCREENPIPE_API_URL` (default `http://localhost:3030`) and
  `SCREENPIPE_LOCAL_API_KEY` (never printed), prints one line per capture (`frame <id> at <timestamp> (open screenpipe://frame/<id>)`
  or `embedded: <reason>`), then installs. `--embedded` skips the lookup; `--print` (browser mock) stays embedded because the mock
  cannot load recorder frames.

## Live check (orchestrator)

1. `SCREENPIPE_LOCAL_API_KEY=<key from Settings > Privacy> bun infra/automation-flows/demo/demo.ts --no-notify`
   (add `SCREENPIPE_API_URL=http://localhost:3130` for an isolated dev build). Expect `Evidence: 9/9 …` and one `frame` line per capture.
2. `open screenpipe://frame/<id>` for a few ids: r1-email shows the opened "Export des contacts vide dans NovaCRM" email, r1-form the
   filled create form, r1-ticket NOVA-25 (same for r2/NOVA-26, r3/NOVA-27).
3. In the app (this branch's frontend), open the Task Page: recorder captures load (caption time = the printed time), embedded ones
   still show; the play button under a recorder capture opens the timeline on that frame.
4. If a line says `embedded: no matching frame…`, the window title or text differs from the quote: compare with the frame's
   `window_name`/text in `GET /search` and adjust that capture's `quote`/`quoteIn` in `detected-task.ts`.
