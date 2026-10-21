// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Test harness: a fake ScreenPipe API (Bun.serve) and a minimal n8n execute
// context. The context mirrors what n8n 2.42.2 gives a node at run time:
// parameters, credentials, input items and `helpers.httpRequest`, whose
// semantics (qs, json, returnFullResponse, ignoreHttpStatusErrors) follow
// @n8n/backend-network's axios request.

import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  IPollFunctions,
} from "n8n-workflow";

export type RecordedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
  /** Every request header, lowercased names. */
  headers: Record<string, string>;
  /** Parsed JSON body (raw text if not JSON); absent when the request had none. */
  body?: unknown;
};

type Reply = { status?: number; body: unknown };

/** Local stand-in for ScreenPipe's HTTP API on a random port. */
export function fakeScreenpipe(routes: Record<string, Reply | ((req: RecordedRequest) => Reply)>) {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const recorded: RecordedRequest = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.get("authorization"),
        headers: Object.fromEntries(req.headers),
        ...(text ? { body: parseJson(text) } : {}),
      };
      requests.push(recorded);
      const route = routes[url.pathname];
      if (!route) return Response.json({ error: "not found" }, { status: 404 });
      const reply = typeof route === "function" ? route(recorded) : route;
      return Response.json(reply.body, { status: reply.status ?? 200 });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}

type ContextOptions = {
  parameters: Record<string, unknown>;
  credentials: { baseUrl: string; apiKey: string };
  items?: INodeExecutionData[];
  continueOnFail?: boolean;
  workflowId?: string;
  executionId?: string;
  /** Replaces `helpers.httpRequest`, e.g. to see a request to a host the test cannot reach. */
  httpRequest?: (request: IHttpRequestOptions) => Promise<unknown>;
};

/** Minimal `this` for `INodeType.execute`, backed by real HTTP. */
export function executeContext(options: ContextOptions): IExecuteFunctions {
  const items = options.items ?? [{ json: {} }];
  const node = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "ScreenPipe",
    type: "CUSTOM.screenPipe",
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: options.parameters as IDataObject,
  };
  const context = {
    getInputData: () => items,
    getNode: () => node,
    getWorkflow: () => ({ id: options.workflowId ?? "wfTest000000001", name: "Test workflow", active: true }),
    getExecutionId: () => options.executionId ?? "101",
    continueOnFail: () => options.continueOnFail ?? false,
    getNodeParameter(name: string, _itemIndex: number, fallback?: unknown) {
      const value = options.parameters[name];
      if (value === undefined) {
        if (arguments.length >= 3) return fallback;
        throw new Error(`Could not get parameter "${name}"`);
      }
      return value;
    },
    async getCredentials(type: string) {
      if (type !== "screenpipeApi") throw new Error(`unexpected credential type ${type}`);
      return { ...options.credentials };
    },
    helpers: { httpRequest: options.httpRequest ?? httpRequest },
  };
  return context as unknown as IExecuteFunctions;
}

type PollOptions = {
  parameters: Record<string, unknown>;
  credentials: { baseUrl: string; apiKey: string };
  /** "trigger" = the active workflow polling; "manual" = "Fetch Test Event" in the editor. */
  mode?: "trigger" | "manual";
};

/**
 * Minimal `this` for `INodeType.poll`. Call `poll` several times on the same
 * context to model successive polls: the node's static data persists between
 * them, as n8n saves it after each emitted run. Warnings logged by the node
 * are collected in `warnings`.
 */
export function pollContext(options: PollOptions): IPollFunctions & { warnings: string[] } {
  const staticData: IDataObject = {};
  const warnings: string[] = [];
  const node = {
    id: "00000000-0000-0000-0000-000000000002",
    name: "ScreenPipe Trigger",
    type: "CUSTOM.screenPipeTrigger",
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: options.parameters as IDataObject,
  };
  const context = {
    warnings,
    getMode: () => options.mode ?? "trigger",
    getNode: () => node,
    getNodeParameter(name: string, fallback?: unknown) {
      const value = options.parameters[name];
      if (value === undefined) {
        if (arguments.length >= 2) return fallback;
        throw new Error(`Could not get parameter "${name}"`);
      }
      return value;
    },
    async getCredentials(type: string) {
      if (type !== "screenpipeApi") throw new Error(`unexpected credential type ${type}`);
      return { ...options.credentials };
    },
    getWorkflowStaticData(type: string) {
      if (type !== "node") throw new Error(`unexpected static data type ${type}`);
      return staticData;
    },
    logger: {
      warn: (message: string) => warnings.push(message),
      error: (message: string) => warnings.push(message),
      info: () => {},
      debug: () => {},
    },
    helpers: { httpRequest },
  };
  return context as unknown as IPollFunctions & { warnings: string[] };
}

async function httpRequest(request: IHttpRequestOptions) {
  const url = new URL(request.url, request.baseURL);
  for (const [key, value] of Object.entries(request.qs ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const headers = new Headers(request.headers as Record<string, string> | undefined);
  if (request.json && !headers.has("accept")) headers.set("accept", "application/json");
  let sent: string | undefined;
  if (request.body !== undefined) {
    sent = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { method: request.method ?? "GET", headers, body: sent });
  const body = parseJson(await response.text());
  if (!request.ignoreHttpStatusErrors && (response.status < 200 || response.status >= 300)) {
    throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
      response: { status: response.status, data: body },
    });
  }
  if (request.returnFullResponse) {
    return { body, headers: Object.fromEntries(response.headers), statusCode: response.status, statusMessage: response.statusText };
  }
  return body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
