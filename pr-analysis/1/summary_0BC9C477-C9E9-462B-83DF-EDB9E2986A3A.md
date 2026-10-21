# Slice review: `crates/screenpipe-engine/src/flow_checks.rs` (587 new lines)

PR #1 (`arthrod/screenpipe`, head = this checkout, diff base `origin/main`). The whole file is
new (`git diff origin/main...HEAD --stat` → 587 insertions, 0 deletions). Four commits touch it
(`83aed53e5`, `bf7771572`, `bc50ef2c0`, `1955e12b8`).

## What this slice changes

A self-contained gate that decides whether a chat-built n8n workflow can become a Flow, before
n8n ever sees it:

- **Refusals** (`inspect_node`, flow_checks.rs:183-242): node type not in this n8n's catalog or
  deliberately excluded (flow_checks.rs:186-193), `typeVersion` this n8n lacks (194-205), required
  parameter empty *as n8n's editor would show it* — display rules (`show`/`hide`) evaluated with
  n8n's `_cnd` conditions (207-221, 345-430), unlinked node (173-175 via `linked_names` 309-322),
  and no trigger node (132, 147-149). All problems are listed at once (`Report::problems`,
  141-151) so one reply tells the chat everything to fix.
- **Credential wiring** (`wire`, flow_checks.rs:283-306): a node missing a credential gets the
  *only* one n8n holds of that type; zero or several candidates is a refusal — the engine never
  picks between the user's accounts. Secrets never enter this module (`N8nCredential` is
  id/name/kind only, 79-96).
- **Node cards for the chat** (`skeleton_parameters`, flow_checks.rs:261-279): default parameter
  sets for the node-search UI in `n8n_nodes.rs:208` and `:330`.

### How it fits the whole PR

It is the enforcement point behind four production paths in `automation_flows.rs`:
`check_nodes` (automation_flows.rs:1000-1003) called by `create_flow` (:2047) and `update_flow`
(:1687); `check_draft` (:1770-1822) for the step-by-step draft state (`draft_view`, :1831,
:2002); `refuse_inventions` (:1858-1866) for early draft-step rejection (:1911, :1971). The
chat-supplied credentials are stripped before this module runs by `keep_user_credentials`
(automation_flows.rs:979-996), so the module's "credentials never come from the chat's request"
header claim (flow_checks.rs:15-18) is actually enforced by its callers.

### On the stated focus: "AI abstain-when-unsure and duplicate-safe ticket gating"

**These two behaviors are not implemented in this file** — that is the most important thing the
lead should know about this slice. They live in the demo workflow
`infra/automation-flows/workflows/novadesk-support-tickets.json`: the "Confident enough" IF node
(`$json.output.confidence === "high"`, else the email is sorted by hand) and the "Ticket already
created?" IF node (`($json.issues ?? []).length > 0` gates ticket creation). Their semantics are
tested behaviorally in `infra/automation-flows/workflows/novadesk-support-tickets.test.ts:240-246`
(unsure AI creates no ticket; `"low"`, `"High"`, `""`, `undefined` all abstain) and :545-557
(dedupe query). What this slice contributes is *structural pinning*: the test
`the_demo_workflow_passes_untouched` (flow_checks.rs:476-494) asserts the committed demo workflow
passes `check_and_wire` **and is returned unmutated** — so any workflow-JSON edit that breaks a
node type/version/required param breaks this Rust test. Conversely, `flow_checks.rs` cannot and
does not stop a chat modification from *deleting* the abstain or dedup gate nodes; only the human
Review Screen does (by design, per `README.md` design rule "nothing runs without the user").

## Checks I ran

- `cargo test -p screenpipe-engine --lib flow_checks` → **9 passed, 0 failed** (1787 filtered out),
  including the demo-workflow pin and the multi-credential refusal.
- Traced every public API consumer (grep across `crates/screenpipe-engine/src`); both
  `check_nodes` call sites are preceded by `keep_user_credentials`.
- Counted `_cnd` usage in `infra/automation-flows/n8n-catalog.json`: 174 occurrences — `gte`×107,
  `lte`×35, `lt`×18, `between`×6, `not`×3; `exists`/`startsWith`/`endsWith`/`includes` currently 0.
