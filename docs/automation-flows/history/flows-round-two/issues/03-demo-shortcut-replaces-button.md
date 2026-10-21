# 03: Demo shortcut ⌃⌥⌘D replaces « Trouver une automatisation »

**What to build:** On stage the presenter presses ⌃⌥⌘D, even when ScreenPipe is not in front: the detected task is reset to its start state and the « Tâche répétitive détectée » notification is sent, exactly like the demo script. When the notification cannot be shown (duplicate within 90 s, pause, quiet hours, server unreachable) the presenter is told why. The « Trouver une automatisation » button is gone. The shortcut is active in every build.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** None (can start immediately)

**Status:** done, live check pending: press ⌃⌥⌘D with another app in front (notification appears, task reset), then again within 90 s (Home comes forward with the « Notification non affichée » toast and the Task Page)

- [x] ⌃⌥⌘D is registered globally by the desktop app and works when the app is in the background. (Registered in code; background behaviour to check live.)
- [x] The shortcut runs the same demo installer as the demo script: answers cleared, task reinstalled, notification sent.
- [x] When the notification is not shown, a visible message gives the reason.
- [x] The button and its component are removed; the shared demo-task module stays and keeps its tests.
- [x] The demo trigger is tested as a TypeScript function (reset, notify, reasons); the global registration is checked live and noted. (Live check pending, see Status.)

## How it works

- `src-tauri/src/shortcuts.rs`: `DEMO_SHORTCUT = "Control+Alt+Super+D"` is registered at the end of
  `apply_shortcuts` (so in every build, not configurable, not in the disabled list; a clash is logged
  and does not block the other shortcuts). It is not registered in hidden-UI enterprise mode, and the
  trial lock suppresses it like every other shortcut. The handler emits
  `shortcut-automation-flows-demo` to the `home` window only, so one press sends one notification.
  If Home was destroyed (headless), it opens Home and emits after 3 s.
- `lib/automation-flows/demo-shortcut.ts`: `demoShortcutHandler(deps)` runs `findAutomation` (the
  installer shared with `infra/automation-flows/demo/demo.ts`). Notified: nothing else. Not notified:
  toast « Notification non affichée » with the reason, then the Task Page opens. Install error: toast
  « Démo non lancée » with the reason, no notification. A press while one is running is ignored.
- `components/automation-flows/demo-shortcut-listener.tsx`, mounted in `app/providers.tsx` (non-overlay
  windows): listens for the event, brings Home forward before any toast (`Home { page: null }` keeps the
  current view). Off in the browser mock.
- Removed: `find-automation-button.tsx` and its test, and its slot in `pipe-store.tsx`.

## Tests run

- `cd apps/screenpipe-app-tauri && NODE_OPTIONS=--no-experimental-webstorage bun x vitest run --config vitest.config.ts lib/automation-flows components/automation-flows components/__tests__/pipe-store-flows-tab.test.tsx components/__tests__/pipe-store-error-state.test.tsx components/workflows/demo-task-evidence.test.tsx components/workflows/task-page-create-flow.test.tsx`:
  9 files, 107 passed (5 new in `lib/automation-flows/demo-shortcut.test.ts`).
- `bun test infra/automation-flows/demo`: 30 passed.
- `cd apps/screenpipe-app-tauri && bun x tsc --noEmit -p .`: exit 0.
- `cd apps/screenpipe-app-tauri && bun run test:tauri shortcuts::tests`: 2 passed
  (`demo_shortcut_is_control_option_command_d` new). Generated `src-tauri/gen/schemas` noise restored.
- Not run: the built app (live check pending, see Status).
