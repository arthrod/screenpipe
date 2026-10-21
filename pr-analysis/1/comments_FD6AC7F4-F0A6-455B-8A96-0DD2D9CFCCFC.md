## Review: `packages/workflows-ui` app shell + CSS

Two P2s and one P3 from my slice (`workflows-app.tsx`, `workflows-app.module.css`). Nothing here repeats the existing thread on lines 337/517/521 — the first finding below complements it with the selectors that gap left out.

---

**`packages/workflows-ui/src/workflows-app.module.css:302`** — **P2 (compact-mode layout regression)**

`.taskHeader { position: sticky; top: 59px; z-index: 1 }` assumes the topbar is exactly 59px (`workflows-app.module.css:149`), but two existing compact rules make it taller, and the pinned header then slides underneath it (topbar is z-index 2, with a translucent blurred background):

- `@media (max-width: 680px) .topbar:has(.toolbarAccessory)` sets `height: auto; min-height: 96px; flex-wrap: wrap` (`workflows-app.module.css:818-820`).
- `@container workflow-pane (max-width: 900px) .sourceTopbar` wraps to two rows (`height: auto; min-height: 59px; flex-wrap: wrap`, `workflows-app.module.css:827-828`) — this triggers even on a wide window when the assistant is docked and the work pane narrows below 900px.

Both inputs are live in the desktop host: `integrated-workflows.tsx:96-98` passes `toolbarAccessory` (WorkflowAccess) and `sourceControl`. In those configurations, once the page scrolls, the top ~37px of the task header — the "All workflows" back button and part of the title — is hidden behind the topbar and clicks there hit the topbar instead. Suggested direction: inside those same two compact blocks, raise the header's sticky offset to match the wrapped topbar height (or stop pinning it — `position: static` — when the topbar wraps, since a pinned bar under a wrapped bar buys little at that width). Worth one browser-mock screenshot at ≤680px with `toolbarAccessory` present before/after.

---

**`packages/workflows-ui/src/workflows-app.module.css:513`** — **P2 (dark mode: unreadable input)**

`.profileCard > textarea, .profileAdvanced textarea` keeps `background: #fafaf7` with `color: var(--ink)`; in the new dark palette `--ink` re-resolves to near-white `hsl(var(--foreground))` (`workflows-app.module.css:835`), so on the Context page in dark mode every typed character is near-white on near-white — the role, company, priorities and "More context" fields are effectively unusable. This is the same class of gap as the existing thread on lines 337/517/521 but on selectors that finding doesn't cover, and here the *text* disappears rather than just the surface looking off. The PR's own theme test can't catch it: `workflows-view-theme.test.tsx:131` skips anything inside `[hidden]`, and the Context page is hidden while the Task Page renders — consider extending the dark test to render the Context view. While in there, `.profileKpiRow > button:hover` (`background: #f6e9e6; color: #854438`, `workflows-app.module.css:527`) also has no dark override and paints a light-pink chip on the dark card.

---

**`packages/workflows-ui/src/workflows-app.tsx:798`** — **P3 (silent failure + stale header state)**

Two related nits on `OpenAutomationButton`:

1. `onClick={() => void open(flowId).catch(() => {})}` — if `openAutomationFlow` rejects, "Open automation" is a dead click with zero feedback. Every other failure path on this page surfaces something (`reviewError`, `skillError`, `analysisError`); even a transient inline error state would fit.
2. The lookup effect runs only on `[active, taskId]` (`workflows-app.tsx:796`), so creating a Flow from the questions block on this same page doesn't reveal the header button until the user leaves the tab/task. If `createFlow` success could trigger a re-check (e.g. a shared "flow created for this task" signal), the header would reflect reality immediately.

Swallowing `find` errors itself matches existing convention (`workflow-questions.tsx:163`), so this is polish rather than a blocker.

---

Checked and not reported as issues: the review-request reload logic (`workflows-app.tsx:966-994`) is race-safe (one reload per key via `reloadedForReview`, stale load aborted through the `catalogLoadRevision` cleanup, handling only after a fresh `catalogReady`); `task-page-create-flow`, `workflow-loading` and `workflows-view-theme` suites pass (40/40, scoped run).
