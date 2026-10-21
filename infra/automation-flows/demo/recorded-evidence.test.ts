// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { afterEach, describe, expect, it } from "bun:test";
import type { WorkflowMap } from "../../../packages/workflows-ui/src/model";
import { buildDemoTask } from "./demo";

const now = "2026-10-17T12:00:00Z";
const KEY = "sp-fake-local-key";

type Frame = { frame_id: number; timestamp: string; app_name: string; window_name: string; browser_url?: string; text: string };

/** A local ScreenPipe holding `frames`, answering `/search` like the engine:
 * every word of `q` in the frame, every word of `window_name` in its title,
 * inclusive time bounds, ordered, limited. `fail` may key on the attempt
 * number for this exact query (0 = first request of that search). */
function fakeScreenpipe(frames: Frame[], fail?: (params: URLSearchParams, attempt: number) => number | undefined, maxConcurrent = Infinity) {
  const auth: (string | null)[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  const words = (value: string | null) => (value ?? "").split(/\s+/).filter(Boolean).map(word => word.toLowerCase());
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      auth.push(request.headers.get("authorization"));
      // Like the engine's search limiter: busy beyond maxConcurrent searches.
      if (inFlight >= maxConcurrent) return Response.json({ error: "too many concurrent searches" }, { status: 503 });
      inFlight++;
      try { await Bun.sleep(5); } finally { inFlight--; }
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const params = url.searchParams;
      const attempt = attempts.get(url.search) ?? 0;
      attempts.set(url.search, attempt + 1);
      const status = fail?.(params, attempt);
      if (status === 503) return Response.json({ error: "Image privacy processing is pending", code: "privacy_pending", retryable: true }, { status });
      if (status) return Response.json({ error: "fake failure" }, { status });
      const start = Date.parse(params.get("start_time") ?? "");
      const end = Date.parse(params.get("end_time") ?? "");
      const rows = frames.filter(frame => {
        const at = Date.parse(frame.timestamp);
        const all = `${frame.text} ${frame.window_name} ${frame.app_name}`.toLowerCase();
        return params.get("content_type") === "ocr"
          && (!Number.isFinite(start) || at >= start) && (!Number.isFinite(end) || at <= end)
          && words(params.get("q")).every(word => all.includes(word))
          && words(params.get("window_name")).every(word => frame.window_name.toLowerCase().includes(word));
      }).sort((a, b) => (Date.parse(a.timestamp) - Date.parse(b.timestamp)) * (params.get("order") === "ascending" ? 1 : -1))
        .slice(0, Number(params.get("limit") ?? 20));
      return Response.json({ data: rows.map(content => ({ type: "OCR", content })), pagination: { limit: rows.length, offset: 0, total: rows.length } });
    },
  });
  servers.push(server);
  return { url: server.url.origin, auth };
}
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

const shot = (task: WorkflowMap, stage: number, index: number) => task.stages[stage].screenshots![index];

// Repetition 1 as this machine recorded it (Chrome, CEST = UTC+2).
const R1_EMAIL: Frame = { frame_id: 7101, timestamp: "2026-10-17T02:05:39.418211Z", app_name: "Google Chrome",
  window_name: "Export des contacts vide dans NovaCRM - servicedesk.novadesk@gmail.com - Gmail",
  browser_url: "https://mail.google.com/mail/u/0/#inbox/FMfcgzQ", text: "Arthur Noteris Export des contacts vide dans NovaCRM Bonjour, l'export CSV des contacts filtres est vide" };
const R1_FORM: Frame = { frame_id: 7140, timestamp: "2026-10-17T02:08:00.733Z", app_name: "Google Chrome",
  window_name: "Tableau NOVA - Jira", browser_url: "https://novadesk.atlassian.net/jira/software/projects/NOVA/boards/1",
  text: "Créer Bug Résumé NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls) Priorité Highest" };
const R1_TICKET: Frame = { frame_id: 7152, timestamp: "2026-10-17T02:08:37.006Z", app_name: "Google Chrome",
  window_name: "[NOVA-25] NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls) - Jira",
  browser_url: "https://novadesk.atlassian.net/browse/NOVA-25", text: "NOVA-25 NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls) Bug Highest" };

