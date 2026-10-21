// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// The Flow half of the ⌃⌥⌘D reset (`demo-shortcut.ts`): every Flow created
// from the demo task is deleted through the engine's DELETE
// /automation-flows/:id (switched off first, then removed from n8n for good),
// like `infra/automation-flows/demo/reset.ts`. Other Flows are never touched.
import type { FlowsApi } from "@/components/automation-flows/api";
import { FlowsApiError } from "@/components/automation-flows/api";
import { flowOfTaskKey } from "@/lib/workflows/automation-flows";
import { DEMO_TASK_ID } from "./demo-task/detected-task";

/** workflows-ui `draftKey`: the Task Page's unsaved answers, per window session. */
const DRAFT_KEY = `screenpipe:workflow-answers:${DEMO_TASK_ID}`;

export type ResetFlowsApi = Pick<FlowsApi, "list" | "get" | "delete">;

/** Resolves with the deleted Flow ids; rejects with the first reason one is left. */
export async function resetDemoFlows(api: ResetFlowsApi, storage: Pick<Storage, "getItem" | "removeItem"> | null = safeStorage("localStorage")): Promise<string[]> {
  safeStorage("sessionStorage")?.removeItem(DRAFT_KEY);
  const remembered = storage?.getItem(flowOfTaskKey(DEMO_TASK_ID)) ?? null;
  const listed = (await api.list()).map(flow => flow.id);
  const candidates = [...new Set([...listed, ...(remembered ? [remembered] : [])])];
  const flows = await Promise.all(candidates.map(id => api.get(id).catch(error => {
    if (error instanceof FlowsApiError && error.code === "not_found") return null;
    throw error;
  })));
  const demo = flows.flatMap(flow => flow && flow.sourceTaskId === DEMO_TASK_ID ? [flow.id] : []);
  for (const id of demo) {
    try {
      await api.delete(id);
    } catch (error) {
      if (!(error instanceof FlowsApiError && error.code === "not_found")) throw error;
    }
  }
  storage?.removeItem(flowOfTaskKey(DEMO_TASK_ID));
  return demo;
}

function safeStorage(name: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[name];
  } catch {
    return null;
  }
}
