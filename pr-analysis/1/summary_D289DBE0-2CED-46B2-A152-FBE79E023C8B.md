# Review: infra/automation-flows compose + import script + custom-nodes gitignore (PR #1 slice)

Reviewer: reviewer-infra-env. Slice: `infra/automation-flows/docker-compose.yml`,
`infra/automation-flows/import-workflow.sh`, `infra/automation-flows/custom-nodes/.gitignore`
— all three are new files added by this PR (verified: `git diff origin/main...HEAD --stat` shows
3 files, 88 insertions, all `new file mode`).

## What this slice changes

- **`docker-compose.yml`** — a pinned, loopback-only local n8n (image `n8nio/n8n:2.42.2`,
  compose project `name: automation-flows`) that Automation Flows treats as the automation
  backend. Publishes `127.0.0.1:5678:5678` only (docker-compose.yml:16); keeps n8n state
  (credentials, API key, workflows) in the named volume `automation-flows_n8n_data`
  (docker-compose.yml:33,36-37); bind-mounts `./custom-nodes` **read-only** into the container
  as `N8N_CUSTOM_EXTENSIONS` (docker-compose.yml:27,34); adds `host.docker.internal:host-gateway`
  so the container can reach the host ScreenPipe API/AI proxy on :3030 (docker-compose.yml:29-31);
  disables n8n telemetry/personalization (docker-compose.yml:24-25).
- **`import-workflow.sh`** — idempotent, fail-closed installer for the bundled demo workflow
  into that container: reads the workflow's fixed `id` with an inline bun one-liner and refuses
  to import without one (import-workflow.sh:19-23); refuses to overwrite a workflow that is
  currently active (import-workflow.sh:29-33); copies the JSON in, imports it switched-off,
  cleans up, then verifies the id actually landed in the inactive list (import-workflow.sh:35-48).
- **`custom-nodes/.gitignore`** — `*` + `!.gitignore`, so built node artifacts copied into this
  directory are never committed while the marker file stays tracked.

## How it fits the whole PR

This is the local n8n backbone the rest of the PR is built against. The engine's
`automation_flows` module and health checks talk to this container; the compose project name
pinned at docker-compose.yml:10 deterministically yields container `automation-flows-n8n-1`
and volume `automation-flows_n8n_data` — exactly the defaults hardcoded elsewhere:
`import-workflow.sh:17`, `infra/automation-flows/n8n-catalog.ts:28`, and
`packages/n8n-nodes-screenpipe/scripts/build.ts:19`. `build.ts --install` (README Quick start
step 2) compiles the n8n nodes and copies them into `infra/automation-flows/custom-nodes`
(build.ts:53-61), which is why the directory must exist but stay empty in git — and build.ts:55-57
actually uses the presence of this `.gitignore` as its tripwire, refusing to copy into any other
directory. So the three-line `.gitignore` is load-bearing beyond ignore semantics. The import
script installs the workflow whose fixed id (`spNovaFlow000001`, verified present in
`infra/automation-flows/workflows/novadesk-support-tickets.json` via python json load) the
demo docs and `infra/automation-flows/demo/reset.ts:8,34` depend on. The README Quick start
(README.md:129-153) is the user-facing walkthrough of exactly these two files.

## Checks I ran (this session)

- `git diff origin/main...HEAD -- <3 files>` — all new files; script mode 100755, others 100644.
- `bash -n infra/automation-flows/import-workflow.sh` — syntax OK.
- `shellcheck infra/automation-flows/import-workflow.sh` — installed (v at
  /opt/homebrew/bin/shellcheck), ran with zero findings.
- `docker compose -f infra/automation-flows/docker-compose.yml config` — exit 0. Rendered output
  confirms `host_ip: 127.0.0.1` on the published port (loopback only), the custom-nodes bind is
  `read_only: true`, and the volume resolves to `automation-flows_n8n_data` as the comment claims.
