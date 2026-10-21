// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Scripted Detected Task for the Automation Flows demo (SPEC "Demo data",
// D8, D10). Evidence is key frames of the team's recording of 2026-10-17
// (starts 04:05:16 local, 02:05:16Z). Embedded images use negative frame IDs:
// they are pixels, never recorder frames (see workflows-ui `screenshots.ts`).
// A capture found in this machine's recordings (`recorded-evidence.ts`) uses
// its recorder frame instead, so the Task Page loads it live. Shared by the
// app's demo shortcut ⌃⌥⌘D (`../demo-shortcut.ts`) and `infra/automation-flows/demo`.
import type { WorkflowMap, WorkflowStage, WorkflowTimingRun } from "@screenpipe/workflows-ui";

export const DEMO_TASK_ID = "wf-novadesk-support-tickets";
export const DEMO_TASK_URL = `screenpipe://workflows?workflow=${DEMO_TASK_ID}&source=notification`;
/** The embedded key frames, `<name>.webp`: served by the app at this path, under `public/` in the repo. */
export const EVIDENCE_PATH = "/automation-flows/demo-evidence";

/**
 * Zero-width marks unique to `now` (to the tenth of a second, repeating after
 * ~7 minutes). The notification server drops the same title and body within
 * 90 s, and every ⌃⌥⌘D press must show the notification.
 */
function invisibleMark(now: number): string {
  return (Math.floor(now / 100) % 4096).toString(2).padStart(12, "0").replace(/0/g, "\u200B").replace(/1/g, "\u200C");
}

/** Same deeplink action shape as the native workflow notification (`notifications/workflow.rs`). */
export function notificationPayload(now = Date.now()) {
  return {
    // Unique per run: the route drops a repeated id ("Notification already sent").
    id: `automation-flows-demo:${DEMO_TASK_ID}:${now}`,
    title: "Repetitive task detected",
    body: `You turned 3 bug emails into NOVA Jira tickets. Answer 2 questions to automate it.${invisibleMark(now)}`,
    type: "pipe",
    priority: "normal",
    transient: false,
    autoDismissMs: 60_000,
    source_url: DEMO_TASK_URL,
    actions: [{ type: "deeplink", label: "View task", url: DEMO_TASK_URL, primary: true }],
  };
}

/** D10: the only Clarification Questions, verbatim. */
export const CLARIFICATION_QUESTIONS = [
  "Should improvement ideas (like NOVA-27) become tickets too?",
  "How do you choose the priority?",
];

/** Suggested answers on the Task Page; the first of each matches the 3 recorded tickets. */
export const QUESTION_CHOICES: Record<string, string[]> = {
  [CLARIFICATION_QUESTIONS[0]]: ["Yes, as a Task with priority Low", "No, only bugs become tickets"],
  [CLARIFICATION_QUESTIONS[1]]: ["Blocking = Highest, workaround = Medium, idea = Low", "Always Medium, I adjust by hand"],
};

type Capture = { image: string; at: string; app: "Gmail" | "Jira"; quote: string };
/** Where the quote shows on screen: the window title (an opened email) or the frame text. */
export type EvidenceCapture = Capture & { quoteIn: "window" | "text" };
/** A recorder frame: its ID and its exact recorder timestamp. */
export type RecordedFrame = { frameId: number; timestamp: string };

/** SPEC "Demo data": the three repetitions were recorded on 2026-10-17 between 04:00 and 04:20 local time. */
export const DEMO_RECORDING = { start: "2026-10-17T04:00:00+02:00", end: "2026-10-17T04:20:00+02:00" };

type Repetition = {
  name: string;
  description: string;
  email: Capture;
  form: Capture;
  ticket: Capture;
  procedure: { email: string; form: string; ticket: string };
};

