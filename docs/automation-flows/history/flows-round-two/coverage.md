# Automation Flows — feature → test coverage

Ticket: `docs/automation-flows/history/flows-round-two/issues/15-spec-feature-coverage.md`.
Sources: `docs/automation-flows/history/hackathon/SPEC.md` (journey, D1–D22, contracts),
`AGENTS.md` « Hackathon mode » (AG), ticket 27 user stories (27-n).
Every row names the automated test(s) at the highest seam that covers the
feature. Rows marked **live** also need the ticket 16 run: what no test can
reach (real n8n, Gmail, Jira, ChatGPT, the OS shortcut, the built app).
State on `main` after ticket 15: every listed test passes (commands and
counts in the ticket file). The native rows (T) were last run by tickets 03
(`shortcuts::tests`) and round-one 20 (`owned_browser`); ticket 15 changed
no native code and did not re-run them.

## Where the tests live

| Key | Seam | Path / command |
|---|---|---|
| E | Flow service routes against the fake n8n | `crates/screenpipe-engine/tests/automation_flows_test.rs` — `cargo test -p screenpipe-engine --test automation_flows_test` |
| EL | Engine units (flow check, node lookup, proxies, schedule) | `crates/screenpipe-engine/src/{flow_checks,n8n_nodes,automation_flows,automation_flows/health,routes/cloud_proxy,routes/chatgpt_proxy}.rs` — `cargo test -p screenpipe-engine --lib` |
| CX | n8n connection fields | `crates/screenpipe-connect/src/connections/n8n.rs` — `cargo test -p screenpipe-connect n8n` |
| K | `automation-flows` skill and guide | `crates/screenpipe-core/src/agents/pi.rs` — `cargo test -p screenpipe-core --lib automation_flows` |
| W | Demo workflow JSON contract | `infra/automation-flows/workflows/novadesk-support-tickets.test.ts` — `bun test infra/automation-flows` |
| C | Node catalog (check + browsing layers) | `infra/automation-flows/n8n-catalog.test.ts` |
| D | Demo task, evidence, reset scripts | `infra/automation-flows/demo/{catalog,recorded-evidence,reset}.test.ts` |
| N | ScreenPipe n8n nodes | `packages/n8n-nodes-screenpipe/test/*.test.ts` — `bun test` there |
| A | App components and client in the browser mock | `apps/screenpipe-app-tauri` — `bun run test:vitest` (files below) |
| T | Native (Tauri) | `apps/screenpipe-app-tauri` — `bun run test:tauri <filter>` |

App file shorthands: `flows-tab` = `components/automation-flows/__tests__/flows-tab.test.tsx`,
`graph` = `…/__tests__/flow-graph.test.tsx`, `api` = `…/__tests__/api.test.ts`,
`pipe-store` = `components/__tests__/pipe-store-flows-tab.test.tsx`,
`task-page` = `components/workflows/task-page-create-flow.test.tsx`,
`evidence` = `components/workflows/demo-task-evidence.test.tsx`,
`theme` = `components/workflows/workflows-view-theme.test.tsx`,
`desktop-create` = `lib/workflows/automation-flows.test.ts`,
`deeplinks` = `lib/notifications/actions.test.ts`,
`notif-actions` = `lib/__tests__/notification-actions.test.ts`,
`shortcut` = `lib/automation-flows/demo-shortcut.test.ts`,
`find` = `lib/automation-flows/find-automation.test.ts`.

## Journey and Task Page (SPEC journey 1–4, D3, D4, D8, D10, AG task page)

