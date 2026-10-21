// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { serializeWorkflowData, WorkflowsApp, type WorkflowsPlatform } from "@screenpipe/workflows-ui";
import { createFixtureWorkflowsPlatform } from "@screenpipe/workflows-ui/fixture";
import { buildDetectedTask, CLARIFICATION_QUESTIONS, DEMO_TASK_ID, QUESTION_CHOICES } from "@/lib/automation-flows/demo-task/detected-task";
import { upsertTask } from "@/lib/automation-flows/demo-task/catalog";
import { readWorkflowAnswers } from "../../../../packages/workflows-ui/src/workflow-answers";
import { THINKING_MS } from "../../../../packages/workflows-ui/src/workflow-questions";

// The Task Page of the scripted Detected Task, opened as the notification does.
const at = "2026-10-17T02:05:41Z";
const CREATE = "Create automation";

async function openTaskPage(extra: Partial<WorkflowsPlatform> = {}, taskId = DEMO_TASK_ID) {
  window.localStorage.clear(); window.sessionStorage.clear();
  window.history.replaceState(null, "", "/home?mode=workflows");
  const task = { ...buildDetectedTask(() => "data:image/webp;base64,AAAA", at), id: taskId };
  const catalog = JSON.parse(serializeWorkflowData(upsertTask(null, task, at)));
  const platform = { ...createFixtureWorkflowsPlatform(catalog), ...extra };
  await act(async () => {
    render(<WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key: "demo", workflowId: taskId }} />);
  });
  await screen.findByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] });
  return platform;
}

const answer = (question: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: question }), { target: { value } });

/** Clicks or submits, then lets the simulated AI thinking run to its end. */
async function withThinking(action: () => void) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    action();
    await act(() => vi.advanceTimersByTimeAsync(THINKING_MS));
  } finally { vi.useRealTimers(); }
}

