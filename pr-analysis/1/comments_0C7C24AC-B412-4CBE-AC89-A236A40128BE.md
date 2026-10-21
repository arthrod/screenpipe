## Review: demo Flow reset (`lib/automation-flows/reset-demo-flows.*`)

Scope of this review: `apps/screenpipe-app-tauri/lib/automation-flows/reset-demo-flows.ts` and `reset-demo-flows.test.ts` (both new). Checked against the slice focus "reset must fully clean demo state and not touch user-created flows"; the two-storage-halves split with the installer (`find-automation.ts`) is coherent and the `sourceTaskId` vetting does keep flows from user tasks out of the delete set. Ran `bun run test:vitest reset-demo-flows`: 3/3 passed. Two findings, neither already raised on this PR:

---

**[P2] `apps/screenpipe-app-tauri/lib/automation-flows/reset-demo-flows.test.ts:45` — no test proves a user flow survives via the remembered-id path.**

The reset's safety rests on the GET-then-check at `reset-demo-flows.ts:24-28`: a candidate id read from localStorage is deleted only if the engine confirms `sourceTaskId === DEMO_TASK_ID`. The suite never exercises that check against an existing flow — test 2 ("stale remembered id") uses the id of a flow that is *gone*, and test 1's survivor (`chat-1`) is only met through the `list()` path with `sourceTaskId: null`. Since `screenpipe:automation-flow-of-task:<id>` is an app-global key (`lib/workflows/automation-flows.ts:55`), a regression that deleted before the check, compared the wrong field, or inverted the condition would still pass all three tests. Please add: localStorage set to the id of an *existing* flow whose `sourceTaskId` is `null` (and ideally one with a *different* task id), assert `deleted` stays empty and the key survives a resolve — plus, cheaply, assert the remembered key is retained when `delete` rejects, since that retention (`reset-demo-flows.ts:36` skipped on throw) is what makes a failed reset retryable.

---

**[P3] `apps/screenpipe-app-tauri/lib/automation-flows/reset-demo-flows.ts:20` — sessionStorage draft is wiped before the reset can fail, unlike the localStorage key.**

`DRAFT_KEY` is removed before any engine call, so a reset that then fails (`flow_running`, engine unreachable) still destroyed the demo Task Page's unsaved answers, while the remembered-id key is deliberately removed only after every delete succeeds (`:36`). The end state after a *successful* run is identical (the installer reinstalls the task answers-cleared, `demo-shortcut.ts:8-9`), so this is minor — but the ordering asymmetry looks accidental. Moving the `removeItem` below the delete loop (or a comment explaining why it is intentionally unconditional) would make the failure behavior self-documenting. Related nit: sessionStorage goes through the hard-coded `safeStorage("sessionStorage")` while localStorage is an injectable parameter, so tests cannot stub one half of the storage behavior.

---
