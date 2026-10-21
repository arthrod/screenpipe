// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeWorkflowAnalysis } from "../../../packages/workflows-ui/src/catalog";
import { serializeWorkflowData, stageScreenshots } from "../../../packages/workflows-ui/src/screenshots";
import { readWorkflowAnswers, writeWorkflowAnswers } from "../../../packages/workflows-ui/src/workflow-answers";
import { clearAnswers, readCatalog, upsertTask, writeCatalog, type Catalog } from "./catalog";
import { buildDetectedTask, CLARIFICATION_QUESTIONS, DEMO_TASK_ID, DEMO_TASK_URL, EVIDENCE_IMAGES } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task";
import { EVIDENCE_DIR, evidenceDataUrl, notificationPayload } from "./demo";

const now = "2026-10-17T06:00:00Z";
const task = buildDetectedTask(evidenceDataUrl, now);
const other = { ...task, id: "wf-other", title: "Other", userCorrection: "keep me", stages: [] };

describe("demo Detected Task", () => {
  it("has three repetitions, each with its email, Jira form and created ticket", () => {
    expect(task.id).toBe(DEMO_TASK_ID);
    expect(task.stages.map(stage => stage.name)).toEqual([
      expect.stringContaining("NOVA-25 (Bug)"), expect.stringContaining("NOVA-26 (Bug)"), expect.stringContaining("NOVA-27 (Task)"),
    ]);
    for (const stage of task.stages) expect(stage.screenshots!.map(image => image.app)).toEqual(["Gmail", "Jira", "Jira"]);
    expect(task.openQuestions).toEqual(CLARIFICATION_QUESTIONS);
    expect(CLARIFICATION_QUESTIONS).toHaveLength(2);
  });

  it("embeds small images that survive app persistence and stay visible after sanitizing", () => {
    const sizes = EVIDENCE_IMAGES.map(name => readFileSync(join(EVIDENCE_DIR, `${name}.webp`)).length);
    expect(sizes).toHaveLength(9);
    expect(Math.max(...sizes)).toBeLessThan(80_000);
    const saved = JSON.parse(serializeWorkflowData(upsertTask(null, task, now))) as Catalog;
    const shown = sanitizeWorkflowAnalysis(saved).analysis.workflows[0];
    for (const stage of shown.stages) {
      expect(stageScreenshots(stage)).toHaveLength(3);
      expect(stageScreenshots(stage).every(image => image.frameId < 0 && image.dataUrl.startsWith("data:image/webp;base64,"))).toBe(true);
    }
    expect(shown.quality.screenshotCount).toBe(9);
    expect(shown.timing?.runs).toHaveLength(3);
  });

  it("notification opens the Task Page through the existing workflows deeplink", () => {
    const payload = notificationPayload(1);
    expect(payload.actions).toEqual([{ type: "deeplink", label: "View task", url: DEMO_TASK_URL, primary: true }]);
    expect(DEMO_TASK_URL).toBe("screenpipe://workflows?workflow=wf-novadesk-support-tickets&source=notification");
    expect(notificationPayload(2).id).not.toBe(payload.id);
  });
});

describe("demo catalog", () => {
  it("creates a catalog the app loads, and reinstalls without touching other workflows", () => {
    const created = upsertTask(null, task, now);
    expect(created).toMatchObject({ schemaVersion: 5, analyzedAt: now, revision: 1 });
    expect(created.quality.warnings).toEqual([]);
    const answered = { ...created, analysis: { workflows: [{ ...created.analysis.workflows[0], userCorrection: "answers", revision: 4 }, other] } };
    const reinstalled = upsertTask(answered, task, "2026-10-18T00:00:00Z");
    expect(reinstalled.analysis.workflows.map(workflow => [workflow.id, workflow.rank])).toEqual([["wf-other", 1], [DEMO_TASK_ID, 2]]);
    expect(reinstalled.analysis.workflows[1]).toMatchObject({ userCorrection: null, revision: 5 });
    expect(reinstalled.analysis.workflows[0].userCorrection).toBe("keep me");
    expect(reinstalled.analyzedAt).toBe(now);
  });

  it("reset clears only the demo answers", () => {
    const installed = upsertTask({ ...upsertTask(null, task, now), analysis: { workflows: [other] } }, task, now);
    const answers = writeWorkflowAnswers(null, CLARIFICATION_QUESTIONS.map(question => ({ question, answer: "oui" })));
    const answered: Catalog = { ...installed, analysis: { workflows: installed.analysis.workflows.map(workflow =>
      workflow.id === DEMO_TASK_ID ? { ...workflow, userCorrection: answers } : workflow) } };
    const answeredDemo = answered.analysis.workflows.find(workflow => workflow.id === DEMO_TASK_ID)!;
    expect(readWorkflowAnswers(answeredDemo.userCorrection)).toHaveLength(2);
    const { catalog, changed } = clearAnswers(answered);
    expect(changed).toBe(true);
    const cleared = catalog.analysis.workflows.find(workflow => workflow.id === DEMO_TASK_ID)!;
    expect(readWorkflowAnswers(cleared.userCorrection)).toEqual([]);
    expect(cleared.revision).toBe(answeredDemo.revision! + 1);
    expect(catalog.analysis.workflows.find(workflow => workflow.id === "wf-other")!.userCorrection).toBe("keep me");
    expect(clearAnswers(catalog).changed).toBe(false);
    expect(() => clearAnswers({ ...catalog, analysis: { workflows: [] } })).toThrow("Run the demo script first");
  });

  it("writes the previous catalog as backup and refuses to overwrite an unreadable one", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-catalog-"));
    expect(readCatalog(dir)).toBeNull();
    const first = upsertTask(null, task, now);
    writeCatalog(dir, null, first);
    const second = clearAnswers({ ...first, analysis: { workflows: [{ ...first.analysis.workflows[0], userCorrection: "x" }] } }).catalog;
    writeCatalog(dir, first, second);
    expect(readCatalog(dir)?.revision).toBe(second.revision);
    expect(JSON.parse(readFileSync(join(dir, "catalog.backup.json"), "utf8")).revision).toBe(first.revision);
    writeFileSync(join(dir, "catalog.json"), "{");
    expect(readCatalog(dir)?.revision).toBe(first.revision);
    writeFileSync(join(dir, "catalog.backup.json"), "{");
    expect(() => readCatalog(dir)).toThrow("unreadable");
  });
});
