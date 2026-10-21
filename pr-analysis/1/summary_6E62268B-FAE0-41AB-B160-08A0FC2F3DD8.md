# Slice summary: `crates/screenpipe-connect/src/connections/n8n.rs` (n8n connection client — auth, timeouts, error mapping)

## What this slice changes

The diff (+206/−17) turns the n8n integration from webhook-only into a dual-mode connection:

1. **New n8n public-API credential pair** — two new `FieldDef`s: `api_url` (non-secret, n8n.rs:28-34) and `api_key` (secret, n8n.rs:35-41), alongside the pre-existing secret `webhook_url` (n8n.rs:21-27, label now "(optional)").
2. **New public helpers** for consumers: `API_KEY_HEADER` = `X-N8N-API-KEY` (n8n.rs:12), `instance_url()` normalizing trailing slashes and a literal `/api/v1` suffix (n8n.rs:47-54), `api_credentials()` returning `(base, key)` only when both fields are non-empty after trim (n8n.rs:57-61, via `non_empty` n8n.rs:63-69). The `require_str` import was dropped (n8n.rs:5).
3. **Rewritten `Integration::test`** (n8n.rs:79-117): rejects a half-configured API pair (`has_url != has_key`, n8n.rs:88-90) and an entirely empty form (n8n.rs:92-94); when API creds are present it GETs `{base}/api/v1/workflows?limit=1` with the key header and `error_for_status()` (n8n.rs:97-106); when the webhook is present it POSTs the same test event as before (n8n.rs:107-114); success messages are joined (n8n.rs:116).
4. **Six new tests** (n8n.rs:120-238): secret-flag/layout invariants incl. `safe_connection_config` filtering, brand spelling, `instance_url` parsing, a wiremock test asserting the header/query/path of the API check, validation rejections, and a SecretStore persistence test asserting the key lands in `cred:n8n` and never in plaintext `connections.json`.

## How it fits the whole PR

This file is the credential layer the new Automation Flows feature stands on: the engine's `N8nApi` reuses exactly the helpers introduced here — `n8n::api_credentials` (crates/screenpipe-engine/src/automation_flows.rs:618) and `n8n::API_KEY_HEADER` (automation_flows.rs:636, and retry.rs:93) — so URL normalization and the header name have a single home. The `webhook_url` field staying secret keeps the inherited `WebhookProxyConfig` boundary (mod.rs:232-242) and the mod.rs registry tests that depend on it (`webhook_proxy_capability_is_inherited_by_every_secret_webhook_provider` still lists n8n, mod.rs:1354) unchanged.

## Auth handling — verified OK

- Key is sent on `X-N8N-API-KEY` (n8n.rs:101), the correct header for n8n's public API.
- `api_key` is `secret: true` (n8n.rs:38), so `safe_connection_config`'s default-deny (mod.rs:1155-1168) keeps it out of read APIs and Pi/model context; directly tested at n8n.rs:142-150 and by the passing mod.rs suite test `render_context_never_exposes_any_declared_secret_field` (mod.rs:1518).
- Redirect-credential safety holds on production paths: the client is injected by `ConnectionManager::test` (mod.rs:813-818) as `build_default_client()`, which uses `same_origin_redirects_only()` (mod.rs:327-346) so the custom-header credential cannot be carried off-origin on a 3xx (verified by the existing test at mod.rs:1177, which passed in my run).
- SecretStore persistence is asserted (n8n.rs:215-237); `normalize_credentials` (mod.rs:460-475) strips whitespace-only fields before save, consistent with `non_empty`'s trim on read.
- `api_url` non-secret is defensible (an address, not a credential; placeholder is localhost, n8n.rs:32).

## Timeouts — verified OK

- `test()` uses the injected client; both production call paths (`connections_api.rs:611` HTTP route, `cli/connection.rs:274` CLI) go through `ConnectionManager`, whose client bounds connect at 10s and requests at 30s (mod.rs:282-296). Only tests construct a bare `reqwest::Client::new()`.
- Worst case with both targets configured is two sequential checks ≈ up to ~60s of timeouts on an explicit user action — acceptable; noted, not commented.
- The engine's own flow client (consumer of these helpers) builds its own bounded client, 3s connect / 20s request (automation_flows.rs:256-258).

## Findings (details in comments file)

- **P2 — error mapping:** the new API check and the webhook check surface raw reqwest errors (`error_for_status()?`, n8n.rs:104/113, no `.with_context`); `test_connection` returns `e.to_string()` to the UI (connections_api.rs:610-613). A wrong key reads as "HTTP status client error (401 Unauthorized) for url (…)" while the engine's own client maps 401/403 to a setup-oriented `FlowError::Unauthorized` (automation_flows.rs:638-645). A malformed `api_url` (e.g. missing scheme) yields a bare "relative URL without a base".
- **P2 — test gap:** no test exercises the webhook-only branch (n8n.rs:107-115) — the only configuration that existed before this PR — or the combined api+webhook path (n8n.rs:116). A flipped condition would silently break every existing webhook-only user's connect flow.
- **P3 — pre-existing, in-scope since the function was rewritten:** `error_for_status()` on the webhook POST embeds the secret webhook URL in the error string ("for url (…)" via connections_api.rs:610-613). Predates the PR (same pattern in the old code) but is a cheap fix while touching error mapping.
- Non-issues checked: `instance_url` handles `/`, `/api/v1`, surrounding whitespace and subpath installs (n8n.rs:47-54, tests 161-170); partial-success progress loss when the first check fails is folded into the P2 error-mapping comment; the test webhook POST firing a real event per click is pre-existing, unchanged.

## Verification run (this session)

- `cargo test -p screenpipe-connect n8n` → 6 passed, 218 filtered out.
- `cargo test -p screenpipe-connect` (full crate suite, per AGENTS.md scoping) → **223 passed, 0 failed, 1 ignored**. Includes the redirect-safety and context-exposure tests cited above.
- `git diff origin/main...HEAD -- crates/screenpipe-connect/src/connections/n8n.rs` and full-file read; consumers read: mod.rs (trait, client builders, storage), automation_flows.rs:595-680 + 222-268, connections_api.rs:595-640, retry.rs:93 (grep only).

## Not checked (honest gaps)

- Did not run `cargo test -p screenpipe-engine` (engine-side consumers are other reviewers' slices).
- Did not verify against a real n8n instance; header/endpoint correctness (`GET /api/v1/workflows`, `X-N8N-API-KEY`) is grounded in the wiremock tests and n8n docs links in the field defs, not a live check.
- Existing PR feedback on this file: none (fetch-pr-feedback run showed line-specific comments on 13 other files only; bots skipped or posted generic summaries).
