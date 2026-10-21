# 05: Read-only graph of the n8n workflow with one sentence per node

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md`.

**What to build:** The Review Screen renders the Flow's nodes and edges as a
read-only graph with the graph library the app already ships, placed from the
n8n node positions. Each node shows its name and its one-sentence
explanation; a node without a sentence shows a neutral placeholder. The graph
is a picture of the workflow, not an editor.

**Blocked by:** 02.

**Status:** ready-for-agent

Implementation: branch `hackathon/ticket-05`. The graph is
`apps/screenpipe-app-tauri/components/automation-flows/flow-graph.tsx`
(`@xyflow/react`), inserted in the Review Screen in place of 02's plain
"Étapes" list. Cards keep 02's `flow-node-<id>` test ids. Positions are the
n8n ones, spread horizontally just enough that the closest nodes of a row
never overlap, and 1.3x vertically (cards are taller than n8n nodes). Main
connections run left to right; nodes plugged in from below (the AI agent's
model, parser and tool) connect bottom-up with dashed links. The picture fits
its frame; drag pans, pinch / double click / the zoom buttons zoom, the wheel
scrolls the page.

- [x] Every non-sticky node appears once with its sentence; edges follow the n8n connections.
- [x] The graph cannot be edited (no connecting, moving into new links or deleting).
- [x] Works in the browser mock with the fixture Flow; frontend tests cover the rendering.

## Verification

| Criterion | Command (exact, in `apps/screenpipe-app-tauri`) | Result |
|---|---|---|
| Graph: nodes + sentences, placeholder, edges, n8n placement (demo and cramped layouts), read-only, zoom controls; Flows tab and Review Screen still pass | `NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx` | 31 passed (flow-graph 7, flows-tab 10, api 12, pipe-store-flows-tab 2) |
| Types | `bun x tsc --noEmit -p .` | 0 errors |

Browser mock (`bun run dev:web`, then
`http://127.0.0.1:1420/home?section=pipes&tab=flows&flow=spNovaFlow000001`):
8 cards, 7 links, no card overflow, no React Flow warning. Screenshot:
`docs/automation-flows/history/hackathon/screenshots/05-review-screen-graph.jpg`.