| Feature | Tests | Seam |
|---|---|---|
| The notification opens the Task Page of `wf-novadesk-support-tickets` through the existing workflows deeplink | D `catalog.test` › notification opens the Task Page through the existing workflows deeplink; A `evidence` › opens from the notification's review request on three repetitions…; A `notif-actions` › workflow review notification routing › opens Home and retries… | D, A |
| Task Page shows what was detected: three repetitions, each with its email, Jira form and ticket; both questions (D10) | D `catalog.test` › has three repetitions…; A `evidence` › opens from the notification's review request… and both questions | D, A |
| Evidence timeline with real captures; images survive persistence (D8) | D `catalog.test` › embeds small images that survive app persistence…; D `recorded-evidence.test` (6 tests: frame per capture, 503 retries, nearest frame, fallbacks, unreachable ScreenPipe); A `evidence` › embedded evidence survives saving…; loads a found capture live… | D, A |
| « Voir dans la timeline » from the Task Page | A `evidence` › loads a found capture live… and opens it in the timeline; says « Voir dans la timeline » in words… | A |
| Questions mandatory only for Flow creation; « Créer l'automatisation » disabled until all are answered | A `task-page` › keeps the action disabled until every question is answered; marks the questions as required…; leaves the page unchanged on hosts/tasks that cannot create Flows | A |
| Answers saved but ignored; creation asked once; failure keeps the answers | A `task-page` › saves the answers, then asks the host once…; shows why creation failed, keeps the answers…; keeps an answer being typed… | A |
| Creation imports the bundled workflow inactive and tagged, idempotent per task (D4) | E `create_from_task_imports_switched_off_and_tagged`, `second_create_returns_the_same_flow`, `create_adopts_the_workflow_already_imported_by_the_import_script`, `create_switches_off_a_pre_imported_copy_that_was_left_on`, `create_never_takes_over_a_flow_the_user_already_has`, `create_again_after_the_workflow_was_deleted_in_n8n`, `unknown_task_or_flow_returns_404` | E |
| After creation the app lands on the Review Screen | A `desktop-create` › creates the Flow from the task through the Flow service, then opens its Review Screen; switches an Automations view already open…; opens the same Flow when clicked again | A |

## Review Screen (SPEC frontend contract, D2, D7, AG review screen, 27-42/43)

