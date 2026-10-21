// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { localFetch } from "@/lib/api";
import { fetchUntilReleased } from "./privacy-pending";

/** Read the recorder-owned original; never substitute a neighboring frame or persist a copy. */
export async function loadOriginalWorkflowScreenshot(frameId: number, signal: AbortSignal): Promise<Blob> {
  if (!Number.isSafeInteger(frameId) || frameId <= 0) throw new Error("Invalid screenshot reference.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  const maxBytes = 12 * 1024 * 1024;
  try {
    // Frame media answers 503 privacy_pending until redaction releases; wait
    // bounded, then raise a distinguishable error instead of "unavailable".
    const response = await fetchUntilReleased(() => localFetch(`/frames/${frameId}?fallback=false`, { signal: controller.signal }), { signal: controller.signal });
    if (!response.ok) throw new Error("A screenshot is unavailable. Restore or replace that screenshot before rendering.");
    if (Number(response.headers?.get("content-length")) > maxBytes) throw new Error("A screenshot is too large.");
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || !blob.size || blob.size > maxBytes) throw new Error("A screenshot could not be read.");
    controller.signal.throwIfAborted();
    return blob;
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}