describe("Task Page: Clarification Questions unlock Flow creation", () => {
  it("keeps the action disabled until every question is answered", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}) });
    const create = screen.getByRole("button", { name: CREATE });
    expect(create).toBeDisabled();
    answer(CLARIFICATION_QUESTIONS[0], "Oui, en Tâche.");
    expect(create).toBeDisabled();
    answer(CLARIFICATION_QUESTIONS[1], "Blocking = Highest, workaround = Medium, idea = Low.");
    expect(create).toBeEnabled();
    answer(CLARIFICATION_QUESTIONS[0], "   ");
    expect(create).toBeDisabled();
  });

  it("leaves the page unchanged on hosts that cannot create Flows", async () => {
    await openTaskPage();
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.getByText("0 of 2 answered · All optional")).toBeVisible();
    expect(screen.getAllByRole("checkbox", { name: "Not sure" })).toHaveLength(2);
  });

  it("leaves the page unchanged for a task the host cannot turn into a Flow", async () => {
    const createAutomationFlow = vi.fn(async () => {});
    await openTaskPage({ createAutomationFlow, canCreateAutomationFlow: id => id === DEMO_TASK_ID }, "wf-other-task");
    expect(screen.queryByRole("button", { name: CREATE })).toBeNull();
    expect(screen.getByRole("heading", { name: "Help make this workflow accurate" })).toBeVisible();
    expect(screen.getByText("0 of 2 answered · All optional")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save answers" })).toBeDisabled();
    expect(screen.getAllByRole("checkbox", { name: "Not sure" })).toHaveLength(2);
    expect(createAutomationFlow).not.toHaveBeenCalled();
  });

  it("keeps the required mode for the task the host can turn into a Flow", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), canCreateAutomationFlow: id => id === DEMO_TASK_ID });
    expect(screen.getByRole("button", { name: CREATE })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "Not sure" })).toBeNull();
  });

  it("marks the questions as required when the host can create Flows", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}) });
    expect(screen.getByText("0 of 2 answered · Required to create the automation")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Not sure" })).toBeNull();
  });

  it("words the question block for creating the automation", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), canCreateAutomationFlow: id => id === DEMO_TASK_ID });
    const block = within(screen.getByRole("region", { name: "Questions and feedback" }));
    expect(block.getByRole("heading", { name: "Help screenpipe understand this task" })).toBeVisible();
    expect(block.getByRole("button", { name: "Answer with voice" })).toBeVisible();
    expect(block.getByRole("textbox", { name: "Anything else to know?" })).toHaveAttribute("placeholder", "Another remark…");
    expect(block.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] })).toHaveAttribute("placeholder", "Your answer…");
    // One way to confirm: creating the automation saves the answers first.
    expect(block.queryByRole("button", { name: "Save answers" })).toBeNull();
    expect(block.getByRole("button", { name: CREATE })).toBeDisabled();
    answer(CLARIFICATION_QUESTIONS[0], "Yes, as a Task.");
    expect(block.getByRole("button", { name: "Clear" })).toBeVisible();
    expect(block.getByLabelText("Answered")).toBeVisible();
    // Not the optional wording of other tasks.
    expect(block.queryByText(/All optional|Help make this workflow accurate/)).toBeNull();
  });

  it("offers suggested answers that fill the free text, which stays editable", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}) });
    const [first, second] = CLARIFICATION_QUESTIONS;
    const choices = within(screen.getByRole("group", { name: `Suggested answers: ${first}` }));
    const choice = choices.getByRole("button", { name: QUESTION_CHOICES[first][0] });
    expect(choice).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(choice);
    expect(screen.getByRole("textbox", { name: first })).toHaveValue(QUESTION_CHOICES[first][0]);
    expect(choice).toHaveAttribute("aria-pressed", "true");

    // The free text stays: an own answer simply unselects the choice.
    answer(first, "Only when a customer asks for it.");
    expect(choice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(screen.getByRole("group", { name: `Suggested answers: ${second}` })).getByRole("button", { name: QUESTION_CHOICES[second][1] }));
    expect(screen.getByRole("button", { name: CREATE })).toBeEnabled();
  });

  it("stops offering creation once the automation exists, and points to the header", async () => {
    const createAutomationFlow = vi.fn(async () => {});
    await openTaskPage({ createAutomationFlow, findAutomationFlow: vi.fn(async () => "flow-1"), openAutomationFlow: vi.fn(async () => {}) });

    const form = screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] }).closest("form")!;
    expect(await within(form).findByText("This automation is already created. Open it from the top of the page.")).toBeVisible();
    expect(within(form).queryByRole("button", { name: CREATE })).toBeNull();
    // Nothing changed: nothing to confirm, and Enter applies nothing.
    expect(within(form).getByRole("button", { name: "Confirm changes" })).toBeDisabled();
    fireEvent.submit(form);
    expect(createAutomationFlow).not.toHaveBeenCalled();
  });

  it("applies changed answers to the existing automation with « Confirm changes », after saving them", async () => {
    const order: string[] = [];
    const createAutomationFlow = vi.fn(async () => { order.push("apply"); });
    const platform = await openTaskPage({ createAutomationFlow, findAutomationFlow: vi.fn(async () => "flow-1"), openAutomationFlow: vi.fn(async () => {}) });
    const save = platform.saveWorkflowAnswers!;
    platform.saveWorkflowAnswers = vi.fn(async (...args) => { order.push("save"); return save(...args); });
    const form = screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] }).closest("form")!;
    const confirm = await within(form).findByRole("button", { name: "Confirm changes" });

    answer(CLARIFICATION_QUESTIONS[0], "No, only bugs.");
    // Every question stays required.
    expect(confirm).toBeDisabled();
    answer(CLARIFICATION_QUESTIONS[1], "Always Medium.");
    expect(within(form).getByText("Confirm to apply your changes to the automation.")).toBeVisible();
    expect(confirm).toBeEnabled();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(confirm); fireEvent.click(confirm);
      // The AI « thinks » first, shown in percent only (no time), before anything is applied.
      const thinking = await within(form).findByRole("progressbar", { name: "Applying your changes" });
      expect(thinking).toHaveTextContent(/\d+%/);
      expect(thinking).not.toHaveTextContent(/second|\d\s?s\b/);
      expect(within(form).getByRole("button", { name: "Applying…" })).toBeDisabled();
      expect(createAutomationFlow).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(THINKING_MS));
      await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(1));
    } finally { vi.useRealTimers(); }
    expect(order).toEqual(["save", "apply"]);
    expect(createAutomationFlow).toHaveBeenCalledWith(DEMO_TASK_ID, [
      { question: CLARIFICATION_QUESTIONS[0], answer: "No, only bugs." },
      { question: CLARIFICATION_QUESTIONS[1], answer: "Always Medium." },
    ]);
    // Saved: nothing left to confirm.
    await waitFor(() => expect(confirm).toBeDisabled());
  });

  it("offers « Open automation » in the page header, once the automation exists", async () => {
    const openAutomationFlow = vi.fn(async () => {});
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), findAutomationFlow: vi.fn(async () => "flow-1"), openAutomationFlow });

    const header = screen.getByTestId("task-header");
    const top = await within(header).findByRole("button", { name: "Open automation" });
    expect(within(header).getByRole("button", { name: /All workflows/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open automation" })).toHaveLength(1);
    // The header comes before the page's content and the questions.
    const firstQuestion = screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] });
    expect(header.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(top);
    await waitFor(() => expect(openAutomationFlow).toHaveBeenCalledWith("flow-1"));
  });

  it("shows no « Open automation » at the top while the automation does not exist", async () => {
    await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), findAutomationFlow: vi.fn(async () => null), openAutomationFlow: vi.fn(async () => {}) });
    await screen.findByRole("button", { name: CREATE });
    expect(screen.queryByRole("button", { name: "Open automation" })).toBeNull();
  });

  it("finds the automation created while the page was hidden, once it is shown again", async () => {
    // The app keeps the Task Page mounted while another section is shown.
    let flowId: string | null = null;
    const platform = await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), findAutomationFlow: vi.fn(async () => flowId), openAutomationFlow: vi.fn(async () => {}) });
    expect(screen.queryByRole("button", { name: "Open automation" })).toBeNull();

    const app = (active: boolean) => <WorkflowsApp platform={platform} storageKey={null} active={active} reviewRequest={{ key: "demo", workflowId: DEMO_TASK_ID }} />;
    cleanup();
    const { rerender } = render(app(true));
    await screen.findByRole("button", { name: CREATE });
    await act(async () => { rerender(app(false)); });
    flowId = "flow-1";
    await act(async () => { rerender(app(true)); });

    const header = screen.getByTestId("task-header");
    expect(await within(header).findByRole("button", { name: "Open automation" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open automation" })).toHaveLength(1);
  });

  it("creates the automation when the answers are confirmed with Enter, not only saves them", async () => {
    const createAutomationFlow = vi.fn(async () => {});
    await openTaskPage({ createAutomationFlow });
    answer(CLARIFICATION_QUESTIONS[0], "Yes, as a Task.");
    answer(CLARIFICATION_QUESTIONS[1], "Blocking = Highest.");
    await withThinking(() => fireEvent.submit(screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[1] }).closest("form")!));
    await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(1));
  });

  it("saves the answers, then asks the host once to create the Flow from the task", async () => {
    const order: string[] = [];
    const createAutomationFlow = vi.fn(async () => { order.push("create"); });
    const platform = await openTaskPage({ createAutomationFlow });
    const save = platform.saveWorkflowAnswers!;
    platform.saveWorkflowAnswers = vi.fn(async (...args) => { order.push("save"); return save(...args); });
    answer(CLARIFICATION_QUESTIONS[0], "Oui, en Tâche.");
    answer(CLARIFICATION_QUESTIONS[1], "Bloquant = Highest.");
    const create = screen.getByRole("button", { name: CREATE });
    await withThinking(() => { fireEvent.click(create); fireEvent.click(create); });
    await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["save", "create"]);
    expect(createAutomationFlow).toHaveBeenCalledWith(DEMO_TASK_ID, [
      { question: CLARIFICATION_QUESTIONS[0], answer: "Oui, en Tâche." },
      { question: CLARIFICATION_QUESTIONS[1], answer: "Bloquant = Highest." },
    ]);
    // Persisted: the saved catalog holds both answers (read back below).
    const saved = (await platform.loadCapturedWork!(30))!.analysis.workflows.find(w => w.id === DEMO_TASK_ID)!;
    expect(readWorkflowAnswers(saved.userCorrection)).toEqual([
      { question: CLARIFICATION_QUESTIONS[0], answer: "Oui, en Tâche." },
      { question: CLARIFICATION_QUESTIONS[1], answer: "Bloquant = Highest." },
    ]);
  });

  it("keeps an answer being typed when the user leaves the page and comes back, without saving", async () => {
    const platform = await openTaskPage({ createAutomationFlow: vi.fn(async () => {}), canCreateAutomationFlow: id => id === DEMO_TASK_ID });
    const save = vi.spyOn(platform, "saveWorkflowAnswers");
    answer(CLARIFICATION_QUESTIONS[0], "Oui, en Tâche.");
    cleanup();
    await act(async () => {
      render(<WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key: "back", workflowId: DEMO_TASK_ID }} />);
    });
    expect(await screen.findByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] })).toHaveValue("Oui, en Tâche.");
    expect(screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[1] })).toHaveValue("");
    expect(save).not.toHaveBeenCalled();
  });

  it("shows why creation failed, keeps the answers and allows a retry", async () => {
    const createAutomationFlow = vi.fn()
      .mockRejectedValueOnce(new Error("n8n is not set up."))
      .mockResolvedValue(undefined);
    await openTaskPage({ createAutomationFlow });
    answer(CLARIFICATION_QUESTIONS[0], "Oui, en Tâche.");
    answer(CLARIFICATION_QUESTIONS[1], "Bloquant = Highest.");
    await withThinking(() => fireEvent.click(screen.getByRole("button", { name: CREATE })));
    expect(await screen.findByText("n8n is not set up.")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] })).toHaveValue("Oui, en Tâche.");
    await withThinking(() => fireEvent.click(screen.getByRole("button", { name: CREATE })));
    await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("n8n is not set up.")).toBeNull());
  });
  it("shows the AI thinking on « Create automation » and stays locked until the Review Screen is shown", async () => {
    let shown!: () => void;
    const createAutomationFlow = vi.fn(() => new Promise<void>(resolve => { shown = resolve; }));
    await openTaskPage({ createAutomationFlow });
    answer(CLARIFICATION_QUESTIONS[0], "Yes, as a Task.");
    answer(CLARIFICATION_QUESTIONS[1], "Blocking = Highest.");
    const form = screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] }).closest("form")!;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole("button", { name: CREATE }));
      // Same thinking as « Confirm changes »: percent only, no time.
      const thinking = await within(form).findByRole("progressbar", { name: "Creating the automation" });
      expect(thinking).toHaveTextContent(/\d+%/);
      expect(thinking).not.toHaveTextContent(/second|\d\s?s\b/);
      expect(within(form).getByRole("button", { name: "Creating…" })).toBeDisabled();
      expect(createAutomationFlow).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(THINKING_MS));
      await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(1));
    } finally { vi.useRealTimers(); }

    // The host is still opening the Review Screen: the bar and the lock stay.
    expect(within(form).getByRole("progressbar", { name: "Creating the automation" })).toHaveAttribute("aria-valuenow", "100");
    expect(within(form).getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] })).toBeDisabled();
    await act(async () => { shown(); });
    expect(within(form).queryByRole("progressbar")).toBeNull();
  });

  it("creates on the first click after the task was reinstalled under an open Task Page (ticket 17)", async () => {
    const createAutomationFlow = vi.fn(async () => {});
    const platform = await openTaskPage({ createAutomationFlow });
    // ⌃⌥⌘D reinstalls the task (a newer revision) while this page stays open.
    const before = (await platform.loadCapturedWork!(30))!;
    const task = before.analysis.workflows.find(w => w.id === DEMO_TASK_ID)!;
    window.localStorage.setItem("screenpipe:fictional-workflow-editor-preview",
      JSON.stringify(upsertTask(before, { ...task, userCorrection: null }, at)));
    // Its notification opens the Task Page again.
    cleanup();
    const app = (key: string) => <WorkflowsApp platform={platform} storageKey={null} reviewRequest={{ key, workflowId: DEMO_TASK_ID }} />;
    const { rerender } = render(app("demo"));
    await screen.findByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] });
    window.localStorage.setItem("screenpipe:fictional-workflow-editor-preview",
      JSON.stringify(upsertTask((await platform.loadCapturedWork!(30))!, { ...task, userCorrection: null }, at)));
    await act(async () => { rerender(app("demo-again")); });
    await waitFor(() => expect(screen.getByRole("textbox", { name: CLARIFICATION_QUESTIONS[0] })).toBeEnabled());

    answer(CLARIFICATION_QUESTIONS[0], "Yes, as a Task.");
    answer(CLARIFICATION_QUESTIONS[1], "Blocking = Highest.");
    await withThinking(() => fireEvent.click(screen.getByRole("button", { name: CREATE })));
    await waitFor(() => expect(createAutomationFlow).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