| Feature | Tests | Seam |
|---|---|---|
| Summary, every non-sticky node with its AI sentence (node `notes`) | E `review_nodes_come_from_n8n_notes_without_sticky_notes`; A `flows-tab` › shows the summary, every node with its sentence, and the status; A `graph` › draws every node once…; shows a neutral placeholder… | E, A |
| Read-only graph from n8n `connections`, zoom only | A `graph` › links the nodes along the n8n connections; offers no editing…; lets the reviewer zoom… | A |
| Cards show only their sentence: no credential names or hosts (27-42, 27-43) | E `no_step_shows_n8n_credentials_or_called_hosts`; A `graph` › shows only the sentence under each step, never n8n credentials or hosts | E, A |
| « Voir le graphe » (n8n URL) and « Voir la tâche » (Task Page) | A `flows-tab` › opens the graph in n8n and goes back to the Task Page; hides the task link for a Flow without a source task | A |
| « Voir dans la timeline » at the first moment the task was seen | E `a_flow_from_a_task_points_at_the_first_moment_the_task_was_seen`, `a_flow_from_the_chat_has_no_source_moment`; A `flows-tab` › opens the moment the task was seen in the timeline; offers the timeline only when…; says when the timeline cannot be opened; A `api` › opens the task's moment through the Timeline handoff… | E, A |
| Status, last run, activation history | E `status_is_derived_from_n8n_and_the_reviewed_version`, `review_screen_shows_the_last_execution`; EL `automation_flows::status_follows_n8n_state_and_reviewed_version`; A `flows-tab` › shows when the Flow last ran (×3); flags a Flow that needs review and lists its activation history | E, A |
| Activer / Désactiver through the n8n API, logged by whom | E `activate_publishes_the_reviewed_version_and_logs_it`, `deactivate_unpublishes_and_logs_then_the_status_follows_the_versions`, `deactivation_is_logged_as_the_users_only_with_the_ui_credential`, `repeated_clicks_switch_once_and_log_once`, `activation_routes_report_setup_and_unknown_flows`; A `flows-tab` › activates a Draft…; deactivates an Active Flow and lists who did what…; says why n8n refused…; says when the Flow was switched off outside Screenpipe | E, A |
| Nothing activates without the user's click (UI credential, reviewed version) | E `nothing_but_the_activate_route_switches_a_flow_on`, `the_local_api_key_alone_cannot_activate_a_flow`, `activation_needs_the_version_the_user_reviewed`, `activation_is_refused_without_publishing_or_logging`, `without_the_desktop_app_no_flow_can_be_activated`; A `flows-tab` › never switches a Flow on or off without a click; activates only the version the user loaded…; reloads a Flow that changed since it was opened…; A `api` › activates the reviewed version with the UI credential…; browser mock refuses… | E, A |
| Edits made in n8n are flagged, not auto-paused (D7) | E `review_is_outdated_while_n8n_runs_an_older_version_than_its_draft`, `review_is_outdated_when_n8n_runs_a_version_the_user_never_activated`, `activating_the_version_edited_in_n8n_clears_the_flag`; A `flows-tab` › offers to activate the version edited in n8n while the old one runs | E, A |
| Switching off waits for the email being processed (ticket 21) | E `switching_off_waits_for_the_email_being_processed`, `a_flow_still_processing_at_the_deadline_is_left_running_with_409`, `the_users_desactiver_switches_off_even_when_an_execution_never_ends`, `switching_off_an_idle_flow_asks_n8n_once`; A `flows-tab` › asks to try again when n8n is still processing an email at Désactiver | E, A |
| « Demander une modification » opens the chat with the Flow id | A `flows-tab` › opens the chat about this Flow to request a change; says when the chat cannot be opened; A `api` › requests a change in the Home chat… | A |
| The Review Screen stays fresh (focus, visibility, interval) | A `flows-tab` › Freshness (6 tests) | A |
| Errors: not configured, refused key, unreachable, other n8n failure, JSON only | E `not_configured_returns_412`, `n8n_down_returns_502`, `refused_api_key_returns_412_unauthorized_not_unreachable`, `any_other_n8n_failure_is_named_n8n_failed_not_unreachable`, `state_changing_routes_take_only_json_requests`; A `flows-tab` › explains that n8n is not configured…; says that n8n refused the API key…; explains that n8n is unreachable and retries; shows the n8n message when the Flow cannot be loaded; A `api` › keeps the unreachable detail… | E, A |

## Flows list (AG Automation Flows view, D6)

| Feature | Tests | Seam |
|---|---|---|
| A « Flows » tab in Automations; `?tab=flows&flow=<id>` opens a Flow | A `pipe-store` › lists Flows in a third tab and keeps the open Flow in the URL; opens the Review Screen from ?tab=flows&flow=<id>; loads the Flow afresh when its Review Screen link is opened… | A |
| Lists only Flows tagged in n8n, every page, with status and last run | E `list_shows_only_flows_with_status_and_last_run`, `list_follows_n8n_pages_to_show_every_flow`; A `flows-tab` › shows each Flow with its status and last run, and opens it; says when there is no Flow yet | E, A |
| « Ajouter » opens the creation chat, creating nothing by itself | A `flows-tab` › opens the chat to create a Flow from Ajouter (×2); says when the creation chat cannot be opened; A `api` › requests a new Flow in the Home chat…; withCreationPrompt (3 tests) | A |
| Design rules: sentence case, phosphor only while running | A `flows-tab` › Design rules (3 tests) | A |

## Chat: creating, changing, the skill (D5, D22, AG chat, SPEC skill contract)

