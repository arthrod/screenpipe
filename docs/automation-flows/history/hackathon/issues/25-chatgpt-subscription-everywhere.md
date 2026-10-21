# 25: The user's ChatGPT subscription answers every AI

User decision (2026-10-17, SPEC D21): ScreenPipe's `auto` model
(`claude-haiku-5-5` behind the cloud gateway's Auto router) is not smart
enough to build Flows or to judge in the n8n nodes. Every AI in scope now uses
the user's ChatGPT subscription.

**Status:** done, live-verified on this Mac (2026-10-17, app rebuilt from
`7d8ee80a9`, ChatGPT signed in).

## Where each AI gets its model

| AI | Before | Now |
|----|--------|-----|
| ScreenPipe chat (Flow creation, Flow changes) | default preset `screenpipe-cloud` / `auto` | the ChatGPT preset on `gpt-5.6-luna`, Effort slider on Max: Settings → AI → « Use a model directly » → ChatGPT, signed in, set as default. No code: Pi already speaks the ChatGPT backend. |
| n8n AI step (OpenAI Chat Model, credential `spProxyOpenAI001`) | model `auto` | model `chatgpt/gpt-5.6-luna:max`, same credential and base URL |
| ScreenPipe AI Trigger | `model: "auto"` hard-coded | new `model` parameter, default `chatgpt/gpt-5.6-luna:max` |

## How `chatgpt/<model>` works

The local proxy `POST :3030/v1/chat/completions` (`routes/cloud_proxy.rs`)
hands any request whose model starts with `chatgpt/` to
`routes/chatgpt_proxy.rs`, which:

- reads the ChatGPT sign-in the app stored (`oauth:chatgpt` in the secret
  store), refreshed under the shared refresh lease, through
  `screenpipe_core::pipes::read_chatgpt_oauth_token` (the function pipes use),
  so no app-side change;
- translates Chat Completions → Codex Responses (`chatgpt.com/backend-api/codex/responses`,
  `store: false`, `stream: true`): system messages become `instructions`,
  tool calls and results become `function_call` / `function_call_output`,
  `response_format` becomes `text.format`, `reasoning_effort` becomes
  `reasoning.effort`; sampling and length parameters are dropped;
- reads the stream to its end and answers one OpenAI chat completion (or a
  short chat stream for `stream: true`), with OpenAI-shaped tool calls;
- errors are OpenAI-shaped (`{"error": {"message"}}`): 503
  `chatgpt_not_connected` without a sign-in, the backend's status and reason
  otherwise, 429 for usage limits.

Every other model (`auto`, `gemma4-e4b`, …) still goes to screenpipe cloud,
byte for byte as before.

## Files

- `crates/screenpipe-engine/src/routes/chatgpt_proxy.rs` (new, 14 tests),
  `routes/cloud_proxy.rs` (dispatch), `routes/mod.rs`.
- `crates/screenpipe-core/src/pipes/mod.rs`: `read_chatgpt_oauth_token` is `pub`.
- `packages/n8n-nodes-screenpipe/nodes/ScreenPipeAiTrigger/ScreenPipeAiTrigger.node.ts`
  (+ tests): `model` parameter; reads OpenAI-shaped error bodies.
- `crates/screenpipe-core/assets/skills/automation-flows/SKILL.md`: the chat
  builds AI steps on `chatgpt/gpt-5.6-luna:max` and knows the trigger's `model`.
- `infra/automation-flows/workflows/novadesk-support-tickets.json`,
  `.review.json`, `.test.ts`, and the app fixture
  `components/automation-flows/fixtures.ts`: model and wording (« votre
  abonnement ChatGPT »).
- `AGENTS.md` (AI model rule), `SPEC.md` (D21).

## Tests run

- `cargo test -p screenpipe-engine --lib routes::` → 389 passed (14 new in
  `chatgpt_proxy`, the 6 `cloud_proxy` tests unchanged).
- `cargo test -p screenpipe-engine --test automation_flows_test` → 48 passed.
- `cd packages/n8n-nodes-screenpipe && bun test` → 47 passed; `bun run typecheck` clean.
- `bun test infra/automation-flows/workflows` → 20 passed.
- `cd apps/screenpipe-app-tauri && bunx vitest run components/automation-flows lib/workflows/automation-flows.test.ts`
  → 94 passed. (The full vitest suite has 180 failures in 17 unrelated files,
  mostly `localStorage` missing in the test environment.)

## Live check (2026-10-17, this Mac)

A scratch script (not in the repo) ran three checks with the keys from the
root `.env`. The n8n check copies the
workflow's AI step (agent, model, output parser, ScreenPipe tool, same
credentials) behind a temporary webhook, then deletes it.

