# Review comments — `apps/screenpipe-app-tauri/README.md` slice

**(No comments posted to the PR.)**

This PR does not modify `apps/screenpipe-app-tauri/README.md` (`git diff origin/main...HEAD` for the file is empty) and every browser-mock / test command the README documents was verified to still match `package.json` and the referenced scripts at HEAD. There is nothing PR-attributable to report, so per the workflow instructions nothing is posted.

Items deliberately withheld from posting (pre-existing, file untouched by this PR — routed to the lead reviewer via the summary instead):

- `apps/screenpipe-app-tauri/README.md:210` — `.localization/coverage.json` is a gitignored generated artifact (`.gitignore:26`) absent from a fresh checkout; the README doesn't say what generates it. P3 nit, pre-existing.
- `apps/screenpipe-app-tauri/README.md:111` — stray leading space before "The check exercises…". P3 whitespace nit, pre-existing.
- `apps/screenpipe-app-tauri/README.md:3` — embedded agent instruction ("add this header … even outside screenpipe repo") contradicts workspace `AGENTS.md` ("Do not add the header outside this repository"). P3, pre-existing upstream content; belongs in a docs issue, not this PR.
- Branch README says "Chat and Workflows" (README.md:18, 111) while origin/main's `e9a730243` already renamed it to "Memory". Resolves cleanly on merge since the PR doesn't touch the file. Informational only.
