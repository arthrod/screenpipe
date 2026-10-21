// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import {
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type INodeExecutionData,
  type INodeParameters,
  type INodeType,
  type INodeTypeDescription,
  type IPollFunctions,
  type JsonObject,
} from "n8n-workflow";

/** Transcriptions can land in ScreenPipe after newer ones: each poll re-reads this far back. */
const LATE_TRANSCRIPTION_MS = 2 * 60_000;
const PAGE_SIZE = 200;
/** Screen text in an event is cut (by ScreenPipe) to this many characters. */
const MAX_TEXT_LENGTH = 500;

/** What every event carries, whatever started it. */
type TriggerEvent = { matchedAt: string; text: string; app: string | null; window: string | null } & IDataObject;

/**
 * Starts a workflow when something happens on the user's PC, as seen by
 * ScreenPipe: a keyword said aloud, an app or window coming to the front, a
 * pipe or an Automation Flow running. Deterministic (no AI): it polls
 * ScreenPipe's API and keeps a cursor in the node's static data so each event
 * fires once.
 */
export class ScreenPipeTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "ScreenPipe Trigger",
    name: "screenPipeTrigger",
    // Same icon as the ScreenPipe node (n8n resolves it next to the built file).
    icon: "file:../ScreenPipe/screenpipe.png",
    group: ["trigger"],
    version: 1,
    subtitle: '={{ $parameter["event"] }}',
    description: "Starts the workflow when a keyword is said, a window comes to the front, or a pipe or Flow runs",
    defaults: { name: "ScreenPipe Trigger" },
    polling: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "screenpipeApi", required: true }],
    properties: [
      {
        displayName: "Trigger On",
        name: "event",
        type: "options",
        noDataExpression: true,
        default: "keyword",
        options: [
          {
            name: "Keyword Said",
            value: "keyword",
            description: "A word or phrase appears in what ScreenPipe transcribed from the microphone or the speakers",
          },
          {
            name: "App or Window Becomes Active",
            value: "window",
            description: "The given app or window comes to the front",
          },
          {
            name: "Pipe Runs",
            value: "pipe",
            description: "A ScreenPipe pipe starts a run",
          },
          {
            name: "Automation Flow Runs",
            value: "flow",
            description: "Another Automation Flow starts a run",
          },
        ],
      },
      {
        displayName: "Keyword",
        name: "keyword",
        type: "string",
        default: "",
        required: true,
        placeholder: "create a ticket",
        description: "Word or phrase to listen for. Case and accents are ignored.",
        displayOptions: { show: { event: ["keyword"] } },
      },
      {
        displayName: "App Name",
        name: "appName",
        type: "string",
        default: "",
        placeholder: "Google Chrome",
        description: "Part of the app name. Case is ignored. Leave empty to match any app.",
        displayOptions: { show: { event: ["window"] } },
      },
      {
        displayName: "Window Title",
        name: "windowName",
        type: "string",
        default: "",
        placeholder: "Jira",
        description: "Part of the window title. Case is ignored. Leave empty to match any window of the app.",
        displayOptions: { show: { event: ["window"] } },
      },
      {
        displayName: "Pipe ID",
        name: "pipeId",
        type: "string",
        default: "",
        required: true,
        placeholder: "meeting-summary",
        description: "The pipe's ID, as listed in ScreenPipe's pipes",
        displayOptions: { show: { event: ["pipe"] } },
      },
      {
        displayName: "Flow ID",
        name: "flowId",
        type: "string",
        default: "",
        required: true,
        description: "ID of the Automation Flow's n8n workflow (the last part of its URL in n8n)",
        displayOptions: { show: { event: ["flow"] } },
      },
    ],
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const event = this.getNodeParameter("event") as string;
    const source = SOURCES[event];
    if (!source) throw new NodeOperationError(this.getNode(), `Unknown trigger event "${event}"`);
    const api = await connect(this);

    // "Fetch Test Event" in the editor: show the newest event, keep the cursor as is.
    if (this.getMode() === "manual") {
      const latest = await source.latest(this, api);
      if (!latest) throw new NodeOperationError(this.getNode(), source.nothingYet(this));
      return [[{ json: { mode: event, ...latest } }]];
    }

    // A cursor belongs to what it watched: after the user edits the trigger, start over.
    const state = this.getWorkflowStaticData("node");
    const watching = signature(this.getNode().parameters);
    const previous = state.watching === watching ? (state.cursor as IDataObject | undefined) : undefined;
    const { events, cursor } = await source.since(this, api, previous);
    state.watching = watching;
    state.cursor = cursor;
    if (events.length === 0) return null;
    return [events.map((e) => ({ json: { mode: event, ...e } }))];
  }
}

