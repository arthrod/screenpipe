# 03: Demo Detected Task with recorded evidence, opened from a notification

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decisions D3, D8, D10 in `SPEC.md`).

**What to build:** A demo script installs the scripted Detected Task
`wf-novadesk-support-tickets` ("bug-report emails become Jira tickets", three
repetitions, the two Clarification Questions) into ScreenPipe's catalog and
fires the notification whose action opens its Task Page through the existing
deeplink. The Evidence is key frames from the team's screen recording: for
each repetition, the open email, the Jira creation form and the created
ticket, cropped to the browser and compressed. They are embedded in the
fixture; the screenshot serialization gets a narrow path so embedded images
survive persistence. A reset script removes the demo task's answers (and,
once 02 exists, the demo Flow) so the demo can be replayed.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Running the demo script shows a notification; clicking it opens the Task Page of the demo task.
  `bun infra/automation-flows/demo/demo.ts` against the running app: `Installed wf-novadesk-support-tickets …` then
  `Notification shown` (route answer `Notification sent successfully`). The engine then lists the task
  (`GET /workflows` via the screenpipe MCP: 1 workflow, 3 stages). The click route
  (`/home?mode=workflows&reviewRequest=…&workflow=wf-novadesk-support-tickets`, what
  `routeNotificationDeeplink` navigates to) opens the Task Page in the browser mock.
  **Not observed by an agent:** the physical click on the native notification panel.
- [x] The Task Page shows the three repetitions with their images and times.
  Browser mock (`bun run dev:web`, catalog from `demo.ts --print`): 9/9 images loaded from
  `data:image/webp`, captions `Gmail · Oct 17, 4:05 AM` … `Jira · Oct 17, 4:15 AM`, no replay buttons.
  Screenshot: `assets/03-task-page.jpg`.
- [x] Both Clarification Questions are displayed (same screenshot, "Help make this workflow accurate", 0 of 2 answered).
- [x] The reset script restores the initial state, and the demo script works again after it.
  Live catalog: answers saved (2) → `bun infra/automation-flows/demo/reset.ts` → `userCorrection = null`;
  a second reset says `nothing to reset`; `demo.ts` then reinstalls and notifies again
  (`Notification shown`, exit 0, once the 90 s repeat window had passed; inside it, the script reports
  `duplicate notification suppressed` and exits 1).
- [x] The existing workflows UI tests still pass.
  `cd apps/screenpipe-app-tauri && bun x vitest run --config vitest.config.ts components/workflows lib/workflows`:
  481 passed, 14 failed. The 14 (`library.test.tsx`, `workflow-block-types.test.tsx`) fail identically
  with this change reverted: `localStorage.clear` is undefined under Node v26 (environment, not this ticket).
  Ticket tests: `bun x vitest run --config vitest.config.ts components/workflows/demo-task-evidence.test.tsx
  components/workflows/step-evidence.test.tsx lib/workflows/guide-images.test.ts`: 28/28 passed.
  `demo-task-evidence.test.tsx` (save path; the demo fixture opened through `WorkflowsApp`'s review request)
  and the embedded-image case in `step-evidence.test.tsx` were red against the pre-ticket `screenshots.ts`.
  `bun test infra/automation-flows/demo`: 6/6 passed. `bun x tsc --noEmit` (app): no errors.
- [x] Committed images show only the demo accounts (no unrelated windows) and stay small.
  9 WebP key frames, cropped to the browser viewport (no menu bar, tabs, toolbar or Dock), 1280 px wide,
  24–50 KB each, 348 KB total. Accounts visible: the NovaDesk Gmail inbox and the NOVA Jira project.

## Implementation notes

- Files: `infra/automation-flows/demo/` (`detected-task.ts` fixture, `evidence/*.webp`,
  `catalog.ts`, `demo.ts`, `reset.ts`, `catalog.test.ts`); `packages/workflows-ui/src/screenshots.ts`
  and `workflow-step-evidence.tsx`.
- **Narrow image path:** an embedded image is a screenshot with a negative `frameId` and a
  `data:image/(jpeg|png|webp);base64,` URL (`isEmbeddedScreenshot`). Both serializers already keep
  pixels for non-positive IDs (`serializeWorkflowData`, engine `discard_screenshot_pixels`), so only
  `stageScreenshots` (accept them) and `EvidenceFigure` (show their own pixels, no recorder lookup, no
  replay) changed. Recorder frames (positive IDs) behave exactly as before.
- **Install path deviation:** the engine has no write route that accepts scripted evidence (commit
  re-verifies sources against the recorder; edits refuse new evidence by design). The demo script
  writes `~/Library/Application Support/screenpi.pe/workflows/catalog.json` directly, backup first then
  atomic rename, like the engine's `persist` and the app's `disk-storage.ts`. Override the folder with
  `SCREENPIPE_WORKFLOWS_DIR`. The engine reads that file on every request.
- **The demo needs this branch's frontend** (`bun run dev:tauri` or a build of it): the installed
  release app opens the Task Page but filters out the embedded images.
- Answers are saved in `userCorrection` (existing `workflow-answers.ts` format); reset sets it to null.
  Reinstalling with `demo.ts` also clears answers.
- Known limits: the MCP `get-workflow` tool only accepts hash/UUID ids, so it rejects
  `wf-novadesk-support-tickets` (the engine route and the app deeplink accept it). ScreenPipe holds no
  captures for 04:05–04:15, so "View in timeline"/replay is hidden for these images. The Workflows view
  loads the catalog when it becomes active: fire the notification from another view. Repeating the same
  alert within 90 s is dropped by the notification gate; `demo.ts` says so and exits 1.
- Follow-up for 02/12: extend `reset.ts` to remove the demo Flow once `/automation-flows` exists.
