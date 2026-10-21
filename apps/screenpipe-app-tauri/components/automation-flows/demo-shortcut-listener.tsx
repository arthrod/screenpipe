// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

"use client";

// Runs the demo when the native ⌃⌥⌘D handler asks (it targets the Home window
// only, see src-tauri/src/shortcuts.rs). Mounted in every non-overlay window,
// so it listens on its own window: Tauri v2 delivers an `emit_to("home")` to
// every global `listen()` (target `Any`), whatever the window, which would run
// the demo once per open window.
import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useToast } from "@/components/ui/use-toast";
import { commands } from "@/lib/utils/tauri";
import { DEMO_SHORTCUT_EVENT, demoShortcutHandler } from "@/lib/automation-flows/demo-shortcut";
import { desktopFindAutomationDeps, openDemoTaskPage } from "@/lib/automation-flows/find-automation";
import { resetDemoFlows } from "@/lib/automation-flows/reset-demo-flows";
import { flowsApi } from "./api";

export function DemoShortcutListener() {
  const { toast } = useToast();
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SCREENPIPE_WEB_DEV === "mock") return;
    // The presenter is usually in another app: bring Home to the front so the
    // message is seen (the Task Page then opens over it when it can).
    const tell = (title: string, description: string, destructive?: boolean) => {
      void commands.showWindowActivated({ Home: { page: null } }).catch(() => {});
      toast({ title, description, ...(destructive ? { variant: "destructive" as const } : {}) });
    };
    const press = demoShortcutHandler({
      installer: desktopFindAutomationDeps(),
      resetFlows: async () => { await resetDemoFlows(flowsApi); },
      openTask: openDemoTaskPage,
      tell: ({ title, description, destructive }) => tell(title, description, destructive),
    });
    const unlisten = getCurrentWebviewWindow().listen(DEMO_SHORTCUT_EVENT, () => {
      press().catch(error => tell("Demo not started", error instanceof Error ? error.message : String(error), true));
    });
    return () => { void unlisten.then(stop => stop()).catch(() => {}); };
  }, [toast]);
  return null;
}
