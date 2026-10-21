// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localFetch } from "@/lib/api";
import { loadOriginalWorkflowScreenshot } from "./original-screenshot";

vi.mock("@/lib/api", () => ({ localFetch: vi.fn() }));
const fetch = vi.mocked(localFetch);

// Upstream #7634 gates frame media behind PII redaction: 503 with this body
// means "not yet", never "gone".
const pending = () => Response.json(
  { error: "Image privacy processing is pending", code: "privacy_pending", retryable: true },
  { status: 503, headers: { "retry-after": "0" } });
const png = () => new Response("png", { headers: { "content-type": "image/png" } });

beforeEach(() => fetch.mockReset());

describe("original screenshot loader under privacy gating", () => {
  it("loads the recorder-owned original frame", async () => {
    fetch.mockResolvedValueOnce(png());
    const blob = await loadOriginalWorkflowScreenshot(7, new AbortController().signal);
    // Realm-agnostic identity: jsdom's Blob global differs from the fetch
    // implementation's realm in CI, so instanceof would false-fail there.
    expect(blob.constructor.name).toBe("Blob");
    expect(blob.size).toBe(3);
    expect(blob.type).toBe("image/png");
    expect(fetch.mock.calls[0][0]).toBe("/frames/7?fallback=false");
  });

  it("retries a privacy-pending frame and loads once redaction releases", async () => {
    fetch.mockImplementationOnce(async () => pending()).mockResolvedValueOnce(png());
    const blob = await loadOriginalWorkflowScreenshot(7, new AbortController().signal);
    expect(blob.size).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("tells a still-redacting frame apart from an unavailable one", async () => {
    fetch.mockImplementation(async () => pending());
    await expect(loadOriginalWorkflowScreenshot(7, new AbortController().signal)).rejects.toThrow(/redact|privacy/i);
    await expect(loadOriginalWorkflowScreenshot(7, new AbortController().signal)).rejects.not.toThrow(/unavailable/);
    // A bare 503 (busy, no privacy marker) and expired media keep today's copy.
    fetch.mockReset();
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(loadOriginalWorkflowScreenshot(7, new AbortController().signal)).rejects.toThrow("unavailable");
    fetch.mockReset();
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(loadOriginalWorkflowScreenshot(7, new AbortController().signal)).rejects.toThrow("unavailable");
  });

  it("stops retrying when the caller aborts during the privacy wait", async () => {
    const controller = new AbortController();
    fetch.mockImplementation(async () => {
      controller.abort();
      return pending();
    });
    await expect(loadOriginalWorkflowScreenshot(7, controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
