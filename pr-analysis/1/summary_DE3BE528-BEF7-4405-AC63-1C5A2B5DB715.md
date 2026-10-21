# Slice review: chat markdown flows links + summary card changes (PR #1)

Files (all under `apps/screenpipe-app-tauri/`): `components/chat/markdown-block.tsx`,
`components/chat/markdown-block.test.tsx`, `components/chat/summary-cards.tsx`,
`components/chat/summary-cards.test.tsx`.

## What this slice changes

1. **`markdown-block.tsx` (+9/−2)** — the chat's link component gains a
   `screenpipe://flows/` deep link: `markdown-block.tsx:217` adds the prefix to
   the screenpipe-link branch and `markdown-block.tsx:224-227` dispatches such
   clicks to `openFlowReviewLink(href)` (imported at `markdown-block.tsx:25`)
   and returns before the other handlers (view/frame/meeting/timeline).
2. **`markdown-block.test.tsx` (+25)** — mocks the new seam
   (`markdown-block.test.tsx:69-71`, hoisted mock at 20-22) and adds
   "opens a Flow's Review Screen from the link the chat ends a Flow change
   with" (`markdown-block.test.tsx:371-388`): renders
   `[Revoir le Flow](screenpipe://flows/spNovaFlow000001)`, clicks it, asserts
   `openFlowReviewLink` got the raw href and that the notification-deeplink
   router and pending-navigation store were not touched.
3. **`summary-cards.tsx` (+52/−13)** — two changes:
   - New optional `onCreateFlow` prop (`summary-cards.tsx:62-66,183`) rendering
     a « Create flow » chip between the quick-summary chips and the user's
     saved templates (`summary-cards.tsx:403-420`). On click it clears the
     prompt preview, fires `home_card_clicked {kind: "create_flow"}` and calls
     `onCreateFlow()`; it sends nothing, shows no hover preview and no agent
     actions — all stated in the comments at `summary-cards.tsx:62-66` and
     `403-404`.
   - The « + Custom » slot button is wrapped in a
     `relative min-w-[148px] flex-1` div and the button becomes `w-full`
     (`summary-cards.tsx:453-470`), matching the other chip wrappers, so the
     custom slot's flex sizing no longer lives on the button itself.
4. **`summary-cards.test.tsx` (+63)** — three new tests: chip order +
   no-send + analytics + style parity (`summary-cards.test.tsx:218-248`),
   absence when the chat does not wire the prop
   (`summary-cards.test.tsx:250-261`), and the custom-slot wrapper classes
   (`summary-cards.test.tsx:290-306`).

## How it fits the whole PR

This is the chat-side consumer of the Automation Flows feature: the
`automation-flows` chat skill ends its replies with a
`screenpipe://flows/<id>` link, and the home cards gain a Create-flow entry
point. The rendering dependency is the 2-line addition of the `"flows"` host
to `chatUrlTransform` (`components/markdown.tsx:90-97`, changed in this PR but
outside my slice — I read it as a dependency) and the new
`lib/workflows/automation-flows.ts` (184 lines, also outside my slice, read
read-only). Without those, the new branch would be unreachable or dead.

## Security review (the stated focus): sanitization of rendered HTML — no new XSS found

Chain of custody for an href reaching the new branch, each stage verified:

- **Tag/attribute allowlist.** The pre-existing `chatSanitizeSchema`
  (`markdown-block.tsx:47-58`) keeps GitHub's default tag allowlist minus
  `picture`/`source` plus `u`/`mark`/`small`, strips `style`, and clobber-prefixes
  DOM-clobberable attributes. It does not change in this PR.
