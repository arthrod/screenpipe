// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

// Builds the ScreenPipe n8n nodes into dist/.
// With --install: also copies them into the folder the local n8n mounts as
// /home/node/custom-nodes (infra/automation-flows/custom-nodes, gitignored)
// and restarts the n8n container so it loads them.
//
// Usage (from packages/n8n-nodes-screenpipe):
//   bun run build          # dist/ only
//   bun run install-n8n    # dist/ + copy + restart n8n
// Container: $N8N_CONTAINER or automation-flows-n8n-1.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const pkgDir = resolve(import.meta.dir, "..");
const dist = join(pkgDir, "dist");
const container = process.env.N8N_CONTAINER ?? "automation-flows-n8n-1";
const install = process.argv.includes("--install");

function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const res = Bun.spawnSync(cmd, { cwd: opts.cwd ?? pkgDir, stdout: "pipe", stderr: "pipe" });
  const out = res.stdout.toString().trim();
  if (res.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${res.exitCode}): ${res.stderr.toString().trim() || out}`);
  }
  if (!opts.quiet && out) console.log(out);
  return out;
}

// 1. Compile (CommonJS, one .js per .ts, same layout as the sources).
rmSync(dist, { recursive: true, force: true });
run(["bunx", "tsc", "-p", "tsconfig.json"]);
for (const dir of ["nodes/ScreenPipe", "credentials"]) {
  cpSync(join(pkgDir, dir, "screenpipe.png"), join(dist, dir, "screenpipe.png"));
}
console.log(`built ${dist}`);
if (!install) process.exit(0);

// 2. Copy into the custom-nodes folder n8n actually mounts (the container may
//    have been started from another checkout of this repo).
function mountedCustomNodesDir(): string | null {
  try {
    const mounts = JSON.parse(run(["docker", "inspect", container, "--format", "{{json .Mounts}}"], { quiet: true }));
    const mount = mounts.find((m: { Destination: string }) => m.Destination === "/home/node/custom-nodes");
    // Docker Desktop may report the bind source as seen from its VM.
    return mount?.Source?.replace(/^\/host_mnt(?=\/)/, "") ?? null;
  } catch {
    return null;
  }
}
const repoCustomNodes = resolve(pkgDir, "../../infra/automation-flows/custom-nodes");
const customNodes = mountedCustomNodesDir() ?? repoCustomNodes;
if (!existsSync(join(customNodes, ".gitignore"))) {
  throw new Error(`${customNodes} is not the gitignored custom-nodes folder; refusing to write there`);
}
const target = join(customNodes, "n8n-nodes-screenpipe");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });
console.log(`copied to ${target}`);

// 3. Restart n8n and wait until it answers.
run(["docker", "restart", container]);
const deadline = Date.now() + 120_000;
for (;;) {
  try {
    const res = await fetch("http://localhost:5678/healthz/readiness");
    if (res.ok) break;
  } catch {}
  if (Date.now() > deadline) throw new Error("n8n did not become ready within 120 s");
  await Bun.sleep(2000);
}
console.log(`n8n restarted (${container}) and ready`);
