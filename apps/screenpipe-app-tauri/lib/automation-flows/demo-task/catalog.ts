// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Installs the scripted Detected Task into a workflow catalog (the
// desktop-owned file the engine serves at GET /workflows/catalog). Pure: the
// app and `infra/automation-flows/demo` each read and write the file their way.
import type { AnalysisQuality, WorkflowAnalysis, WorkflowMap } from "@screenpipe/workflows-ui";

export type Catalog = WorkflowAnalysis & { revision?: number };

const EMPTY_QUALITY: AnalysisQuality = {
  grade: "limited", usableDays: 0, requestedDays: 90, capturedMinutes: 0, totalFrames: 0,
  appAttributionCoverage: 0, parsedContextCount: 0, verifiedEvidenceCount: 0,
  screenshotCount: 0, screenshotCoverage: 0, warnings: [],
};

/** Install or reinstall the scripted task in its initial state (no answers). */
export function upsertTask(previous: Catalog | null, task: WorkflowMap, now: string): Catalog {
  const base: Catalog = previous ?? {
    schemaVersion: 5, revision: 0, analysis: { workflows: [] }, analyzedAt: now, days: 90,
    source: "screenpipe", bundleCount: 0, observedActiveMinutes: 0, quality: EMPTY_QUALITY,
  };
  const prior = base.analysis.workflows.find(workflow => workflow.id === task.id);
  const others = base.analysis.workflows.filter(workflow => workflow.id !== task.id);
  // A newer revision makes a stale open Task Page reload before saving answers.
  const installed = { ...task, revision: Math.max(task.revision ?? 1, (prior?.revision ?? 0) + 1) };
  return {
    ...base,
    revision: (base.revision ?? 0) + 1,
    analyzedAt: base.analyzedAt || now,
    quality: base.quality ?? EMPTY_QUALITY,
    // Demo provenance stays segregated: the scripted task installs after the
    // user's real detections, so `rank` never puts it first for genuine use
    // (rank is reassigned from array order below).
    analysis: { workflows: [...others, installed].map((workflow, index) => ({ ...workflow, rank: index + 1 })) },
  };
}
