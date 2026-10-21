# Review slice: `apps/screenpipe-app-tauri/components/automation-flows/__tests__/flow-graph.test.tsx`

PR #1, diff base `origin/main...HEAD`. The file is new (316 insertions, 0 deletions).

## What this slice is

The frontend test leg of hackathon ticket 05 ("Read-only graph of the n8n workflow with one
sentence per node", `docs/automation-flows/history/hackathon/issues/05-graph.md`). It renders the
real `FlowsTab` (mounted at `flowId`, flows-tab.tsx:26-34 → flow-review.tsx:171 `<FlowGraph …/>`)
against the shared `fixtureFlow` and asserts the graph's rendering contract:

- every fixture node drawn once with name + sentence, placeholder for `sentence: null`
  (flow-graph.test.tsx:33-41, 96-105);
- card typography clamps (`text-lg`, `line-clamp-3`, `title` attr) (:43-52);
- click-to-open popover with unclamped text, Escape closes (:54-72);
- clickability through React Flow's `pointer-events: none` (:74-82);
- card shows only name + sentence — no n8n type/credential/host (:84-100);
- rendered link set equals the fixture edge set, matched by `"<from> → <to>"` aria-labels
  (:117-127);
- layout invariants on a synthetic linear flow and a "cramped" n8n-position flow: one row, equal
  gaps, context nodes below their step without overlap (:129-230);
- the demo workflow's branch and retry loop stay steps on their own rows, with a pairwise
  no-overlap check over all 14 cards (:232-267? see below — `it` at :232 "keeps the demo
  workflow's branch and retry loop…");
- straight vs curved edge choice, handle placement at card mid-height, equal card heights and
  ≥40 px row spacing, context nodes centred under the AI step (:269-322);
- read-only invariants (no drag/select/connect/delete, Backspace/Delete no-ops) and zoom controls
  without an "interactive" toggle (:324-360).

The fixture (`fixtures.ts:14-145`) is a hand-copy of the committed Gmail demo workflow
(`infra/automation-flows/workflows/novadesk-support-tickets.json`, also new in this PR): Gmail
trigger → AI step with model/parser context nodes → confidence branch ("Sort by hand" up,
"Ticket needed" on) → duplicate-check → Jira create → success notification, plus a retry loop
("Check the creation" → "Let Jira index" → back to "Find the ticket for this email", giving up in
"Jira refused the ticket"). 14 nodes, 14 edges.

## Focus question: does it pin the Gmail demo workflow shape from issue #05?

**Largely yes, with two real gaps.**

Pinned well: the branch/retry-loop test names the demo nodes explicitly and asserts their row
membership (branch above, retry row below, main row through the duplicate check) plus pairwise
non-overlap — that is a genuine topology pin of the demo workflow. The link-set test pins the
exact edge list. The read-only and zoom tests pin issue #05's "a picture, not an editor"
requirement.

Gap 1 — **the dashed-link requirement is unpinned.** Issue #05 (05-graph.md:21-23) requires
context nodes (the AI agent's model, parser) to "connect bottom-up with **dashed** links". The
component implements it (`strokeDasharray: context ? "4 4" : undefined`, flow-graph.tsx:265;
context edges route bottom-up via handles "up"/"under", flow-graph.tsx:232), but no test in the
repo asserts it (grep for `dasharray|dashed` under `components/automation-flows/__tests__/` →
only unrelated CSS hits). The test "draws straight links along a row, curves for context nodes,
branches and loops" (flow-graph.test.tsx:233) asserts only edge *type* (`react-flow__edge-straight`
vs `react-flow__edge-default`) — context links and branch/loop links are both type `default`, so
the assertion cannot tell them apart, and the test name over-promises. Dropping the dash or
swapping the context/branch visual distinction keeps every test green.

Gap 2 — **the shape pin rests on fixture edges/positions that nothing drift-checks.**
fixtures.ts:5-8 claims "A test in `__tests__/api.test.ts` fails when the two drift apart". That
test exists (api.test.ts:371-387) but compares only name, type and sentence per node (plus flow
name/summary/sourceTaskId) — **not edges and not positions**. So if the committed JSON's
`connections` or node positions change, api.test.ts still passes and flow-graph.test.tsx tests a
shape no real Flow can have, all green. This matters concretely: the component's row grouping
tolerances are `SAME_ROW = 100`, `SAME_COLUMN = 60` (flow-graph.tsx:41-42), and the fixture's
hand-copied positions sit exactly on that boundary — "Ticket created" is at y=-100, exactly 100
from the main row (fixtures.ts:100, :30), so a JSON-side nudge to y=-90 would merge it into the
main row in production while every test stays green. Cheap fix: extend the api.test.ts drift test
with an edges and a positions comparison, or assert the edge list here against the JSON.

## Checks I ran (this session)

- `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows/__tests__/flow-graph.test.tsx`
  (cwd `apps/screenpipe-app-tauri`) → **16 tests passed (16)**, exit 0. Note: this is the
  single-file run; issue 05's verification table used the wider command (`… vitest run
  components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx`, 31 tests) —
  I did **not** run that wider suite.
- `bun x tsc --noEmit -p .` (cwd `apps/screenpipe-app-tauri`) → exit 0, no output.
- `bun x tsc --noEmit -p . --listFilesOnly | grep -c flow-graph.test` → **0**: the app tsconfig
  excludes `**/__tests__/**` and `**/*.test.tsx`, so this test file is typechecked by nothing
  (vitest doesn't typecheck either). Relevant to the fakeApi finding below.
- Greps for the drift test and dashed assertions cited above.
- Existing PR feedback fetched per fetch-pr-feedback (`--pr 1`): 15 line-specific comments, all
  from coderabbitai, none touching this file; the 12 s-vs-8 s note mismatch they flagged on the
  JSON (novadesk-support-tickets.json:136) also exists in the fixture copy the tests read
  (fixtures.ts:45) — already reported, not duplicated here.

## Posted comments (3)

1. **P2** — dashed context links from ticket #05 never asserted (anchor flow-graph.test.tsx:233).
2. **P2** — shape pinning rests on fixture edges/positions that the fixture↔JSON drift test
   doesn't compare (anchor flow-graph.test.tsx:117, references api.test.ts:371-387).
3. **P3** — `fakeApi` (flow-graph.test.tsx:15-25) provides 8 of `FlowsApi`'s 18 methods while
   annotated `: FlowsApi`; nothing typechecks the file, and the mounted `FlowsHealthBanner`
   (flows-tab.tsx:37) calls the missing `api.health()` (health-banner.tsx:20), which throws and is
   swallowed by `useFlowsLoad`'s rejection handler (common.tsx:61-72). Suggest the exhaustive-fake
   pattern already used by flows-tab.test.tsx:39-62.

## Noted, not posted (minor)

- `boxes()` (flow-graph.test.tsx:220-227) parses `style.transform` with a non-null-asserted
  regex; a @xyflow/react upgrade that changes the transform format fails opaquely. Same for the
  test pinning React Flow's internal `pointer-events: none` inline style (:74-82) — brittle, but
  it documents why the card button needs `pointer-events-auto`, which earns its keep.
- `expect(node).not.toHaveProperty("facts")` (:93) is a deliberate canary for ticket 01's
  "cards stay minimal" decision; harmless.
- Issue 05's verification table ("flow-graph 7", "8 cards, 7 links") is stale relative to this
  file's 16 tests / 14 nodes — the demo workflow grew in commits 1955e12b8/234e4ffae. History,
  not a defect.
- I did not review `flow-graph.tsx` implementation quality beyond what these tests depend on
  (other slice), and did not run the browser mock.
