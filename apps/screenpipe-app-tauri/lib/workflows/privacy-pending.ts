// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Upstream #7634 gates captured data on PII-redaction receipts: while protected
// reads are enabled and a frame has not been released, /search, /frames and
// frame media answer 503 `{"code":"privacy_pending","retryable":true}`. Flow
// evidence must treat that answer as "not yet", never as "gone": bounded
// retry-until-release here, then a distinguishable error so surfaces fall back
// to saved pixels or show a retry instead of empty evidence.

/** The engine's marker on a 503 whose reason is unfinished redaction. */
export const PRIVACY_PENDING_CODE = "privacy_pending";

/** Raised when the privacy hold did not lift within the retry budget. */
export class PrivacyPendingError extends Error {
  constructor(message = "The screenshot is still being redacted; try again shortly.") {
    super(message);
    this.name = "PrivacyPendingError";
  }
}

/** True when a failure came from a privacy-pending answer (duck-typed on the
 * name so plain `Error` copies across module boundaries still match). */
export function isPrivacyPendingError(error: unknown): boolean {
  return error instanceof Error && error.name === "PrivacyPendingError";
}

/** True when the response is the engine's 503 privacy-pending answer.
 * Consumes the body, so only call it on responses you are about to discard. */
export async function isPrivacyPending(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    return body?.code === PRIVACY_PENDING_CODE;
  } catch { return false; }
}

export type ReleasedFetchOptions = {
  /** Total tries, including the first. Default 4. */
  attempts?: number;
  /** Step between tries when the engine sends no Retry-After. Default 100ms. */
  backoffMs?: number;
  /** Checked between tries; an aborted caller never waits or retries. */
  signal?: AbortSignal;
};

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Fetches and, while the engine answers 503 privacy_pending, retries until
 * the release or a bounded budget; still pending, it rejects with a
 * PrivacyPendingError. Every other response passes through untouched — a bare
 * 503 (busy limiter) keeps its caller's existing fast-fail behavior. */
export async function fetchUntilReleased(fetch: () => Promise<Response>, options: ReleasedFetchOptions = {}): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const backoffMs = options.backoffMs ?? 100;
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted();
    const response = await fetch();
    if (!(await isPrivacyPending(response))) return response;
    if (attempt >= attempts) throw new PrivacyPendingError();
    // Honor Retry-After when the engine sends one; stay bounded either way.
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : backoffMs * attempt);
  }
}