const REPETITIONS: Repetition[] = [
  {
    name: "Repetition 1 · Arthur Noteris → NOVA-25 (Bug)",
    description: "The email \"Export des contacts vide dans NovaCRM\" becomes Bug NOVA-25, priority Highest, assigned to Nils Laeremans, label back.",
    email: { image: "r1-email", at: "2026-10-17T02:05:41Z", app: "Gmail", quote: "Export des contacts vide dans NovaCRM" },
    form: { image: "r1-form", at: "2026-10-17T02:08:01Z", app: "Jira", quote: "NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls)" },
    ticket: { image: "r1-ticket", at: "2026-10-17T02:08:36Z", app: "Jira", quote: "NOVA-25 NovaCRM - Export CSV des contacts filtres vide (en-tetes seuls)" },
    procedure: {
      email: "Read Arthur Noteris's email: the CSV export of contacts is empty, a blocking defect.",
      form: "Create a Bug in NOVA: title \"NovaCRM - …\", description taken from the email, Highest, Nils Laeremans, label back.",
      ticket: "Check the created ticket NOVA-25.",
    },
  },
  {
    name: "Repetition 2 · Loris Omont → NOVA-26 (Bug)",
    description: "The email \"NovaPay refuse les montants avec centimes\" becomes Bug NOVA-26, priority Medium (a workaround exists), assigned to Arthur Noteris, label back.",
    email: { image: "r2-email", at: "2026-10-17T02:09:41Z", app: "Gmail", quote: "NovaPay refuse les montants avec centimes" },
    form: { image: "r2-form", at: "2026-10-17T02:10:43Z", app: "Jira", quote: "NovaPay - Montant avec virgule refuse dans une note de frais" },
    ticket: { image: "r2-ticket", at: "2026-10-17T02:10:50Z", app: "Jira", quote: "NOVA-26 NovaPay - Montant avec virgule refuse dans une note de frais" },
    procedure: {
      email: "Read Loris Omont's email: an amount with a comma is refused; a dot works as a workaround.",
      form: "Create a Bug in NOVA: title \"NovaPay - …\", description taken from the email, Medium, Arthur Noteris, label back.",
      ticket: "Check the created ticket NOVA-26.",
    },
  },
  {
    name: "Repetition 3 · Nils L. → NOVA-27 (Task)",
    description: "The idea \"filtrer les clients par date de dernière relance\" becomes Task NOVA-27, priority Low, assigned to Arthur Noteris, label front, requested by Nils Laeremans.",
    email: { image: "r3-email", at: "2026-10-17T02:12:56Z", app: "Gmail", quote: "Idée : filtrer les clients par date de dernière relance" },
    form: { image: "r3-form", at: "2026-10-17T02:14:02Z", app: "Jira", quote: "NovaCRM - Filtre \"Derniere relance\" enregistrable dans la liste clients" },
    ticket: { image: "r3-ticket", at: "2026-10-17T02:15:11Z", app: "Jira", quote: "NOVA-27 NovaCRM - Filtre \"Derniere relance\" enregistrable dans la liste clients" },
    procedure: {
      email: "Read Nils L.'s email: not a defect but an improvement idea.",
      form: "Create a Task in NOVA: title \"NovaCRM - …\", description taken from the email, Low, Arthur Noteris, label front.",
      ticket: "Fill in the requester (Nils Laeremans) on the created ticket NOVA-27.",
    },
  },
];

export const EVIDENCE_CAPTURES: EvidenceCapture[] = REPETITIONS.flatMap(r => [
  { ...r.email, quoteIn: "window" as const }, { ...r.form, quoteIn: "text" as const }, { ...r.ticket, quoteIn: "text" as const },
]);
export const EVIDENCE_IMAGES = EVIDENCE_CAPTURES.map(capture => capture.image);

const minutes = (run: WorkflowTimingRun) =>
  (Date.parse(run.end.timestamp) - Date.parse(run.start.timestamp)) / 60_000;

function timingOf(runs: WorkflowTimingRun[]) {
  const values = runs.map(minutes);
  return {
    basis: "estimated-elapsed" as const,
    sampleCount: runs.length,
    averageMinutes: values.reduce((sum, value) => sum + value, 0) / values.length,
    minMinutes: Math.min(...values),
    maxMinutes: Math.max(...values),
    runs,
  };
}

/** `dataUrl(name)` returns the embedded image for `evidence/<name>.webp`.
 * `recorded[name]` replaces that image, and its time, with a recorder frame. */
