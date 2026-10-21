// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/utils/tauri", () => ({ commands: {} }));

import { FlowsApiError, type Flow } from "@/components/automation-flows/api";
import { flowOfTaskKey } from "@/lib/workflows/automation-flows";
import { DEMO_TASK_ID } from "./demo-task/detected-task";
import { resetDemoFlows, type ResetFlowsApi } from "./reset-demo-flows";

const flow = (id: string, sourceTaskId: string | null) => ({ id, sourceTaskId }) as Flow;

function api(flows: Flow[]): ResetFlowsApi & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    list: vi.fn(async () => flows.map(({ id }) => ({ id, name: id, status: "draft" as const, lastExecution: null }))),
    get: vi.fn(async (id: string) => {
      const found = flows.find(f => f.id === id);
      if (!found) throw new FlowsApiError("not_found", "flow_not_found");
      return found;
    }),
    delete: vi.fn(async (id: string) => { deleted.push(id); }),
  };
}

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

describe("⌃⌥⌘D Flow reset", () => {
  it("deletes only the Flows created from the demo task, and forgets them", async () => {
    window.localStorage.setItem(flowOfTaskKey(DEMO_TASK_ID), "demo-1");
    window.sessionStorage.setItem(`screenpipe:workflow-answers:${DEMO_TASK_ID}`, "{\"q\":\"draft\"}");
    const flows = api([flow("demo-1", DEMO_TASK_ID), flow("chat-1", null), flow("demo-2", DEMO_TASK_ID)]);

    await expect(resetDemoFlows(flows)).resolves.toEqual(["demo-1", "demo-2"]);

    expect(flows.deleted).toEqual(["demo-1", "demo-2"]);
    expect(window.localStorage.getItem(flowOfTaskKey(DEMO_TASK_ID))).toBeNull();
    expect(window.sessionStorage.getItem(`screenpipe:workflow-answers:${DEMO_TASK_ID}`)).toBeNull();
  });

  it("does nothing when no demo Flow is left, even with a stale remembered id", async () => {
    window.localStorage.setItem(flowOfTaskKey(DEMO_TASK_ID), "gone");
    const flows = api([flow("chat-1", null)]);
    await expect(resetDemoFlows(flows)).resolves.toEqual([]);
    expect(flows.deleted).toEqual([]);
  });

  it("rejects with the engine's reason when a demo Flow cannot be deleted", async () => {
    const flows = api([flow("demo-1", DEMO_TASK_ID)]);
    flows.delete = vi.fn(async () => { throw new FlowsApiError("flow_running", "n8n is processing an email"); });
    await expect(resetDemoFlows(flows)).rejects.toThrow("flow_running");
  });
});
