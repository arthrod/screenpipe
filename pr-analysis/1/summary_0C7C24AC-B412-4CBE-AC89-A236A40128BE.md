# Slice review: demo Flow reset (`reset-demo-flows.ts` + test)

Reviewer: reviewer-lib-flows-reset · PR #1 · base `origin/main` (both files are new: +46 / +57 lines).

## What this slice changes

`reset-demo-flows.ts` is the Flow-deletion half of the ⌃⌥⌘D demo reset. On each press it:

1. Clears the demo Task Page's unsaved answers from sessionStorage (`DRAFT_KEY`, `reset-demo-flows.ts:14,20`). The key format matches the workflows-ui writer (`packages/workflows-ui/src/workflow-questions.tsx:14` builds `screenpipe:workflow-answers:${workflow.id ?? workflow.title}` in sessionStorage) and the demo task's `id: DEMO_TASK_ID` (`lib/automation-flows/demo-task/detected-task.ts:178`).
2. Unions the engine's listed flow ids with the localStorage-remembered id for the demo task (`flowOfTaskKey`, `lib/workflows/automation-flows.ts:55`; sole writer is `rememberFlow` at `:57-64`, so by construction the value is a flow created from the demo task).
3. Vets every candidate with a GET and deletes only flows whose `sourceTaskId === DEMO_TASK_ID` (`reset-demo-flows.ts:24-28,29-35`), swallowing only `not_found` on delete; removes the remembered key only after all deletes succeed (`:36`); returns the deleted ids.

Caller chain: native chord → `demo-shortcut-listener.tsx:32` (`resetFlows: async () => { await resetDemoFlows(flowsApi); }`) → `demo-shortcut.ts:43` captures a reset failure without blocking the reinstall and toasts "Previous demo Flow not deleted" (`:48`).

## How it fits the PR

Demo reset is split in two halves by design: this file owns Flows + the two web-storage keys; the installer half (`find-automation.ts:47` → `upsertTask`, `demo-task/catalog.ts:18-33`) reinstalls the scripted task into the on-disk catalog, replacing the prior entry and thereby dropping its saved answers — so "fully clean demo state" holds across the two halves. The infra reference (`infra/automation-flows/demo/reset.ts`) additionally deletes the bundled workflow copy by fixed id and clears catalog answers itself; those steps have no app-path equivalent to mirror.

## Verified in this session

- Ran `bun run test:vitest reset-demo-flows` (from `apps/screenpipe-app-tauri`, vitest v1.6.1): **3/3 passed**. Note: `bun x vitest run --config vitest.config.ts <full path>` failed first with MODULE_NOT_FOUND (resolved `~/node_modules`); the app's own script works.
- Existing PR feedback fetched per fetch-pr-feedback (14 line-specific comments, all from coderabbitai[bot]): none touch these two files. The posted `src-tauri/src/shortcuts.rs` comment already covers "production chord deletes every Flow whose sourceTaskId is wf-novadesk-support-tickets", so that angle is not re-raised here.

## Focus verdict: user flows survive

Correct. Two independent guards: (a) a flow is deleted only after the engine confirms `sourceTaskId === DEMO_TASK_ID` (`reset-demo-flows.ts:28`); (b) flows from user tasks never carry that id, and `list` includes dismissed flows (per `api.ts:353` "listed as Dismissed"), so there is no listing blind spot. Caveat: a flow a *user* deliberately created from the demo Task Page (creation is offered to any user via `CREATABLE_TASK_IDS`, `lib/workflows/automation-flows.ts:38`) is indistinguishable from a demo-installed flow and is deleted without confirmation — inherent to the `sourceTaskId` marker, and substantively covered by the already-posted shortcuts.rs comment.

## Risks / quality issues

1. **P2 — test gap on the remembered-id path.** The sharpest safety check (localStorage value → GET → `sourceTaskId` check → delete, `reset-demo-flows.ts:21-28`) is never exercised against an *existing user flow*. Test 2 (`reset-demo-flows.test.ts:45-50`) only uses a remembered id of a gone flow. A regression that deleted before checking (or compared the wrong field) would pass the current suite. Also no test uses a flow whose `sourceTaskId` is a *different, user* task id — the survivor in test 1 has `null`.
2. **P3 — draft cleared before the work can fail.** sessionStorage `DRAFT_KEY` is removed before any engine call (`reset-demo-flows.ts:20`), so a reset that then fails (engine down, `flow_running`) still destroyed the Task Page draft, while the localStorage key is only cleared after all deletes succeed (`:36`). Impact is small — the installer reinstalls the task answers-cleared anyway — but the ordering asymmetry is unexplained, and sessionStorage is not injectable while localStorage is (minor testability asymmetry).
3. **Not verified.** The engine's DELETE semantics (switch-off first, `flow_running` while n8n processes) are taken from the documented contract in `components/automation-flows/api.ts:337-347`; I did not read the Rust route (outside this slice). The two `DEMO_TASK_ID` exports (`demo-task/detected-task.ts:13`, `components/automation-flows/fixtures.ts:12`) are currently identical; the fixtures one is browser-mock-only (`mock.ts:14,222`), so drift would affect only the mock — noted, no comment posted.
4. **Good.** Narrow `ResetFlowsApi` Pick type (`reset-demo-flows.ts:16`), `safeStorage` guards privacy-mode throws (`:40-46`), id-dedup via Set (`:23`), ids URL-encoded by the API layer (`api.ts:281,343`), error codes consistent with `findAutomationFlow` (`lib/workflows/automation-flows.ts:82`), required source-file header present in both files.
