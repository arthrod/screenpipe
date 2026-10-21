# 20: The agent's browser cannot open the app's own pages

Spec: story 34 ("the chat can never switch anything on"); ticket 14 (UI-only
activation credential). Found by the ticket 14 implementer.

**What to build:** The agent-controlled browser
(`apps/screenpipe-app-tauri/src-tauri/src/owned_browser.rs`) accepts any URL
scheme (`normalize_url`) and allows every navigation (`on_navigation` returns
`true`). Its webviews share the app's capabilities, so a page from the app's
own origin (`tauri://localhost`, `http(s)://tauri.localhost`, `ipc:`,
`asset:` / `http(s)://asset.localhost`, the dev server origin in debug
builds) gets Tauri IPC: the agent could load the app inside its browser and
call `get_flow_activation_key` or click « Activer » there, bypassing ticket
14. Refuse those origins in the owned browser: `normalize_url` returns an
error for them (the agent gets a clear message), and `on_navigation` returns
`false` for them (a page cannot redirect there). Ordinary web URLs, `about:`,
`data:` etc. keep working exactly as before.

**Blocked by:** None.

**Status:** done (live: `tauri://localhost/home` refused with the app-itself message, `https://example.com` still opens; see `docs/automation-flows/history/hackathon/evidence/LIVE-CHECKS.md`)

- [x] Tests (src-tauri, `bun run test:tauri owned_browser`): every app-origin form above is refused by URL normalization and by the navigation check, case and trailing-slash variants included; `https://example.com`, `localhost:8080`, `about:blank` still pass.
- [x] Nothing else in the owned browser changes (existing owned_browser tests pass).

## What was built

All in `apps/screenpipe-app-tauri/src-tauri/src/owned_browser.rs`:

- `is_app_origin(url, dev_build) -> bool`, one pure predicate. App origins:
  the schemes `tauri:`, `ipc:`, `asset:`; `http(s)://tauri.localhost`,
  `ipc.localhost`, `asset.localhost` (any port, case and trailing-dot
  variants, as WebView2 serves them on Windows); `blob:` URLs whose inner URL
  is one of those; and, only when `dev_build`, the dev server on port 1420
  (`localhost`, `127.0.0.1`, `[::1]`). Release builds keep opening a user's
  own project on `localhost:1420`.
- `normalize_url` refuses those URLs: « cannot open <url>: this page is the
  screenpipe app itself, and the agent browser never loads app pages. Give
  the user a screenpipe:// link instead. » It covers `owned_browser_navigate`,
  `owned_browser_tab_navigate` and the agent's eval-with-navigate path.
- `on_navigation` returns `false` for them (logged as a warning, scheme and
  host only), before the loading-state event, so no page, redirect or iframe
  can take the browser there.
- Both callers pass `tauri::is_dev()`. A test reads `build.devUrl` from
  `tauri.conf.json` so the port constant cannot drift.

## Tests run

- `cd apps/screenpipe-app-tauri && PATH="$HOME/.cargo/bin:$PATH" bun run test:tauri owned_browser`
  → 39 passed, 0 failed (new: `the_agent_browser_cannot_open_the_app_itself`,
  `app_pages_are_refused_when_the_agent_asks_for_them`,
  `a_page_cannot_navigate_the_agent_browser_to_the_app`,
  `dev_builds_also_refuse_the_dev_server`,
  `the_configured_dev_url_is_the_one_refused`, `ordinary_pages_still_open`;
  the 33 existing owned_browser tests still pass). Re-run after merging
  `origin/hackathon/automation-flows`: same result. The `PATH` prefix is
  needed on this Mac because the agent shell does not have `~/.cargo/bin`;
  the regenerated `src-tauri/gen/schemas/` noise was restored.

## Pending: live check in the real app (dev build, this branch)

1. `bun run dev:tauri` on this branch, open a chat with the browser sidebar.
   Ask the agent to open `tauri://localhost/` (macOS) or
   `http://tauri.localhost/` (Windows), then `http://localhost:1420/`.
   Check: the agent gets the « screenpipe app itself » error and the browser
   stays on its current page.
2. Ask it to open `https://example.com`: it loads as before.
