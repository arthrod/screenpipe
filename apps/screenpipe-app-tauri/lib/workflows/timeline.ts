// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import { commands } from "@/lib/utils/tauri";

/**
 * Opens the Timeline at a recorded moment, through the same native handoff as
 * Search. Used by the Task Page evidence ("Voir dans la timeline") and by the
 * Review Screen for the moment its Flow's task was seen. `frameId` is a
 * recorder frame, or `null` to open the Timeline at `timestamp` alone.
 */
export async function openTimelineMoment(frameId: number | null, timestamp: string): Promise<void> {
  const validFrame = frameId === null || (Number.isSafeInteger(frameId) && frameId > 0);
  if (!validFrame || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Invalid captured moment");
  }
  const result = await commands.searchNavigateToTimeline(timestamp, frameId, null, null, null, null);
  if (result.status === "error") throw new Error(result.error);
}