- Confirmed serde_json uses default features (workspace `Cargo.toml:58`, no `preserve_order` in
  `Cargo.lock`) → `Map` is a `BTreeMap`; rule AND-ing is order-insensitive and `_cnd` maps carry
  one operator each, so key order doesn't change verdicts.
- Not run / unverified: n8n's own acceptance behavior (whether `POST /workflows` rejects a
  connection whose target name matches no node) — no n8n instance available locally. Everything
  below that depends on it is marked accordingly.

## Findings

1. **P2 — dangling connection targets pass the "connected" check**
   (`linked_names`, flow_checks.rs:309-322, consumed at :173-175). Every string in
   `connections[*][*][*][*].node` is inserted into `linked` verbatim; phantom names are never
   cross-checked against `workflow["nodes"]`. A chat typo in one connection target leaves the
   source node "linked", reports nothing for the phantom, and — if that was the only real edge —
   the workflow passes the gate whose header promises "A Flow is never created half-built"
   (flow_checks.rs:8) and imports with the trigger wired to nothing. Mitigation unknown: if n8n
   rejects dangling targets at import, impact is a confusing refusal path only (unverified — see
   checks). Fix is small: intersect connection names with the node-name set.

2. **P2 — the `_cnd` condition evaluator has no direct tests despite heavy catalog use**
   (flow_checks.rs:389-438). 174 catalog conditions route through `condition_holds`/`any_matches`,
   yet the 9 tests only reach them indirectly (via demo-workflow params). Untested:
   numeric `gte/lte/gt/lt/between`, the boolean-vs-number guard in `same` (:433-438), unknown-op →
   `None` (never-refuse) paths, and rule-depth cutoff (:349-351). Also note `exists` (:424)
   treats `""` as absent, whereas JS-style existence would call it present — currently moot (zero
   catalog uses) but an under-refusal direction if a future catalog uses it.

3. **P3 — `catalog()` panics on catalog drift** (flow_checks.rs:74-77): `expect("n8n-catalog.json
   is valid")` runs at first use inside a request path. The same file is deserialized by the
   tests, so CI catches schema breakage; still, a bad regen would panic per request task instead
   of returning a 4xx/5xx `FlowError`.

4. **P3 — module-header invariant is enforced by callers, not here** (flow_checks.rs:15-18 vs
   `wire` at :284-287): `wire` keeps any held credential id as-is; only
   `keep_user_credentials` (automation_flows.rs:979-996) prevents the chat from choosing between
   the user's accounts by supplying an existing id. True for both current call sites; a doc
   pointer on `check_and_wire` would keep future callers safe.

5. **Over-refusal edges, safe direction** (no comment posted): `is_empty` trims strings
   (:328) and requires `value` on `__rl` resource locators (:330-332) — slightly stricter than
   n8n (a mode-`list` RL carrying only `cachedResultName` would be refused). Refusing a valid
   workflow is annoying, not dangerous, and chat-built nodes come from skeletons with explicit
   values.

6. **Performance**: not a hot path — runs once per chat create/update/draft request (sometimes
   2-3 `inspect` passes per request via `refuse_inventions` + `check_draft` + `check_nodes`).
   The 1.6 MB catalog is parsed once (`OnceLock`, :74-77); per-call work is O(nodes × params)
   with small clones. Recording hot paths (per AGENTS.md) are untouched by this file.

## Quality

Strong overall: a precise `//!` contract (flow_checks.rs:4-18), user-readable refusal messages
that aggregate every problem, recursion bounded (`MAX_RULE_DEPTH`, terminates on cyclic display
rules because `depth` increments through every `value`→`shown` hop), and tests that pin real
artifacts (the committed demo workflow, including its credential ids). The main gaps are the two
P2s above.

## Existing PR feedback overlap

None of the 15 existing review comments (all `coderabbitai[bot]`; fetched via
`gh api repos/arthrod/screenpipe/pulls/1/comments` plus issue comments) touch
`flow_checks.rs`. Closest themes — `retry.rs` double-retry duplicate tickets and the demo JSON
12 s-vs-8 s note — are different files; my posted comments do not duplicate them.
