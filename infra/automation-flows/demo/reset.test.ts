// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalog } from "./catalog";
import { resetDemo } from "./reset";

const KEY = "test-n8n-key";
const DEMO_TASK = "wf-novadesk-support-tickets";

type FakeWorkflow = { id: string; name: string; active: boolean; isArchived?: boolean; tags?: { name: string }[] };
type Refusal = { status: number; message: string };
type FakeExecution = { workflowId: string; status: string; finishAfterPolls?: number };

/** n8n 2.x public API as far as reset uses it. Refuses what n8n would refuse:
 * archiving or deleting a workflow that is switched on, and (strict) deleting
 * one that is not archived. */
function fakeN8n(initial: FakeWorkflow[], options: { strictArchive?: boolean; refuse?: Record<string, Refusal>; busyAfterUnpublish?: number; executions?: FakeExecution[] } = {}) {
  const workflows = new Map(initial.map(workflow => [workflow.id, { ...workflow }]));
  // n8n 2.x answers 409 to a delete while it is still unpublishing the workflow.
  const unpublishing = new Map<string, number>();
  const executions = (options.executions ?? []).map(execution => ({ ...execution }));
  let executionPolls = 0;
  const json = (status: number, body: unknown) => Response.json(body, { status });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (request.headers.get("X-N8N-API-KEY") !== KEY) return json(401, { message: "unauthorized" });
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/executions") {
        executionPolls += 1;
        const workflowId = url.searchParams.get("workflowId");
        // Each question brings a finishing execution closer to its end.
        for (const execution of executions) {
          if (execution.workflowId !== workflowId || execution.finishAfterPolls === undefined) continue;
          if (execution.finishAfterPolls <= 0) execution.status = "success";
          else execution.finishAfterPolls -= 1;
        }
        return json(200, { data: executions.filter(execution => execution.workflowId === workflowId), nextCursor: null });
      }
      const [, id, action] = url.pathname.match(/^\/api\/v1\/workflows(?:\/([^/]+))?(?:\/([^/]+))?$/) ?? [];
      const refusal = options.refuse?.[`${request.method} ${action ?? ""} ${id}`.replace("  ", " ")];
      if (refusal) return json(refusal.status, { message: refusal.message });
      if (!id && request.method === "GET") {
        const tag = url.searchParams.get("tags");
        return json(200, { data: [...workflows.values()].filter(w => !w.isArchived && (!tag || w.tags?.some(t => t.name === tag))), nextCursor: null });
      }
      const workflow = id ? workflows.get(id) : undefined;
      if (!workflow) return json(404, { message: "Not Found" });
      if (request.method === "GET" && !action) return json(200, workflow);
      if (request.method === "POST" && action === "unpublish") {
        workflow.active = false;
        unpublishing.set(workflow.id, options.busyAfterUnpublish ?? 0);
        return json(200, workflow);
      }
      if (request.method === "POST" && action === "archive") {
        if (workflow.active) return json(400, { message: "Workflow is active" });
        workflow.isArchived = true;
        return json(200, workflow);
      }
      if (request.method === "DELETE" && !action) {
        if (workflow.active) return json(400, { message: "Workflow is active" });
        const busy = unpublishing.get(workflow.id) ?? 0;
        if (busy > 0) {
          unpublishing.set(workflow.id, busy - 1);
          return json(409, { message: "Workflow is still being unpublished. Please try again in a few moments." });
        }
        if (options.strictArchive && !workflow.isArchived) return json(400, { message: "Workflow must be archived before it can be deleted." });
        workflows.delete(id!);
        return json(200, workflow);
      }
      return json(404, { message: "Not Found" });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, workflows, polls: () => executionPolls, stop: () => server.stop(true) };
}

const record = (sourceTaskId: string | null) => ({
  sourceTaskId, summary: "summary", answers: null, reviewedVersionId: null, activationLog: [], createdAt: "2026-10-17T06:00:00Z",
});

function dataDir(flows: Record<string, ReturnType<typeof record>>) {
  const dir = mkdtempSync(join(tmpdir(), "demo-reset-data-"));
  writeFileSync(join(dir, "automation-flows.json"), JSON.stringify({ flows }, null, 2));
  return dir;
}
const storedFlows = (dir: string) => JSON.parse(readFileSync(join(dir, "automation-flows.json"), "utf8")).flows;

