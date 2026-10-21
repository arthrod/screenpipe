// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// The desktop-owned workflow catalog the engine serves at GET /workflows/catalog.
// The engine's write routes refuse client-supplied evidence by design, so the
// demo writes the file directly, in the order the app's own writers use
// (engine `persist`, `disk-storage.ts`): backup of the last valid catalog,
// then an atomic replace. The engine reads the file on every request.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Catalog } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/catalog";
import { DEMO_TASK_ID } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/detected-task";

// The task itself and how it is installed are shared with the app's
// demo shortcut ⌃⌥⌘D.
export { upsertTask, type Catalog } from "../../../apps/screenpipe-app-tauri/lib/automation-flows/demo-task/catalog";

/** `<app local data>/workflows`; the default is the installed macOS app (`screenpi.pe`). */
export function catalogDir(): string {
  const override = process.env.SCREENPIPE_WORKFLOWS_DIR;
  if (override) return override;
  if (process.platform !== "darwin") throw new Error("Set SCREENPIPE_WORKFLOWS_DIR to <app local data>/workflows.");
  return join(homedir(), "Library", "Application Support", "screenpi.pe", "workflows");
}

const isCatalog = (value: unknown): value is Catalog => {
  const catalog = value as Catalog | null;
  return catalog?.schemaVersion === 5 && Array.isArray(catalog?.analysis?.workflows);
};

/** Same fallback as the engine: primary, then backup. Never overwrite an unreadable catalog. */
export function readCatalog(dir: string): Catalog | null {
  let found = false;
  for (const name of ["catalog.json", "catalog.backup.json"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    found = true;
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (isCatalog(value)) return value;
    } catch {
      // Try the backup.
    }
  }
  if (found) throw new Error(`The workflow catalog in ${dir} is unreadable. It was left untouched.`);
  return null;
}

/** Answers live in `userCorrection` (workflows-ui `workflow-answers.ts`). */
export function clearAnswers(catalog: Catalog, id = DEMO_TASK_ID): { catalog: Catalog; changed: boolean } {
  const workflow = catalog.analysis.workflows.find(candidate => candidate.id === id);
  if (!workflow) throw new Error(`${id} is not installed. Run the demo script first.`);
  if (workflow.userCorrection == null) return { catalog, changed: false };
  return {
    changed: true,
    catalog: {
      ...catalog,
      revision: (catalog.revision ?? 0) + 1,
      analysis: { workflows: catalog.analysis.workflows.map(candidate => candidate.id === id
        ? { ...candidate, userCorrection: null, revision: (candidate.revision ?? 0) + 1 } : candidate) },
    },
  };
}

export function writeCatalog(dir: string, previous: Catalog | null, next: Catalog): void {
  mkdirSync(dir, { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.tmp`;
  const replace = (name: string, value: Catalog) => {
    const path = join(dir, name);
    writeFileSync(`${path}.${suffix}`, JSON.stringify(value));
    renameSync(`${path}.${suffix}`, path);
  };
  if (previous) replace("catalog.backup.json", previous);
  replace("catalog.json", next);
}
