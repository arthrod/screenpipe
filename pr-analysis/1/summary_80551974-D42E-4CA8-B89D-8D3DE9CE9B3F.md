# Review slice: n8n-nodes-screenpipe test files (main node, skill parameters, trigger)

PR #1 (`arthrod/screenpipe`, head = this checkout, diff base `origin/main`).
Slice: three new test files, 750 added lines, no modifications:

- `packages/n8n-nodes-screenpipe/test/screenpipe.node.test.ts` (376 lines) — main `ScreenPipe` node
- `packages/n8n-nodes-screenpipe/test/skill-parameters.test.ts` (42 lines) — cross-artifact contract test
- `packages/n8n-nodes-screenpipe/test/screenpipe-trigger.test.ts` (332 lines) — `ScreenPipeTrigger` polling node

## How this fits the whole PR

The whole `packages/n8n-nodes-screenpipe/` package is new in this PR (verified: `git diff origin/main...HEAD --stat` shows all three files as pure additions). These tests are the verification layer for the n8n integration the PR adds on top of Automation Flows: the `ScreenPipe` node (search / activity-summary / notify), the deterministic `ScreenPipeTrigger`, and (via the skill test) the `ScreenPipeAiTrigger` built elsewhere in the PR. The `skill-parameters.test.ts` file encodes the PR's central design constraint stated in its header (`test/skill-parameters.test.ts:4-6`): the chat builds Flows from `crates/screenpipe-core/assets/skills/automation-flows/SKILL.md` alone and cannot read this package, so every node parameter and option value must be named in the skill — this test is the tripwire that keeps skill and node definitions in lockstep.

## Checks I ran

- `bun test` (whole package, from `packages/n8n-nodes-screenpipe/`): **56 pass, 0 fail, 214 expect() calls, 4 files, 401ms** — includes the AI-trigger file (another reviewer's slice), all green.
- `bun test test/screenpipe.node.test.ts test/skill-parameters.test.ts test/screenpipe-trigger.test.ts` (my slice only): **33 pass, 0 fail, 144 expect() calls, 3 files**.
- `names()` probe (bun -e script re-running the test's own collection logic against `ScreenPipe.node.ts` properties): confirms `appName`/`windowName` are **not** collected — see finding 1.
- `bun -e 'new URL("n8n is great")'` → `TypeError - Invalid URL`; confirmed `new URL(url)` at `nodes/ScreenPipe/ScreenPipe.node.ts:301` sits outside the `try` starting at `:305` — see finding 2.
- n8n-workflow 2.42.2 typings (`node_modules/n8n-workflow/dist/esm/interfaces.d.ts:1052`): `IPollFunctions.getNodeParameter(parameterName, fallbackValue?, options?)` — no itemIndex, so the shim at `test/screenpipe-trigger.test.ts:28-30` and its comment are faithful to the real runtime.
- `gh pr checks 1`: PandaCI **fail** — "Pull requests from forks are not currently supported" (infra/fork protection, not a test failure; consistent with coderabbitai's existing PR comment). Socket checks pass/skip.

## Quality assessment

The tests are unusually strong for n8n node tests:

- **Real HTTP, outside-in.** A local `Bun.serve` fake (`test/harness.ts:32-60`) receives the node's actual requests; assertions pin method, path, query params, `Authorization` presence/absence, `Host`-header rewrite (`test/screenpipe.node.test.ts:293-300`, the DNS-rebinding guard), body JSON, and the exact flattened output items — not mocks of the node's internals.
- **The markdown-escaping assertion is sound** (`test/screenpipe.node.test.ts:271-275`): tokenizing with `/\\?./gsu` and filtering for exact bare matches proves no unescaped punctuation survives, and the round-trip `unescapeMarkdown(body) === text` proves no over-escaping. Minor nit: the explicit loop samples 10 of the 17 escaped characters; a regression dropping e.g. `` ` ``/`~`/`&` from the node's escape set (`ScreenPipe.node.ts:337`) would pass the loop and the round-trip. Not posted — the dangerous characters (link/HTML/heading) are all sampled.
- **Cursor semantics are thoroughly pinned** in `test/screenpipe-trigger.test.ts`: exactly-once keyword emission with the late-transcription re-read margin (`:108-141`), window-switch edge detection (`:144-178`), pipe execution ids oldest-first including status transitions not re-firing (`:181-219`), cursor reset when the watched target changes (`:221-240`), manual "Fetch Test Event" leaving static data untouched (`:283-294`), and errors keeping the cursor (`:306-322`).
- **Error paths are covered for both nodes**: HTTP non-2xx, `continueOnFail` error items, unreachable server naming the URL, HTTP-200-with-`{error}` (pipe routes) — `test/screenpipe.node.test.ts:172-202, 343-375`, `test/screenpipe-trigger.test.ts:306-332`.

## Findings (details in comments file)

All three findings are P3 test-coverage gaps; no correctness, security, or performance problem in the tests themselves, and nothing blocking.

1. **P3** `skill-parameters.test.ts:23-24` — `names()` never collects `type: "collection"` field names (`appName`, `windowName`, `query` inside `filters`/`summaryFilters`), so the guarantee in the file header is not fully enforced. Verified by execution.
2. **P3** `screenpipe.node.test.ts:351` (errors describe) — malformed `notifyUrl` is untested and today surfaces as bare `TypeError: Invalid URL` (`ScreenPipe.node.ts:301`, outside the try) instead of the URL-naming `NodeApiError`.
3. **P3** `screenpipe-trigger.test.ts:221` — the `signature()` exclusion of `pollTimes` (`ScreenPipeTrigger.node.ts:155`) is unpinned; a regression there would silently reset cursors whenever n8n rewrites the schedule.

## Limitations / not checked

- I did not verify the assertions against a real ScreenPipe server or real n8n runtime — fidelity is judged against `harness.ts` and the n8n-workflow 2.42.2 typings only.
- I did not review `test/screenpipe-ai-trigger.node.test.ts` (another slice) or the node sources as primary material; node code is cited only where a test assertion depends on it.
- PR CI does not run (fork protection), so there is no second signal beyond my local runs.
- Existing PR feedback checked before posting (per fetch-pr-feedback, 15 line-specific comments + 4 issue comments, none on my three files; the only package comment, on `ScreenPipeAiTrigger.node.ts:198-206` about adding an AI-proxy timeout, is a different subject — none of my findings duplicate it).
