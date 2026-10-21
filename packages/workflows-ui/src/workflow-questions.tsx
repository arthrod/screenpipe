// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Mic, Square, Undo2 } from "lucide-react";
import type { WorkflowMap } from "./model";
import { readWorkflowAnswers, writeWorkflowAnswers, type WorkflowAnswer } from "./workflow-answers";
import { QuestionnaireVoiceSession, type QuestionnaireVoice, type VoiceState } from "./questionnaire-voice";
import { LiveVoiceFill } from "./live-voice-fill";
import styles from "./workflow-question.module.css";

const EXTRA = "Anything else we should know?";
/** Unsaved answers, kept per task for this app session so leaving the page loses nothing. */
const draftKey = (workflow: WorkflowMap) => `screenpipe:workflow-answers:${workflow.id ?? workflow.title}`;
function readDraft(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch { return {}; }
}
function writeDraft(key: string, draft: Record<string, string>) {
  try {
    if (Object.keys(draft).length) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch { /* Answering still works when storage is unavailable. */ }
}
/** Every task keeps the optional block. Creation mode (an Automation Flow is created from the
 * answers) makes every question required and says so. */
const COPY = {
  en: {
    section: "Questions and feedback",
    title: "Help make this workflow accurate",
    unavailable: "Answers are unavailable in this view.",
    hint: "Answer what you know. Skip anything you’re unsure about, or talk through the questions.",
    progress: (answered: number, total: number) => `${answered} of ${total} answered · All optional`,
    startVoice: "Answer with voice", stopVoice: "Stop recording",
    connecting: "Connecting microphone…", listening: "Listening", interrupted: "Recording interrupted", stopped: "Recording stopped",
    level: "Microphone level", remaining: (time: string) => `${time} left`,
    voiceHint: "Talk naturally. Answers and a summary update as you speak. Anything you edit by hand stays unchanged.",
    updating: "Updating answers and summary…", byHand: "You can still answer by hand.", review: "Review your answers and summary below.", waiting: "Waiting for your words…",
    liveTranscript: "Live transcript", originalTranscript: "Original transcript", retryVoice: "Retry filling from voice notes",
    fillFailed: "Could not fill answers. Your words are kept. Try again.",
    answered: "Answered", extra: EXTRA,
    extraHint: "Add a missing step, an exception, or other feedback. When you speak, your summary appears here.",
    extraPlaceholder: "Add any other feedback…", placeholder: "Your answer…",
    clear: "Clear", fromVoice: "Filled from voice", summaryFromVoice: "Summary from voice",
    undo: "Undo", undoLabel: (question: string) => `Undo voice answer: ${question}`,
    saved: "Answers saved for the next workflow update.",
    saveFailed: "Couldn’t save answers. Your draft is still here. Try again.",
    savingStopsVoice: "Saving stops voice and keeps the answers shown here.",
    footer: "Saved answers refine future workflow updates.",
    save: "Save answers", saving: "Saving…",
    choices: "Suggested answers", created: "", open: "", pending: "", confirm: "", applying: "",
    thinkingLabel: "", creatingLabel: "", thinking: (_percent: number) => "",
  },
  creation: {
    section: "Questions and feedback",
    title: "Help screenpipe understand this task",
    unavailable: "Answers are unavailable in this view.",
    hint: "Answer each question to create the automation, in writing or out loud.",
    progress: (answered: number, total: number) => `${answered} of ${total} answered · Required to create the automation`,
    startVoice: "Answer with voice", stopVoice: "Stop recording",
    connecting: "Connecting microphone…", listening: "Listening", interrupted: "Recording interrupted", stopped: "Recording stopped",
    level: "Microphone level", remaining: (time: string) => `${time} left`,
    voiceHint: "Talk naturally. Answers and a summary fill in as you speak. Anything you edit by hand stays unchanged.",
    updating: "Updating answers and summary…", byHand: "You can still answer in writing.", review: "Check your answers and the summary below.", waiting: "Waiting for your words…",
    liveTranscript: "Live transcript", originalTranscript: "Original transcript", retryVoice: "Retry filling from voice",
    fillFailed: "Could not fill the answers. Your words are kept. Try again.",
    answered: "Answered", extra: "Anything else to know?",
    extraHint: "Add a missing step, an exception or another remark. When you speak, your summary shows up here.",
    extraPlaceholder: "Another remark…", placeholder: "Your answer…",
    clear: "Clear", fromVoice: "Filled from voice", summaryFromVoice: "Summary from voice",
    undo: "Undo", undoLabel: (question: string) => `Undo voice answer: ${question}`,
    saved: "Answers saved.",
    saveFailed: "Could not save the answers. Your draft is kept. Try again.",
    savingStopsVoice: "Saving stops voice and keeps the answers shown here.",
    footer: "Your answers stay here if you leave the page.",
    save: "Save answers", saving: "Saving…",
    choices: "Suggested answers",
    created: "This automation is already created. Open it from the top of the page.",
    pending: "Confirm to apply your changes to the automation.",
    confirm: "Confirm changes", applying: "Applying…",
    thinkingLabel: "Applying your changes", creatingLabel: "Creating the automation",
    thinking: (percent: number) => percent < 25 ? "Reading your changes…" : percent < 55 ? "Thinking through the automation…" : percent < 85 ? "Checking each step…" : "Finishing up…",
  },
};
/** How long « Create automation » and « Confirm changes » show the AI thinking before they act. */
export const THINKING_MS = 5000;
/**
 * Simulated AI thinking for « Create automation » and « Confirm changes »: 0 → 100 % over `ms`, in uneven
 * jumps with pauses, never going back. It reports a percentage only, no time.
 */
function think(ms: number, onProgress: (percent: number) => void) {
  return new Promise<void>(resolve => {
    const start = Date.now();
    let shown = 0;
    const tick = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= ms) { onProgress(100); resolve(); return; }
      const f = elapsed / ms;
      // Slow start, faster middle, slow end; skipped ticks read as pauses.
      const target = Math.floor(100 * f * f * (3 - 2 * f));
      if (target > shown && Math.random() > 0.35) { shown = target; onProgress(shown); }
      setTimeout(tick, Math.min(80 + Math.random() * 160, ms - elapsed));
    };
    onProgress(0); tick();
  });
}
export function WorkflowQuestions({ workflow, save, voice, active = true, createFlow, findFlow }: {
  workflow: WorkflowMap;
  save?: (correction: string) => Promise<WorkflowMap>;
  voice?: QuestionnaireVoice;
  active?: boolean;
  /** Present when the host can create an Automation Flow: every question becomes required. */
  createFlow?: (answers: WorkflowAnswer[]) => Promise<void>;
  /** The Flow already created from this task, if any: then creation is not offered again. */
  findFlow?: () => Promise<string | null>;
}) {
  const t = createFlow ? COPY.creation : COPY.en;
  const copy = useRef(t); copy.current = t;
  const questions = [...new Set((workflow.openQuestions ?? []).map(q => q.trim()).filter(q => q && q !== EXTRA))];
  const fields = [...questions, EXTRA];
  const initial = () => Object.fromEntries(readWorkflowAnswers(workflow.userCorrection).map(a => [a.question, a.answer]));
  const [restored] = useState(() => readDraft(draftKey(workflow)));
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...initial(), ...restored }));
  const [saved, setSaved] = useState<Record<string, string>>(initial);
  const fieldsRef = useRef(fields); fieldsRef.current = fields;
  const baseline = useRef(saved);
  const locked = useRef(new Set([...Object.keys(saved).filter(q => saved[q]), ...Object.keys(restored)]));
  const key = draftKey(workflow);
  useEffect(() => {
    if (save) writeDraft(key, Object.fromEntries(Object.entries(answers).filter(([q, a]) => a !== (saved[q] ?? ""))));
  }, [answers, saved, key, save]);
  const beforeVoice = useRef<Record<string, string>>({});
  const [voiceFields, setVoiceFields] = useState<Set<string>>(new Set());
  useEffect(() => {
    const latest = Object.fromEntries(readWorkflowAnswers(workflow.userCorrection).map(a => [a.question, a.answer]));
    const prior = baseline.current;
    setAnswers(current => ({ ...latest, ...Object.fromEntries(Object.entries(current).filter(([q, a]) => a !== (prior[q] ?? ""))) }));
    Object.keys(latest).filter(q => latest[q] !== prior[q]).forEach(q => locked.current.add(q));
    baseline.current = latest; setSaved(latest);
  }, [workflow.userCorrection]);
  const [voiceState, setVoiceState] = useState<VoiceState>({ status: "idle", remaining: 120 });
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");
  const [filling, setFilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  // « Create automation » / « Confirm changes »: the simulated thinking, in
  // percent. Held at 100 % until the host has opened the Review Screen.
  const [progress, setProgress] = useState<number | null>(null);
  // The Flow already created from this task: the page header opens it.
  const [existingFlow, setExistingFlow] = useState<string | null>(null);
  // Looked up per task, and again each time the page is shown: the host keeps
  // it mounted while hidden, and a Flow may be created meanwhile. The host
  // passes a new function on every render.
  const findFlowRef = useRef(findFlow); findFlowRef.current = findFlow;
  const canFindFlow = Boolean(findFlow);
  useEffect(() => {
    if (!active || !canFindFlow || !findFlowRef.current) return;
    let current = true;
    findFlowRef.current().then(flowId => { if (current) setExistingFlow(flowId); }, () => {});
    return () => { current = false; };
  }, [active, canFindFlow, workflow.id]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const session = useRef<QuestionnaireVoiceSession>();
  const filler = useRef<LiveVoiceFill>();
  const finishVoice = useRef<() => void>();
  const [voiceSession, setVoiceSession] = useState(0);
  const prefix = useRef("");
  const id = useId();
  const recording = voiceState.status === "connecting" || voiceState.status === "listening";
  const changed = fields.some(q => (answers[q] ?? "").trim() !== (saved[q] ?? "").trim());
  useEffect(() => {
    if (!voice || !active) { setFilling(false); return; }
    const abort = new AbortController();
    let mounted = true;
    const fill = new LiveVoiceFill(async text => {
      try {
        const patches = await voice.fill({ questions: fieldsRef.current, transcript: text, locked: [...locked.current] }, abort.signal);
        if (!mounted) return;
        setAnswers(current => {
          const next = { ...current };
          for (const patch of patches) {
            // Manual edits made during inference also win over its late result.
            if (locked.current.has(patch.question) || !fieldsRef.current.includes(patch.question) || !patch.quote.trim() || !text.includes(patch.quote)) continue;
            if (!(patch.question in beforeVoice.current)) beforeVoice.current[patch.question] = current[patch.question] ?? "";
            next[patch.question] = patch.answer;
          }
          return next;
        });
        setVoiceFields(current => new Set([...current, ...patches.filter(p => !locked.current.has(p.question) && fieldsRef.current.includes(p.question) && p.quote.trim() && text.includes(p.quote)).map(p => p.question)]));
        setError("");
      } catch (cause) { if (mounted) setError(cause instanceof Error ? cause.message : copy.current.fillFailed); }
    }, value => { if (mounted) setFilling(value); });
    filler.current = fill;
    const connection = new QuestionnaireVoiceSession(voice, state => {
      if (!mounted) return;
      setVoiceState(state);
      if (state.status === "stopped" || state.status === "error") fill.enqueue(transcriptRef.current, true);
    }, text => {
      if (!mounted) return;
      const combined = [prefix.current, text].filter(Boolean).join("\n").slice(-24000);
      transcriptRef.current = combined; setTranscript(combined); fill.enqueue(combined);
    });
    session.current = connection;
    const dispose = () => {
      mounted = false;
      // Invalidate callbacks before stopping: Stop normally queues a final fill.
      connection.stop(); fill.dispose(); abort.abort();
      session.current = undefined; filler.current = undefined; finishVoice.current = undefined;
      setFilling(false);
      setVoiceState(s => ({ ...s, status: "stopped", level: undefined }));
    };
    finishVoice.current = () => {
      dispose();
      // A later recording gets a fresh controller and cannot revive stale fills.
      setVoiceSession(value => value + 1);
    };
    return dispose;
  }, [voice, active, voiceSession]);
  function manual(question: string, value: string) {
    locked.current.add(question);
    setAnswers(a => ({ ...a, [question]: value })); setNotice("");
    setVoiceFields(current => { const next = new Set(current); next.delete(question); return next; });
  }
  function toggleVoice() {
    if (recording) { session.current?.stop(); return; }
    prefix.current = transcriptRef.current; setError(""); setNotice("");
    void session.current?.start(workflow.title.slice(0, 300), questions.slice(0, 30));
  }
  const answered = questions.filter(q => answers[q]?.trim()).length;
  const complete = answered === questions.length;
  async function persist(write: NonNullable<typeof save>) {
    const next = await write(writeWorkflowAnswers(workflow.userCorrection, fields.filter(q => (answers[q] ?? "").trim() !== (saved[q] ?? "").trim()).map(question => ({ question, answer: answers[question] ?? "" }))));
    const persisted = Object.fromEntries(readWorkflowAnswers(next.userCorrection).map(a => [a.question, a.answer]));
    baseline.current = persisted; setAnswers(persisted); setSaved(persisted); Object.keys(persisted).forEach(q => locked.current.add(q)); setVoiceFields(new Set());
    return persisted;
  }
  async function submit() {
    if (!save || !changed || saving.current) return;
    if (recording || filling) finishVoice.current?.();
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await persist(save);
      setNotice(t.saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.saveFailed); }
    finally { saving.current = false; setBusy(false); }
  }
  /**
   * Saves the answers first, so the Flow is never created from answers that
   * were not kept. Once the Flow exists, the same call applies changed
   * answers to it (« Confirm changes »). Both show a simulated AI thinking;
   * the form stays locked until `createFlow` resolves, which the host does
   * once its Review Screen is on screen.
   */
  async function create() {
    if (!createFlow || !complete || (existingFlow && !changed) || saving.current) return;
    if (recording || filling) finishVoice.current?.();
    saving.current = true; setBusy(true); setCreating(true); setError(""); setNotice("");
    try {
      const kept = save && changed ? await persist(save) : answers;
      await think(THINKING_MS, setProgress);
      await createFlow(fields.filter(q => kept[q]?.trim()).map(question => ({ question, answer: kept[question].trim() })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : existingFlow ? "Could not apply the changes. Your answers are kept. Try again." : "Could not create the automation. Your answers are kept. Try again."); }
    finally { saving.current = false; setBusy(false); setCreating(false); setProgress(null); }
  }
  if (!questions.length) return null;
  const saveButton = <button type="submit" disabled={!changed || busy}>{busy ? t.saving : t.save}</button>;
  return <section className={styles.questions} aria-label={t.section}>
    <div className={styles.heading}>
      <div><h2>{t.title}</h2><p className={styles.hint}>{!save ? t.unavailable : t.hint}</p></div>
      {voice && save && <button type="button" className={styles.voiceButton} disabled={!active || busy || (!recording && filling)} onClick={toggleVoice}>
        {recording ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}{recording ? t.stopVoice : t.startVoice}
      </button>}
    </div>
    <p className={styles.progress} role="status">{t.progress(answered, questions.length)}</p>
    {(recording || transcript || voiceState.error) && <div className={styles.voicePanel}>
      <div className={styles.voiceStatus}><span>{voiceState.status === "connecting" ? <Loader2 size={16} /> : <Mic size={16} />}{voiceState.status === "connecting" ? t.connecting : recording ? t.listening : voiceState.status === "error" ? t.interrupted : t.stopped}</span>
        {recording && <span><meter aria-label={t.level} min={0} max={1} value={voiceState.level ?? 0} />{t.remaining(`${Math.floor(voiceState.remaining / 60)}:${String(voiceState.remaining % 60).padStart(2, "0")}`)}</span>}
      </div>
      <p className={styles.hint}>{t.voiceHint}</p>
      <p className={styles.progress} aria-live="polite">{filling ? t.updating : voiceState.error ? t.byHand : transcript ? t.review : t.waiting}</p>
      {voiceState.error && <p className={styles.error} role="alert">{voiceState.error}</p>}
      {transcript && <details open={recording}><summary>{recording ? t.liveTranscript : t.originalTranscript}</summary><p className={styles.transcript}>{transcript}</p></details>}
      {!recording && transcript && <button type="button" className={styles.textButton} disabled={filling || busy} onClick={() => filler.current?.enqueue(transcriptRef.current, true, true)}>{t.retryVoice}</button>}
    </div>}
    {/* Creation mode has one way to confirm: create the automation, or once it
        exists apply the changed answers to it (both save the answers first). */}
    <form onSubmit={e => { e.preventDefault(); if (!createFlow) void submit(); else void create(); }}>
      {fields.map((question, index) => <div key={question} className={styles.field}>
        <label htmlFor={`${id}-${index}`}><span className={styles.number}>{index < questions.length ? String(index + 1).padStart(2, "0") : ""}</span><span>{question === EXTRA ? t.extra : question}</span>{answers[question]?.trim() && <Check size={16} aria-label={t.answered} />}</label>
        <div className={styles.answer}>
          {question === EXTRA && <p className={styles.hint}>{t.extraHint}</p>}
          {question !== EXTRA && (workflow.openQuestionChoices?.[question] ?? []).length > 0 && <div className={styles.choices} role="group" aria-label={`${t.choices}: ${question}`}>
            {workflow.openQuestionChoices![question].map(choice => <button key={choice} type="button" aria-pressed={(answers[question] ?? "").trim() === choice} disabled={!save || busy} onClick={() => manual(question, choice)}>{choice}</button>)}
          </div>}
          <textarea id={`${id}-${index}`} aria-label={question === EXTRA ? t.extra : question} rows={question === EXTRA ? 3 : 2} maxLength={4000} value={answers[question] ?? ""} placeholder={question === EXTRA ? t.extraPlaceholder : t.placeholder} disabled={!save || busy} onChange={e => manual(question, e.target.value)} />
          <div className={styles.fieldActions}>
            {question !== EXTRA && !createFlow && <label><input type="checkbox" checked={answers[question] === "Not sure"} disabled={!save || busy} onChange={e => manual(question, e.target.checked ? "Not sure" : "")} />Not sure</label>}
            {answers[question]?.trim() && <button type="button" disabled={!save || busy} onClick={() => manual(question, "")}>{t.clear}</button>}
            {voiceFields.has(question) && <span><Mic size={12} />{question === EXTRA ? t.summaryFromVoice : t.fromVoice}<button type="button" disabled={busy} aria-label={t.undoLabel(question === EXTRA ? t.extra : question)} onClick={() => manual(question, beforeVoice.current[question] ?? "")}><Undo2 size={12} />{t.undo}</button></span>}
          </div>
        </div>
      </div>)}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {save && <div className={styles.actions}>{progress !== null
        ? <div className={styles.thinking} role="progressbar" aria-label={existingFlow ? t.thinkingLabel : t.creatingLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div><div>{t.thinking(progress)}</div><div>{progress}%</div></div>
          <div className={styles.track}><div style={{ width: `${progress}%` }} /></div>
        </div>
        : <span role="status">{notice || (recording || filling ? t.savingStopsVoice : createFlow && existingFlow ? changed ? t.pending : t.created : t.footer)}</span>}{createFlow ? existingFlow
        ? <button type="submit" disabled={!changed || !complete || busy}>{creating ? t.applying : t.confirm}</button>
        : <button type="submit" disabled={!complete || busy}>{creating ? "Creating…" : "Create automation"}</button> : saveButton}</div>}
    </form>
  </section>;
}