describe("demo task evidence from this machine's recordings", () => {
  it("points each found capture at its recorded frame and exact time; the other captures keep their embedded image", async () => {
    const api = fakeScreenpipe([R1_EMAIL, R1_FORM, R1_TICKET]);
    const { task } = await buildDemoTask(now, { url: api.url, key: KEY });

    expect(task.stages[0].screenshots!.map(image => [image.frameId, image.timestamp, image.app, image.dataUrl])).toEqual([
      [7101, R1_EMAIL.timestamp, "Gmail", ""], [7140, R1_FORM.timestamp, "Jira", ""], [7152, R1_TICKET.timestamp, "Jira", ""],
    ]);
    // The same moments everywhere the page names them: evidence, procedure, timing.
    expect(task.stages[0].evidence.map(entry => entry.timestamp)).toEqual([R1_EMAIL.timestamp, R1_FORM.timestamp, R1_TICKET.timestamp]);
    expect(task.stages[0].procedure!.map(step => step.timestamp)).toEqual([R1_EMAIL.timestamp, R1_FORM.timestamp, R1_TICKET.timestamp]);
    expect(task.stages[0].timing!.runs[0]).toMatchObject({ start: { timestamp: R1_EMAIL.timestamp }, end: { timestamp: R1_TICKET.timestamp } });
    // Nothing recorded for repetitions 2 and 3: embedded key frames, unchanged.
    for (const stage of [1, 2]) for (const index of [0, 1, 2]) {
      expect(shot(task, stage, index).frameId).toBeLessThan(0);
      expect(shot(task, stage, index).dataUrl).toStartWith("data:image/webp;base64,");
    }
    expect(api.auth.length).toBeGreaterThan(0);
    expect(api.auth.every(header => header === `Bearer ${KEY}`)).toBe(true);
  });

  it("finds every capture when ScreenPipe serves one search at a time and answers 503 to the others", async () => {
    const api = fakeScreenpipe([R1_EMAIL, R1_FORM, R1_TICKET], undefined, 1);
    const { task, evidence } = await buildDemoTask(now, { url: api.url, key: KEY });

    expect(task.stages[0].screenshots!.map(image => image.frameId)).toEqual([7101, 7140, 7152]);
    expect(evidence.filter(lookup => lookup.reason?.includes("503"))).toEqual([]);
  });

  it("picks the opened email and the Jira window, inside the recording, at the frame nearest each key frame", async () => {
    const at = (iso: string, frame: Frame, frame_id: number): Frame => ({ ...frame, frame_id, timestamp: iso });
    const inbox: Frame = { ...R1_EMAIL, frame_id: 7000, timestamp: "2026-10-17T02:05:41Z",
      window_name: "Boîte de réception (3) - servicedesk.novadesk@gmail.com - Gmail", text: "Export des contacts vide dans NovaCRM NovaPay refuse les montants avec centimes" };
    // Jira's own notification email quotes the ticket, but in Gmail.
    const notification: Frame = { ...R1_EMAIL, frame_id: 7153, timestamp: "2026-10-17T02:08:36.5Z",
      window_name: "Boîte de réception (4) - servicedesk.novadesk@gmail.com - Gmail", text: R1_TICKET.text };
    // Filling the form produces many frames before the key frame (more than one page of results).
    const typing = Array.from({ length: 25 }, (_, i) => at(new Date(Date.parse("2026-10-17T02:07:08Z") + i * 2000).toISOString(), R1_FORM, 7110 + i));
    const api = fakeScreenpipe([
      inbox, at("2026-10-17T02:04:58.100Z", R1_EMAIL, 7090), at("2026-10-17T02:05:40.902Z", R1_EMAIL, 7102),
      at("2026-10-17T02:25:00Z", R1_EMAIL, 7900), // after the recording window
      ...typing, at("2026-10-17T02:08:01.200Z", R1_FORM, 7141),
      notification, at("2026-10-17T02:08:38.100Z", R1_TICKET, 7154), at("2026-10-17T02:12:30Z", R1_TICKET, 7300),
    ]);
    const { task } = await buildDemoTask(now, { url: api.url, key: KEY });
    expect(task.stages[0].screenshots!.map(image => image.frameId)).toEqual([7102, 7141, 7154]);
  });

  it("gives a frame to one capture only, the one whose key frame is nearest", async () => {
    // No frame of the form: the ticket view also shows the summary.
    const api = fakeScreenpipe([R1_EMAIL, R1_TICKET]);
    const { task, evidence } = await buildDemoTask(now, { url: api.url, key: KEY });
    expect(task.stages[0].screenshots!.map(image => image.frameId)).toEqual([7101, -2, 7152]);
    expect(evidence.find(lookup => lookup.image === "r1-form")).toMatchObject({ frame: null, reason: expect.stringContaining("r1-ticket") });
  });

  it("retries a privacy-pending first answer on every search and still finds the captures", async () => {
    // Upstream #7634: /search answers 503 privacy_pending until PII redaction
    // releases. The first request of every search fails; the backoff loop must
    // absorb it instead of giving up on the capture.
    const api = fakeScreenpipe([R1_EMAIL, R1_FORM, R1_TICKET], (_params, attempt) => attempt === 0 ? 503 : undefined);
    const { task, evidence } = await buildDemoTask(now, { url: api.url, key: KEY, backoffMs: 1 });

    expect(task.stages[0].screenshots!.map(image => image.frameId)).toEqual([7101, 7140, 7152]);
    expect(evidence.filter(lookup => lookup.reason?.includes("privacy"))).toEqual([]);
    // 3 captures × 2 sides, each retried at least once: the loop really fired.
    expect(api.auth.length).toBeGreaterThanOrEqual(12);
  });

  it("says redaction is still pending when privacy_pending never releases", async () => {
    const api = fakeScreenpipe([R1_EMAIL, R1_FORM, R1_TICKET], () => 503);
    const { task, evidence } = await buildDemoTask(now, { url: api.url, key: KEY, backoffMs: 1 });

    // No frame found anywhere, but no silent empty evidence either: the
    // capture keeps its embedded key frame and the reason names the hold.
    expect(task.stages.flatMap(stage => stage.screenshots!).every(image => image.frameId < 0)).toBe(true);
    for (const lookup of evidence) {
      expect(lookup.frame).toBeNull();
      expect(lookup.reason).toMatch(/redacting|privacy/i);
      expect(lookup.reason).not.toContain("HTTP 503");
    }
  });

  it("keeps the embedded image of a capture whose lookup fails, and says why", async () => {
    const formQuery = (params: URLSearchParams) => params.get("q")?.includes("filtres") && !params.get("q")?.includes("NOVA-25");
    const api = fakeScreenpipe([R1_EMAIL, R1_FORM, R1_TICKET], params => formQuery(params) ? 500 : undefined);
    const { task, evidence } = await buildDemoTask(now, { url: api.url, key: KEY });
    expect(task.stages[0].screenshots!.map(image => image.frameId)).toEqual([7101, -2, 7152]);
    expect(shot(task, 0, 1)).toMatchObject({ timestamp: "2026-10-17T02:08:01Z", dataUrl: expect.stringMatching(/^data:image\/webp;base64,/) });
    expect(evidence.find(lookup => lookup.image === "r1-form")).toMatchObject({ frame: null, reason: expect.stringContaining("HTTP 500") });
    expect(evidence.find(lookup => lookup.image === "r2-email")).toMatchObject({ frame: null, reason: expect.stringContaining("no matching frame") });
  });

  it("keeps every embedded image when ScreenPipe is unreachable or refuses the key", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() });
    const url = closed.url.origin;
    closed.stop(true);
    const down = await buildDemoTask(now, { url, key: KEY });
    expect(down.task.stages.flatMap(stage => stage.screenshots!).every(image => image.frameId < 0 && image.dataUrl.startsWith("data:image/webp"))).toBe(true);
    expect(down.evidence.every(lookup => !lookup.frame && lookup.reason.includes("not reachable"))).toBe(true);

    const refused = fakeScreenpipe([R1_EMAIL], () => 401);
    const unauthorized = await buildDemoTask(now, { url: refused.url });
    expect(unauthorized.task.stages[0].screenshots![0].frameId).toBe(-1);
    expect(unauthorized.evidence[0]).toMatchObject({ frame: null, reason: expect.stringContaining("SCREENPIPE_LOCAL_API_KEY") });
    expect(refused.auth.every(header => header === null)).toBe(true);
  });
});