| Feature | Tests | Seam |
|---|---|---|
| Chat creation imports switched off and tagged, without the chat's credentials or MCP exposure | E `chat_create_imports_switched_off_and_tagged_and_stores_the_summary`, `chat_create_cannot_wire_the_users_n8n_credentials`, `no_flow_is_offered_to_n8n_mcp_clients`, `chat_create_refuses_a_workflow_the_review_screen_cannot_explain` | E |
| A chat change of an active Flow pauses it, needs review, keeps credentials (D7, 27-24) | E `chat_update_switches_an_active_flow_off_first_and_leaves_it_needing_review`, `chat_reads_the_editable_workflow_and_sends_it_back`, `chat_update_is_refused_untouched_when_a_node_has_no_sentence`, `chat_update_refused_by_n8n_leaves_the_flow_switched_off`, `chat_update_keeps_the_users_credentials_and_never_takes_the_chats`, `chat_update_of_a_draft_keeps_it_a_draft_and_its_summary`, `chat_update_of_a_paused_flow_leaves_it_needing_review_without_switching`; A `flows-tab` › asks to review a Flow the chat changed…; A `api` › lets a chat change switch the fixture Flow off… | E, A |
| No invented, switched-off or half-built node (D22) | E `chat_create_refuses_an_invented_node_before_n8n_sees_it`, `chat_update_with_a_node_n8n_cannot_run_is_refused_untouched`, `chat_create_wires_the_only_credential_n8n_holds_of_a_type`; EL `flow_checks` (9 tests: switched-off/invented type, unknown version, empty required parameter, only credential wired, several never chosen, predefined credential type, lone node / no trigger, every problem listed, demo workflow passes) | E, EL |
| The chat's last message links to the Review Screen | A `components/chat/markdown-block.test.tsx` › opens a Flow's Review Screen from the link the chat ends a Flow change with; A `desktop-create` › Review Screen link from the chat (4 tests) | A |
| Skill: installed in the chat only, never activates, ends on the Review Screen link | K `automation_flows_skill_installs_in_chat_only_and_never_switches_a_flow_on` | K |
| Skill names the ScreenPipe node types n8n loads and every node parameter | K `automation_flows_skill_names_the_screenpipe_node_types_n8n_loads`; N `skill-parameters.test` (one test per parameter + polling) | K, N |

## Chat knows n8n (27-1…12)

| Feature | Tests | Seam |
|---|---|---|
| 27-1, 27-5: search returns real nodes, named node first, at most 20, with the match count | E `node_search_puts_the_named_node_first`, `node_search_returns_at_most_twenty_entries_and_says_how_many_matched`, `node_search_needs_words_to_look_for` | E |
| 27-2: a card for one node, narrowed to an operation, with a valid skeleton | E `node_card_narrowed_to_an_operation_lists_its_fields_and_a_skeleton`, `node_card_without_an_operation_lists_the_choices_and_says_fields_are_hidden`, `a_node_built_from_its_card_skeleton_passes_the_flow_check`, `node_card_of_an_invented_type_is_not_found`; EL `n8n_nodes::every_usable_type_has_a_card_and_a_skeleton_the_check_knows` | E, EL |
| 27-3: the card says whether n8n holds none, one or several credentials | E `node_card_says_whether_n8n_holds_none_one_or_several_credentials` | E |
| 27-4: switched-off nodes listed, flagged, never usable | E `node_search_lists_switched_off_nodes_flagged_never_usable`, `node_card_of_a_switched_off_node_is_flagged_without_fields`; C › lists the switched-off types, flagged; the AI-tool twin of a switched-off node is switched off too | E, C |
| 27-6: required fields nested in collections shown in cards | C › a card keeps allowed values, display rules and required fields nested in collections | C |
| 27-7, 27-8: reference guide with expressions, branching, AI sub-nodes and complete example Flows that pass the check | K `automation_flows_guide_ships_beside_the_skill_and_is_linked_from_it`; E `every_example_flow_of_the_guide_passes_the_flow_check` | K, E |
| 27-9: lookup and check from one catalog | C › comes from the same n8n image as the check layer; lists every type the check accepts, at its latest version… | C |
| 27-10: ScreenPipe nodes changed without regenerating the catalog fails a test | C › ScreenPipe n8n nodes › are in both layers exactly as the package describes them | C |
| 27-11: pinned n8n version test kept | C › describes the pinned n8n image; knows every node of the demo workflow, at its version | C |
| 27-12: the skill has no hard-coded node versions; it looks nodes up first | K `automation_flows_skill_takes_node_versions_from_the_lookup_only`, `automation_flows_skill_looks_a_node_up_before_using_it` | K |
| Node lookup needs the local API key | E `node_lookup_takes_the_local_api_key` | E |