/** The trigger's settings, minus its poll schedule, in a stable order. */
function signature(parameters: INodeParameters): string {
  const { pollTimes: _schedule, ...watched } = parameters;
  return JSON.stringify(Object.entries(watched).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Event sources
// ---------------------------------------------------------------------------

type Source = {
  /**
   * Events after the cursor, oldest first, and the advanced cursor. Without a
   * cursor (activation) it only sets one: nothing from before fires.
   */
  since(ctx: IPollFunctions, api: Api, cursor: IDataObject | undefined): Promise<{ events: TriggerEvent[]; cursor: IDataObject }>;
  /** The newest event, whenever it happened. */
  latest(ctx: IPollFunctions, api: Api): Promise<TriggerEvent | null>;
  /** What the user can do when there is no event to show yet. */
  nothingYet(ctx: IPollFunctions): string;
};

const SOURCES: Record<string, Source> = {
  keyword: {
    since: (ctx, api, cursor) => keywordSaid(api, keywordOf(ctx), cursor as KeywordCursor | undefined),
    async latest(ctx, api) {
      const keyword = keywordOf(ctx);
      const page = await api.get("/search", { content_type: "audio", q: keyword, limit: 20 });
      const hit = contents(page).find((h) => containsKeyword(h, keyword));
      return hit ? keywordEvent(hit) : null;
    },
    nothingYet: (ctx) =>
      `No transcription contains "${keywordOf(ctx)}" yet: say it near a recorded microphone, ` +
      "wait a minute for ScreenPipe to transcribe it, then fetch again",
  },
  window: {
    since: (ctx, api, cursor) => windowBecameActive(api, windowMatcher(ctx), cursor as WindowCursor | undefined),
    async latest(ctx, api) {
      const matches = windowMatcher(ctx);
      const page = await api.get("/search", { ...FOCUSED_FRAMES, limit: 100 });
      const frame = contents(page).find(matches);
      return frame ? windowEvent(frame) : null;
    },
    nothingYet: () => "That app or window has not been in front recently: bring it to the front, then fetch again",
  },
  pipe: {
    since: (ctx, api, cursor) => pipeRan(api, idOf(ctx, "pipeId", "Pipe ID"), cursor as PipeCursor | undefined),
    async latest(ctx, api) {
      const pipeId = idOf(ctx, "pipeId", "Pipe ID");
      const [run] = await pipeRuns(api, pipeId, 1);
      return run ? pipeEvent(run, pipeId) : null;
    },
    nothingYet: (ctx) => `Pipe "${idOf(ctx, "pipeId", "Pipe ID")}" has not run yet: run it once in ScreenPipe, then fetch again`,
  },
  flow: {
    since: (ctx, api, cursor) => flowRan(api, flowIdOf(ctx), cursor as FlowCursor | undefined),
    async latest(ctx, api) {
      const flowId = flowIdOf(ctx);
      const flow = await api.get(`/automation-flows/${encodeURIComponent(flowId)}`);
      return flowEvent(flow, flowId);
    },
    nothingYet: (ctx) => `Flow "${flowIdOf(ctx)}" has not run yet: run it once in n8n, then fetch again`,
  },
};

// --- Keyword said ----------------------------------------------------------

type KeywordCursor = { newest: string; seen: string[] };

/**
 * New transcriptions that contain the keyword. The cursor is the newest
 * transcription seen (the activation time at first); each poll re-reads a
 * margin before it and skips the transcriptions already seen.
 */
async function keywordSaid(api: Api, keyword: string, previous: KeywordCursor | undefined) {
  const newest = previous?.newest ?? new Date().toISOString();
  const seen = new Set(previous?.seen ?? []);
  const from = new Date(Date.parse(newest) - LATE_TRANSCRIPTION_MS).toISOString();
  const hits = contents(
    await api.get("/search", { content_type: "audio", start_time: from, order: "ascending", limit: PAGE_SIZE }),
  );

  const events = previous
    ? hits.filter((hit) => !seen.has(transcriptionKey(hit)) && containsKeyword(hit, keyword)).map(keywordEvent)
    : [];
  const latest = hits.reduce((max, hit) => Math.max(max, Date.parse(String(hit.timestamp))), Date.parse(newest));
  const cursor: KeywordCursor = {
    newest: new Date(latest).toISOString(),
    seen: hits.filter((hit) => Date.parse(String(hit.timestamp)) >= latest - LATE_TRANSCRIPTION_MS).map(transcriptionKey),
  };
  return { events, cursor };
}

function keywordOf(ctx: IPollFunctions): string {
  const keyword = String(ctx.getNodeParameter("keyword", "")).trim();
  if (!normalize(keyword)) throw new NodeOperationError(ctx.getNode(), "Keyword is empty");
  return keyword;
}

function containsKeyword(hit: IDataObject, keyword: string): boolean {
  return normalize(transcription(hit)).includes(normalize(keyword));
}

function keywordEvent(hit: IDataObject): TriggerEvent {
  return { matchedAt: String(hit.timestamp), text: transcription(hit), app: null, window: null };
}

function transcription(hit: IDataObject): string {
  return String(hit.transcription ?? hit.text ?? "");
}

function transcriptionKey(hit: IDataObject): string {
  return `${hit.chunk_id}:${hit.start_time ?? hit.offset_index ?? ""}:${hit.timestamp}`;
}

// --- App or window becomes active -------------------------------------------

type WindowCursor = { frameId: number; timestamp: string; active: boolean };

/** Screen frames of the window in front (ScreenPipe captures the focused window). */
const FOCUSED_FRAMES = { content_type: "ocr", focused: true, max_content_length: MAX_TEXT_LENGTH };

/**
 * Walks the focused window's screen frames since the cursor (the last frame
 * read) and fires on each frame where the wanted app/window comes to the front.
 * At activation the cursor is the latest frame, so a window already in front
 * does not fire.
 */
async function windowBecameActive(
  api: Api,
  matches: (frame: IDataObject) => boolean,
  previous: WindowCursor | undefined,
) {
  const page = previous
    ? await api.get("/search", { ...FOCUSED_FRAMES, start_time: previous.timestamp, order: "ascending", limit: PAGE_SIZE })
    : await api.get("/search", { ...FOCUSED_FRAMES, limit: 1 });
  const frames = contents(page).filter((frame) => !previous || Number(frame.frame_id) > previous.frameId);

  const cursor: WindowCursor = previous
    ? { ...previous }
    : { frameId: 0, timestamp: new Date().toISOString(), active: false };
  const events: TriggerEvent[] = [];
  for (const frame of frames) {
    const active = matches(frame);
    if (previous && active && !cursor.active) events.push(windowEvent(frame));
    Object.assign(cursor, { frameId: Number(frame.frame_id), timestamp: String(frame.timestamp), active });
  }
  return { events, cursor };
}

/** App and window title filters, both optional, case- and accent-insensitive "contains". */
function windowMatcher(ctx: IPollFunctions): (frame: IDataObject) => boolean {
  const app = normalize(String(ctx.getNodeParameter("appName", "")));
  const window = normalize(String(ctx.getNodeParameter("windowName", "")));
  if (!app && !window) {
    throw new NodeOperationError(ctx.getNode(), "Set an app name, a window title, or both");
  }
  return (frame) =>
    normalize(String(frame.app_name ?? "")).includes(app) && normalize(String(frame.window_name ?? "")).includes(window);
}

function windowEvent(frame: IDataObject): TriggerEvent {
  return {
    matchedAt: String(frame.timestamp),
    text: String(frame.text ?? ""),
    app: String(frame.app_name ?? ""),
    window: String(frame.window_name ?? ""),
  };
}

// --- Pipe runs ---------------------------------------------------------------

type PipeCursor = { executionId: number };

/** New executions of the pipe (newer than the cursor, the last execution id seen). */
async function pipeRan(api: Api, pipeId: string, previous: PipeCursor | undefined) {
  const runs = (await pipeRuns(api, pipeId, previous ? 50 : 1)).reverse();
  const lastSeen = previous?.executionId ?? runs.reduce((max, run) => Math.max(max, Number(run.id)), 0);
  const fresh = previous ? runs.filter((run) => Number(run.id) > lastSeen) : [];
  const cursor: PipeCursor = { executionId: fresh.reduce((max, run) => Math.max(max, Number(run.id)), lastSeen) };
  return { events: fresh.map((run) => pipeEvent(run, pipeId)), cursor };
}

/** The pipe's latest executions, newest first, without their output. */
async function pipeRuns(api: Api, pipeId: string, limit: number): Promise<IDataObject[]> {
  const page = await api.get(`/pipes/${encodeURIComponent(pipeId)}/executions`, { limit, include_output: false });
  return ((page.data ?? []) as IDataObject[]).sort((a, b) => Number(b.id) - Number(a.id));
}

function pipeEvent(run: IDataObject, pipeId: string): TriggerEvent {
  return {
    matchedAt: String(run.started_at ?? new Date().toISOString()),
    text: String(run.pipe_name ?? pipeId),
    app: null,
    window: null,
    executionId: Number(run.id),
    status: String(run.status ?? ""),
  };
}

// --- Automation Flow runs ----------------------------------------------------

type FlowCursor = { startedAt: string | null };

/**
 * A new run of an Automation Flow, read from ScreenPipe's Flow record (its
 * last n8n execution). Several runs between two polls fire once, for the latest.
 */
async function flowRan(api: Api, flowId: string, previous: FlowCursor | undefined) {
  const flow = await api.get(`/automation-flows/${encodeURIComponent(flowId)}`);
  const event = flowEvent(flow, flowId);
  const cursor: FlowCursor = { startedAt: event?.matchedAt ?? previous?.startedAt ?? null };
  const isNew = previous && event && event.matchedAt !== previous.startedAt;
  return { events: isNew ? [event] : [], cursor };
}

function flowIdOf(ctx: IPollFunctions): string {
  const flowId = idOf(ctx, "flowId", "Flow ID");
  if (flowId === ctx.getWorkflow().id) {
    throw new NodeOperationError(ctx.getNode(), "A Flow cannot be started by itself: pick another Flow");
  }
  return flowId;
}

function flowEvent(flow: IDataObject, flowId: string): TriggerEvent | null {
  const last = flow.lastExecution as IDataObject | null | undefined;
  if (!last?.startedAt) return null;
  return {
    matchedAt: String(last.startedAt),
    text: String(flow.name ?? flowId),
    app: null,
    window: null,
    status: String(last.status ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function idOf(ctx: IPollFunctions, name: string, label: string): string {
  const id = String(ctx.getNodeParameter(name, "")).trim();
  if (!id) throw new NodeOperationError(ctx.getNode(), `${label} is empty`);
  return id;
}

/** The `content` of each /search hit. */
function contents(page: IDataObject): IDataObject[] {
  return ((page.data ?? []) as IDataObject[]).map((hit) => (hit.content ?? {}) as IDataObject);
}

/** Lower case, no accents, single spaces: "Créer  un Ticket" → "creer un ticket". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// ScreenPipe API
// ---------------------------------------------------------------------------

type Api = { get(path: string, qs?: IDataObject): Promise<IDataObject> };

async function connect(ctx: IPollFunctions): Promise<Api> {
  const credentials = await ctx.getCredentials("screenpipeApi");
  const baseUrl = String(credentials.baseUrl).replace(/\/+$/, "");
  const apiKey = String(credentials.apiKey ?? "");
  return {
    async get(path, qs = {}) {
      let response: { statusCode: number; body: unknown };
      try {
        response = await ctx.helpers.httpRequest({
          method: "GET",
          url: `${baseUrl}${path}`,
          qs,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          json: true,
          returnFullResponse: true,
          ignoreHttpStatusErrors: true,
        });
      } catch (error) {
        // Only the message: the raw client error can carry request headers (the API key).
        const reason = (error as Error).message;
        throw new NodeApiError(ctx.getNode(), { message: reason } as JsonObject, {
          message: `Cannot reach ScreenPipe at ${baseUrl}: is ScreenPipe running?`,
          description: reason,
        });
      }
      const body = response.body;
      const httpFailed = response.statusCode < 200 || response.statusCode >= 300;
      // The pipe routes answer their errors with HTTP 200 and `{ error }`.
      const reportedError = body && typeof body === "object" && typeof (body as IDataObject).error === "string";
      if (httpFailed || reportedError) {
        const detail =
          body && typeof body === "object" ? String((body as IDataObject).error ?? JSON.stringify(body)) : String(body ?? "");
        throw new NodeApiError(ctx.getNode(), (body && typeof body === "object" ? body : { detail }) as JsonObject, {
          message: httpFailed
            ? `ScreenPipe returned HTTP ${response.statusCode} for ${path}`
            : `ScreenPipe reported an error for ${path}`,
          description: detail,
          httpCode: httpFailed ? String(response.statusCode) : undefined,
        });
      }
      return (body ?? {}) as IDataObject;
    },
  };
}
