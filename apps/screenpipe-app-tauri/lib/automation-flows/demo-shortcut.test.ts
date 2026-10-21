// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { describe, expect, it, vi } from "vitest";
import { demoShortcutHandler, type DemoShortcutDeps } from "./demo-shortcut";
import { upsertTask, type Catalog } from "./demo-task/catalog";
import { buildDetectedTask, DEMO_TASK_ID } from "./demo-task/detected-task";

const NOW = new Date("2026-10-17T15:00:00Z");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function answeredCatalog(): Catalog {
  const answered = { ...buildDetectedTask(() => "", NOW.toISOString()), userCorrection: "answers", revision: 2 };
  return upsertTask(null, answered, NOW.toISOString());
}

function deps(overrides: Partial<DemoShortcutDeps["installer"]> = {}) {
  let saved: Catalog | null = null;
  const d: DemoShortcutDeps = {
    installer: {
      now: () => NOW,
      search: vi.fn(async () => json({ data: [] })),
      loadImage: vi.fn(async (image: string) => `data:image/webp;base64,${image}`),
      loadCatalog: vi.fn(async () => answeredCatalog()),
      saveCatalog: vi.fn(async (catalog: Catalog) => { saved = catalog; }),
      notify: vi.fn(async () => json({ success: true, message: "Notification sent successfully" })),
      ...overrides,
    },
    openTask: vi.fn(async () => {}),
    tell: vi.fn(),
  };
  return { d, saved: () => saved };
}

describe("demo shortcut ⌃⌥⌘D", () => {
  it("resets the detected task (answers cleared) and sends the notification, telling nothing", async () => {
    const { d, saved } = deps();
    await expect(demoShortcutHandler(d)()).resolves.toEqual({ notified: true });

    const task = saved()!.analysis.workflows.find(w => w.id === DEMO_TASK_ID)!;
    expect(task.userCorrection).toBeNull();
    expect(d.installer.notify).toHaveBeenCalledTimes(1);
    expect((d.installer.notify as ReturnType<typeof vi.fn>).mock.calls[0][0].title).toBe("Repetitive task detected");
    expect(d.tell).not.toHaveBeenCalled();
    expect(d.openTask).not.toHaveBeenCalled();
  });

  it("tells the presenter why the notification was not shown and opens the Task Page", async () => {
    const { d } = deps({ notify: vi.fn(async () => json({ success: true, message: "duplicate notification suppressed" })) });
    await expect(demoShortcutHandler(d)()).resolves.toEqual({ notified: false, reason: "duplicate notification suppressed" });

    expect(d.openTask).toHaveBeenCalledTimes(1);
    expect(d.tell).toHaveBeenCalledWith({
      title: "Notification not shown",
      description: "duplicate notification suppressed. The task opens directly.",
    });
  });

  it("tells the presenter when the notification server is unreachable", async () => {
    const { d } = deps({ notify: vi.fn(async () => { throw new Error("Screenpipe's notification server does not answer"); }) });
    await demoShortcutHandler(d)();

    expect(d.tell).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("Screenpipe's notification server does not answer"),
    }));
  });

  it("tells the presenter when the task cannot be installed, sending no notification", async () => {
    const { d } = deps({ loadCatalog: vi.fn(async () => { throw new Error("The saved workflow catalog is unreadable."); }) });
    await expect(demoShortcutHandler(d)()).resolves.toEqual({ notified: false, reason: "The saved workflow catalog is unreadable." });

    expect(d.installer.notify).not.toHaveBeenCalled();
    expect(d.openTask).not.toHaveBeenCalled();
    expect(d.tell).toHaveBeenCalledWith({
      title: "Demo not started",
      description: "The saved workflow catalog is unreadable.",
      destructive: true,
    });
  });

  it("deletes the previous demo Flow before the notification is sent", async () => {
    const order: string[] = [];
    const { d } = deps({ notify: vi.fn(async () => { order.push("notify"); return json({ success: true, message: "Notification sent successfully" }); }) });
    d.resetFlows = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20)); order.push("reset"); });
    await expect(demoShortcutHandler(d)()).resolves.toEqual({ notified: true });
    expect(order).toEqual(["reset", "notify"]);
    expect(d.tell).not.toHaveBeenCalled();
  });

  it("still notifies when the previous Flow cannot be deleted, and says why", async () => {
    const { d } = deps();
    d.resetFlows = vi.fn(async () => { throw new Error("n8n_unreachable: connection refused"); });
    await expect(demoShortcutHandler(d)()).resolves.toEqual({ notified: true });
    expect(d.installer.notify).toHaveBeenCalledTimes(1);
    expect(d.tell).toHaveBeenCalledWith(expect.objectContaining({
      title: "Previous demo Flow not deleted",
      description: expect.stringContaining("n8n_unreachable: connection refused"),
    }));
  });

  it("sends a notification the server never drops as a repeat, press after press", async () => {
    const bodies: string[] = [];
    let now = NOW.getTime();
    const { d } = deps({
      now: () => new Date(now),
      notify: vi.fn(async (payload: { title: string; body: string }) => {
        bodies.push(payload.body);
        return json({ success: true, message: "Notification sent successfully" });
      }),
    });
    const press = demoShortcutHandler(d);
    for (let i = 0; i < 5; i++) { await press(); now += 1_500; }
    // The notification server's repeat key is the title and the body.
    expect(new Set(bodies).size).toBe(5);
    for (const body of bodies) {
      expect(body.replace(/[\u200B\u200C]/g, "")).toBe("You turned 3 bug emails into NOVA Jira tickets. Answer 2 questions to automate it.");
    }
  });

  it("ignores a second press while the first one is still running", async () => {
    let release!: () => void;
    const loadCatalog = vi.fn(async () => null as Catalog | null)
      .mockImplementationOnce(() => new Promise<Catalog | null>(resolve => { release = () => resolve(null); }));
    const { d } = deps({ loadCatalog });
    const press = demoShortcutHandler(d);

    const first = press();
    await vi.waitFor(() => expect(loadCatalog).toHaveBeenCalledTimes(1));
    await expect(press()).resolves.toEqual({ ignored: true });
    release();
    await expect(first).resolves.toEqual({ notified: true });
    expect(d.installer.notify).toHaveBeenCalledTimes(1);
    // Once done, the shortcut works again.
    await expect(press()).resolves.toEqual({ notified: true });
  });
});
