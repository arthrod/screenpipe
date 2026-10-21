# CLAUDE.md

Conventions live in one file so they cannot drift. Read `AGENTS.md`.

Before opening or updating a PR, run every eval relevant to the changed behavior
locally and put the exact commands and results in the PR body. CI is a second
signal, not a substitute.

@AGENTS.md

## Agent context

### Issue tracker

Tickets live as local markdown under `.scratch/<topic>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.
