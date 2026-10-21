// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Demo reset: bring the demo machine back to the state before the first click,
// so rehearsals repeat. It
// - switches off and deletes in n8n every Flow created from the demo task
//   (its records in `<data dir>/automation-flows.json`) and the copy
//   `import-workflow.sh` installs (the bundled workflow's fixed id), then
//   removes their records: the Flows list is empty and "Créer
//   l'automatisation" creates the Flow again. Other workflows are never touched;
// - clears the Task Page answers.
// The inbox needs no reset: the Flow's Gmail Trigger only takes the emails
// that arrive after its activation, read or unread.
// It prints what it did and exits 1, with every reason, on anything it could
// not restore.
//
//   N8N_API_KEY=… bun infra/automation-flows/demo/reset.ts
//
// N8N_API_KEY: the n8n API key; without it, the key of ScreenPipe's n8n
// connection when it is saved in `<data dir>/connections.json` (the app keeps
// it in its encrypted secret store otherwise). Never printed. N8N_API_URL
// (default: the connection's, else http://localhost:5678), SCREENPIPE_DATA_DIR
// (default ~/.screenpipe), SCREENPIPE_WORKFLOWS_DIR (see catalog.ts).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { catalogDir, clearAnswers, readCatalog, writeCatalog } from "./catalog";
import { DEMO_TASK_ID } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task";

const STORE_FILE = "automation-flows.json";
const FLOW_TAG = "screenpipe-flow"; // engine `FLOW_TAG`
// The bundled demo workflow (the engine's from-task fixture).
const WORKFLOW = JSON.parse(readFileSync(join(import.meta.dir, "..", "workflows", "novadesk-support-tickets.json"), "utf8"));
/** The copy `import-workflow.sh` installs keeps the bundled workflow's fixed id. */
export const DEMO_WORKFLOW_ID: string = WORKFLOW.id;

export type N8nConfig = { url: string; apiKey: string };
export type ResetOptions = {
  n8n: N8nConfig | null;
  /** ScreenPipe data dir, holding the engine's `automation-flows.json`. */
  dataDir: string;
  /** Workflow catalog dir (`catalog.ts`), holding the Task Page answers. */
  catalogDir: string;
  log: (line: string) => void;
  /** How long to wait, before switching a Flow off, for the execution n8n is
   * processing (the engine's `RunningWait`, at the real pace). */
  runningWait?: { interval: number; deadline: number };
};
export type ResetReport = { failures: string[] };

type FlowStore = { flows?: Record<string, { sourceTaskId?: string | null }> };
type N8nWorkflow = { id: string; name?: string; active?: boolean; isArchived?: boolean };
type N8nCall = (method: string, path: string) => Promise<{ status: number; body: any }>;

function n8nClient({ url, apiKey }: N8nConfig): N8nCall {
  return async (method, path) => {
    const response = await fetch(`${url}/api/v1${path}`, {
      method, headers: { "X-N8N-API-KEY": apiKey }, signal: AbortSignal.timeout(15_000),
    }).catch(error => { throw new Error(`cannot reach n8n at ${url} (${error instanceof Error ? error.message : error})`); });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
}

const ok = (status: number) => status >= 200 && status < 300;
const answer = ({ status, body }: { status: number; body: any }) =>
  `n8n answered ${status}${body?.message ? `: ${body.message}` : ""}`;

/** DELETE, waiting while n8n answers 409 because it is still unpublishing the
 * workflow (n8n 2.x does that for a moment after `unpublish`). */
async function deleteWhenUnpublished(n8n: N8nCall, id: string) {
  let deleted = await n8n("DELETE", `/workflows/${id}`);
  for (let attempt = 1; deleted.status === 409 && attempt <= 20; attempt++) {
    await new Promise(done => setTimeout(done, 500));
    deleted = await n8n("DELETE", `/workflows/${id}`);
  }
  return deleted;
}

/** An execution n8n has taken but not finished (the engine's one status
 * mapping): a `running` one, an email the trigger counted before its execution
 * started (`new`), or one a Wait node holds (`waiting`). */
const beingProcessed = (execution: { status?: string }) =>
  ["running", "new", "waiting"].includes(execution.status ?? "");

/** Waits, bounded like the engine's `RunningWait`, while n8n processes an
 * execution of the workflow: unpublishing mid-flight would lose its email.
 * Answers whether something was still running when it gave up waiting. */
async function waitWhileProcessing(
  n8n: N8nCall,
  id: string,
  wait: { interval: number; deadline: number },
): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const listed = await n8n("GET", `/executions?workflowId=${id}&limit=100`);
    if (!ok(listed.status)) return false; // cannot ask: never block the reset on it
    if (!(listed.body?.data ?? []).some(beingProcessed)) return false;
    if (Date.now() - started >= wait.deadline) return true;
    await new Promise(done => setTimeout(done, wait.interval));
  }
}

