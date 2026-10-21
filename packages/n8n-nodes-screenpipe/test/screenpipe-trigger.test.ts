// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Outside-in tests of the ScreenPipe Trigger (deterministic polling node): its
// poll entry point runs against a local fake ScreenPipe API, with the node's
// static data carried from one poll to the next as n8n does.
// Run: cd packages/n8n-nodes-screenpipe && bun test

import { afterEach, describe, expect, test } from "bun:test";
import { NodeApiError, NodeOperationError, type IDataObject, type IPollFunctions } from "n8n-workflow";
import { join } from "node:path";
import { ScreenPipeTrigger } from "../nodes/ScreenPipeTrigger/ScreenPipeTrigger.node";
import { executeContext, fakeScreenpipe, type RecordedRequest } from "./harness";

const API_KEY = "sp-test-fixture-key";
let api: ReturnType<typeof fakeScreenpipe> | undefined;
afterEach(() => api?.stop());

/** One active trigger: parameters plus the static data n8n keeps between polls. */
function trigger(parameters: Record<string, unknown>, options: { mode?: "trigger" | "manual"; workflowId?: string } = {}) {
  const staticData: IDataObject = {};
  const poll = () => {
    const base = executeContext({ parameters, credentials: { baseUrl: api!.baseUrl, apiKey: API_KEY } });
    const ctx = {
      getNode: base.getNode,
      getCredentials: base.getCredentials,
      helpers: base.helpers,
      // n8n's IPollFunctions.getNodeParameter has no item index.
      getNodeParameter: (name: string, ...fallback: unknown[]) =>
        fallback.length ? base.getNodeParameter(name, 0, fallback[0]) : base.getNodeParameter(name, 0),
      getMode: () => options.mode ?? "trigger",
      getActivationMode: () => "activate",
      getWorkflow: () => ({ id: options.workflowId ?? "wfTrigger0000001", name: "Trigger test", active: true }),
      getWorkflowStaticData: (type: string) => {
        if (type !== "node") throw new Error(`unexpected static data type ${type}`);
        return staticData;
      },
    } as unknown as IPollFunctions;
    return new ScreenPipeTrigger().poll.call(ctx);
  };
  /** Emitted items' JSON, or null when the poll emitted nothing. */
  const next = async () => {
    const result = await poll();
    return result === null ? null : result[0].map((item) => item.json);
  };
  return { poll, next, staticData };
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function audio(chunkId: number, text: string, timestamp: string) {
  return { type: "Audio", content: { chunk_id: chunkId, transcription: text, text, timestamp, device_name: "MacBook Pro Microphone" } };
}

/** A fake /search whose answer the test changes between polls. */
function searchReturning(initial: unknown[]) {
  const state = { data: initial };
  api = fakeScreenpipe({ "/search": () => ({ body: { data: state.data, pagination: {} } }) });
  return state;
}

const searches = () => api!.requests.filter((r: RecordedRequest) => r.path === "/search");

function frame(frameId: number, app: string, window: string, timestamp: string) {
  return {
    type: "OCR",
    content: { frame_id: frameId, text: `${window} screen text`, timestamp, app_name: app, window_name: window, focused: true },
  };
}

/** A fake /search over screen frames that honours start_time, order and limit like ScreenPipe. */
function framesRecorded() {
  const frames: ReturnType<typeof frame>[] = [];
  api = fakeScreenpipe({
    "/search": (req) => {
      const from = req.query.start_time ? Date.parse(req.query.start_time) : -Infinity;
      let data = frames.filter((f) => Date.parse(f.content.timestamp) >= from);
      if (req.query.order !== "ascending") data = [...data].reverse();
      return { body: { data: data.slice(0, Number(req.query.limit ?? 20)), pagination: {} } };
    },
  });
  let minute = 0;
  return {
    /** Records focused frames one minute apart, in order. */
    add(...windows: [app: string, window: string][]) {
      for (const [app, window] of windows) frames.push(frame(frames.length + 1, app, window, minutesFromNow(++minute)));
      return frames[frames.length - 1].content;
    },
  };
}

describe("ScreenPipe Trigger: what n8n loads", () => {
  test("is listed in package.json and is a polling trigger with the ScreenPipe API credential", async () => {
    const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
    expect(pkg.n8n.nodes).toContain("dist/nodes/ScreenPipeTrigger/ScreenPipeTrigger.node.js");

    const node = new ScreenPipeTrigger().description;
    expect(node.polling).toBe(true);
    expect(node.group).toEqual(["trigger"]);
    expect(node.inputs).toEqual([]);
    expect(node.credentials).toEqual([{ name: "screenpipeApi", required: true }]);
    const events = node.properties.find((p) => p.name === "event")!.options!.map((o) => (o as { value: string }).value);
    expect(events).toEqual(["keyword", "window", "pipe", "flow"]);
  });
});

describe("ScreenPipe Trigger: keyword said", () => {
  test("emits once per new transcription containing the keyword, and moves its cursor forward", async () => {
    const said = searchReturning([]);
    const t = trigger({ event: "keyword", keyword: "Créer un ticket" });

    // Activation: nothing said yet since the trigger was switched on.
    expect(await t.next()).toBeNull();

    const at = minutesFromNow(10);
    said.data = [
      audio(1, "bon, je vais créer un TICKET pour ça", at),
      audio(2, "on en parle demain", minutesFromNow(10.5)),
    ];
    expect(await t.next()).toEqual([
      { mode: "keyword", matchedAt: at, text: "bon, je vais créer un TICKET pour ça", app: null, window: null },
    ]);

    // Same transcriptions on the next poll: no second event.
    expect(await t.next()).toBeNull();

    // A new match later fires again.
    const later = minutesFromNow(20);
    said.data = [...said.data, audio(3, "Créer un ticket Jira, s'il te plaît", later)];
    expect((await t.next())!.map((e) => e.matchedAt)).toEqual([later]);

    // Every poll reads audio transcriptions oldest first, from the cursor;
    // the cursor follows the newest transcription (minus a margin for late transcriptions).
    const starts = searches().map((r) => r.query.start_time);
    expect(searches().every((r) => r.query.content_type === "audio" && r.query.order === "ascending")).toBe(true);
    expect(searches().every((r) => r.authorization === `Bearer ${API_KEY}`)).toBe(true);
    expect(starts.length).toBe(4);
    expect(Date.parse(starts[2]!)).toBeGreaterThan(Date.parse(starts[1]!));
    expect(Date.parse(starts[3]!)).toBeGreaterThanOrEqual(Date.parse(starts[2]!));
    expect(Date.parse(starts[2]!)).toBeLessThan(Date.parse(at));
  });
});

describe("ScreenPipe Trigger: app or window becomes active", () => {
  test("fires when the focused window starts matching, not while it stays active", async () => {
    const screen = framesRecorded();
    screen.add(["Slack", "support - Slack"]);
    const t = trigger({ event: "window", appName: "chrome", windowName: "JIRA" });

    // Activation: Slack is in front, nothing fires.
    expect(await t.next()).toBeNull();

    // Switch to Jira (two frames while it stays in front): one event, for the switch.
    const switched = screen.add(["Google Chrome", "NOVA board - Jira"]);
    screen.add(["Google Chrome", "NOVA board - Jira"]);
    expect(await t.next()).toEqual([
      {
        mode: "window",
        matchedAt: switched.timestamp,
        text: "NOVA board - Jira screen text",
        app: "Google Chrome",
        window: "NOVA board - Jira",
      },
    ]);

    // Still on Jira: nothing.
    expect(await t.next()).toBeNull();
    screen.add(["Google Chrome", "NOVA-12 - Jira"]);
    expect(await t.next()).toBeNull();

    // Another app in front (Chrome on another site, then Slack), then back to Jira: fires again.
    screen.add(["Google Chrome", "Gmail"], ["Slack", "support - Slack"]);
    const back = screen.add(["Google Chrome", "NOVA board - Jira"]);
    expect((await t.next())!.map((e) => e.matchedAt)).toEqual([back.timestamp]);

    // Only the focused window's screen frames are read.
    expect(searches().every((r) => r.query.content_type === "ocr" && r.query.focused === "true")).toBe(true);
  });
});

describe("ScreenPipe Trigger: pipe runs", () => {
  test("fires once per new execution of the pipe, oldest first", async () => {
    const execution = (id: number, status: string, minutes: number) => ({
      id,
      pipe_name: "meeting-summary",
      status,
      trigger_type: "schedule",
      started_at: minutesFromNow(minutes),
      finished_at: null,
    });
    const history = [execution(41, "completed", 0)];
    api = fakeScreenpipe({ "/pipes/meeting-summary/executions": () => ({ body: { data: [...history].reverse() } }) });
    const t = trigger({ event: "pipe", pipeId: "meeting-summary" });

    // Activation: past runs do not fire.
    expect(await t.next()).toBeNull();

    history.push(execution(42, "running", 1));
    expect(await t.next()).toEqual([
      {
        mode: "pipe",
        matchedAt: history[1].started_at,
        text: "meeting-summary",
        app: null,
        window: null,
        executionId: 42,
        status: "running",
      },
    ]);

    // The same run finishing is not a new run.
    history[1] = { ...history[1], status: "completed" };
    expect(await t.next()).toBeNull();

    history.push(execution(43, "completed", 2), execution(44, "running", 3));
    expect((await t.next())!.map((e) => e.executionId)).toEqual([43, 44]);

    expect(api.requests.every((r) => r.query.include_output === "false")).toBe(true);
  });

  test("watching another pipe starts over from that pipe's latest run", async () => {
    const run = (pipe: string, id: number) => ({ id, pipe_name: pipe, status: "completed", started_at: minutesFromNow(id) });
    const runs: Record<string, ReturnType<typeof run>[]> = {
      "meeting-summary": [run("meeting-summary", 42)],
      "daily-digest": [run("daily-digest", 9), run("daily-digest", 7)],
    };
    api = fakeScreenpipe({
      "/pipes/meeting-summary/executions": () => ({ body: { data: runs["meeting-summary"] } }),
      "/pipes/daily-digest/executions": () => ({ body: { data: runs["daily-digest"] } }),
    });
    const parameters = { event: "pipe", pipeId: "meeting-summary" };
    const t = trigger(parameters);
    expect(await t.next()).toBeNull();

    // The user edits the trigger: the old pipe's cursor (42) does not apply.
    parameters.pipeId = "daily-digest";
    expect(await t.next()).toBeNull();
    runs["daily-digest"].unshift(run("daily-digest", 10));
    expect((await t.next())!.map((e) => e.executionId)).toEqual([10]);
  });
});

describe("ScreenPipe Trigger: Automation Flow runs", () => {
  const FLOW_ID = "wfSupportFlow001";
  function flowRunning() {
    const flow = { id: FLOW_ID, name: "Tickets support NOVA", status: "active", lastExecution: null as unknown };
    api = fakeScreenpipe({ [`/automation-flows/${FLOW_ID}`]: () => ({ body: flow }) });
    return flow;
  }

  test("fires when the Flow's last execution is a new one", async () => {
    const flow = flowRunning();
    flow.lastExecution = { status: "success", startedAt: minutesFromNow(-5) };
    const t = trigger({ event: "flow", flowId: FLOW_ID });

    // Activation: the run before it does not fire.
    expect(await t.next()).toBeNull();

    const startedAt = minutesFromNow(1);
    flow.lastExecution = { status: "running", startedAt };
    expect(await t.next()).toEqual([
      { mode: "flow", matchedAt: startedAt, text: "Tickets support NOVA", app: null, window: null, status: "running" },
    ]);

    // The same run finishing is not a new run.
    flow.lastExecution = { status: "success", startedAt };
    expect(await t.next()).toBeNull();

    expect(api!.requests.every((r) => r.path === `/automation-flows/${FLOW_ID}`)).toBe(true);
  });

  test("refuses to watch the workflow it belongs to (it would start itself forever)", async () => {
    flowRunning();
    const t = trigger({ event: "flow", flowId: FLOW_ID }, { workflowId: FLOW_ID });

    const error = await t.poll().catch((e) => e);

    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toContain("itself");
  });
});

describe("ScreenPipe Trigger: Fetch Test Event (manual mode)", () => {
  test("returns the latest matching event, whenever it happened, and leaves the cursor alone", async () => {
    const at = minutesFromNow(-90);
    searchReturning([audio(9, "il faut créer un ticket", at), audio(8, "créer un ticket aussi", minutesFromNow(-120))]);
    const t = trigger({ event: "keyword", keyword: "créer un ticket" }, { mode: "manual" });

    expect(await t.next()).toEqual([
      { mode: "keyword", matchedAt: at, text: "il faut créer un ticket", app: null, window: null },
    ]);
    expect(searches()[0].query).toMatchObject({ content_type: "audio", q: "créer un ticket" });
    expect(t.staticData).toEqual({});
  });

  test("with nothing to show yet, says what to do instead of returning nothing", async () => {
    api = fakeScreenpipe({ "/pipes/meeting-summary/executions": { body: { data: [] } } });

    const error = await trigger({ event: "pipe", pipeId: "meeting-summary" }, { mode: "manual" }).poll().catch((e) => e);

    expect(error).toBeInstanceOf(NodeOperationError);
    expect(error.message).toContain("meeting-summary");
  });
});

describe("ScreenPipe Trigger: errors", () => {
  test("an HTTP error fails the poll with ScreenPipe's message and keeps the cursor", async () => {
    const said = searchReturning([]);
    const t = trigger({ event: "keyword", keyword: "ticket" });
    await t.next();
    const cursor = structuredClone(t.staticData);

    api!.stop();
    api = fakeScreenpipe({ "/search": { status: 403, body: { error: "invalid or missing api key" } } });
    said.data = [audio(1, "ticket", minutesFromNow(1))];
    const error = await t.poll().catch((e) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.httpCode).toBe("403");
    expect(`${error.message} ${error.description}`).toContain("invalid or missing api key");
    expect(t.staticData).toEqual(cursor);
  });

  test("an error ScreenPipe reports with HTTP 200 (pipe routes do) also fails the poll", async () => {
    api = fakeScreenpipe({ "/pipes/nope/executions": { body: { error: "database is locked" } } });

    const error = await trigger({ event: "pipe", pipeId: "nope" }).poll().catch((e) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect(`${error.message} ${error.description}`).toContain("database is locked");
  });
});
