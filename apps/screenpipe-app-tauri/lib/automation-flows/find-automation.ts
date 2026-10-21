// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// The demo installer behind the hidden shortcut ⌃⌥⌘D (`demo-shortcut.ts`).
// Demo contract (AGENTS.md, Hackathon mode): no detection runs; finding
// repeated work installs the scripted Detected Task, its captures pointing at this
// machine's recorder frames when found, then sends the notification whose
// "View task" opens its Task Page. Same result as
// `infra/automation-flows/demo/demo.ts`, without a terminal.
import { appServerFetch } from "@/lib/notifications/app-server";
import { localFetch } from "@/lib/api";
import { upsertTask, type Catalog } from "./demo-task/catalog";
import {
  buildDetectedTask,
  DEMO_RECORDING,
  DEMO_TASK_URL,
  EVIDENCE_CAPTURES,
  EVIDENCE_PATH,
  notificationPayload,
} from "./demo-task/detected-task";
import { findRecordedFrames } from "./demo-task/recorded-evidence";

export type FindAutomationDeps = {
  now: () => Date;
  /** The local search API, for the recorder frames of the captures. */
  search: (url: string, init: RequestInit) => Promise<Response>;
  /** `data:` URL of the embedded key frame `<image>.webp`. */
  loadImage: (image: string) => Promise<string>;
  loadCatalog: () => Promise<Catalog | null>;
  saveCatalog: (catalog: Catalog) => Promise<void>;
  /** POST /notify on the app's notification server; rejects, with the reason, when it cannot be asked. */
  notify: (payload: ReturnType<typeof notificationPayload>) => Promise<Response>;
};

/** `notified: false` carries the reason the notification server gave (or why it was not asked). */
export type FindAutomationResult = { notified: true } | { notified: false; reason: string };

export async function findAutomation(deps: FindAutomationDeps): Promise<FindAutomationResult> {
  const now = deps.now();
  const lookups = await findRecordedFrames(EVIDENCE_CAPTURES, { url: "", window: DEMO_RECORDING, fetch: deps.search });
  const frames = Object.fromEntries(lookups.flatMap(lookup => lookup.frame ? [[lookup.image, lookup.frame]] : []));
  // Only the captures this machine did not record need their embedded key frame.
  const embedded = new Map(await Promise.all(lookups.filter(lookup => !lookup.frame)
    .map(async lookup => [lookup.image, await deps.loadImage(lookup.image)] as const)));
  const task = buildDetectedTask(image => embedded.get(image) ?? "", now.toISOString(), frames);
  // An unreadable catalog throws here and is never overwritten.
  await deps.saveCatalog(upsertTask(await deps.loadCatalog(), task, now.toISOString()));

  let response: Response;
  try {
    response = await deps.notify(notificationPayload(now.getTime()));
  } catch (error) {
    return { notified: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const result = await response.json().catch(() => ({})) as { message?: string; outcome?: string };
  // Delivery gates (duplicate within 90 s, pause, quiet hours) answer 200 with a reason.
  // The machine-readable `outcome` decides when the server sends one; older
  // servers are read through the pinned "Notification sent successfully" copy.
  const shown = response.ok && (result.outcome !== undefined
    ? result.outcome === "shown"
    : result.message === "Notification sent successfully");
  if (!shown) {
    return { notified: false, reason: result.message ?? `HTTP ${response.status}` };
  }
  return { notified: true };
}

/** What the notification's "View task" does: the Task Page of the demo task. */
export async function openDemoTaskPage(): Promise<void> {
  const { routeNotificationDeeplink } = await import("@/lib/notifications/actions");
  await routeNotificationDeeplink(DEMO_TASK_URL);
}

async function evidenceDataUrl(image: string): Promise<string> {
  const response = await fetch(`${EVIDENCE_PATH}/${image}.webp`);
  if (!response.ok) throw new Error(`Evidence image ${image} not found (HTTP ${response.status}).`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Evidence image ${image} is unreadable.`));
    reader.readAsDataURL(blob);
  });
}

// The browser mock's Workflows view reads its catalog from this key
// (workflows-ui `createFixtureWorkflowsPlatform`).
const MOCK_CATALOG_KEY = "screenpipe:fictional-workflow-editor-preview";

/** The app's wiring: the same catalog file the engine serves, and the app's notification server. */
export function desktopFindAutomationDeps(): FindAutomationDeps {
  const mock = process.env.NEXT_PUBLIC_SCREENPIPE_WEB_DEV === "mock";
  return {
    now: () => new Date(),
    search: (url, init) => localFetch(url, init),
    loadImage: evidenceDataUrl,
    loadCatalog: async () => {
      if (!mock) return (await import("@/lib/workflows/disk-storage")).loadWorkflowAnalysisFromDisk();
      const raw = window.localStorage.getItem(MOCK_CATALOG_KEY);
      return raw ? JSON.parse(raw) as Catalog : null;
    },
    saveCatalog: async (catalog) => {
      if (!mock) return (await import("@/lib/workflows/disk-storage")).saveWorkflowAnalysisToDisk(catalog);
      window.localStorage.setItem(MOCK_CATALOG_KEY, JSON.stringify(catalog));
    },
    notify: async (payload) => {
      // `bun run dev:web` must never reach the notification server of a
      // ScreenPipe app running on this machine.
      if (process.env.NEXT_PUBLIC_SCREENPIPE_WEB_DEV) {
        throw new Error("no notification in the browser dev loop");
      }
      return appServerFetch("/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        throw new Error("Screenpipe's notification server does not answer");
      });
    },
  };
}
