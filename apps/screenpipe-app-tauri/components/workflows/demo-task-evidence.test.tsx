// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { serializeWorkflowData, WorkflowsApp } from "@screenpipe/workflows-ui";
import { createFixtureWorkflowsPlatform, fixtureWorkflowAnalysis } from "@screenpipe/workflows-ui/fixture";
import { localFetch } from "@/lib/api";
import { loadWorkflowScreenshot } from "@/lib/workflows/source-screenshot";
import { stageScreenshots } from "../../../../packages/workflows-ui/src/screenshots";
import { buildDetectedTask, CLARIFICATION_QUESTIONS, DEMO_TASK_ID } from "@/lib/automation-flows/demo-task/detected-task";
import { upsertTask } from "@/lib/automation-flows/demo-task/catalog";

vi.mock("@/lib/api", () => ({ localFetch: vi.fn() }));

const stage = fixtureWorkflowAnalysis.analysis.workflows[0].stages[0];
const at = "2026-10-17T02:05:41Z";
const evidence = (name: string) => `data:image/webp;base64,${readFileSync(join(__dirname, "../../public/automation-flows/demo-evidence", `${name}.webp`)).toString("base64")}`;
const shownTime = (timestamp: string) => new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Walks a step's capture carousel once, collecting what each capture shows. */
const walkCaptures = (step: HTMLElement, name: string, count: number, read: () => string | null | undefined) => Array.from({ length: count }, (_, index) => {
  if (index) fireEvent.click(within(step).getByRole("button", { name: `Next capture for ${name}` }));
  expect(within(step).getByText(`${index + 1} / ${count}`)).toBeVisible();
  return read();
});

describe("embedded evidence (scripted Detected Task)", () => {
  it("survives saving and is still shown as step evidence, while recorder frames drop copied pixels", () => {
    const embedded = { frameId: -1, timestamp: at, app: "Gmail", visualVerified: true, matchDistanceSeconds: 0, dataUrl: "data:image/webp;base64,AAAA" };
    const recorder = { ...embedded, frameId: 42, app: "Jira", dataUrl: "data:image/png;base64,BBBB" };
    const saved = JSON.parse(serializeWorkflowData({ stage: { ...stage, screenshot: null, screenshots: [embedded, recorder] } })).stage;
    expect(stageScreenshots(saved).map(image => [image.frameId, image.dataUrl])).toEqual([[-1, embedded.dataUrl], [42, ""]]);
  });

  it("opens from the notification's review request on three repetitions with their images and times, and both questions", async () => {
    window.history.replaceState(null, "", "/home?mode=workflows");
    const task = buildDetectedTask(evidence, at);
    const saved = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
    await act(async () => {
      render(<WorkflowsApp platform={createFixtureWorkflowsPlatform(saved)} storageKey={null} reviewRequest={{ key: "demo", workflowId: DEMO_TASK_ID }} />);
    });
    for (const [index, ticket] of ["NOVA-25 (Bug)", "NOVA-26 (Bug)", "NOVA-27 (Task)"].entries()) {
      expect((await screen.findByRole<HTMLInputElement>("textbox", { name: `Step ${index + 1} title` })).value).toContain(ticket);
      const step = screen.getByRole("article", { name: `Step ${index + 1}` });
      const shown = walkCaptures(step, task.stages[index].name, 3, () => {
        const images = within(step).getAllByRole("img", { name: /^Captured reference/ });
        expect(images).toHaveLength(1);
        return `${images[0].getAttribute("src")?.slice(0, 23)} ${within(step).getByText(/^(Gmail|Jira) · /).textContent}`;
      });
      expect(shown).toEqual(task.stages[index].screenshots!.map(capture => `data:image/webp;base64, ${capture.app} · ${shownTime(capture.timestamp)}`));
    }
    for (const question of CLARIFICATION_QUESTIONS) expect(screen.getByRole("textbox", { name: question })).toBeVisible();
  });

  it("labels the scripted task as demo in the Task Page header", async () => {
    window.history.replaceState(null, "", "/home?mode=workflows");
    const task = buildDetectedTask(evidence, at);
    const saved = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
    await act(async () => {
      render(<WorkflowsApp platform={createFixtureWorkflowsPlatform(saved)} storageKey={null} reviewRequest={{ key: "demo", workflowId: DEMO_TASK_ID }} />);
    });
    const badge = await screen.findByTestId("demo-badge");
    expect(badge).toBeVisible();
    expect(badge).toHaveTextContent(/demo/i);
  });
});

