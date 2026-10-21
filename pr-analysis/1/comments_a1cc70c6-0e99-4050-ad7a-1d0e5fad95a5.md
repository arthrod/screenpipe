## Review: `flow-graph.test.tsx` — does it pin the Gmail demo workflow shape (ticket 05)?

Mostly yes — the branch/retry-loop test names the demo's nodes and pins their rows, the link-set test pins the exact edge list, and the read-only/zoom tests pin "a picture, not an editor" from `docs/automation-flows/history/hackathon/issues/05-graph.md`. Ran `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows/__tests__/flow-graph.test.tsx` (16/16 pass) and `bun x tsc --noEmit -p .` (0 errors). Three findings:

---

**[P2] `apps/screenpipe-app-tauri/components/automation-flows/__tests__/flow-graph.test.tsx:233` — the ticket's dashed context links are never asserted.**

Issue #05 requires the AI agent's model and parser to "connect bottom-up with dashed links" (05-graph.md:21-23), and `flow-graph.tsx:265` implements exactly that (`strokeDasharray: context ? "4 4" : undefined`). But this test — named "curves for context nodes" — only asserts the edge *type* (`react-flow__edge-straight` vs `react-flow__edge-default`), and context links, branch links ("Confident enough → Sort by hand") and the retry loop's back-link are all type `default`. Nothing in the repo asserts the dash (grep for `dasharray` under `components/automation-flows/__tests__/` finds nothing). The dashed style is the only visible encoding of "plugged in from below", so dropping it or giving it to the wrong edge class keeps every test green. In this test, assert `link.style.strokeDasharray` is set exactly for the two context edges ("screenpipe AI model → Read the email (AI)", "Answer format → Read the email (AI)") and unset for the others; that also makes the test name true.

---

**[P2] `apps/screenpipe-app-tauri/components/automation-flows/__tests__/flow-graph.test.tsx:117` — the shape pin rests on fixture edges/positions that nothing drift-checks against the demo JSON.**

This test (and the layout tests) take the workflow shape from `fixtureFlow`, whose header claims "A test in `__tests__/api.test.ts` fails when the two drift apart" (fixtures.ts:5-8). That drift test exists (api.test.ts:371-387) but compares only each node's name/type/sentence — it never compares `edges` or `position`. So a change to `infra/automation-flows/workflows/novadesk-support-tickets.json`'s `connections` or node positions leaves api.test.ts and this whole file green while the graph tests a shape no real Flow can have. This is not hypothetical: the layout's row tolerance is `SAME_ROW = 100` (flow-graph.tsx:41) and the fixture's "Ticket created" sits at y=-100, exactly on the boundary (fixtures.ts:100) — a JSON-side nudge to y=-90 would merge it into the main row in production with no test noticing. Extend the api.test.ts drift test with an edges comparison and a positions comparison (a few lines each), or read the JSON here and assert the edge list and row membership against it.

---

**[P3] `apps/screenpipe-app-tauri/components/automation-flows/__tests__/flow-graph.test.tsx:15` — `fakeApi` provides 8 of `FlowsApi`'s 18 methods while annotated `: FlowsApi`, and nothing checks that annotation.**

The app tsconfig excludes `**/__tests__/**` and `**/*.test.tsx` (verified with `tsc --noEmit -p . --listFilesOnly`: this file is not typechecked), and vitest doesn't typecheck — so the missing ten methods (`health`, `retry`, `activate`, `deactivate`, `delete`, `dismiss`, `restore`, `openTimeline`, `requestChange`, `requestCreation`) go unnoticed. It happens to work at runtime, but not cleanly: `FlowsTab` always renders `FlowsHealthBanner` (flows-tab.tsx:37), which calls `api.health()` (health-banner.tsx:20) — a TypeError per test render, swallowed only because `useFlowsLoad` attaches a rejection handler (common.tsx:61-72). If a future render path touches an unstubbed method, the failure is an opaque "api.x is not a function" deep in a graph test. The sibling `flows-tab.test.tsx:39-62` already models the right pattern: an exhaustive fake (its `retry` even throws "not expected" to pin it's never called) with `Partial<FlowsApi>` overrides. Either copy that here or drop the `: FlowsApi` annotation so the lie is at least visible.
