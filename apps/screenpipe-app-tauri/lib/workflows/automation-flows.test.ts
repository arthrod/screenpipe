// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localFetch: vi.fn(),
  emit: vi.fn(async (_event: string, _payload?: unknown) => {}),
  showWindowActivated: vi.fn(async (_window: unknown) => ({ status: "ok" as const, data: null })),
}));
vi.mock("@/lib/api", () => ({ localFetch: mocks.localFetch }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/utils/tauri", () => ({ commands: { showWindowActivated: mocks.showWindowActivated } }));

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canCreateAutomationFlow,
  createAutomationFlow,
  findAutomationFlow,
  flowReviewLink,
  followFlowsNavigation,
  openAutomationFlow,
  openFlowReviewLink,
  reviewScreenShown,
} from "./automation-flows";
import { DEMO_TASK_ID, fixtureFlow } from "@/components/automation-flows/fixtures";
import { mockAutomationFlowsResponse } from "@/components/automation-flows/mock";

const answers = [{ question: "Should ideas become tickets?", answer: "Yes, as a Task." }];
const reviewUrl = `/home?section=pipes&tab=flows&flow=${fixtureFlow.id}`;

// Home's `navigate` listener, as far as these tests need it: the Review
// Screen of the Flow in the URL appears a moment later.
function homeShowsReviewScreen(_event: string, payload?: unknown) {
  const flow = new URL((payload as { url: string }).url, "http://localhost").searchParams.get("flow");
  if (flow) setTimeout(() => {
    const screen = document.createElement("div");
    screen.dataset.flowReview = flow;
    document.body.append(screen);
  }, 30);
  return Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  mocks.emit.mockImplementation(homeShowsReviewScreen);
  window.history.replaceState({}, "", `/home?mode=workflows&workflow=${DEMO_TASK_ID}`);
  // The Flow service as the browser mock (`bun run dev:web`) answers it.
  mocks.localFetch.mockImplementation(async (path: string, init?: RequestInit) =>
    mockAutomationFlowsResponse(new URL(path, "http://localhost:3030"), init)!);
});