describe("recorded evidence (captures found on this machine)", () => {
  it("loads a found capture live from its recorder frame next to the embedded fallbacks, and opens it in the timeline", async () => {
    window.history.replaceState(null, "", "/home?mode=workflows");
    const live = { frameId: 4242, timestamp: "2026-10-17T02:07:12.733417Z" };
    const task = buildDetectedTask(evidence, at, { "r1-form": live });
    // The catalog as the app saves it, loaded by the app's own frame adapter.
    const saved = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
    vi.mocked(localFetch).mockImplementation(async (path: string) =>
      path === "/frames/4242/metadata" ? Response.json({ frame_id: 4242, timestamp: live.timestamp })
        : path === "/frames/4242?fallback=false" ? new Response("jpeg bytes", { headers: { "content-type": "image/jpeg" } })
          : new Response(null, { status: 404 }));
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:frame-4242"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const openCapturedMoment = vi.fn().mockResolvedValue(undefined);
    const platform = { ...createFixtureWorkflowsPlatform(saved), loadWorkflowScreenshot, openCapturedMoment };
    await act(async () => {
      render(<WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key: "demo-recorded", workflowId: DEMO_TASK_ID }} />);
    });
    const step = await screen.findByRole("article", { name: "Step 1" });
    const name = task.stages[0].name;
    const image = () => within(step).getByRole("img", { name: /^Captured reference/ }).getAttribute("src")?.slice(0, 23);
    expect(image()).toBe("data:image/webp;base64,");
    // "View in timeline" exists only for the recorder frame, and opens that exact moment.
    expect(within(step).queryByRole("button", { name: /^Open recording/ })).toBeNull();
    fireEvent.click(within(step).getByRole("button", { name: `Next capture for ${name}` }));
    await waitFor(() => expect(image()).toBe("blob:frame-4242"));
    expect(within(step).getByText(`Jira · ${shownTime(live.timestamp)}`)).toBeVisible();
    fireEvent.click(within(step).getByRole("button", { name: `Next capture for ${name}` }));
    expect(image()).toBe("data:image/webp;base64,");
    expect(within(step).queryByRole("button", { name: /^Open recording/ })).toBeNull();
    fireEvent.click(within(step).getByRole("button", { name: `Previous capture for ${name}` }));
    fireEvent.click(await within(step).findByRole("button", { name: `Open recording 2 for ${name}` }));
    await waitFor(() => expect(openCapturedMoment).toHaveBeenCalledWith(4242, live.timestamp));
  });

  it("says View in timeline in words on the Task Page that creates a Flow", async () => {
    window.history.replaceState(null, "", "/home?mode=workflows");
    const live = { frameId: 4242, timestamp: "2026-10-17T02:07:12.733417Z" };
    const task = buildDetectedTask(evidence, at, { "r1-form": live });
    const saved = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
    vi.mocked(localFetch).mockImplementation(async (path: string) =>
      path === "/frames/4242/metadata" ? Response.json({ frame_id: 4242, timestamp: live.timestamp })
        : path === "/frames/4242?fallback=false" ? new Response("jpeg bytes", { headers: { "content-type": "image/jpeg" } })
          : new Response(null, { status: 404 }));
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:frame-4242"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const openCapturedMoment = vi.fn().mockResolvedValue(undefined);
    const platform = {
      ...createFixtureWorkflowsPlatform(saved), loadWorkflowScreenshot, openCapturedMoment,
      createAutomationFlow: vi.fn(async () => {}), canCreateAutomationFlow: (id: string) => id === DEMO_TASK_ID,
    };
    await act(async () => {
      render(<WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key: "demo-create", workflowId: DEMO_TASK_ID }} />);
    });
    const step = await screen.findByRole("article", { name: "Step 1" });
    fireEvent.click(within(step).getByRole("button", { name: `Next capture for ${task.stages[0].name}` }));
    const open = await within(step).findByRole("button", { name: /^View in timeline/ });
    // The words are on screen, not only in the accessible name.
    expect(open).toHaveTextContent("View in timeline");
    expect(within(step).getAllByRole("button", { name: /^View in timeline/ })).toHaveLength(1);
    expect(within(step).queryByRole("button", { name: /^Open recording/ })).toBeNull();
    fireEvent.click(open);
    await waitFor(() => expect(openCapturedMoment).toHaveBeenCalledWith(4242, live.timestamp));
  });
});