export function buildDetectedTask(dataUrl: (image: string) => string, now: string,
  recorded: Partial<Record<string, RecordedFrame>> = {}): WorkflowMap {
  let embeddedId = 0;
  const stages: WorkflowStage[] = REPETITIONS.map(repetition => {
    const captures = [repetition.email, repetition.form, repetition.ticket].map(capture => {
      const frame = recorded[capture.image];
      const embedded = --embeddedId;
      return { ...capture, at: frame?.timestamp ?? capture.at, frame, embedded };
    });
    const [email, form, ticket] = captures;
    const run: WorkflowTimingRun = {
      start: { timestamp: email.at, app: email.app, quote: email.quote },
      end: { timestamp: ticket.at, app: ticket.app, quote: ticket.quote },
      summary: repetition.description,
    };
    return {
      name: repetition.name,
      description: repetition.description,
      activeMinutes: 0,
      waitingMinutes: 0,
      apps: ["Gmail", "Jira"],
      confidence: 0.9,
      observedOccurrences: 1,
      observedDays: 1,
      timing: timingOf([run]),
      evidence: captures.map(capture => ({ timestamp: capture.at, app: capture.app, detail: capture.quote, source: "screen" })),
      // A recorder frame has the shape the engine attaches (`workflow_catalog.rs`): no pixels.
      screenshots: captures.map(capture => ({
        frameId: capture.frame?.frameId ?? capture.embedded,
        timestamp: capture.at,
        app: capture.app,
        matchDistanceSeconds: 0,
        visualVerified: true,
        dataUrl: capture.frame ? "" : dataUrl(capture.image),
      })),
      procedure: [
        { kind: "input", text: repetition.procedure.email, quote: email.quote, timestamp: email.at, app: email.app },
        { kind: "action", text: repetition.procedure.form, quote: form.quote, timestamp: form.at, app: form.app },
        { kind: "output", text: repetition.procedure.ticket, quote: ticket.quote, timestamp: ticket.at, app: ticket.app },
      ],
    };
  });
  const evidence = stages.flatMap(stage => stage.evidence);
  return {
    id: DEMO_TASK_ID,
    // Explicit provenance: scripted demo data, never a genuine detection.
    // The Task Page renders it as a badge and the review-notification loop
    // skips demo-marked entries.
    demo: true,
    revision: 1,
    rank: 1,
    analysisDays: 90,
    title: "Turn bug emails into Jira tickets",
    description: "For each support email that reports a bug or suggests an improvement, you create a ticket in the Jira project NOVA: title \"<Product> - <short summary>\", Bug for a defect or Task for an idea, a description taken from the email, priority and a back or front label.",
    repetitions: REPETITIONS.length,
    frequency: "",
    trigger: "A bug or improvement-idea email arrives in servicedesk.novadesk@gmail.com.",
    outcome: "A NOVA ticket with the right type, the title \"<Product> - <summary>\", the priority and the label.",
    totalMinutes: 0,
    activeMinutes: 0,
    waitingMinutes: 0,
    durationSource: "unknown",
    timing: timingOf(stages.map(stage => stage.timing!.runs[0])),
    appSwitches: 0,
    confidence: 0.9,
    apps: ["Gmail", "Jira"],
    people: ["Arthur Noteris", "Loris Omont", "Nils Laeremans"],
    handoffs: [],
    variations: ["An improvement idea (NOVA-27) becomes a Task with priority Low, with the requester filled in."],
    stages,
    bottlenecks: [],
    evidence,
    openQuestions: CLARIFICATION_QUESTIONS,
    openQuestionChoices: QUESTION_CHOICES,
    userCorrection: null,
    catalogStatus: "current",
    lastReviewedAt: now,
    quality: {
      grade: "good",
      evidenceCount: evidence.length,
      distinctDays: 1,
      stageEvidenceCoverage: 100,
      repeatedStageCoverage: 100,
      screenshotCount: EVIDENCE_CAPTURES.length,
      stageScreenshotCoverage: 100,
      reasons: ["Three repetitions seen on October 17, 2026"],
    },
  };
}