- `git check-ignore -v` — a built artifact path under `custom-nodes/` is ignored by line 2 (`*`);
  `custom-nodes/.gitignore` itself is NOT ignored (exit 1), so it stays tracked.
- `bash -c 'set -euo pipefail; x="$(echo out; false)"; echo REACHED'` → exit 1, `REACHED` never
  printed: a failed command substitution inside an assignment aborts under `set -e` (basis for
  the P2 finding at import-workflow.sh:29).
- Cross-file greps: image tag `2.42.2` matches `infra/automation-flows/n8n-catalog.json:1`
  (`"n8n":"2.42.2"`) and workflow tests that call it "the local n8n 2.42.2"; container default
  name consistent across three files (above).

## Not verified (be honest)

- I did **not** start the compose stack or run the import script against a live n8n; so the n8n
  CLI flags the script relies on (`list:workflow --active=true --onlyId`, `import:workflow`
  updating an existing id in place) are corroborated only by the script's own header comments and
  repo references (`docs/automation-flows/history/hackathon/SPEC.md:152,253`,
  `docs/automation-flows/history/hackathon/HANDOFF.md:24`), not executed here.
- The SIGPIPE rationale at import-workflow.sh:27-28 is correct by reasoning (`grep -q` exiting
  early SIGPIPEs the producer; under `pipefail` the pipeline returns 141, so an `if grep -q`
  guard would take the "not active" branch while the workflow IS active) — but I could not
  reproduce it without a running n8n.

## Notable risks / quality issues (details posted as PR comments)

1. **P2 — silent death when Docker/container is down** (import-workflow.sh:29): `2>/dev/null`
   inside the command substitution swallows docker's only diagnostics; with `set -e` the script
   then exits printing nothing (behavior verified above). The most common failure — n8n not
   started yet — produces zero output.
2. **P2 — silent clobber of a switched-off workflow's n8n edits** (import-workflow.sh:36-37):
   the active-guard protects only a *running* workflow. An inactive workflow the user edited in
   n8n is replaced in place with no notice, even though README design rule 1 says n8n is the
   source of truth and rule 2 says edits happen in n8n. The ask's focus ("must not clobber
   existing workflows silently") is met for the active case only.
3. **P3 — hard-coded `Europe/Paris`** (docker-compose.yml:22-23): any user following the README
   Quick start gets Paris time for schedule/cron-type triggers. Suggested `${TZ:-Europe/Paris}`.
4. **P3 — ugly failure for a bad `$1`** (import-workflow.sh:16,19): missing file or invalid JSON
   dies with a bun stack trace instead of a clean message; a `[ -f "$file" ]` guard would fix it.

## What's good

- Loopback-only port publish and `:ro` custom-nodes mount: the compose focus (no host-network
  over-exposure) is genuinely satisfied; credentials live only in the named volume, matching the
  header's claim (docker-compose.yml:6-9) — consistent with design rule 6.
- Quoting is solid throughout the script: every expansion quoted, the bun one-liner receives the
  filename via an env var rather than interpolation (import-workflow.sh:19), `grep -qx` on a
  captured variable avoids both the SIGPIPE trap (import-workflow.sh:27-28) and regex surprises.
- The post-import verification (import-workflow.sh:42-48) closes the loop instead of trusting
  `import:workflow`'s exit code; failure messages are actionable (import-workflow.sh:31).
- All three files carry the required screenpipe header per AGENTS.md (compose 1-2; script 2-3
  below the shebang; gitignore line 1).

## Existing PR feedback overlap

Fetched per fetch-pr-feedback (`--pr 1`, author/current-user `arthrod` excluded, resolved threads
excluded): 3 issue comments + 15 line-specific comments, all from bots (codeant-ai[bot] skip
notice, qodo paused, coderabbitai[bot]). **None touch the three files in this slice** (nearest is
`infra/automation-flows/workflows/novadesk-support-tickets.json:136`, a different file). No
duplication in my posted comments.
