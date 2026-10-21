// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A fake Tauri v2 event bus with the real dispatch rule (tauri
// event/listener.rs `match_any_or_filter`): a listener whose target is `Any`
// (the global `listen()`) receives every event, even one sent with `emit_to`;
// a window-scoped listener receives an `emit_to(label)` only when its label
// matches.
type Target = { kind: string; label?: string };
const bus = vi.hoisted(() => ({
  currentLabel: "home",
  listeners: [] as { event: string; target: { kind: string; label?: string }; handler: () => void }[],
  emitTo(label: string, event: string) {
    for (const l of bus.listeners) {
      if (l.event !== event) continue;
      if (l.target.kind === "Any" || l.target.label === label) l.handler();
    }
  },
}));

function add(event: string, target: Target, handler: () => void) {
  const entry = { event, target, handler };
  bus.listeners.push(entry);
  return Promise.resolve(() => {
    bus.listeners.splice(bus.listeners.indexOf(entry), 1);
  });
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: () => void) => add(event, { kind: "Any" }, handler),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: bus.currentLabel,
    listen: (event: string, handler: () => void) =>
      add(event, { kind: "WebviewWindow", label: bus.currentLabel }, handler),
  }),
}));

const press = vi.hoisted(() => vi.fn(async () => ({ ignored: true as const })));
vi.mock("@/lib/automation-flows/demo-shortcut", () => ({
  DEMO_SHORTCUT_EVENT: "shortcut-automation-flows-demo",
  demoShortcutHandler: () => press,
}));
vi.mock("@/lib/automation-flows/find-automation", () => ({
  desktopFindAutomationDeps: () => ({}),
  openDemoTaskPage: async () => {},
}));
vi.mock("@/lib/utils/tauri", () => ({ commands: { showWindowActivated: async () => {} } }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

import { DemoShortcutListener } from "../demo-shortcut-listener";

afterEach(() => {
  cleanup();
  bus.listeners.length = 0;
  press.mockClear();
});

async function mountIn(label: string) {
  bus.currentLabel = label;
  render(<DemoShortcutListener />);
  await waitFor(() => expect(bus.listeners.length).toBeGreaterThan(0));
}

describe("DemoShortcutListener", () => {
  it("runs the demo in the Home window when the shortcut targets Home", async () => {
    await mountIn("home");
    bus.emitTo("home", "shortcut-automation-flows-demo");
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("does not run the demo in another window when the shortcut targets Home", async () => {
    await mountIn("settings");
    bus.emitTo("home", "shortcut-automation-flows-demo");
    expect(press).not.toHaveBeenCalled();
  });
});