| Check | Result |
|-------|--------|
| Proxy, `chatgpt/gpt-5.6-terra`, plain | 200 in 2 s, « Paris », usage filled |
| Proxy, tool call | 200 in 1.4 s, OpenAI tool call (`call_…` id, `finish_reason: tool_calls`) |
| Proxy, tool result sent back | 200 in 1.4 s, « It’s 19:04 in Paris. » |
| Proxy, `stream: true` + usage | chunk, finish chunk, usage chunk, `[DONE]` |
| Proxy, `chatgpt/not-a-model` | 400, « The 'not-a-model' model is not supported when using Codex with a ChatGPT account. » |
| Proxy, `auto` | 200 from screenpipe cloud, as before |
| AI Trigger, default model, « working in a code editor, a terminal or an AI coding assistant » | fired in 2.6 s: « The user is actively using Terminal and Claude for coding-related work. » |
| AI Trigger, « watching a football match » | not met in 1.5 s: « The activity shows coding and messaging, with no football match visible. » |
| n8n AI step, NovaCRM CSV-export bug email | 200 in 4.9 s: Bug, NovaCRM, Highest, back, « Export CSV des contacts filtrés vide (en-têtes seuls) » |
| n8n AI step, Google security alert | 200 in 1.4 s: `type: none` (no ticket) |

Every call stayed far under the AI step's 20 s timeout. n8n 2.x registers a
webhook a moment after activation: the first try got a 404 and the delete a
409; the check script now waits for both.

## Luna at max effort everywhere (user decision, 2026-10-17)

`gpt-5.6-luna` at reasoning effort `max` replaces `gpt-5.6-terra`. In Pi's
Codex catalog Luna is the lightest of the 5.6 family (input/output $0.2/$1.2
per M tokens, against $2/$12 for Terra and $5/$30 for Sol); all three accept
`max`.

- **Proxy:** `chatgpt/<model>:<effort>` sets the reasoning effort; a
  `reasoning_effort` in the request wins. Needed because n8n's OpenAI Chat
  Model only forwards `low`, `medium` or `high` (`LmChatOpenAi.node.js`,
  `['low','medium','high'].includes(...)`). The backend validates the value
  (`bogus` → 400 listing `none` … `max`).
- **n8n AI step, AI Trigger default, automation-flows skill:**
  `chatgpt/gpt-5.6-luna:max`.
- **Chat:** the Effort slider gains « Max » (`thinking-level-selector.tsx`,
  `pi_set_thinking_level` / `pi_get_thinking_level` in `src-tauri/src/pi.rs`);
  Pi clamps it on models without `max`. On this Mac the default ChatGPT
  preset is `gpt-5.6-luna` and Pi's `defaultThinkingLevel` is `max`
  (`~/.screenpipe/pi-config/settings.json`), set while the app was stopped.
  The preset's model list shows only the account catalog's
  `visibility: list` entries and Luna is not among them; the field takes a
  typed model name.
- **Demo Flow** `DucCIr8YH6FdrZOZ` (created with `auto`): changed through
  `PUT /automation-flows/<id>` (model and « abonnement ChatGPT » wording), so
  ScreenPipe paused it (`paused_for_edit`) and it is `needs_review`: the user
  re-activates it from the Review Screen.

| Live check, luna:max (app rebuilt from `1326c501d`) | Result |
|-------|--------|
| Proxy plain / tool call / tool result / stream | 200 in 2.8 / 0.9 / 1.7 / 1.2 s |
| Proxy `auto` | 200 from screenpipe cloud, unchanged |
| AI Trigger, coding condition | fired in 1.8 s |
| AI Trigger, football condition | not met in 1.7 s |
| n8n AI step, NovaCRM bug email | 200 in 6.1 s: Bug, NovaCRM, Highest, back |
| n8n AI step, security alert | 200 in 1.4 s: `type: none` |

Tests: `cargo test -p screenpipe-engine --lib routes::chatgpt_proxy` → 15
passed; `cargo test -p screenpipe-core --lib automation_flows_skill` → 2
passed; node tests 47, workflow tests 20; effort slider and composer vitest
files → 51 passed.

## Known limits

- ChatGPT plans have usage windows; a polling AI Trigger spends them. A usage
  limit is a 429 that the trigger treats as « not met » and the n8n step fails
  (and retries) on.
- `/v1/local/chat/completions` (« the user's preset ») still sends
  `openai-chatgpt` presets to `api.openai.com`, which refuses a ChatGPT token.
  Not used by Flows.
