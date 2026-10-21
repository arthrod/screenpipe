# 05: Chat searches the nodes this n8n really has

**What to build:** Before using a node, the chat searches the nodes this n8n has and reads a node's card: description, parameters with allowed values, display conditions and nested required fields, the credential it needs and whether n8n holds none, one (named) or several, and a minimal valid node skeleton. Switched-off nodes (Execute Command, Local File Trigger) show up flagged « switched off here », never usable. Lookup and the Flow check come from one generated catalog.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** None (can start immediately)

**Status:** done, live check pending: chat lookup against the running app (see below)

- [x] The catalog generator writes a browsing layer (index and per-type detail for the latest version) from the same n8n image as the check layer; its size is measured and kept reasonable (compressed or loaded from disk if needed).
- [x] A search route returns at most about 20 index entries; a card route returns one node's detail plus live credential state from n8n.
- [x] Switched-off types appear in search, flagged.
- [x] The skill tells the chat to search and read the card before using a node and to build only from what they return.
- [x] A test fails when the ScreenPipe n8n nodes differ from the catalog; the pinned-image test still passes.
- [x] Engine integration tests cover search, card, switched-off flagging and the three credential states.

## What was built

- `infra/automation-flows/n8n-catalog.ts` writes, from one read of the image,
  the check layer `n8n-catalog.json` (same shape) and the browsing layer
  `n8n-nodes.json.gz`: an index of 843 types (type, name, short description,
  latest version, trigger, credential types, aliases, `toolOf`, `off`) and
  one card per type for its latest version (parameters: name, type, default,
  required, allowed values with what each operation does, show/hide, nested
  `fields`/`groups`, resource-locator `modes`, `dynamic` for account-loaded
  values). Notices, icons, routing data and long docs are dropped. Running it
  twice gives the same bytes.
- Fix found on the way: the check layer accepted
  `n8n-nodes-base.executeCommandTool`, the AI-tool twin of a switched-off
  node, which n8n never builds. The twin is now switched off too (listed in
  `excluded`, flagged in search).
- Size: 5.2 MiB of JSON, embedded gzipped at 623 497 bytes (609 KiB) via
  `include_bytes!`. `flate2` was already linked through `png`, so no new crate
  code (Cargo.lock gains one dependency edge). Only the parsed index stays in
  memory; a card is read from a fresh decompression (one card per line, so
  only that card is parsed).
- Routes (local API key, next to the Flow routes, no n8n call for search):
  `GET /automation-flows/nodes?q=<words>` → `{results (≤ 20, every word must
  match, best first), total}`; `GET /automation-flows/nodes/card?type=&resource=&operation=`
  → the card narrowed to the chosen resource/operation (`fieldsHidden` when
  not chosen; `400 invalid_query` for a value the node does not offer),
  credentials with `inN8n` none/one (`name`)/several (`names`) from n8n's
  credential list, and a `skeleton` built from the check layer
  (`flow_checks::skeleton_parameters`). Unknown type → `404 node_type_unknown`;
  switched-off type → flagged card, no fields, no skeleton.
- Why narrowing: a whole card is up to 140 KB (Notion), too much for the chat.
- Skill: rule 5 « Look every node up first », a « Look up a node » section,
  two API rows and errors; creation step 2 looks every node up. Hard-coded
  node versions are left for ticket 06.

## Tests run

- `bun test infra/automation-flows/ packages/n8n-nodes-screenpipe/test/skill-parameters.test.ts`
  → 64 pass, 0 fail (catalog: pinned image, demo nodes, browsing layer
  present and consistent with the check layer, switched-off flagged, tool
  twin switched off, nested required fields, ScreenPipe nodes match both
  layers). The ScreenPipe-node test was seen failing on a changed parameter
  description, then the change reverted.
- `cargo test -p screenpipe-engine --test automation_flows_test` → 62 passed
  (14 new node-lookup tests; seen red, 11 failing, with the routes switched off).
- `cargo test -p screenpipe-engine --lib -- n8n_nodes flow_checks automation_flows`
  → 13 passed (every usable type has a card and a skeleton the check knows).
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 3 passed.
- `bun infra/automation-flows/n8n-catalog.ts` (reads the container only) →
  840 check types, 3 excluded, browsing 843 entries; git clean after a rerun.

## Live check (ticket 16)

On the running app: in the chat, ask for a Flow using Jira and Gmail; confirm
the chat calls `/automation-flows/nodes` and `/nodes/card` before building,
that `curl -G -H "Authorization: Bearer …" --data-urlencode "q=shell"
localhost:3030/automation-flows/nodes` lists Execute Command flagged, and that
the Jira card shows `inN8n: "one"` with « NovaDesk Jira ».