function catalogDir(userCorrection: string | null = null) {
  const dir = mkdtempSync(join(tmpdir(), "demo-reset-catalog-"));
  const workflow = (id: string, answers: string | null) => ({ id, title: id, rank: 1, revision: 3, userCorrection: answers, stages: [] });
  writeFileSync(join(dir, "catalog.json"), JSON.stringify({
    schemaVersion: 5, revision: 7, analysis: { workflows: [workflow(DEMO_TASK, userCorrection), workflow("wf-other", "keep me")] },
  }));
  return dir;
}

let servers: { stop: () => void }[] = [];
afterEach(() => { servers.forEach(server => server.stop()); servers = []; });
function serve(...args: Parameters<typeof fakeN8n>) {
  const server = fakeN8n(...args);
  servers.push(server);
  return server;
}

describe("demo reset", () => {
  it("deletes the demo Flows from n8n and their records, and leaves other workflows alone", async () => {
    const n8n = serve([
      { id: "wfDemo000000001", name: "NovaDesk", active: false, tags: [{ name: "screenpipe-flow" }] },
      { id: "wfChat000000001", name: "Chat Flow", active: false, tags: [{ name: "screenpipe-flow" }] },
      { id: "wfOther00000001", name: "Not a Flow", active: true },
    ]);
    const data = dataDir({ wfDemo000000001: record(DEMO_TASK), wfChat000000001: record(null) });

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: data, catalogDir: catalogDir(), log: () => {},
    });

    expect(report.failures).toEqual([]);
    expect([...n8n.workflows.keys()]).toEqual(["wfChat000000001", "wfOther00000001"]);
    expect(n8n.workflows.get("wfOther00000001")!.active).toBe(true);
    expect(Object.keys(storedFlows(data))).toEqual(["wfChat000000001"]);
  });

  it("switches off an active demo Flow and the pre-imported copy, archives them, then deletes them", async () => {
    const n8n = serve([
      { id: "wfDemo000000001", name: "NovaDesk", active: true, tags: [{ name: "screenpipe-flow" }] },
      { id: "spNovaFlow000001", name: "NovaDesk (import script)", active: true, tags: [{ name: "screenpipe-flow" }] },
    ], { strictArchive: true });
    // A record whose workflow is already gone from n8n is cleaned up too.
    const data = dataDir({ wfDemo000000001: record(DEMO_TASK), wfGone000000001: record(DEMO_TASK) });
    const lines: string[] = [];

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: data, catalogDir: catalogDir(), log: line => lines.push(line),
    });

    expect(report.failures).toEqual([]);
    expect(n8n.workflows.size).toBe(0);
    expect(storedFlows(data)).toEqual({});
    expect(lines.join("\n")).toContain("spNovaFlow000001");
  });

  it("waits while n8n is still unpublishing a Flow, then deletes it instead of leaving it archived", async () => {
    const n8n = serve([
      { id: "spNovaFlow000001", name: "NovaDesk (import script)", active: true, tags: [{ name: "screenpipe-flow" }] },
    ], { strictArchive: true, busyAfterUnpublish: 2 });

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: catalogDir(), log: () => {},
    });

    expect(report.failures).toEqual([]);
    expect(n8n.workflows.size).toBe(0);
  });

  it("waits for the email n8n has taken before switching a Flow off, like the engine does", async () => {
    // `new` is an email the trigger counted before its execution started;
    // unpublishing mid-flight would lose it.
    const n8n = serve([
      { id: "spNovaFlow000001", name: "NovaDesk (import script)", active: true, tags: [{ name: "screenpipe-flow" }] },
    ], {
      strictArchive: true,
      executions: [{ workflowId: "spNovaFlow000001", status: "new", finishAfterPolls: 2 }],
    });
    const lines: string[] = [];

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: catalogDir(),
      runningWait: { interval: 10, deadline: 5_000 }, log: line => lines.push(line),
    });

    expect(report.failures).toEqual([]);
    expect(n8n.polls()).toBeGreaterThanOrEqual(3);
    expect(lines.join("\n")).not.toContain("still processing");
    expect(n8n.workflows.size).toBe(0);
  });

  it("warns when it switches a Flow off while n8n still processes an execution", async () => {
    const n8n = serve([
      { id: "spNovaFlow000001", name: "NovaDesk (import script)", active: true, tags: [{ name: "screenpipe-flow" }] },
    ], { strictArchive: true, executions: [{ workflowId: "spNovaFlow000001", status: "waiting" }] });
    const lines: string[] = [];

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: catalogDir(),
      runningWait: { interval: 10, deadline: 60 }, log: line => lines.push(line),
    });

    // The reset never blocks on a stuck execution, but says what it cut off.
    expect(report.failures).toEqual([]);
    expect(n8n.polls()).toBeGreaterThanOrEqual(2);
    expect(lines.join("\n")).toContain("spNovaFlow000001");
    expect(lines.join("\n")).toContain("still processing an execution");
    expect(lines.join("\n")).toContain("may be lost");
    expect(n8n.workflows.size).toBe(0);
  });

  it("clears the demo Task Page answers and keeps the other tasks' answers", async () => {
    const n8n = serve([]);
    const catalog = catalogDir("saved answers");

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: catalog, log: () => {},
    });

    expect(report.failures).toEqual([]);
    const answers = readCatalog(catalog)!.analysis.workflows.map(workflow => [workflow.id, workflow.userCorrection]);
    expect(answers).toEqual([[DEMO_TASK, null], ["wf-other", "keep me"]]);
  });

  it("reports a demo Flow n8n refuses to switch off, keeps its record, and still restores the rest", async () => {
    const n8n = serve([
      { id: "wfStuck00000001", name: "NovaDesk", active: true },
      { id: "wfDemo000000001", name: "NovaDesk 2", active: false },
    ], { refuse: { "POST unpublish wfStuck00000001": { status: 500, message: "database is locked" } } });
    const data = dataDir({ wfStuck00000001: record(DEMO_TASK), wfDemo000000001: record(DEMO_TASK) });
    const catalog = catalogDir("saved answers");

    const report = await resetDemo({ n8n: { url: n8n.url, apiKey: KEY }, dataDir: data, catalogDir: catalog, log: () => {} });

    expect(report.failures).toEqual([expect.stringContaining("wfStuck00000001")]);
    expect(report.failures[0]).toContain("database is locked");
    expect(n8n.workflows.get("wfStuck00000001")!.active).toBe(true);
    expect(Object.keys(storedFlows(data))).toEqual(["wfStuck00000001"]);
    expect(readCatalog(catalog)!.analysis.workflows[0].userCorrection).toBeNull();
  });

  it("reports a missing n8n key or an unreachable n8n, and keeps the Flow records", async () => {
    const data = dataDir({ wfDemo000000001: record(DEMO_TASK) });
    const options = { dataDir: data, catalogDir: catalogDir(), log: () => {} };

    const missing = await resetDemo({ ...options, n8n: null });
    const down = await resetDemo({ ...options, n8n: { url: "http://127.0.0.1:9", apiKey: KEY } });

    expect(missing.failures).toEqual([expect.stringContaining("N8N_API_KEY")]);
    expect(down.failures).toEqual([expect.stringContaining("cannot reach n8n at http://127.0.0.1:9")]);
    expect(Object.keys(storedFlows(data))).toEqual(["wfDemo000000001"]);
  });

  it("leaves an unreadable Flow store untouched and still removes the pre-imported copy", async () => {
    const n8n = serve([{ id: "spNovaFlow000001", name: "NovaDesk", active: false }]);
    const data = mkdtempSync(join(tmpdir(), "demo-reset-data-"));
    writeFileSync(join(data, "automation-flows.json"), "{ not json");

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: data, catalogDir: catalogDir(), log: () => {},
    });

    expect(report.failures).toEqual([expect.stringContaining("automation-flows.json")]);
    expect(readFileSync(join(data, "automation-flows.json"), "utf8")).toBe("{ not json");
    expect(n8n.workflows.size).toBe(0);
  });

  it("refuses a record id that is not an n8n workflow id instead of calling n8n with it", async () => {
    const n8n = serve([{ id: "wfOther00000001", name: "Not a Flow", active: true }]);
    const data = dataDir({ "../wfOther00000001": record(DEMO_TASK) });

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: data, catalogDir: catalogDir(), log: () => {},
    });

    expect(report.failures).toEqual([expect.stringContaining("not an n8n workflow id")]);
    expect(n8n.workflows.get("wfOther00000001")!.active).toBe(true);
    expect(Object.keys(storedFlows(data))).toEqual(["../wfOther00000001"]);
  });

  it("reports a missing Task Page catalog", async () => {
    const n8n = serve([]);

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: mkdtempSync(join(tmpdir(), "demo-reset-empty-")),
      log: () => {},
    });

    expect(report.failures).toEqual([expect.stringContaining("run the demo script first")]);
  });

  it("names the other Flows still in n8n, which it never touches", async () => {
    const n8n = serve([
      { id: "spNovaFlow000001", name: "NovaDesk", active: false, tags: [{ name: "screenpipe-flow" }] },
      { id: "wfChat000000001", name: "Résumé hebdo", active: true, tags: [{ name: "screenpipe-flow" }] },
    ]);
    const lines: string[] = [];

    const report = await resetDemo({
      n8n: { url: n8n.url, apiKey: KEY }, dataDir: dataDir({}), catalogDir: catalogDir(), log: line => lines.push(line),
    });

    expect(report.failures).toEqual([]);
    expect(lines).toContain("n8n: 1 other Flow(s) left untouched: wfChat000000001 (Résumé hebdo, active)");
    expect(n8n.workflows.get("wfChat000000001")!.active).toBe(true);
  });
});