/** Switches a workflow off, then deletes it (archiving first when n8n asks for
 * it). Returns what it did; throws with n8n's reason when it is still there. */
async function removeWorkflow(n8n: N8nCall, id: string, wait: { interval: number; deadline: number }): Promise<string> {
  // Same rule as the engine's `valid_workflow_id`: never splice a path into the URL.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`${JSON.stringify(id)} is not an n8n workflow id; left untouched`);
  const found = await n8n("GET", `/workflows/${id}`);
  if (found.status === 404) return `${id} is not in n8n (already removed)`;
  if (!ok(found.status)) throw new Error(`cannot read ${id}: ${answer(found)}`);
  const workflow = found.body as N8nWorkflow;
  const done: string[] = [];
  if (workflow.active) {
    const cutOff = await waitWhileProcessing(n8n, id, wait);
    const off = await n8n("POST", `/workflows/${id}/unpublish`);
    if (!ok(off.status)) throw new Error(`cannot switch off ${id}: ${answer(off)}`);
    done.push(cutOff
      ? "switched off (it was still processing an execution: the email it held may be lost)"
      : "switched off");
  }
  let deleted = await deleteWhenUnpublished(n8n, id);
  if (!ok(deleted.status) && deleted.status !== 404 && !workflow.isArchived) {
    // n8n 2.x deletes only archived workflows.
    const archived = await n8n("POST", `/workflows/${id}/archive`);
    if (!ok(archived.status)) throw new Error(`cannot archive ${id}: ${answer(archived)} (delete: ${answer(deleted)})`);
    done.push("archived");
    deleted = await deleteWhenUnpublished(n8n, id);
  }
  if (!ok(deleted.status) && deleted.status !== 404) throw new Error(`cannot delete ${id}: ${answer(deleted)}`);
  const after = await n8n("GET", `/workflows/${id}`);
  if (after.status !== 404) throw new Error(`${id} is still in n8n after delete (${answer(after)})`);
  done.push("deleted");
  return `${id} (${workflow.name ?? "unnamed"}): ${done.join(", ")}`;
}

/** The engine's Flow records (`automation_flows.rs`); a missing file has none. */
function loadStore(path: string): FlowStore {
  if (!existsSync(path)) return {};
  try {
    const store = JSON.parse(readFileSync(path, "utf8")) as FlowStore;
    if (typeof store === "object" && store !== null && (store.flows === undefined || typeof store.flows === "object")) return store;
  } catch {
    // Reported below.
  }
  throw new Error(`${path} is not a valid ${STORE_FILE}; it was left untouched`);
}

function clearTaskAnswers(dir: string): string {
  const previous = readCatalog(dir);
  if (!previous) throw new Error(`no workflow catalog in ${dir}; run the demo script first`);
  const { catalog, changed } = clearAnswers(previous);
  if (changed) writeCatalog(dir, previous, catalog);
  return changed
    ? `cleared the answers of ${DEMO_TASK_ID} in ${join(dir, "catalog.json")}`
    : `${DEMO_TASK_ID} has no saved answers`;
}