- **Protocol deferral claim is true.** `chatSanitizeSchema` sets
  `protocols: { href: [], src: [] }` (`markdown-block.tsx:55`). I downloaded the
  pinned dependency sources and verified the semantics:
  - `hast-util-sanitize@5.0.2` `safeProtocol` returns `true` ("everything is
    fine") when the protocol list is empty
    (`/tmp/hast-util-sanitize-5.0.2-lib.js:679-681`, fetched via
    `curl -sL https://unpkg.com/hast-util-sanitize@5.0.2/lib/index.js`; version
    pinned in `apps/screenpipe-app-tauri/bun.lock:1908`). So the empty array
    **disables** the sanitizer's protocol check rather than denying all —
    protocol filtering is delegated, exactly as the comment at
    `markdown-block.tsx:37-41` says.
  - `react-markdown@9.1.0` applies `urlTransform` in its post-processing pass,
    after all rehype plugins, to every `html-url-attributes` key (incl. `href`,
    `src`) on every element — raw-HTML-derived nodes included
    (`/tmp/react-markdown-9.1.0.js:367-379`, fetched via
    `curl -sL https://unpkg.com/react-markdown@9.1.0/lib/index.js`; version
    pinned in `bun.lock:2626`). So raw HTML cannot bypass `chatUrlTransform`.
  - `chatUrlTransform` (`components/markdown.tsx:65-97`) keeps only
    `screenpipe:` URLs whose (opaque, case-preserving) host is in
    `{timeline, frame, meeting, view, flows}`, local absolute/`file://` paths,
    and otherwise falls back to `defaultUrlTransform` (which strips
    `javascript:`, `data:`, unknown protocols).
- **The new branch itself** is a plain string-prefix dispatch on an
  already-validated href; it renders `<a href="#">` with `preventDefault` and
  never puts the chat-controlled URL into DOM. Downstream,
  `openFlowReviewLink` re-validates (`flowIdFromReviewLink`,
  `lib/workflows/automation-flows.ts:102-110`: protocol `screenpipe:`, host
  exactly `flows`, first path segment) and re-encodes the ID with
  `encodeURIComponent` before it lands in a URL, `history.replaceState`, or a
  Tauri command (`automation-flows.ts:97-131,160-165`). A hostile Flow ID can
  only select which existing Flow the Review Screen tries to display — no
  injection sink.
- **Case edge, checked empirically:** for non-special schemes WHATWG URL does
  not lowercase opaque hosts — `new URL("screenpipe://FLOWS/x").host` is
  `"FLOWS"` (ran `node -e` to confirm), so a model-emitted uppercase-host link
  fails `chatUrlTransform`'s allowlist and `defaultUrlTransform` collapses the
  href to `""` — a dead link, consistent with the dispatcher's case-sensitive
  `startsWith`. No mismatch, no bypass.
- **The new test pins the real pipeline.** The test mocks
  `@/lib/workflows/automation-flows` but not `@/components/markdown`
  (`markdown-block.test.tsx:40-71`), so `chatUrlTransform` runs for real: if
  the href were stripped, the click would never reach `openFlowReviewLinkMock`
  and the `waitFor` at `markdown-block.test.tsx:381-385` would fail. The
  pre-existing sanitization suite (`markdown-block.test.tsx:501-603`) already
  pins live-element removal, `javascript:` neutralization (incl. raw-HTML
  anchors — the deferral contract), remote-image blocking, and the
  `user-content-` clobber prefix.

## Tests I ran (exact commands)

- `cd apps/screenpipe-app-tauri && bun install --frozen-lockfile` → "1 package
  installed" (app had no node_modules in this checkout; frozen lockfile).
- `bun x vitest run --config vitest.config.ts components/chat/markdown-block.test.tsx components/chat/summary-cards.test.tsx`
  → **2 files passed, 87 tests passed (67 + 20), 0 failed** (stderr noise about
  media loading comes from the missing-recording test and is expected).
- I did **not** run the full frontend suite or any other crate's tests; this is
  a two-file scoped run, not a substitute for `bun run test`.

## Notable risks / quality issues

- **P3 test gap (posted):** the Create-flow chip's two documented behavioral
  differences — no prompt preview on hover/focus and no agent actions — are
  only pinned on the click side (`onPreviewPrompt` cleared,
  `summary-cards.test.tsx:246`). A regression that adds `promptPreviewHandlers`
  or `HomeCardAgentActions` to the chip (`summary-cards.tsx:405-419`) would
  pass the current suite.
- Everything else I looked for held up: chip placement matches the sibling
  wrapper pattern (`min-w-[148px] flex-1`, cf. `summary-cards.tsx:350,370`);
  empty `customTemplates` leaves the row well-formed (+ Custom always renders —
  pre-existing); the custom-slot wrap is structurally identical to the other
  chips and class-pinned by a test. I could not visually verify the alignment
  rationale in the comment at `summary-cards.tsx:453-457` (no screenshot/ASCI
  mockup in my scope); the test pins classes, not rendered geometry.
- Error handling matches the file's existing pattern: a rejected
  `openFlowReviewLink` is caught and logged
  (`markdown-block.tsx:259-261`); the user gets no toast — consistent with the
  other deep-link branches. The ignored `false` return at
  `markdown-block.tsx:224-227` is unreachable-in-practice because the outer
  prefix guard and `flowIdFromReviewLink` agree for any href that passes
  `chatUrlTransform` (verified by reasoning over both parsers; no case found).
- Out-of-slice dependencies I checked read-only and found consistent:
  `components/markdown.tsx:90-97` (flows host allowlist), and
  `lib/workflows/automation-flows.ts` (new file).

## Existing PR feedback (dedup check)

Ran fetch-pr-feedback for PR #1 (both paginated comment fetches + resolved-thread
GraphQL succeeded; RESOLVED_IDS = []). 13 line-specific comments exist, all from
coderabbitai[bot], on: flow-activation.tsx, notification-actions.test.ts,
shortcuts.rs, n8n-guide.md, skills SKILL.md (×2), pi.rs, retry.rs,
chatgpt_proxy.rs, DEMO.md (×2), novadesk-support-tickets.json,
ScreenPipeAiTrigger.node.ts, workflow-questions.tsx, workflows-app.module.css.
**None touch my four files**; nothing I post duplicates them.