## Building step by step (27-13…25)

| Feature | Tests | Seam |
|---|---|---|
| 27-13, 27-19: a hidden draft in n8n, marked under construction, absent from the list | E `a_draft_starts_in_n8n_switched_off_marked_under_construction_and_hidden` | E |
| 27-14: inventions, switched-off types, unknown versions refused at each step | E `a_step_with_an_invented_or_switched_off_node_or_unknown_version_is_refused` | E |
| 27-15, 27-16, 27-20: half-built steps accepted; per-node state; the only credential wired | E `each_step_is_accepted_half_built_and_the_state_says_what_each_node_lacks` | E |
| 27-17: « Terminer » refused while anything is missing, listing every problem | E `terminer_is_refused_while_anything_is_missing_and_lists_every_problem` | E |
| 27-18: a finished Flow is a switched-off Draft to review, with the error workflow named | E `terminer_turns_a_complete_draft_into_a_switched_off_draft_to_review`, `terminer_wires_a_credential_the_user_created_since_the_last_step`, `a_finished_draft_reports_its_failed_runs_like_any_flow` | E |
| 27-21: never picks between several accounts | EL `flow_checks::several_credentials_of_a_type_are_never_chosen_between` | EL |
| 27-22: the chat deletes a draft it abandons | E `the_chat_deletes_a_draft_it_abandons`; K `automation_flows_skill_builds_step_by_step_and_deletes_abandoned_drafts` | E, K |
| 27-23: drafts unchanged for 24 h are deleted at the health check | E `drafts_left_under_construction_for_24_hours_are_deleted` | E |
| 27-24: changing an existing Flow keeps today's rule | see « A chat change of an active Flow… » above | E |
| 27-25: building never activates anything | E `a_draft_under_construction_can_never_be_activated_or_used_as_a_flow` | E |

## Demo notification (27-26…29)

| Feature | Tests | Seam |
|---|---|---|
| 27-26: ⌃⌥⌘D, registered in every build, works with ScreenPipe in the background | T `shortcuts::tests::demo_shortcut_is_control_option_command_d` (keys only); **live**: the global registration | T, live |
| 27-27: the shortcut resets the task (answers cleared) and sends « Tâche répétitive détectée », like the demo script | A `shortcut` › resets the detected task (answers cleared) and sends the notification…; ignores a second press…; A `find` (7 tests: installs then notifies, recorder frames or embedded key frames, reinstall without answers, unreadable catalog); D `catalog.test` › reset clears only the demo answers | A, D |
| 27-28: no « Trouver une automatisation » button | A `pipe-store` › shows no control that fakes the detection… (**new**) | A |
| 27-29: the presenter is told when the notification is not shown | A `shortcut` › tells the presenter why the notification was not shown and opens the Task Page; …when the notification server is unreachable; …when the task cannot be installed | A |
| Demo reset script restores the start state (Flows, answers, inbox) | D `reset.test` (18 tests; the CLI runs now isolated from the repo `.env`) | D |

## Workflows view theme (27-30, 27-31)

| Feature | Tests | Seam |
|---|---|---|
| The Workflows view (Task Page, integrated view, dialogs) follows the app's dark class; no light surface or forced light select | A `theme` › paints the light palette when the app is light; leaves no light surface on the Task Page…; …in the integrated view…; opens the access notice…; asks about automatic updates… | A |

## Deleting Flows (27-32…36)

