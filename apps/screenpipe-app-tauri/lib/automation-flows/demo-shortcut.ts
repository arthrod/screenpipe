// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Hidden demo shortcut ⌃⌥⌘D (registered globally by the desktop app in
// demo/dev contexts only, src-tauri/src/shortcuts.rs
// `demo_shortcut_allowed`, which emits DEMO_SHORTCUT_EVENT to the Home
// window). A full reset on every press: the Flows created from the demo task
// are deleted (through the engine, like `infra/automation-flows/demo/reset.ts`)
// while the same demo installer as `infra/automation-flows/demo/demo.ts`
// reinstalls the detected task in its start state (answers cleared); then
// « Repetitive task detected » is sent, every time (its body is unique per
// press). Opening the Task Page from it reads the task again. When the
// notification is not shown, the presenter is told why and the Task Page
// opens directly.
import { findAutomation, type FindAutomationDeps, type FindAutomationResult } from "./find-automation";

/** Emitted by the native shortcut handler; keep in sync with `DEMO_SHORTCUT_EVENT` in shortcuts.rs. */
export const DEMO_SHORTCUT_EVENT = "shortcut-automation-flows-demo";

export type DemoShortcutMessage = { title: string; description: string; destructive?: true };

export type DemoShortcutDeps = {
  installer: FindAutomationDeps;
  /** Deletes the Flows created from the demo task; rejects with the reason. */
  resetFlows?: () => Promise<void>;
  /** What the notification's « View task » does. */
  openTask: () => Promise<void>;
  /** A message the presenter sees (a toast in the Home window). */
  tell: (message: DemoShortcutMessage) => void;
};

export type DemoShortcutOutcome = FindAutomationResult | { ignored: true };

/** One handler per listener: a press while the previous one still runs is ignored. */
export function demoShortcutHandler(deps: DemoShortcutDeps): () => Promise<DemoShortcutOutcome> {
  let running = false;
  return async () => {
    if (running) return { ignored: true };
    running = true;
    try {
      const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
      // Runs while the task is reinstalled; the notification waits for it, so
      // the Task Page it opens never finds the previous Flow.
      const reset = (deps.resetFlows?.() ?? Promise.resolve()).then(() => null, reason);
      const installer: FindAutomationDeps = {
        ...deps.installer,
        notify: async payload => {
          const failed = await reset;
          if (failed) deps.tell({ title: "Previous demo Flow not deleted", description: `${failed}. Delete it in Automations → Flows.`, destructive: true });
          return deps.installer.notify(payload);
        },
      };
      let result: FindAutomationResult;
      try {
        result = await findAutomation(installer);
      } catch (error) {
        deps.tell({ title: "Demo not started", description: reason(error), destructive: true });
        return { notified: false, reason: reason(error) };
      }
      if (!result.notified) {
        deps.tell({ title: "Notification not shown", description: `${result.reason}. The task opens directly.` });
        await deps.openTask();
      }
      return result;
    } finally {
      running = false;
    }
  };
}
