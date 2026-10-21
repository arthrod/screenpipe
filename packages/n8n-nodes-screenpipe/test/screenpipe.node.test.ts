// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Outside-in tests of the ScreenPipe n8n node: its execute entry point runs
// against a local fake ScreenPipe API.
// Run: cd packages/n8n-nodes-screenpipe && bun test

import { afterEach, describe, expect, test } from "bun:test";
import { NodeApiError } from "n8n-workflow";
import { basename, join } from "node:path";
import { ScreenPipeApi } from "../credentials/ScreenPipeApi.credentials";
import { ScreenPipe } from "../nodes/ScreenPipe/ScreenPipe.node";
import type { IHttpRequestOptions } from "n8n-workflow";
import { executeContext, fakeScreenpipe } from "./harness";

const ROOT = join(import.meta.dir, "..");
const API_KEY = "sp-test-fixture-key";
let api: ReturnType<typeof fakeScreenpipe> | undefined;
afterEach(() => api?.stop());

type RunExtra = Omit<Parameters<typeof executeContext>[0], "parameters" | "credentials">;

function run(parameters: Record<string, unknown>, apiKey = API_KEY, extra: RunExtra = {}) {
  const ctx = executeContext({ parameters, credentials: { baseUrl: api?.baseUrl ?? "http://127.0.0.1:9", apiKey }, ...extra });
  return new ScreenPipe().execute.call(ctx);
}

const JIRA_HIT = {
  type: "UI",
  content: {
    frame_id: 4242,
    text: "Créer un ticket · Projet NOVA · Type Bug · Résumé NovaCRM - Export CSV des contacts filtres vide",
    timestamp: "2026-10-17T02:05:12Z",
    app_name: "Google Chrome",
    window_name: "Créer un ticket - Jira",
    browser_url: "https://kylianaubry.atlassian.net/jira/software/projects/NOVA",
  },
};

describe("what n8n loads", () => {
  // n8n's loaders do `require(file)[<file name without .node.js/.credentials.js>]`.
  test("every node and credential listed in package.json exports a class named after its file", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json();
    const entries: string[] = [...pkg.n8n.nodes, ...pkg.n8n.credentials];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of entries) {
      const source = join(ROOT, entry.replace(/^dist\//, "").replace(/\.js$/, ".ts"));
      const className = basename(entry).replace(/\.(node|credentials)\.js$/, "");
      const mod = await import(source);
      expect(typeof mod[className], `${entry} exports ${className}`).toBe("function");
    }
  });

  test("the ScreenPipe node is offered as an AI Agent tool and uses the ScreenPipe API credential", () => {
    const node = new ScreenPipe().description;
    const credential = new ScreenPipeApi();
    expect(node.usableAsTool).toBe(true);
    expect(node.credentials).toEqual([{ name: credential.name, required: true }]);
    expect(credential.displayName).toBe("ScreenPipe API");
    const field = (name: string) => credential.properties.find((p) => p.name === name)!;
    expect(field("baseUrl").default).toBe("http://host.docker.internal:3030");
    expect(field("apiKey").typeOptions?.password).toBe(true);
    expect(field("apiKey").default).toBe("");
  });
});