async function spawn(argv: string[], env: Record<string, string>) {
  // A fresh cwd: Bun loads the `.env` of its working directory, and the repo
  // root's (the user's real n8n key) must never leak into the child.
  const cwd = mkdtempSync(join(tmpdir(), "demo-reset-cwd-"));
  const child = Bun.spawn(argv, { env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}

describe("bun infra/automation-flows/demo/reset.ts", () => {
  const cli = (env: Record<string, string>) =>
    spawn([process.execPath, join(import.meta.dir, "reset.ts")], { HOME: mkdtempSync(join(tmpdir(), "demo-reset-home-")), ...env });

  it("restores the start state and exits 0, never printing the n8n key", async () => {
    const n8n = serve([{ id: "wfDemo000000001", name: "NovaDesk", active: true, tags: [{ name: "screenpipe-flow" }] }], { strictArchive: true });
    const data = dataDir({ wfDemo000000001: record(DEMO_TASK) });
    const catalog = catalogDir("saved answers");

    const result = await cli({ N8N_API_KEY: KEY, N8N_API_URL: `${n8n.url}/`, SCREENPIPE_DATA_DIR: data, SCREENPIPE_WORKFLOWS_DIR: catalog });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("wfDemo000000001 (NovaDesk): switched off, archived, deleted");
    expect(result.stdout.trim().split("\n").at(-1)).toBe("Reset complete: no demo Flow, no saved answers.");
    // The Gmail Trigger only takes emails that arrive after its activation: the inbox needs no reset.
    expect(result.stdout).not.toMatch(/inbox|unread/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(KEY);
    expect(n8n.workflows.size).toBe(0);
    expect(storedFlows(data)).toEqual({});
    expect(readCatalog(catalog)!.analysis.workflows[0].userCorrection).toBeNull();
  });

  it("falls back to the n8n connection ScreenPipe saved in connections.json", async () => {
    const n8n = serve([{ id: "spNovaFlow000001", name: "NovaDesk", active: false }]);
    const data = dataDir({});
    writeFileSync(join(data, "connections.json"), JSON.stringify({
      n8n: { enabled: true, credentials: { api_url: `${n8n.url}/api/v1`, api_key: KEY } },
    }));
    const result = await cli({ SCREENPIPE_DATA_DIR: data, SCREENPIPE_WORKFLOWS_DIR: catalogDir() });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(n8n.workflows.size).toBe(0);
  });

  it("exits non-zero with every reason when a step cannot be restored", async () => {
    const result = await cli({ SCREENPIPE_DATA_DIR: dataDir({}), SCREENPIPE_WORKFLOWS_DIR: catalogDir() });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Reset incomplete");
    expect(result.stderr).toContain("N8N_API_KEY");
    expect(result.stdout).not.toContain("Reset complete");
  });
});
