# Slice review: screenpipe-redact adapters (onnx.rs, opf.rs, rfdetr.rs) — PR #1

## Headline

**PR #1 does not modify any file in this slice.** The assigned focus areas (ONNX
model-input validation, OPF rule/coverage strength, RF-DETR tiling box math) are
therefore not exercised by this PR at all: no redaction-coverage weakening, no
box-math regression, and no input-validation change can be introduced by it. I
verified this five independent ways (below). I posted no review comment — there
is no diff line in this slice to anchor one to.

## Evidence that the slice is unchanged (all commands run in this session)

1. `git diff origin/main...HEAD -- crates/screenpipe-redact/src/adapters/onnx.rs
   crates/screenpipe-redact/src/adapters/opf.rs crates/screenpipe-redact/src/adapters/rfdetr.rs`
   → empty output.
2. `git diff origin/main...HEAD --stat` → 234 files, +34,606/−600, all
   automation-flows work; `git diff origin/main...HEAD --name-only | grep -i redact`
   → no matches (exit 1). The entire `crates/screenpipe-redact/` crate is untouched.
3. GitHub's authoritative PR file list:
   `gh api repos/arthrod/screenpipe/pulls/1/files --paginate --jq '.[].filename'`
   → 234 files, 0 matching `redact` / `privacy` / `pii`.
4. The local refs match the PR exactly: `gh pr view 1 --json baseRefOid,headRefOid`
   → base `d75ccaedd` = local `origin/main`, head `0b6c5f9d1` = local `HEAD`
   (confirmed by `git rev-parse`).
5. Blob identity at the merge base:
   `git merge-base origin/main HEAD` = `35ed62162`, and
   `git show <merge-base>:crates/screenpipe-redact/src/adapters/{onnx,opf,rfdetr}.rs`
   shasums are byte-identical to the `HEAD:` blobs
   (`0161009283…`, `5eebe05328…`, `d6bde205f1…`).

## The trap other reviewers should not fall into

A **two-dot** diff (`git diff origin/main -- crates/screenpipe-redact/src/adapters/`)
shows substantial changes to exactly these files: removal of `provides_model_detection`,
`RequiredOnnx`/`required_session`, `window_shape`, `redact_required`, a tinfoil
short-text test, and `pub(crate)` → private version constants. Those changes
**belong to the base side**, not this PR: `git log HEAD..origin/main -- <adapters>`
shows exactly one commit, `5ce7edfcd` ("Gate captured data on PII completion
receipts (#7634)", Louis Beaumont, 2026-10-16), which is on `main` after the
merge base and is absent from the PR branch. The PR branch simply predates that
upstream redact rework. GitHub's PR "Files changed" uses the three-dot
(merge-base) diff, consistent with everything above. Anyone reviewing the
`RequiredRedaction` additions as PR changes would be reviewing the wrong commit.
Merging this PR will not conflict in these files (the PR never touches them).

## Slice state at the PR head (context read; all pre-existing, none PR-induced)

I read all three files in full at the PR head. For the record, the assigned
focus areas look coherent in the branch's state, with the guard tests present:

- **ONNX input validation** (`crates/screenpipe-redact/src/adapters/onnx.rs`):
  load-time presence checks for model/tokenizer/config (`onnx.rs:372-392`),
  tokenizer truncation disabled so long inputs are never silently dropped
  (`onnx.rs:399-406`), empty-input fast path (`onnx.rs:434-440`), windowed
  inference with overlap for over-context inputs (`onnx.rs:694-722`), logits
  rank/batch/length validation against the input (`onnx.rs:638-654`), and
  sha-256-verified model downloads (`onnx.rs:170-224`). Nothing here is
  changed by the PR.
- **OPF rules/coverage** (`crates/screenpipe-redact/src/adapters/opf.rs`):
  version constant pinned at v6 (`opf.rs:61`), total 12-label mapping that acts
  as a compile-time sync check (`opf.rs:348-365`), sha-256-pinned checkpoint
  manifest (`opf.rs:108-117`, verified at `opf.rs:309-313`). No rule/threshold
  logic lives in this adapter (it forwards to the `opf` crate, `opf.rs:406-422`),
  and the PR does not touch that crate either.
- **RF-DETR tiling math** (`crates/screenpipe-redact/src/adapters/rfdetr.rs`):
  `inference_windows` (`rfdetr.rs:637-653`) keeps the whole-frame pass first —
  the invariant documented as load-bearing against a 95.7%→56.1% recall
  collapse — with guard tests `whole_frame_pass_is_never_dropped`
  (`rfdetr.rs:778-788`) and `tiles_cover_the_whole_frame` (`rfdetr.rs:795-822`);
  window→full-frame box math `(cx − bw/2)·win_w + ox` (`rfdetr.rs:608-611`) is
  consistent with normalized-center coordinates per window. Unchanged by the PR.

Pre-existing nits I noticed while reading (FYI only; **not** introduced by this
PR and not postable on it): `detect_input_size` parses the `Debug` string of the
ORT input type instead of reading a typed shape (`rfdetr.rs:704-717`); the tiling
gate is asymmetric (`w ≥ 2×input_size && h ≥ 1.5×input_size`, `rfdetr.rs:437`);
box edges are u32-truncated rather than clamped to the frame (`rfdetr.rs:615-616`);
the ONNX download skips sha verification only while a `REPLACE_` placeholder sha
is configured (`onnx.rs:176`, currently real hex shas are pinned, `onnx.rs:132-153`).

## Tests / checks

- The ask named no test run for this slice, and with an empty slice diff there
  is no PR-side behavior to test; I did **not** run `cargo test -p
  screenpipe-redact` (it would only exercise pre-existing base-state code and,
  for the feature-gated paths, require an `onnx-cpu` build). All verification
  above is the git/GitHub evidence listed in the first section, which I did run.
- The PR-wide test story (automation-flows) is owned by other reviewers' slices.

## How this slice fits the whole PR

PR #1 is the Automation Flows feature drop (engine routes, desktop app UI,
workflows-ui package, n8n nodes, chat skill, docs — matching the existing
CodeRabbit summary on the PR). It does not intersect the redaction pipeline in
code. The only interaction worth noting for the lead reviewer: the branch is
~behind `main` on the redact side (base commit `5ce7edfcd` rewrote these
adapters after the PR branched), so post-merge, CI will compile this PR's
automation-flows code on top of the new redaction "required redaction" gating —
an integration that neither side has tested together yet. That risk belongs to
the merge/rebase step, not to any diff line in this PR.