describe("ScreenPipe node: search content", () => {
  test("queries GET /search with the user's filters and the API key, and returns one item per capture", async () => {
    api = fakeScreenpipe({ "/search": { body: { data: [JIRA_HIT], pagination: { limit: 5, offset: 0, total: 1 } } } });

    const [output] = await run({
      operation: "searchContent",
      query: "NovaCRM export",
      contentType: "accessibility",
      limit: 5,
      filters: { appName: "Google Chrome", windowName: "Jira", startTime: "2026-10-17T00:00:00Z", endTime: "now" },
    });

    expect(api.requests).toHaveLength(1);
    const [request] = api.requests;
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/search");
    expect(request.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.query).toEqual({
      q: "NovaCRM export",
      content_type: "accessibility",
      limit: "5",
      app_name: "Google Chrome",
      window_name: "Jira",
      start_time: "2026-10-17T00:00:00Z",
      end_time: "now",
    });

    expect(output.map((item) => item.json)).toEqual([
      {
        type: "UI",
        timestamp: "2026-10-17T02:05:12Z",
        app: "Google Chrome",
        window: "Créer un ticket - Jira",
        url: "https://kylianaubry.atlassian.net/jira/software/projects/NOVA",
        frameId: 4242,
        text: JIRA_HIT.content.text,
      },
    ]);
  });

  test("sends no Authorization header when the credential has no API key (ScreenPipe auth off)", async () => {
    api = fakeScreenpipe({ "/search": { body: { data: [], pagination: {} } } });

    const [output] = await run({ operation: "searchContent", query: "NovaCRM" }, "");

    expect(api.requests[0].authorization).toBeNull();
    expect(output).toEqual([]);
  });

  test("cuts long capture text to the max text length (1000 by default) and says how much was cut", async () => {
    const long = "Résumé du ticket. ".repeat(400); // 7200 chars
    const audio = { type: "Audio", content: { chunk_id: 7, transcription: long, timestamp: "2026-10-17T02:06:00Z" } };
    api = fakeScreenpipe({ "/search": { body: { data: [JIRA_HIT, audio], pagination: {} } } });

    const [byDefault] = await run({ operation: "searchContent", query: "ticket" });
    const [capped] = await run({ operation: "searchContent", query: "ticket", maxTextLength: 200 });

    expect(byDefault[0].json.text).toBe(JIRA_HIT.content.text); // short text untouched
    const defaultText = String(byDefault[1].json.text);
    expect(defaultText.startsWith(long.slice(0, 1000))).toBe(true);
    expect(defaultText).toContain("[6200 more characters]");
    expect(defaultText.length).toBeLessThan(1100);

    const cappedText = String(capped[1].json.text);
    expect(cappedText.startsWith(long.slice(0, 200))).toBe(true);
    expect(cappedText).toContain("[7000 more characters]");
    expect(cappedText.length).toBeLessThan(300);
  });
});

describe("ScreenPipe node: activity summary", () => {
  test("queries GET /activity-summary for the time range and returns the summary with long texts cut", async () => {
    const summary = {
      time_range: { start: "2026-10-17T02:00:00Z", end: "2026-10-17T03:00:00Z" },
      total_active_minutes: 42,
      apps: [{ name: "Google Chrome", minutes: 30 }],
      key_texts: [{ app_name: "Google Chrome", window_name: "Jira", text: "x".repeat(900) }],
    };
    api = fakeScreenpipe({ "/activity-summary": { body: summary } });

    const [output] = await run({
      operation: "activitySummary",
      startTime: "1h ago",
      endTime: "now",
      summaryFilters: { appName: "Google Chrome", query: "NOVA" },
      maxTextLength: 100,
    });

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]).toMatchObject({
      method: "GET",
      path: "/activity-summary",
      authorization: `Bearer ${API_KEY}`,
      query: { start_time: "1h ago", end_time: "now", app_name: "Google Chrome", q: "NOVA" },
    });

    expect(output).toHaveLength(1);
    const json = output[0].json as any;
    expect(json.total_active_minutes).toBe(42);
    expect(json.apps).toEqual(summary.apps);
    expect(json.key_texts[0].window_name).toBe("Jira");
    expect(json.key_texts[0].text).toBe(`${"x".repeat(100)}… [800 more characters]`);
  });
});

describe("ScreenPipe node: errors", () => {
  test("an HTTP error from ScreenPipe fails the node with the status and ScreenPipe's message", async () => {
    api = fakeScreenpipe({ "/search": { status: 403, body: { error: "invalid or missing api key" } } });

    const error = await run({ operation: "searchContent", query: "NovaCRM" }, "wrong-key").catch((e) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.httpCode).toBe("403");
    expect(`${error.message} ${error.description}`).toContain("invalid or missing api key");
  });

  test("with 'On Error: Continue', the error comes back as an item so an AI Agent can carry on", async () => {
    api = fakeScreenpipe({ "/search": { status: 500, body: { error: "database is locked" } } });

    const [output] = await run({ operation: "searchContent", query: "NovaCRM" }, API_KEY, { continueOnFail: true });

    expect(output).toHaveLength(1);
    expect(String(output[0].json.error)).toContain("HTTP 500");
    expect(String(output[0].json.error)).toContain("database is locked");
  });

  test("when ScreenPipe is not running, the node fails and names the URL it tried", async () => {
    api = fakeScreenpipe({});
    api.stop();

    const error = await run({ operation: "searchContent", query: "NovaCRM" }).catch((e) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.message).toContain(api.baseUrl);
  });
});