/** Every step runs even when an earlier one fails; each failure is reported. */
export async function resetDemo(options: ResetOptions): Promise<ResetReport> {
  const failures: string[] = [];
  const fail = (name: string, error: unknown) => {
    const reason = `${name}: ${error instanceof Error ? error.message : String(error)}`;
    failures.push(reason);
    options.log(`FAILED ${reason}`);
  };
  const step = async (name: string, action: () => Promise<string> | string) => {
    try {
      options.log(`${name}: ${await action()}`);
    } catch (error) {
      fail(name, error);
    }
  };

  const storePath = join(options.dataDir, STORE_FILE);
  let store: FlowStore | null;
  try {
    store = loadStore(storePath);
  } catch (error) {
    store = null;
    fail("records", error);
  }
  const demoIds = Object.entries(store?.flows ?? {})
    .filter(([, record]) => record.sourceTaskId === DEMO_TASK_ID)
    .map(([id]) => id);

  const gone: string[] = [];
  let n8n: N8nCall | null = null;
  try {
    if (!options.n8n) throw new Error("no n8n API key: export N8N_API_KEY (the key saved in ScreenPipe > Connections > n8n)");
    const client = n8nClient(options.n8n);
    const probe = await client("GET", "/workflows?limit=1");
    if (!ok(probe.status)) throw new Error(`n8n at ${options.n8n.url} refused the request (${answer(probe)})`);
    n8n = client;
    options.log(`n8n: connected to ${options.n8n.url}`);
  } catch (error) {
    fail("n8n", error);
  }
  for (const id of new Set([...demoIds, DEMO_WORKFLOW_ID])) {
    if (!n8n) break;
    const client = n8n;
    const wait = options.runningWait ?? { interval: 1_000, deadline: 90_000 };
    await step("n8n", async () => {
      const done = await removeWorkflow(client, id, wait);
      gone.push(id);
      return done;
    });
  }

  if (n8n) {
    const client = n8n;
    await step("n8n", async () => {
      const listed = await client("GET", `/workflows?tags=${FLOW_TAG}&limit=250`);
      if (!ok(listed.status)) throw new Error(`cannot list the Flows: ${answer(listed)}`);
      const others = (listed.body?.data ?? []) as N8nWorkflow[];
      if (others.length === 0) return "the Flows list is empty";
      const names = others.map(w => `${w.id} (${w.name ?? "unnamed"}, ${w.active ? "active" : "off"})`);
      return `${others.length} other Flow(s) left untouched: ${names.join(", ")}`;
    });
  }

  if (store) {
    const current = store;
    await step("records", () => {
      const removed = Object.keys(current.flows ?? {}).filter(id => gone.includes(id));
      if (removed.length === 0) return "no demo Flow record to remove";
      const flows = Object.fromEntries(Object.entries(current.flows ?? {}).filter(([id]) => !removed.includes(id)));
      // Same format and atomic replace as the engine's `FlowStore::save`.
      const tmp = `${storePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...current, flows }, null, 2));
      renameSync(tmp, storePath);
      return `removed ${removed.join(", ")} from ${storePath}`;
    });
  }

  await step("answers", () => clearTaskAnswers(options.catalogDir));
  return { failures };
}

/** The n8n instance root from what the user typed (connector `n8n::instance_url`). */
const instanceUrl = (raw: string) => raw.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "").replace(/\/+$/, "");

/** N8N_API_KEY / N8N_API_URL, else ScreenPipe's n8n connection when it is saved
 * in the legacy `connections.json` (`load_connection`'s file fallback). */
export function n8nConfig(env: Record<string, string | undefined>, dataDir: string): N8nConfig | null {
  let saved: { api_url?: string; api_key?: string } = {};
  try {
    const connection = JSON.parse(readFileSync(join(dataDir, "connections.json"), "utf8")).n8n;
    if (connection?.enabled) saved = connection.credentials ?? {};
  } catch {
    // No saved connection.
  }
  const apiKey = env.N8N_API_KEY?.trim() || saved.api_key?.trim();
  if (!apiKey) return null;
  return { url: instanceUrl(env.N8N_API_URL?.trim() || saved.api_url || "http://localhost:5678"), apiKey };
}

if (import.meta.main) {
  try {
    const dataDir = process.env.SCREENPIPE_DATA_DIR || join(homedir(), ".screenpipe");
    const { failures } = await resetDemo({
      n8n: n8nConfig(process.env, dataDir),
      dataDir,
      catalogDir: catalogDir(),
      log: line => console.log(line),
    });
    if (failures.length > 0) {
      console.error(`Reset incomplete, ${failures.length} step(s) not restored:\n${failures.map(f => `- ${f}`).join("\n")}`);
      process.exit(1);
    }
    console.log("Reset complete: no demo Flow, no saved answers.");
  } catch (error) {
    console.error(`Reset incomplete: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
