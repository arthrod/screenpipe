# 13: The AI proxy returns OpenAI-shaped tool calls

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decision D11 in `SPEC.md`; probe results in its "Verified on the local n8n 2.42.2" section). Found while doing ticket 07.

**What to build:** When an n8n AI Agent (or any OpenAI-compatible client) uses
tools through ScreenPipe's local AI proxy, the conversation keeps working
after the first tool call. Today the proxy passes the upstream answer through
unchanged, and tool calls come back as `{"type": "tool_use", "function": …}`
with an empty or missing `id` and no `finish_reason`; the client then sends
the tool result with `tool_call_id: ""` and the next call fails with 400
"malformed tool call". The proxy normalizes non-streaming JSON answers: every
tool call gets a unique non-empty `id` (e.g. `call_<uuid>`) and
`type: "function"`, and `finish_reason` is `"tool_calls"` when tool calls are
present and the field is missing. Everything else (other fields, plain
answers, streaming, errors) passes through unchanged.

**Blocked by:** None (can start immediately).

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Engine tests through the proxy route with a fake upstream: tool calls without ids get unique ids and type "function"; existing ids are kept; finish_reason is set only when missing; a plain answer and an error answer are byte-for-byte unchanged; streaming is untouched. (`cargo test -p screenpipe-engine --lib routes::cloud_proxy`: 6 passed. Seam: `chat_completions_with_base` in `routes/cloud_proxy.rs` with a wiremock upstream; `server.rs` untouched.)
- [x] The two-turn probe from ticket 07 (tool call, then tool result) returns 200 through the proxy when the app runs the dev build containing the fix. Dev build: tool calls come back with `id: call_…`, `type: function`, `finish_reason: tool_calls` (installed app: `id: null`, `type: tool_use`); the demo agent's tool round trips complete in live runs (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
- [x] The demo n8n workflow with the ScreenPipe tool runs end to end on a synthetic email (manual-trigger probe), ending with `{type, product, summary, priority, label}`. Bug, none and prompt-injection emails, then real emails (n8n executions 9 and 10).

Note: the running ScreenPipe is the installed app, which does not contain
engine changes. Live checks need the dev build (`bun run dev:tauri` from the
app folder, installed app quit first); that switch is a human step.

Pending human (live checks):

1. Quit the installed ScreenPipe app.
2. From `apps/screenpipe-app-tauri` on a checkout that contains this fix, run
   `bun run dev:tauri` and stay signed in (the proxy needs the cloud token).
3. Run `docker exec -e N8N_RUNNERS_BROKER_PORT=5690 automation-flows-n8n-1 n8n execute --id=spProbeTool00001 --rawOutput`
   (agent + tool, real two turns). Expected: no 400 "malformed tool call";
   the run reaches the agent's final answer.
4. Optional: `docker exec -e N8N_RUNNERS_BROKER_PORT=5690 automation-flows-n8n-1 n8n execute --id=spProbeProxy0001 --rawOutput`.
   This probe hardcodes both requests, so the fix does not change it:
   expected `sansIdStatus` 400 and `avecIdStatus` 200, as before. It only
   confirms the dev build serves the proxy.
5. Third checkbox: run the demo workflow on a synthetic email with a manual
   trigger and check the final item has `{type, product, summary, priority, label}`.