describe("ScreenPipe node: parameters", () => {
  const properties = new ScreenPipe().description.properties;
  const shownFor = (name: string) => properties.find((p) => p.name === name)?.displayOptions?.show?.operation;

  test("the notification fields show for Send Notification only, the text length for the two reads only", () => {
    const operations = properties.find((p) => p.name === "operation")!.options as { value: string }[];
    expect(operations.map((o) => o.value)).toEqual(["searchContent", "activitySummary", "notify"]);
    for (const name of ["title", "body", "buttonLabel", "buttonUrl", "notificationId", "notifyUrl"]) {
      expect(shownFor(name), name).toEqual(["notify"]);
    }
    expect(shownFor("maxTextLength")).toEqual(["searchContent", "activitySummary"]);
    expect(properties.find((p) => p.name === "notifyUrl")!.default).toBe("http://host.docker.internal:11435/notify");
  });
});

describe("ScreenPipe node: send notification", () => {
  const SENT = { success: true, message: "Notification sent successfully" };
  const JIRA_URL = "https://kylianaubry.atlassian.net/browse/NOVA-42";

  /** Markdown backslash escapes undone: what the user reads in the notification. */
  const unescapeMarkdown = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1");

  /** Records what the node asks n8n to send, for hosts this test cannot reach. */
  function capture(reply: { statusCode: number; body: unknown } = { statusCode: 200, body: SENT }) {
    const sent: IHttpRequestOptions[] = [];
    const httpRequest = async (request: IHttpRequestOptions) => {
      sent.push(request);
      return reply;
    };
    return { sent, httpRequest };
  }

  test("POSTs the title, the body shown as typed and a link button to the notify server, and says it was shown", async () => {
    api = fakeScreenpipe({ "/notify": { body: SENT } });
    const text = "NovaCRM - Export [vide](https://evil.example) **now** <b>#1</b>";

    const [output] = await run({
      operation: "notify",
      notifyUrl: `${api.baseUrl}/notify`,
      title: "  Ticket NOVA-42 created ",
      body: text,
      buttonLabel: "Open in Jira",
      buttonUrl: JIRA_URL,
      notificationId: "automation-flow:wfNova:ticket:7",
    });

    expect(api.requests).toHaveLength(1);
    const [request] = api.requests;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/notify");
    expect(request.headers["content-type"]).toBe("application/json");
    // The ScreenPipe API key is for the API, never sent to the notify server.
    expect(request.authorization).toBeNull();
    // A host other than host.docker.internal keeps its own Host header.
    expect(request.headers.host).toBe(new URL(api.baseUrl).host);
    const body = request.body as Record<string, any>;
    expect(body).toEqual({
      id: "automation-flow:wfNova:ticket:7",
      title: "Ticket NOVA-42 created",
      body: expect.any(String),
      type: "pipe",
      priority: "high",
      transient: false,
      actions: [{ type: "link", label: "Open in Jira", url: JIRA_URL, primary: true }],
      source_url: JIRA_URL,
    });
    // Every Markdown character is escaped: no link, emphasis, HTML or heading.
    for (const mark of ["[", "]", "(", ")", "*", "<", ">", "#", "-", "."]) {
      const bare = [...body.body.matchAll(/\\?./gsu)].filter((m) => m[0] === mark);
      expect(bare, `unescaped ${mark}`).toEqual([]);
    }
    expect(unescapeMarkdown(body.body)).toBe(text);

    expect(output.map((item) => item.json)).toEqual([
      { id: "automation-flow:wfNova:ticket:7", shown: true, message: "Notification sent successfully" },
    ]);
    expect(output[0].pairedItem).toEqual({ item: 0 });
  });

  test("reaches the app through host.docker.internal by default, with the Host the notify server accepts, within 5 s", async () => {
    const { sent, httpRequest } = capture();

    await run({ operation: "notify", title: "Sort by hand" }, API_KEY, { httpRequest });
    await run({ operation: "notify", title: "Sort by hand", notifyUrl: "http://host.docker.internal/notify" }, API_KEY, { httpRequest });

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      method: "POST",
      url: "http://host.docker.internal:11435/notify",
      // The notify server answers its own host name only (DNS-rebinding guard).
      headers: { Host: "localhost:11435" },
      json: true,
      timeout: 5000,
      ignoreHttpStatusErrors: true,
      returnFullResponse: true,
    });
    expect(sent[1].headers).toEqual({ Host: "localhost" });
  });

  test("a screenpipe:// button opens inside ScreenPipe, a button without a label reads « Open », no URL means no button", async () => {
    const { sent, httpRequest } = capture();

    await run({ operation: "notify", title: "Sort by hand", buttonUrl: "screenpipe://flows/wfNova", buttonLabel: " " }, API_KEY, {
      httpRequest,
    });
    await run({ operation: "notify", title: "Sort by hand", buttonUrl: "  ", buttonLabel: "View Flow" }, API_KEY, { httpRequest });

    const [deeplink, none] = sent.map((request) => request.body as Record<string, any>);
    expect(deeplink.actions).toEqual([{ type: "deeplink", label: "Open", url: "screenpipe://flows/wfNova", primary: true }]);
    expect(deeplink.source_url).toBe("screenpipe://flows/wfNova");
    expect(none).not.toHaveProperty("actions");
    expect(none).not.toHaveProperty("source_url");
  });

  test("without a notification ID, each run and item gets its own, so none is dropped as a repeat", async () => {
    const { sent, httpRequest } = capture();

    const [output] = await run({ operation: "notify", title: "Sort by hand", notificationId: "  " }, API_KEY, {
      httpRequest,
      workflowId: "wfNova",
      executionId: "4242",
      items: [{ json: {} }, { json: {} }],
    });

    const ids = sent.map((request) => (request.body as Record<string, any>).id);
    expect(ids).toEqual(["n8n:wfNova:4242:ScreenPipe:0", "n8n:wfNova:4242:ScreenPipe:1"]);
    expect(output.map((item) => item.json.id)).toEqual(ids);
  });

  test("keeps a huge title and body short", async () => {
    const { sent, httpRequest } = capture();

    await run({ operation: "notify", title: "T".repeat(5_000), body: "b".repeat(50_000) }, API_KEY, { httpRequest });

    const body = sent[0].body as Record<string, any>;
    expect(body.title).toBe("T".repeat(200));
    expect(body.body).toBe("b".repeat(2_000));
  });

  test("a notification ScreenPipe holds back (paused, a repeat) is not an error: it comes back with shown false", async () => {
    api = fakeScreenpipe({ "/notify": { body: { success: true, message: "notifications paused" } } });

    const [output] = await run({ operation: "notify", notifyUrl: `${api.baseUrl}/notify`, title: "Sort by hand", notificationId: "n1" });

    expect(output.map((item) => item.json)).toEqual([{ id: "n1", shown: false, message: "notifications paused" }]);
  });

  test("an HTTP error from the notify server fails the node with the status and its message", async () => {
    api = fakeScreenpipe({ "/notify": { status: 403, body: { error: "invalid host header" } } });
    const parameters = { operation: "notify", notifyUrl: `${api.baseUrl}/notify`, title: "Sort by hand" };

    const error = await run(parameters).catch((e) => e);
    const [output] = await run(parameters, API_KEY, { continueOnFail: true });

    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.httpCode).toBe("403");
    expect(error.message).toContain("HTTP 403");
    expect(error.description).toContain("invalid host header");
    expect(String(output[0].json.error)).toContain("invalid host header");
  });

  test("when ScreenPipe is not running, the node fails and names the notify URL it tried", async () => {
    api = fakeScreenpipe({});
    api.stop();
    const url = `${api.baseUrl}/notify`;

    const error = await run({ operation: "notify", notifyUrl: url, title: "Sort by hand" }).catch((e) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.message).toContain(url);
    expect(error.message).toContain("is ScreenPipe running?");
  });
});