describe("desktop createAutomationFlow", () => {
  it("creates the Flow from the task through the Flow service, then opens its Review Screen", async () => {
    await createAutomationFlow(DEMO_TASK_ID, answers);

    expect(mocks.localFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.localFetch.mock.calls[0];
    expect(path).toBe("/automation-flows/from-task");
    expect(JSON.parse(init.body)).toEqual({ taskId: DEMO_TASK_ID, answers });
    expect(`${window.location.pathname}${window.location.search}`).toBe(reviewUrl);
    expect(mocks.emit).toHaveBeenCalledWith("navigate", { url: reviewUrl });
  });

  it("leaves the switch to Home's navigate listener, so the Flow opens once", async () => {
    const switched = vi.fn();
    window.addEventListener("switch-pipes-tab", switched);
    try {
      await createAutomationFlow(DEMO_TASK_ID, answers);
    } finally {
      window.removeEventListener("switch-pipes-tab", switched);
    }
    expect(switched).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it("resolves only once the Review Screen is on screen, not while Home keeps it hidden", async () => {
    mocks.emit.mockImplementation(async () => {});
    const hidden = document.createElement("div");
    hidden.className = "hidden";
    const screen = document.createElement("div");
    screen.dataset.flowReview = fixtureFlow.id;
    hidden.append(screen);
    document.body.append(hidden);
    let done = false;
    const creation = createAutomationFlow(DEMO_TASK_ID, answers).then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(done).toBe(false);
    hidden.className = "";
    await creation;
    expect(done).toBe(true);
  });

  it("gives up waiting for the Review Screen after a while", async () => {
    mocks.emit.mockImplementation(async () => {});
    const started = Date.now();
    await reviewScreenShown("never-shown", 120);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("opens the same Flow when the action is clicked again", async () => {
    await createAutomationFlow(DEMO_TASK_ID, answers);
    await createAutomationFlow(DEMO_TASK_ID, answers);
    expect(mocks.emit.mock.calls).toEqual([["navigate", { url: reviewUrl }], ["navigate", { url: reviewUrl }]]);
  });

  it.each([
    ["not-configured", /n8n is not set up.*Connections/],
    ["unauthorized", /n8n refused the API key.*Connections → n8n/],
    ["unreachable", /Could not reach n8n/],
  ])("explains a %s Flow service and stays on the Task Page", async (state, message) => {
    window.history.replaceState({}, "", `/home?mode=workflows&flowsState=${state}`);
    await expect(createAutomationFlow(DEMO_TASK_ID, answers)).rejects.toThrow(message);
    expect(window.location.search).toBe(`?mode=workflows&flowsState=${state}`);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("explains a task that cannot become a Flow yet", async () => {
    await expect(createAutomationFlow("wf-other-task", answers)).rejects.toThrow("This task cannot become an automation yet.");
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe("the Flow created from a task", () => {
  beforeEach(() => window.localStorage.clear());

  it("is unknown before creation, then found after it", async () => {
    expect(await findAutomationFlow(DEMO_TASK_ID)).toBeNull();
    await createAutomationFlow(DEMO_TASK_ID, answers);
    expect(await findAutomationFlow(DEMO_TASK_ID)).toBe(fixtureFlow.id);
    expect(await findAutomationFlow("wf-other-task")).toBeNull();
  });

  it("is forgotten once the Flow no longer exists (a demo reset deletes it)", async () => {
    await createAutomationFlow(DEMO_TASK_ID, answers);
    mocks.localFetch.mockImplementation(async () => Response.json({ error: "flow_not_found" }, { status: 404 }));
    expect(await findAutomationFlow(DEMO_TASK_ID)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("opens its Review Screen in Automations → Flows", async () => {
    await openAutomationFlow(fixtureFlow.id);
    expect(mocks.emit).toHaveBeenCalledWith("navigate", { url: reviewUrl });
  });
});

describe("desktop canCreateAutomationFlow", () => {
  it("offers creation only for the tasks the Flow service can create", () => {
    expect(canCreateAutomationFlow(DEMO_TASK_ID)).toBe(true);
    expect(canCreateAutomationFlow("wf-other-task")).toBe(false);
  });

  it("matches the Detected Tasks the engine's Flow service bundles", () => {
    // `create_from_task` answers 404 for any task missing from DEMO_TASKS.
    const engine = readFileSync(path.resolve(__dirname, "../../../../crates/screenpipe-engine/src/automation_flows.rs"), "utf8");
    const start = engine.indexOf("const DEMO_TASKS");
    const ids = [...engine.slice(start, engine.indexOf("];", start)).matchAll(/\bid:\s*"([^"]+)"/g)].map(match => match[1]);
    expect(ids).toEqual([DEMO_TASK_ID]);
    for (const id of ids) expect(canCreateAutomationFlow(id)).toBe(true);
  });
});

describe("Review Screen link from the chat", () => {
  const link = flowReviewLink(fixtureFlow.id);

  it("opens the Flow's Review Screen from the Home chat", async () => {
    window.history.replaceState({}, "", "/home?section=home");

    expect(await openFlowReviewLink(link)).toBe(true);

    expect(link).toBe(`screenpipe://flows/${fixtureFlow.id}`);
    expect(`${window.location.pathname}${window.location.search}`).toBe(reviewUrl);
    expect(mocks.emit).toHaveBeenCalledWith("navigate", { url: reviewUrl });
    expect(mocks.localFetch).not.toHaveBeenCalled();
  });

  it("brings Home to the Review Screen from another chat window", async () => {
    window.history.replaceState({}, "", "/chat");

    expect(await openFlowReviewLink(link)).toBe(true);

    expect(window.location.pathname).toBe("/chat");
    expect(mocks.showWindowActivated).toHaveBeenCalledWith({
      Home: { page: `pipes&tab=flows&flow=${fixtureFlow.id}` },
    });
  });

  it.each(["screenpipe://flows/", "screenpipe://frame/12", "https://example.com/flows/x"])(
    "leaves %s to other handlers",
    async (href) => {
      expect(await openFlowReviewLink(href)).toBe(false);
      expect(mocks.emit).not.toHaveBeenCalled();
      expect(mocks.showWindowActivated).not.toHaveBeenCalled();
    },
  );
});

describe("Home brought up on a Review Screen from another window", () => {
  // A failure notification or the Chat overlay asks the native side to show
  // Home on `pipes&tab=flows&flow=<id>`; Home then receives `navigate`.
  it("switches the Automations view to the Flow named in the navigation", () => {
    window.history.replaceState({}, "", "/home?section=timeline");
    const switched = vi.fn();
    const listen = (event: Event) => switched((event as CustomEvent).detail);
    window.addEventListener("switch-pipes-tab", listen);
    try {
      expect(followFlowsNavigation(new URL(`http://localhost${reviewUrl}`))).toBe(true);
    } finally {
      window.removeEventListener("switch-pipes-tab", listen);
    }
    // A view that mounts now reads the address; one already mounted follows the event.
    expect(`${window.location.pathname}${window.location.search}`).toBe(reviewUrl);
    expect(switched).toHaveBeenCalledWith({ tab: "flows", flow: fixtureFlow.id });
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("leaves every other navigation alone", () => {
    window.history.replaceState({}, "", "/home?section=timeline");
    expect(followFlowsNavigation(new URL("http://localhost/home?section=pipes"))).toBe(false);
    expect(followFlowsNavigation(new URL("http://localhost/home?section=meetings&tab=flows"))).toBe(false);
    expect(window.location.search).toBe("?section=timeline");
  });
});
