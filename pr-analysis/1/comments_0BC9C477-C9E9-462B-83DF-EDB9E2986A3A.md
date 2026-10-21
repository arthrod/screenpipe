## Review of `crates/screenpipe-engine/src/flow_checks.rs` (new file, 587 lines)

Scope of this review: the flow-check gate itself (node/version/parameter/credential/link validation, `_cnd` display-rule evaluation, and the demo-workflow pin). All 9 module tests pass locally (`cargo test -p screenpipe-engine --lib flow_checks` → 9 passed, 0 failed). Nothing here overlaps the existing review threads on `retry.rs`, `chatgpt_proxy.rs`, or the demo JSON.

---

**[P2] A connection to a name that is no node leaves the source "linked" — one typo passes a disconnected workflow** — `crates/screenpipe-engine/src/flow_checks.rs:309-322`

`linked_names` inserts both ends of every connection verbatim (`names.insert(target.to_string())`, flow_checks.rs:315-316), and `inspect` only tests `linked.contains(&name)` for nodes that exist (flow_checks.rs:173-175). If the chat typos one connection target, the phantom name is never reported, the source node counts as connected, and — when that was the only real edge — the workflow passes the gate whose header promises "A Flow is never created half-built" (flow_checks.rs:8). It then imports with the trigger wired to nothing. I could not verify locally whether n8n's `POST /workflows` rejects dangling connection targets; if it does, the impact is only a confusing refusal path, if it doesn't, an activation-ready broken Flow. The fix is small: collect the real node names in `inspect`, and count a connection end as linking only when the name matches an existing node.

---

**[P2] The `_cnd` evaluator runs 174 times in the catalog but has no direct tests** — `crates/screenpipe-engine/src/flow_checks.rs:410-430`

`n8n-catalog.json` contains 174 `_cnd` conditions (`gte`×107, `lte`×35, `lt`×18, `between`×6, `not`×3 — counted from the file), all routed through `condition_holds`/`any_matches`, yet the module's 9 tests reach them only indirectly through the demo workflow's parameters. Worth adding unit tests for: the numeric arms including `between`'s `from`/`to` (flow_checks.rs:420-423), the boolean-vs-number guard in `same` (flow_checks.rs:433-438, a subtle and load-bearing piece — `true.as_f64() == Some(1.0)`), the unknown-operator → `None` → never-refuse path (flow_checks.rs:428), and the `MAX_RULE_DEPTH` cutoff (flow_checks.rs:349-351). Also a fidelity note while you are in there: `exists` (flow_checks.rs:424) treats `""` as absent (`value != ""`), whereas JS-style existence would call an empty string present; that is the under-refusal direction if a future catalog uses `exists` on a param the editor considers set. It is currently unused (0 occurrences in the catalog), so no behavior bug today.

---

**[P3] `catalog()` panics inside a request path on catalog drift** — `crates/screenpipe-engine/src/flow_checks.rs:76`

`serde_json::from_str(CATALOG_JSON).expect("n8n-catalog.json is valid")` panics at first use, which is inside create/update/draft handlers (`automation_flows.rs:1002`, `:1771`, `:1859`). The tests deserialize the same embedded file, so CI catches a schema-breaking regen of `n8n-catalog.json` — but a panic kills the handler task with no `FlowError` for the chat to act on. A `Result`-returning init (or a `OnceLock<Result<Catalog, String>>` mapped to `FlowError::InvalidWorkflow`) would turn drift into a proper refusal. Not blocking: the file is `include_str!`-compiled and test-pinned.

---

**[P3] The "credentials never come from the chat's request" invariant is enforced by the callers, not by this module** — `crates/screenpipe-engine/src/flow_checks.rs:284-287`

The `//!` header states "Credentials still never come from the chat's request (ticket 22)" (flow_checks.rs:15-18), but `wire` itself happily keeps any node-held credential id that exists in n8n (`credentials.iter().any(|c| c.kind == kind && Some(c.id.as_str()) == held)` → `Ok(())`), which is exactly how a chat *would* pick between the user's accounts if it could supply ids. Today that is prevented only because both production call sites run `keep_user_credentials` first (`automation_flows.rs:979-996`, used at `:1687` and `:2047`) — I traced both. Since `flow_checks` is a `pub mod` (`lib.rs:44`) with a public `check_and_wire`, a one-line doc on the function stating the precondition ("callers must strip chat-supplied credentials; see `keep_user_credentials`") would keep future callers from silently reintroducing account selection.
