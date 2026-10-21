// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { describe, expect, it, vi } from "vitest";
import type { WorkflowMap } from "@screenpipe/workflows-ui";
import { findAutomation, type FindAutomationDeps } from "./find-automation";
import { upsertTask, type Catalog } from "./demo-task/catalog";
import { buildDetectedTask, DEMO_TASK_ID, DEMO_TASK_URL, EVIDENCE_CAPTURES } from "./demo-task/detected-task";

const NOW = new Date("2026-10-17T15:00:00Z");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** A local search API that records every capture of the demo at its key-frame time. */
const recordedEverything = async (url: string) => {
  const params = new URL(url, "http://local").searchParams;
  const capture = EVIDENCE_CAPTURES.find(c => new Date(c.at).toISOString() === params.get("start_time")
    || new Date(c.at).toISOString() === params.get("end_time"))!;
  const id = 1000 + EVIDENCE_CAPTURES.indexOf(capture);
  const where = capture.app === "Gmail" ? "Gmail - mail.google.com" : "Jira - atlassian.net";
  return json({ data: [{ type: "OCR", content: { frame_id: id, timestamp: capture.at, app_name: "Safari", window_name: where } }] });
};

function deps(overrides: Partial<FindAutomationDeps> = {}) {
  let saved: Catalog | null = null;
  const all = {
    now: () => NOW,
    search: vi.fn(async () => json({ data: [] })),
    loadImage: vi.fn(async (image: string) => `data:image/webp;base64,${image}`),
    loadCatalog: vi.fn(async () => null as Catalog | null),
    saveCatalog: vi.fn(async (catalog: Catalog) => { saved = catalog; }),
    notify: vi.fn(async () => json({ success: true, message: "Notification sent successfully" })),
    ...overrides,
  };
  return { deps: all, saved: () => saved };
}

describe("findAutomation (scripted demo detection)", () => {
  it("installs the demo task, then sends the notification that opens its Task Page", async () => {
    const { deps: d, saved } = deps();
    await expect(findAutomation(d)).resolves.toEqual({ notified: true });

    const workflows = saved()!.analysis.workflows;
    expect(workflows.map(w => w.id)).toEqual([DEMO_TASK_ID]);
    expect(workflows[0].userCorrection).toBeNull();
    const payload = d.notify.mock.calls[0][0];
    expect(payload.title).toBe("Repetitive task detected");
    expect(payload.actions).toEqual([{ type: "deeplink", label: "View task", url: DEMO_TASK_URL, primary: true }]);
    expect(payload.id).toBe(`automation-flows-demo:${DEMO_TASK_ID}:${NOW.getTime()}`);
  });

  it("uses this machine's recorder frames and loads no embedded image when every capture is recorded", async () => {
    const { deps: d, saved } = deps({ search: vi.fn(recordedEverything) });
    await findAutomation(d);

    expect(d.loadImage).not.toHaveBeenCalled();
    const shots = saved()!.analysis.workflows[0].stages.flatMap(stage => stage.screenshots ?? []);
    expect(shots).toHaveLength(9);
    expect(shots.every(shot => shot.frameId >= 1000 && shot.dataUrl === "")).toBe(true);
  });

  it("falls back to the embedded key frames when the recordings do not hold the captures", async () => {
    const { deps: d, saved } = deps();
    await findAutomation(d);

    expect(d.loadImage).toHaveBeenCalledTimes(9);
    const shots = saved()!.analysis.workflows[0].stages.flatMap(stage => stage.screenshots ?? []);
    expect(shots.every(shot => shot.frameId < 0 && shot.dataUrl.startsWith("data:image/webp;base64,"))).toBe(true);
  });

  it("reinstalls the task without answers and keeps the other detected tasks", async () => {
    const other = { ...buildDetectedTask(() => "", NOW.toISOString()), id: "wf-other", title: "Other" };
    const answered = { ...buildDetectedTask(() => "", NOW.toISOString()), userCorrection: "answers", revision: 4 };
    const previous = upsertTask(upsertTask(null, other, NOW.toISOString()), answered, NOW.toISOString());
    const { deps: d, saved } = deps({ loadCatalog: vi.fn(async () => previous) });
    await findAutomation(d);

    const workflows = saved()!.analysis.workflows;
    expect(workflows.map(w => w.id)).toEqual(["wf-other", DEMO_TASK_ID]);
    const reinstalled = workflows.find(w => w.id === DEMO_TASK_ID)!;
    expect(reinstalled.userCorrection).toBeNull();
    expect(reinstalled.revision).toBe(5);
  });

  it("installs the task marked as demo, ranked after the user's real detections", async () => {
    // A genuine detection: no scripted-provenance marker.
    const real: WorkflowMap = { ...buildDetectedTask(() => "", NOW.toISOString()), id: "wf-real", title: "Real detection" };
    delete real.demo;
    const previous = upsertTask(null, real, NOW.toISOString());
    const { deps: d, saved } = deps({ loadCatalog: vi.fn(async () => previous) });
    await findAutomation(d);

    const workflows = saved()!.analysis.workflows;
    expect(workflows.find(w => w.id === DEMO_TASK_ID)?.demo).toBe(true);
    expect(workflows.find(w => w.id === "wf-real")?.demo).toBeUndefined();
    // Segregated: the scripted task never takes rank 1 from a real detection.
    expect(workflows.map(w => [w.id, w.rank])).toEqual([["wf-real", 1], [DEMO_TASK_ID, 2]]);
  });

  it("reports the reason when the notification gate does not show the alert", async () => {
    const { deps: d } = deps({ notify: vi.fn(async () => json({ success: true, message: "duplicate notification suppressed" })) });
    await expect(findAutomation(d)).resolves.toEqual({ notified: false, reason: "duplicate notification suppressed" });
    expect(d.saveCatalog).toHaveBeenCalledTimes(1);
  });

  it("reads the machine-readable delivery outcome, whatever the copy says", async () => {
    // The server names what it did with the alert in `outcome`; the English
    // `message` copy is only the fallback for older servers.
    const paused = deps({ notify: vi.fn(async () => json({ success: true, message: "repos", outcome: "paused" })) });
    await expect(findAutomation(paused.deps)).resolves.toEqual({ notified: false, reason: "repos" });

    const shown = deps({ notify: vi.fn(async () => json({ success: true, message: "envoyé", outcome: "shown" })) });
    await expect(findAutomation(shown.deps)).resolves.toEqual({ notified: true });

    const duplicate = deps({ notify: vi.fn(async () => json({ success: true, message: "déjà affiché", outcome: "duplicate" })) });
    await expect(findAutomation(duplicate.deps)).resolves.toEqual({ notified: false, reason: "déjà affiché" });
  });

  it("reports why the notification server could not be asked", async () => {
    const { deps: d } = deps({ notify: vi.fn(async () => { throw new Error("the server does not answer"); }) });
    await expect(findAutomation(d)).resolves.toEqual({ notified: false, reason: "the server does not answer" });
  });

  it("never overwrites an unreadable catalog and sends no notification", async () => {
    const { deps: d } = deps({ loadCatalog: vi.fn(async () => { throw new Error("The saved workflow catalog is unreadable."); }) });
    await expect(findAutomation(d)).rejects.toThrow("unreadable");
    expect(d.saveCatalog).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });
});
