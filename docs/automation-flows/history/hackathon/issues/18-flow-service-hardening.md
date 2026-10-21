# 18: Flow service hardening — clear n8n errors, creation always off, fresh Review Screen

Spec: stories 12, 21, 38, 44; Implementation Decisions "Flow service". Found by the spec audit (`scratchpad` audit gaps 5, 6, 10, 11).

**What to build:**

- **Creation is always switched off (story 12).** `create_from_task` adopts the
  pre-imported copy (fixed id from `infra/automation-flows/import-workflow.sh`)
  as it is, even when it is active (`crates/screenpipe-engine/src/automation_flows.rs`,
  adopt path). If the adopted workflow is active, unpublish it before
  recording, and log nothing as "activated".
- **A refused n8n API key is not "unreachable" (story 44).** Every non-2xx
  n8n answer becomes `502 n8n_unreachable` today (`upstream_error`). Map n8n
  401/403 to a distinct error (e.g. `412 {error: "n8n_unauthorized"}`) whose
  UI message says the API key in Connections → n8n was refused; keep
  `n8n_not_configured` and `n8n_unreachable` as they are. Update the typed
  client codes and messages (`apps/screenpipe-app-tauri/components/automation-flows/api.ts`,
  `common.tsx`, `lib/workflows/automation-flows.ts`).
- **The Review Screen and the list stay fresh (stories 21, 38).** They reload
  only on navigation today (`common.tsx`). Reload on window focus /
  visibility change and every ~15 s while visible, so a new execution, a
  chat change or an edit in n8n shows without re-opening the Flow. No
  flicker or lost scroll position on reload.
- **Small:** the list follows n8n pagination (`list_flows` reads one page);
  a Review Screen test covers the last-run line.

**Blocked by:** None. Ticket 14 changes `POST /:id/activate` and the client's
activate call in parallel: keep your edits away from activation and merge the
integration tip before reporting.

**Status:** done (live: refused key message and recovery; an active pre-imported copy was created switched off; list/Review Screen refreshed without reopening; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] Engine tests (fake n8n): an active pre-imported copy is switched off on creation; n8n 401 → `n8n_unauthorized`; pagination returns every tagged workflow.
- [x] Frontend tests: the unauthorized message; the screen reloads on focus/visibility and on its interval, keeping its content while loading; last-run line rendered.

## What was built

- Engine (`crates/screenpipe-engine/src/automation_flows.rs`):
  - `create_from_task`, adopt path: a pre-imported copy that is active is
    unpublished (`POST …/unpublish`) before the Flow is recorded; the Flow
    is a Draft with an empty history (nothing logged).
  - `N8nApi::send`: any n8n 401/403 becomes `FlowError::Unauthorized` →
    `412 {error: "n8n_unauthorized", detail: "n8n answered 401: …"}`, on
    every route. `n8n_not_configured` (412) and `n8n_unreachable` (502)
    unchanged. Activation code untouched (ticket 14).
  - `N8nApi::all_pages`: follows `nextCursor` (bounded to 40 pages, stops on
    a repeated cursor); used by `list_flows` (keeps `tags=screenpipe-flow`
    on every page) and the tag lookup.
- Frontend (`components/automation-flows/`):
  - `api.ts`: typed code `n8n_unauthorized`. `common.tsx`: « n8n a refusé la
    clé API » with Ouvrir Connexions and Réessayer.
    `lib/workflows/automation-flows.ts`: the Task Page creation says the key
    in Connexions → n8n was refused. Browser mock: `?flowsState=unauthorized`.
  - `useFlowsLoad` (`common.tsx`), shared by the list and the Review Screen:
    background re-read on window `focus`, on `visibilitychange` to visible,
    and every `REFRESH_INTERVAL_MS` (15 s) while visible. A background read
    never shows « Chargement… », keeps the screen when it fails or returns
    the same content (same reference, so the graph is not re-rendered),
    never piles up (one in flight), and an answer older than a click's
    result (`replace`) is dropped. « Réessayer » still goes through loading.
- `automation-flows` skill and `SPEC.md` contract list `412 n8n_unauthorized`.

## Tests run (after merging `origin/hackathon/automation-flows` at `847c314a5`)

- `source ~/.cargo/env && cargo test -p screenpipe-engine --test automation_flows_test`
  → 34 passed (new: `create_switches_off_a_pre_imported_copy_that_was_left_on`,
  `refused_api_key_returns_412_unauthorized_not_unreachable` (401 and 403),
  `list_follows_n8n_pages_to_show_every_flow`; the fake n8n now pages the
  workflow list when `page_size` is set).
- `cargo test -p screenpipe-engine --lib automation_flows` → 3 passed.
- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run components/automation-flows lib/workflows components/__tests__`
  → 75 files, 837 tests passed (new: unauthorized code, list message and
  Task Page message; Freshness: focus, visibility, interval on the Review
  Screen and the list, hidden window does not re-read, a read older than a
  click is dropped, a failed background read keeps the screen; Review Screen
  last-run line for success / error / running). Freshness tests were
  mutation-checked (removing each listener, the visibility gate, the
  `replace` generation bump or the keep-on-failure branch fails a test).
- `bun x tsc --noEmit -p .` → no errors.

## Pending: live check in the real app (dev build, this branch)

1. Creation always off: in n8n, Publish `spNovaFlow000001`; run the demo
   reset (ticket 16) so ScreenPipe has no record of it; Task Page →
   « Créer l'automatisation ». Check: Review Screen says Brouillon, the
   history says « Jamais activé. », n8n shows the workflow unpublished.
2. Refused key: in Connexions → n8n, replace the API key with a wrong one.
   Check: the Flows tab says « n8n a refusé la clé API » (not « Impossible
   de joindre n8n »); « Créer l'automatisation » says the key was refused.
   Restore the key, click Réessayer (or refocus the window): the list comes
   back.
3. Freshness: open an Active Flow's Review Screen, scroll down. Send a bug
   email (or edit a node's note in n8n). Check: within ~15 s, or on coming
   back to the window, the last run / sentence / « modifié dans n8n » flag
   updates with no « Chargement… » flash and the scroll position kept.
