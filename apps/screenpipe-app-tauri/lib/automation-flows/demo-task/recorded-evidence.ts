// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Finds the demo captures in this machine's own recordings through the local
// ScreenPipe search API, so the Task Page shows real frames like the finished
// product would. Deterministic: words of the capture's quote, no AI. A capture
// that cannot be found keeps its embedded key frame.
import { isPrivacyPending, PrivacyPendingError } from "../../workflows/privacy-pending";
import type { EvidenceCapture, RecordedFrame } from "./detected-task";

export type CaptureLookup = { image: string; frame: RecordedFrame } | { image: string; frame: null; reason: string };

export type RecordingsApi = {
  url: string;
  key?: string;
  window: { start: string; end: string };
  timeoutMs?: number;
  /** Step between 503 retries; scripts pass a small value to keep tests fast. */
  backoffMs?: number;
  /** The app passes its authenticated local API client; scripts use `fetch` with `key`. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

type SearchRow = { frame_id?: unknown; timestamp?: unknown; app_name?: unknown; window_name?: unknown; browser_url?: unknown };

/** The quote's words for the search API, which requires each of them. */
const words = (quote: string) => quote.split(/\s+/)
  .map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
  .filter(Boolean).join(" ");

/** Gmail and Jira run in a browser: recognise them by window title or URL, not by app. */
const SURFACES: Record<EvidenceCapture["app"], string[]> = { Gmail: ["gmail", "mail.google.com"], Jira: ["jira", "atlassian.net"] };
const onSurface = (row: SearchRow, app: EvidenceCapture["app"]) => {
  const where = [row.app_name, row.window_name, row.browser_url].filter(value => typeof value === "string").join(" ").toLowerCase();
  return SURFACES[app].some(marker => where.includes(marker));
};

async function findCapture(capture: EvidenceCapture, api: RecordingsApi): Promise<CaptureLookup> {
  // The closest match on each side of the key frame: one short page per side,
  // so long runs of matching frames elsewhere in the recording do not hide it.
  const side = async (order: "ascending" | "descending"): Promise<RecordedFrame | null> => {
    const params = new URLSearchParams({
      content_type: "ocr", limit: "20", offset: "0", order,
      start_time: new Date(order === "ascending" ? capture.at : api.window.start).toISOString(),
      end_time: new Date(order === "ascending" ? api.window.end : capture.at).toISOString(),
      [capture.quoteIn === "window" ? "window_name" : "q"]: words(capture.quote),
    });
    // The engine serves only a few searches at once and answers 503 to the
    // rest: searches go one at a time, and a busy answer is retried. The same
    // 503 also carries `privacy_pending` (#7634) while redaction catches up —
    // both mean "not yet", so the loop waits through them.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(done => setTimeout(done, (api.backoffMs ?? 250) * attempt));
      response = await (api.fetch ?? fetch)(`${api.url}/search?${params}`, {
        headers: api.key ? { Authorization: `Bearer ${api.key}` } : {},
        signal: AbortSignal.timeout(api.timeoutMs ?? 5_000),
      }).catch(() => { throw new Error(`ScreenPipe is not reachable at ${api.url}`); });
      if (response.status !== 503) break;
    }
    response = response!;
    if (response.status === 401 || response.status === 403) {
      throw new Error(`ScreenPipe refused the search (HTTP ${response.status}); set SCREENPIPE_LOCAL_API_KEY (Settings > Privacy)`);
    }
    if (!response.ok) {
      if (await isPrivacyPending(response))
        throw new PrivacyPendingError("ScreenPipe is still redacting this recording; the capture keeps its key frame for now");
      throw new Error(`ScreenPipe search failed (HTTP ${response.status})`);
    }
    const body = await response.json() as { data?: { type?: string; content?: SearchRow }[] };
    const row = body.data?.map(item => item.type === "OCR" ? item.content : undefined)
      .find(row => row && typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp))
        && Number.isSafeInteger(row.frame_id) && (row.frame_id as number) > 0 && onSurface(row, capture.app));
    return row ? { frameId: row.frame_id as number, timestamp: row.timestamp as string } : null;
  };
  const distance = (frame: RecordedFrame) => Math.abs(Date.parse(frame.timestamp) - Date.parse(capture.at));
  const before = await side("descending");
  const after = await side("ascending");
  const frame = before && after ? (distance(after) < distance(before) ? after : before) : before ?? after;
  return frame ? { image: capture.image, frame }
    : { image: capture.image, frame: null, reason: "no matching frame in the recording window" };
}

/** Never throws: a capture whose lookup fails comes back without a frame, with the reason. */
export async function findRecordedFrames(captures: EvidenceCapture[], api: RecordingsApi): Promise<CaptureLookup[]> {
  const lookups: CaptureLookup[] = [];
  for (const capture of captures) {
    lookups.push(await findCapture(capture, api).catch((error: unknown) =>
      ({ image: capture.image, frame: null, reason: error instanceof Error ? error.message : String(error) })));
  }
  // The Task Page shows a frame once: a frame two captures match goes to the
  // capture whose key frame is nearest; the other keeps its embedded image.
  const distance = (lookup: CaptureLookup, index: number) =>
    lookup.frame ? Math.abs(Date.parse(lookup.frame.timestamp) - Date.parse(captures[index].at)) : Infinity;
  return lookups.map((lookup, index) => {
    if (!lookup.frame) return lookup;
    const frameId = lookup.frame.frameId;
    // Ties go to the earlier capture, so exactly one capture owns the frame.
    const owner = lookups.reduce((best, other, i) => other.frame?.frameId === frameId
      && distance(other, i) < distance(lookups[best], best) ? i : best,
    lookups.findIndex(other => other.frame?.frameId === frameId));
    return owner === index ? lookup
      : { image: lookup.image, frame: null, reason: `its nearest frame ${frameId} is ${lookups[owner].image}'s` };
  });
}