| Feature | Tests | Seam |
|---|---|---|
| 27-32: Delete on the list and on the Review Screen | A `flows-tab` › Deleting a Flow (5 tests: list once confirmed, cancel, Review Screen, still processing, n8n refusal); A `api` › deletes a Flow with a JSON request; browser mock › deletes the fixture Flow… | A |
| 27-33: an active Flow is switched off first, after the email being processed | E `deleting_an_active_flow_switches_it_off_after_the_email_being_processed`, `a_flow_still_processing_at_the_deadline_is_not_deleted` | E |
| 27-34: removed from n8n for good and from ScreenPipe | E `deleting_an_idle_flow_removes_it_from_n8n_and_screenpipe`, `deleting_an_archived_flow_deletes_it_for_good`, `an_n8n_workflow_that_is_not_a_flow_is_never_deleted` | E |
| 27-35: the chat deletes when asked, without confirmation | E `the_chat_deletes_a_flow_with_the_local_api_key_alone`; K `automation_flows_skill_deletes_a_flow_when_asked_without_confirmation` (**new**) | E, K |
| 27-36: a Flow n8n no longer has is cleared | E `deleting_a_flow_n8n_no_longer_has_clears_it_from_screenpipe` | E |

## Demo Flow (D9, D11, D20, D21, 27-37…41, 27-52)

| Feature | Tests | Seam |
|---|---|---|
| IMAP trigger: unread only, marks read (the dedupe); catches up after a pause | W › reads unread emails of the support inbox and marks them read; every activation catches up the unread emails… | W |
| 27-37, 27-41: one AI agent, short instruction, email treated as data, no sanitizing expressions | W › one AI Agent judges each email, through ScreenPipe's local AI proxy, into a fixed answer shape; the email reaches the AI as data, quoted as is, under a short instruction | W |
| 27-38: ScreenPipe history search and activity summary tools, limited to Jira screen text | W › the AI Agent's tools are ScreenPipe's history search and activity summary…; an email cannot widen what the ScreenPipe tool reads… | W |
| 27-39: type, product, summary, priority, label, confidence, closed answers | W › the AI answer is closed: allowlists everywhere…; a malformed or injected AI answer never reaches Jira… | W |
| 27-40: a fixed Jira node creates the ticket from the AI's fields | W › a fixed Jira node creates the ticket straight from the AI's fields; creates one unassigned NOVA issue titled '<product> - <summary>'…; an improvement idea becomes a Tâche…; calls the Jira Cloud REST API with the stored Jira credential; Jira-markup / empty / huge email tests | W |
| Stops without a ticket when the AI answers none | W › stops without a ticket when the AI answers none | W |
| 27-52 (D20): `mail-<8 hex>` label, JQL search before creating, no duplicate on Retry | W › every ticket carries the label mail-…; an email without a Message-ID still gets its own label…; before creating, it searches Jira…; an email that already has its ticket creates nothing…; a failed creation is checked in Jira before trying again… | W |
| Model `chatgpt/gpt-5.6-luna:max` on the local proxy (D21, AG AI model) | W › one AI Agent judges each email… (model value); N `screenpipe-ai-trigger.node.test` › is a polling trigger… (default model), fires once… (model sent); EL `chatgpt_proxy::an_effort_suffix_sets_the_reasoning_effort`, `only_chatgpt_prefixed_models_are_for_chatgpt` + 12 more; **live**: the chat's ChatGPT preset and Max effort | W, N, EL, live |
| Tool calls through the AI proxy get ids (SPEC verified facts) | EL `cloud_proxy::tool_calls_without_ids_get_unique_ids_and_function_type`, `missing_finish_reason_becomes_tool_calls`, + 4 pass-through tests | EL |
| Only verified node types and versions; a Flow, switched off, tagged, not in MCP; summary; no secrets | W › uses only node types and versions verified on the local n8n 2.42.2; is an Automation Flow…; ships a plain-language summary…; contains no secrets…; every step explains itself in exactly one sentence; EL `flow_checks::the_demo_workflow_passes_untouched`; EL `automation_flows::bundled_fixtures_parse_and_import_without_read_only_fields` | W, EL |
| Browser-mock fixture matches the bundled workflow | A `api` › shows the demo workflow the engine bundles (ticket 01) | A |

