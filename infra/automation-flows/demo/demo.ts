// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Demo start: install the scripted Detected Task, then show the notification
// whose action opens its Task Page. Each capture of the Evidence points at the
// frame this machine recorded for it (local search API at SCREENPIPE_API_URL,
// key SCREENPIPE_LOCAL_API_KEY); a capture that is not found keeps its
// embedded key frame.
//   bun infra/automation-flows/demo/demo.ts              install + notify
//   bun infra/automation-flows/demo/demo.ts --no-notify  install only
//   bun infra/automation-flows/demo/demo.ts --embedded   install with the embedded key frames only (no lookup)
//   bun infra/automation-flows/demo/demo.ts --print      print a catalog holding only the task (browser mock, embedded)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDetectedTask, DEMO_RECORDING, DEMO_TASK_ID, EVIDENCE_CAPTURES, EVIDENCE_PATH, notificationPayload } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task";
import { findRecordedFrames } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/recorded-evidence";
import { catalogDir, readCatalog, upsertTask, writeCatalog } from "./catalog";

export { notificationPayload };

const NOTIFY_URL = process.env.SCREENPIPE_NOTIFY_URL ?? "http://localhost:11435/notify";
const SCREENPIPE_API_URL = process.env.SCREENPIPE_API_URL ?? "http://localhost:3030";

/** The app's `public/` folder serves the key frames at EVIDENCE_PATH. */
export const EVIDENCE_DIR = join(import.meta.dir, "../../../apps/screenpipe-app-tauri/public", EVIDENCE_PATH);

export function evidenceDataUrl(image: string): string {
  const bytes = readFileSync(join(EVIDENCE_DIR, `${image}.webp`));
  return `data:image/webp;base64,${bytes.toString("base64")}`;
}

/** The demo task, each capture pointing at this machine's recorder frame when one is found. */
export async function buildDemoTask(now: string, api: { url: string; key?: string }) {
  const evidence = await findRecordedFrames(EVIDENCE_CAPTURES, { ...api, window: DEMO_RECORDING });
  const frames = Object.fromEntries(evidence.flatMap(lookup => lookup.frame ? [[lookup.image, lookup.frame]] : []));
  return { task: buildDetectedTask(evidenceDataUrl, now, frames), evidence };
}

async function notify() {
  const response = await fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notificationPayload()),
  }).catch(() => null);
  if (!response) throw new Error(`ScreenPipe is not reachable at ${NOTIFY_URL}. Open the ScreenPipe app and retry.`);
  const result = await response.json().catch(() => ({})) as { message?: string };
  // Delivery gates answer 200 with a reason instead of showing the alert.
  if (!response.ok || result.message !== "Notification sent successfully") {
    const reason = result.message ?? `HTTP ${response.status}`;
    throw new Error(`Notification not shown: ${reason}. ${reason.includes("duplicate")
      ? "The same alert was shown less than 90 s ago; wait and retry."
      : "Check ScreenPipe Settings > Notifications (pipe notifications, pause, quiet hours)."}`);
  }
  console.log("Notification shown. Click “View task” to open the Task Page.");
}

function printEvidence(evidence: Awaited<ReturnType<typeof buildDemoTask>>["evidence"]) {
  const found = evidence.filter(lookup => lookup.frame).length;
  console.log(`Evidence: ${found}/${evidence.length} captures are frames recorded on this machine; the others keep their embedded key frame.`);
  for (const lookup of evidence) {
    console.log(lookup.frame
      ? `  ${lookup.image.padEnd(10)} frame ${lookup.frame.frameId} at ${lookup.frame.timestamp} (open screenpipe://frame/${lookup.frame.frameId})`
      : `  ${lookup.image.padEnd(10)} embedded: ${lookup.reason}`);
  }
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const now = new Date().toISOString();
  // The browser mock cannot load recorder frames: --print always embeds.
  if (args.has("--print")) {
    process.stdout.write(JSON.stringify(upsertTask(null, buildDetectedTask(evidenceDataUrl, now), now)));
    process.exit(0);
  }
  try {
    const { task, evidence } = args.has("--embedded")
      ? { task: buildDetectedTask(evidenceDataUrl, now), evidence: [] }
      : await buildDemoTask(now, { url: SCREENPIPE_API_URL, key: process.env.SCREENPIPE_LOCAL_API_KEY });
    if (evidence.length) printEvidence(evidence);
    const dir = catalogDir();
    const previous = readCatalog(dir);
    writeCatalog(dir, previous, upsertTask(previous, task, now));
    console.log(`Installed ${DEMO_TASK_ID} in ${join(dir, "catalog.json")}`);
    if (!args.has("--no-notify")) await notify();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
