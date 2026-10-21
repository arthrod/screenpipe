## Automation Flows UI — activation / activity / delete / health banner review

Three findings; nothing here repeats the already-posted comments on this PR.

---

**[P2] `apps/screenpipe-app-tauri/components/automation-flows/flow-activation.tsx:17-18` — the Pause `flow_running` copy invites a retry that silently discards the email n8n is processing.**

When Pause hits n8n's running-execution wait, the engine polls for up to 90 s (`RunningWait::default`, `crates/screenpipe-engine/src/automation_flows.rs:196-206`) and only then answers `409 flow_running` with nothing changed (`unpublish`, automation_flows.rs:849-871). This notice then says "n8n is still processing an email with this Flow: nothing changed. Try again in a moment." — but for the user's click `deactivate_flow` passes `user_stop = true` (automation_flows.rs:1559; `from_user` is the UI credential, :1459-1464), so the "try again" this copy invites is the destructive path: the second Pause waits up to another 90 s and then force-unpublishes mid-execution, and per the engine's own comment the in-flight email is then lost (automation_flows.rs:186-189). The same-shaped copy under Delete is truthful, because deletion never force-stops (`false` at automation_flows.rs:1604-1610) — the identical message therefore means "harmless, come back later" in one place and "retrying abandons the email being processed" in the other, with nothing on screen telling them apart. (The user also stares at a disabled Pause for up to 90 s per attempt with no progress text — compare Activity's "n8n is running it again…", flow-activity.tsx:128.) The engine's first-click wait itself honors issue #21; this is only about the copy being honest about what a second click does — a deactivate-specific notice, e.g. "…nothing changed yet. Pause again to stop it anyway; the email n8n is processing will be lost.", would do it.

---

**[P3] `apps/screenpipe-app-tauri/components/automation-flows/flow-activity.tsx:86` — « Show all N » and the Activity count present the engine's capped 20-run page as the complete history.**

`api.activity` fetches executions with `limit=20` and no pagination (`ACTIVITY_RUNS = "20"`, `crates/screenpipe-engine/src/automation_flows/activity.rs:13`, request at :49-60), and the UI renders that single page as the whole Activity: the header reads "Activity 20" (flow-activity.tsx:53) and the toggle says "Show all 20" (:86) even when the Flow has hundreds of runs. `total` is just `runs.data.length` (:31), so from the 21st run on, the copy overstates what is shown and older runs are silently unreachable from the UI. Either caption it as the latest 20 (e.g. "Show all · the latest 20 runs") or add pagination in the engine route.

---

**[P3] `apps/screenpipe-app-tauri/components/automation-flows/health-banner.tsx:21-22` — the banner's state filter is right, but its truthfulness is pinned by tests for only 4 of the 6 health states.**

Showing the banner only for `unreachable` is the correct, truthful read: `unauthorized`/`not_configured` mean ScreenPipe's API access to n8n failed, not that n8n stopped executing its active workflows, and those states already surface through the list's error panels (`common.tsx:243-276`). But the "stays away" test loop (`flows-tab.test.tsx:989-1005`) only covers `reachable`, `not_configured`, `unknown` and a failed read — the `unauthorized` and `failed` branches of `FlowsHealth["n8n"]` (`api.ts:88`; engine `health.rs:113-126`, :271-281) are untested, so a future refactor could flip either into showing "your Flows are not running" for a state where n8n is in fact answering. Both are one-line additions to the existing loop.