## Failure handling (D16–D19, 27-44…51)

| Feature | Tests | Seam |
|---|---|---|
| 27-44 (D16): a failed run notifies with sender, subject, step and error, linking to the Review Screen; every Flow names one error workflow | E `every_flow_reports_its_failed_runs_through_one_error_workflow`, `a_failed_run_is_notified_with_its_email_and_the_flow_keeps_running`, `a_failing_trigger_is_notified_with_its_error`, `only_a_run_of_that_flow_is_notified`; A `deeplinks` › opens the Flow's Review Screen in Home (a failed run, D16) | E, A |
| 27-45: red in the list, not paused | E `a_failed_run_is_notified_with_its_email_and_the_flow_keeps_running`; A `flows-tab` › shows red, still active, a Flow whose last run failed (D16) | E, A |
| 27-46 (D17): Retry from the Review Screen | E `retrying_a_failed_run_runs_it_again_in_n8n_and_says_how_it_ended`, `a_retry_that_fails_again_says_where_and_why`, `only_a_failed_run_of_that_flow_is_retried`, `a_retry_n8n_refuses_is_reported_with_its_reason`, `a_retry_never_runs_a_change_nobody_reviewed_or_published`, `activity_offers_to_retry_only_failed_runs_not_retried_yet`; A `flows-tab` › Relancer a failed run (4 tests); A `api` › retries a failed run…; browser mock › retries the fixture's failed run… | E, A |
| 27-46 (D17): Retry from the failure notification (« Relancer » calls the route, then opens the Review Screen) | E failure tests above (the notice carries the `api` action); A `notif-actions` › « Relancer » on a failed Flow run retries it, then opens the Flow's Review Screen (**new**); « Relancer » that n8n refuses says why… (**new**) | E, A |
| 27-47: a failed email stays read and its run and input stay in n8n | W › reads unread emails… and marks them read; W › a failed run keeps its email in n8n so Retry has it… (**new**); **live**: n8n keeps the failed run's data and Retry replays it | W, live |
| 27-48 (D18): low confidence creates no ticket and sends « À trier à la main » with sender, subject, reason | W › an unsure AI creates no ticket…; an unsure AI sends the ScreenPipe notification « À trier à la main »…; an email cannot put a link or markup in…; a huge or empty email still gives a short notification | W |
| 27-49 (D18): Activity per handled email: ticket, ignored, abstained, failed, with the reason | E `activity_shows_the_ticket_an_email_became_with_the_ais_reason`, `activity_shows_an_email_the_ai_was_unsure_about_as_abstained`, `activity_shows_an_email_that_needed_no_ticket_as_ignored`, `activity_lists_handled_emails_newest_first_with_the_failed_ones_and_why`, `activity_shows_the_ticket_an_email_already_had_when_creation_was_skipped`, `activity_of_a_flow_without_an_ai_answer_says_its_runs_went_through`; A `flows-tab` › lists the Flow's Activity newest first… (D18); says when the Flow has handled no email yet; A `api` › reads the Flow routes… (activity), browser mock › shows the fixture Flow's Activity… | E, A |
| 27-50 (D19): health check at start and every 15 min; banner while n8n is unreachable | E `an_unreachable_n8n_is_reported_until_n8n_answers_again`, `the_check_runs_at_start_then_on_its_schedule_and_sooner_while_n8n_is_down`; EL `automation_flows::health::the_app_checks_every_15_minutes_and_every_30_seconds_while_n8n_is_down`; A `flows-tab` › Health banner (D19) (3 tests); A `api` › reads the engine's last health check with a plain GET… (**new**); browser mock › answers the health check… (**new**) | E, EL, A |
| 27-51 (D19): failed runs while the app or n8n was down notified at the next check, never twice | E `failed_runs_since_the_last_check_are_notified_once_each`, `a_run_the_error_workflow_reported_is_not_notified_again_and_vice_versa`, `a_failed_run_the_notification_server_missed_is_notified_at_the_next_check` | E |

