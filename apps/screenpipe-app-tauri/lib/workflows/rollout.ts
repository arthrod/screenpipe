// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { useFeatureFlagEnabled } from "posthog-js/react";
import posthog from "posthog-js";
import { localFetch } from "@/lib/api";

export const WORKFLOWS_FLAG = "workflows";
/**
 * A local build opens Workflows without the PostHog flag when built with
 * NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT=1 (hackathon demo machine). It only
 * shows the view; background AI tasks still need their explicit opt-in.
 */
export function isWorkflowsRolloutForcedLocally(): boolean {
  return process.env.NEXT_PUBLIC_SCREENPIPE_WORKFLOWS_ROLLOUT === "1";
}
export function isWorkflowsRolloutEnabled(flag: unknown): boolean {
  return flag === true || isWorkflowsRolloutForcedLocally();
}
export function useWorkflowsRolloutEnabled(): boolean {
  const flag = useFeatureFlagEnabled(WORKFLOWS_FLAG);
  return process.env.NEXT_PUBLIC_SCREENPIPE_WEB_DEV === "mock" || isWorkflowsRolloutEnabled(flag);
}
export function requireWorkflowsRollout(): void {
  if (!isWorkflowsRolloutEnabled(posthog.isFeatureEnabled?.(WORKFLOWS_FLAG))) {
    throw new Error("Workflows is not available for this account yet.");
  }
}

/** The engine starts closed; await this before dispatching a user-requested run. */
export async function syncWorkflowsRollout(enabled: boolean, signal?: AbortSignal): Promise<void> {
  const response = await localFetch("/workflows/rollout", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }), signal,
  });
  if (!response.ok) throw new Error("Could not confirm Workflows access. Try again.");
}
