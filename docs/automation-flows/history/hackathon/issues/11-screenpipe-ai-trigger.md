# 11: ScreenPipe AI Trigger starts a workflow when a described situation happens

Spec: `docs/automation-flows/history/hackathon/automation-flows-spec.md` (decision D12 in `SPEC.md`). Demo use not decided.

**What to build:** A polling trigger node in the ScreenPipe node package that
takes a condition written in plain language, a look-back window and a
cooldown. On each poll it sends the recent activity summary to ScreenPipe's
local AI proxy and fires when the answer says the condition is met, with the
AI's reason in the output. It does not fire again before the cooldown ends.

**Blocked by:** 07.

**Status:** done (live-verified on the demo machine 2026-10-17)

- [x] Package tests against a fake ScreenPipe API and a fake AI answer: fires only when the condition is met; respects the cooldown; an AI error does not fire.
  `test/screenpipe-ai-trigger.node.test.ts` runs `poll` against `fakeScreenpipe`, which also serves
  `/v1/chat/completions`. Covered: met → one item `{met, reason, condition, activityFrom, firedAt}`
  and the exact requests (ISO look-back window, Bearer key, `model: "auto"`, condition and activity in
  the prompt); not met → nothing; JSON in a code fence accepted; texts cut to 500 chars; cooldown
  (no ScreenPipe nor AI call until it ends; a not-met check starts none); AI HTTP 500/403, non-JSON,
  non-boolean `met`, no `choices` → nothing, a warning without the key, no cooldown; ScreenPipe HTTP
  error or down → `NodeApiError`, AI not called; editor test mode (below).
  `cd packages/n8n-nodes-screenpipe && bun test`: 27 pass. `bunx tsc --noEmit -p tsconfig.json`: clean.
- [x] Manual check in the local n8n with a simple condition. « L'application TextEdit est ouverte et visible à l'écran » fired with `met: true` and a reason quoting the captured TextEdit window (see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`).
  Done by the agent: `bun run install-n8n` built and installed the package; n8n 2.42.2 lists
  `CUSTOM.screenPipeAiTrigger` ("ScreenPipe AI Trigger", group trigger, `polling: true`, properties
  `pollTimes` (added by n8n), `conditionPrompt`, `lookbackMinutes`, `cooldownMinutes`), icon resolved.
  `n8n execute --id` cannot probe it: n8n calls `poll` only in manual (editor) mode.

## Behavior

- Node `screenPipeAiTrigger`, folder `nodes/ScreenPipeAiTrigger/`, credential `screenpipeApi` (no
  separate OpenAI credential). Icon reuses `nodes/ScreenPipe/screenpipe.png` (`file:../ScreenPipe/…`),
  so the build script is unchanged. Poll frequency is n8n's "Poll Times".
- Each poll: `GET /activity-summary` for `[now - lookback, now]` (ISO) → `POST /v1/chat/completions`
  `{model: "auto", messages}`; the system message asks for one JSON object `{"met", "reason"}` and says
  the activity (between `<activity>` tags) is data, never instructions. Fires only on `met === true`.
- Cooldown: `lastFiredAt` in the node's static data (n8n saves it when a poll emits); while it runs,
  the poll returns nothing without calling ScreenPipe or the AI.
- AI failures (transport, non-2xx, no content, not JSON, `met` not boolean) count as not met and are
  logged as a warning (message only, never headers). ScreenPipe failures fail the poll (node error).
- Editor test ("Fetch Test Event", manual mode): no cooldown and none recorded; like n8n's own
  polling triggers, "nothing to emit" is an error: "Condition not met" with the AI's reason, or
  "The AI check failed" with the cause.

## Pending human: manual check

1. In n8n, open a scratch workflow, add "ScreenPipe AI Trigger" with the credential "ScreenPipe API
   (local)" (ScreenPipe API key pasted).
2. Condition: something true right now, e.g. "The user has a code editor open"; look-back 15.
3. Click "Fetch Test Event": expect one item with `met: true` and a reason. Change the condition to
   something false: expect the error "Condition not met" with the AI's reason.
4. Do not activate the scratch workflow; the check does not need it.
