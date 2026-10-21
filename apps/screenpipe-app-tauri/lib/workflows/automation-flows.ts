// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Desktop side of the Task Page's "Create automation": the Flow service
// creates the Flow from the Detected Task (idempotent per task), then the
// app opens its Review Screen in Automations → Flows. Also opens that Review
// Screen from the chat's `screenpipe://flows/<id>` link.

import { emit } from "@tauri-apps/api/event";
import type { WorkflowsPlatform } from "@screenpipe/workflows-ui";
import { commands } from "@/lib/utils/tauri";
import { flowsApi, FlowsApiError, type FlowsErrorCode } from "@/components/automation-flows/api";

// Shown on the Task Page, under the action; the answers stay on screen.
const CREATION_FAILED = "Could not create the automation. Your answers are kept. Try again.";
const CREATION_ERROR: Record<FlowsErrorCode, string> = {
  n8n_not_configured: "n8n is not set up. Enter the n8n API URL and an API key in Connections → n8n, then try again.",
  n8n_unauthorized: "n8n refused the API key. Check the API key in Connections → n8n, then try again.",
  n8n_unreachable: "Could not reach n8n. Check that it is running, then try again.",
  n8n_failed: "n8n ran into an error. Try again in a moment.",
  // A copy of the Flow left on in n8n is still processing an email.
  flow_running: "n8n is still processing an email with this Flow. Try again in a moment.",
  not_found: "This task cannot become an automation yet.",
  // Activation, Dismiss and retry codes; creation never returns them.
  flow_active: CREATION_FAILED,
  version_changed: CREATION_FAILED,
  activation_failed: CREATION_FAILED,
  activation_requires_user: CREATION_FAILED,
  retry_requires_user: CREATION_FAILED,
  run_not_failed: CREATION_FAILED,
  retry_still_running: CREATION_FAILED,
  unknown: CREATION_FAILED,
};

// The Detected Tasks the Flow service can create a Flow from: the engine's
// bundled DEMO_TASKS (crates/screenpipe-engine/src/automation_flows.rs; a test
// fails when the two drift apart). Every other task keeps the ordinary Task Page.
const CREATABLE_TASK_IDS = new Set(["wf-novadesk-support-tickets"]);

export const canCreateAutomationFlow: NonNullable<WorkflowsPlatform["canCreateAutomationFlow"]> = taskId =>
  CREATABLE_TASK_IDS.has(taskId);

export const createAutomationFlow: NonNullable<WorkflowsPlatform["createAutomationFlow"]> = async (taskId, answers) => {
  let flowId: string;
  try {
    flowId = (await flowsApi.createFromTask(taskId, answers)).id;
  } catch (error) {
    throw new Error(CREATION_ERROR[error instanceof FlowsApiError ? error.code : "unknown"], { cause: error });
  }
  rememberFlow(taskId, flowId);
  await openFlowReview(flowId);
};

/** Which Flow was created from a Detected Task, kept on this device. */
export const flowOfTaskKey = (taskId: string) => `screenpipe:automation-flow-of-task:${taskId}`;

function rememberFlow(taskId: string, flowId: string | null) {
  try {
    if (flowId) window.localStorage.setItem(flowOfTaskKey(taskId), flowId);
    else window.localStorage.removeItem(flowOfTaskKey(taskId));
  } catch {
    // Storage off: the Task Page offers creation again, which reopens the same Flow.
  }
}

/**
 * The Flow created from this task, when it still exists (a demo reset deletes
 * it): the Task Page then opens it instead of creating it.
 */
export const findAutomationFlow: NonNullable<WorkflowsPlatform["findAutomationFlow"]> = async taskId => {
  let flowId: string | null = null;
  try {
    flowId = window.localStorage.getItem(flowOfTaskKey(taskId));
  } catch {
    return null;
  }
  if (!flowId) return null;
  try {
    await flowsApi.get(flowId);
    return flowId;
  } catch (error) {
    if (error instanceof FlowsApiError && error.code === "not_found") {
      rememberFlow(taskId, null);
      return null;
    }
    // n8n unreachable or the like: the Flow is most likely still there.
    return flowId;
  }
};

export const openAutomationFlow: NonNullable<WorkflowsPlatform["openAutomationFlow"]> = flowId => openFlowReview(flowId);

/**
 * The Review Screen link the `automation-flows` chat skill ends with
 * (`screenpipe://flows/<id>`).
 */
export function flowReviewLink(flowId: string): string {
  return `screenpipe://flows/${encodeURIComponent(flowId)}`;
}

/** The Flow a `screenpipe://flows/<id>` link (chat, failure notification) points at. */
export function flowIdFromReviewLink(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "screenpipe:" || url.host !== "flows") return null;
    return decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "") || null;
  } catch {
    return null;
  }
}

/** The Home page (`showWindowActivated`) of a Flow's Review Screen. */
export function flowReviewPage(flowId: string): string {
  return `pipes&tab=flows&flow=${encodeURIComponent(flowId)}`;
}

/**
 * Opens the Review Screen a chat link points at; false when `href` is not a
 * Flow link. The Review Screen lives in the Home window: from another window
 * (the Chat overlay), Home is brought up on it instead.
 */
export async function openFlowReviewLink(href: string): Promise<boolean> {
  const flowId = flowIdFromReviewLink(href);
  if (!flowId) return false;
  if (window.location.pathname === "/home") {
    await openFlowReview(flowId);
  } else {
    await commands.showWindowActivated({ Home: { page: flowReviewPage(flowId) } });
  }
  return true;
}

/** How long the Task Page keeps its progress while waiting for the Review Screen. */
export const REVIEW_SCREEN_WAIT_MS = 10_000;

/**
 * Resolves once the Review Screen of `flowId` is on screen (loading or
 * loaded), or after `timeoutMs`. Home hides the views it keeps mounted with
 * the `hidden` class, so a Review Screen inside one is not shown yet.
 */
export function reviewScreenShown(flowId: string, timeoutMs = REVIEW_SCREEN_WAIT_MS): Promise<void> {
  const visible = () => Array.from(document.querySelectorAll<HTMLElement>("[data-flow-review]")).some(
    (element) => element.dataset.flowReview === flowId && !element.closest(".hidden, [hidden]"),
  );
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (visible() || Date.now() - started >= timeoutMs) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Opens the Review Screen and resolves once it is on screen, so the Task Page
 * keeps its progress until then. Home's `navigate` listener does the switch
 * (`followFlowsNavigation`), once: switching here too opened the Flow twice.
 */
async function openFlowReview(flowId: string): Promise<void> {
  const url = `/home?section=${flowReviewPage(flowId)}`;
  window.history.replaceState(window.history.state, "", url);
  await emit("navigate", { url });
  await reviewScreenShown(flowId);
}

/**
 * Home's `navigate` listener: a navigation to the Flows tab (Home brought up
 * from another window, e.g. a failure notification) opens it on its Flow.
 * False for any other navigation. Never emits, so it cannot loop.
 */
export function followFlowsNavigation(url: URL): boolean {
  const params = url.searchParams;
  if (params.get("section") !== "pipes" || params.get("tab") !== "flows") return false;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`);
  showFlowsTab(params.get("flow"));
  return true;
}

// The Automations view reads ?tab=flows&flow= when it mounts; one that is
// already mounted (kept hidden behind Workflows) follows `switch-pipes-tab`.
function showFlowsTab(flowId: string | null): void {
  window.dispatchEvent(new CustomEvent("switch-pipes-tab", { detail: { tab: "flows", flow: flowId ?? undefined } }));
}
