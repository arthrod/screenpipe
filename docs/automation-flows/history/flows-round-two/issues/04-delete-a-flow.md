# 04: Delete a Flow from the app and from the chat

**What to build:** The user deletes a Flow from the Flows list or its Review Screen; the chat deletes one when asked, without a confirmation step. An active Flow is switched off first (waiting for the email being processed), then the n8n workflow is deleted for good and the ScreenPipe record (summary, history) removed. Deleting a Flow n8n no longer has clears it from ScreenPipe.

Spec: `docs/automation-flows/history/hackathon/issues/27-flows-round-two.md`.

**Blocked by:** None (can start immediately)

**Status:** done, live check pending: in the running app, delete a throwaway Flow (not the demo Flow) from the list and another from its Review Screen; confirm each is gone from n8n (not under Archived) and from the list; ask the chat to delete one and confirm it does so without asking (the running app needs a rebuilt engine for the new route).

- [x] A delete route accepts the Review Screen and the local API key (chat).
- [x] An active Flow is unpublished with the existing running-execution wait before deletion; a Flow still processing at the deadline is left untouched with `409 flow_running`.
- [x] The n8n workflow is deleted (not archived) and the ScreenPipe record removed; a Flow missing in n8n is still cleared.
- [x] The list and the Review Screen offer Delete; the list no longer shows the Flow afterwards.
- [x] The automation-flows skill documents deletion.
- [x] Engine integration tests cover idle, active, running and missing Flows; component tests cover the Delete action.

## Notes

- Route: `DELETE /automation-flows/:id` (JSON content type, like every state-changing Flow route). Answers `200 {id, deleted: true}`; `404 flow_not_found` when neither n8n (as a tagged workflow) nor ScreenPipe knows the id, so an untagged n8n workflow is never deleted.
- n8n 2.42.2's public `DELETE /workflows/{id}` calls `workflowService.delete(..., force=true)`: a permanent delete, not an archive (read from the container's dist). Archived Flows are deleted too.
- The 409 at the deadline applies even to the user's click (unlike « Désactiver »): deletion never orphans an email.
- When an active Flow is switched off but the n8n delete then fails, the record keeps a `deactivated` event (by `user` or `api`).
- UI: « Supprimer » asks once more (« Supprimer définitivement » / « Annuler ») because deletion is final; the chat deletes without confirmation.

## Tests run

- `cargo test -p screenpipe-engine --test automation_flows_test deleting_` before the route → 4 failed (405), red as expected.
- `cargo test -p screenpipe-engine --test automation_flows_test` → 58 passed (7 new: idle, active after the running email, still running at the deadline → 409 untouched, missing in n8n cleared then 404, archived deleted, chat with the local API key only (refused without key or JSON), untagged n8n workflow never deleted).
- `cd apps/screenpipe-app-tauri && bunx vitest run components/automation-flows` → red first (7 failed), then 4 files, 87 tests passed (api client DELETE + browser mock, list/Review Screen Delete, cancel, flow_running, n8n refusal).
- `bunx tsc --noEmit -p .` in apps/screenpipe-app-tauri → no errors in components/automation-flows.
- `cargo test -p screenpipe-core --lib automation_flows_skill` → 2 passed; `cd packages/n8n-nodes-screenpipe && bun test test/skill-parameters.test.ts` → 4 passed.