## ScreenPipe n8n nodes (D12, AG nodes, situational triggers)

| Feature | Tests | Seam |
|---|---|---|
| ScreenPipe node: search content and activity summary, offered as an AI tool, text cut, errors | N `screenpipe.node.test` (9 tests) | N |
| ScreenPipe Trigger (deterministic): keyword in transcription, window active, pipe run, another Flow's run, manual test event, errors | N `screenpipe-trigger.test` (12 tests) | N |
| ScreenPipe AI Trigger: condition prompt judged by the AI, cooldown, look-back, manual mode, errors, injection-safe activity | N `screenpipe-ai-trigger.node.test` (18 tests) | N |
| The nodes as n8n loads them (`CUSTOM.*`) are in the catalog | C › leaves out the nodes this n8n switches off, and has the ScreenPipe nodes | C |

## Setup and security (D13, D14, tickets 14 and 20)

| Feature | Tests | Seam |
|---|---|---|
| n8n API URL and key on ScreenPipe's n8n connection, the key in the secret store (D13) | CX `api_url_is_plain_and_api_key_is_secret`, `instance_url_accepts_api_suffix_and_slashes`, `test_checks_the_api_with_the_key_header`, `test_rejects_half_configured_api_and_empty_form`, `api_key_is_stored_in_the_secret_store` | CX |
| n8n pinned to 2.42.2 (D14) | C › describes the pinned n8n image | C |
| Workflow ids cannot escape the n8n path | EL `automation_flows::workflow_ids_cannot_escape_the_n8n_path` | EL |
| The agent's browser cannot open the app's own pages (ticket 20) | T `owned_browser` (6 tests, e.g. `the_agent_browser_cannot_open_the_app_itself`) | T |
| The UI activation credential reaches only the webview (`get_flow_activation_key`) | E `without_the_desktop_app_no_flow_can_be_activated`, `the_local_api_key_alone_cannot_activate_a_flow`; **live**: the Tauri command in the built app | E, live |

## Only checkable live (goes to ticket 16)

No automated seam reaches these; ticket 16's checklist must cover them.

1. ⌃⌥⌘D registered globally in the built app, with ScreenPipe in the background; the toast when the notification is suppressed (duplicate within 90 s, pause, quiet hours).
2. The real notification server shows « Tâche répétitive détectée » and its click opens the Task Page.
3. Creation imports into the real n8n 2.42.2 (inactive, tagged, `errorWorkflow` set) and the Review Screen opens.
4. Activer publishes in the real n8n; Désactiver reverses it.
5. A real email in the Gmail inbox becomes one real NOVA ticket with the `mail-` label; a non-ticket email creates none; an unsure email sends « À trier à la main ».
6. The AI step answers through the ChatGPT subscription (`chatgpt/gpt-5.6-luna:max`), including a ScreenPipe tool round trip; the chat uses the ChatGPT preset with Max effort.
7. A failed run (e.g. Jira credential broken) is notified, the Flow turns red and stays on; n8n keeps the failed run with its input; « Relancer » from the notification and from the Review Screen replays it without a duplicate ticket.
8. The health banner appears when the n8n container is stopped (on a throwaway n8n, never the user's), and failures that happened meanwhile are notified at the next check.
9. Deletion of an active Flow from the list, the Review Screen and the chat; the workflow is gone from n8n.
10. A Flow built step by step from the chat (node search and cards, `/drafts`, « Terminer »), the abandoned draft deleted.
11. The Workflows view in dark mode in the real webview (CSS modules, native selects).
12. Real recorder captures on the demo machine for the evidence timeline (D8, D11).
13. `infra/automation-flows/import-workflow.sh` (manual helper; the app path is `from-task`, tested by E).
