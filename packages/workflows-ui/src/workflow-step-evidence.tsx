// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Play, Trash2, X } from "lucide-react";
import type { WorkflowMap, WorkflowStage, WorkflowScreenshot } from "./model";
import type { WorkflowsPlatform } from "./platform";
import { WorkflowReplay } from "./workflow-replay";
import { isEmbeddedScreenshot, verifiedStageScreenshots } from "./screenshots";
import { useSourceScreenshot } from "./use-source-screenshot";
import styles from "./workflow-step-evidence.module.css";

const when = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date unavailable";

export function WorkflowStepEvidence({ workflow, stage, platform, timelineLabel, onImageLayoutChange }: {
  workflow: WorkflowMap; stage: WorkflowStage; platform: WorkflowsPlatform;
  /** Visible text of the button that opens a capture in the Timeline (the
   * Automation Flow Task Page says "View in timeline"); icon only when absent. */
  timelineLabel?: string;
  /** Authoring hook from the workflow editor: reorder, hide or relocate the
   * images of this step without touching the captured evidence itself. */
  onImageLayoutChange?: (layout: NonNullable<WorkflowStage["imageLayout"]>) => void;
}) {
  const label = platform.openCapturedMoment ? timelineLabel : undefined;
  const [enlarged, setEnlarged] = useState<Set<number>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [selected, setSelected] = useState<WorkflowScreenshot | null>(null);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (playing) playerRef.current?.scrollIntoView?.({ block: "start" }); }, [playing]);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const replay = useMemo(() => ({ ...workflow, stages: [selected ? {
    ...stage, evidence: stage.evidence.filter(e => e.app.toLowerCase() === selected.app.toLowerCase()
      && Date.parse(e.timestamp) === Date.parse(selected.timestamp)),
  } : stage] }), [workflow, stage, selected]);
  const attached = verifiedStageScreenshots(stage);
  const preview = useSourceScreenshot(stage, attached.length > 0, platform.loadWorkflowScreenshot);
  const available = attached.length ? attached : preview.image ? [preview.image] : [];
  const layout = stage.imageLayout ?? { order: [], hidden: [], beforeText: false };
  const ordered = [...available].sort((a, b) => {
    const rank = (id: number) => { const at = layout.order.indexOf(id); return at < 0 ? layout.order.length : at; };
    return rank(a.frameId) - rank(b.frameId);
  });
  const screenshots = ordered.filter(image => !layout.hidden.includes(image.frameId));
  const removeImage = (id: number) => {
    onImageLayoutChange?.({ ...layout, hidden: [...new Set([...layout.hidden, id])] });
    setSelectedImage(null);
  };
  const moveImage = (position: number, direction: -1 | 1) => {
    const next = position + direction;
    if (next < 0 || next >= screenshots.length) {
      onImageLayoutChange?.({ ...layout, beforeText: direction === -1 });
    } else {
      const order = screenshots.map(image => image.frameId);
      [order[position], order[next]] = [order[next], order[position]];
      onImageLayoutChange?.({ ...layout, order });
      // The carousel keeps the capture that was moved in view.
      setIndex(next);
    }
  };
  const screenshot = screenshots[0];
  // One capture at a time; the position survives catalog refreshes that shorten the list.
  const count = screenshots.length;
  const position = Math.min(index, Math.max(count - 1, 0));
  const current = screenshots[position];
  const suffix = count > 1 ? ` ${position + 1}` : "";
  const move = (delta: number) => setIndex((position + delta + count) % count);
  const canReplay = platform.loadWorkflowRecording && stage.evidence.some(e => !["audio", "meeting"].includes(e.source ?? "") && Number.isFinite(Date.parse(e.timestamp)));
  const openRecording = async (capture = screenshot) => {
    if (!platform.openCapturedMoment) { setSelected(capture ?? null); setPlaying(true); return; }
    setOpening(true); setOpenError(false);
    let media: Awaited<ReturnType<NonNullable<WorkflowsPlatform["loadWorkflowRecording"]>>> = null;
    try {
      if (capture) await platform.openCapturedMoment(capture.frameId, capture.timestamp);
      else {
        const entry = stage.evidence.find(e => !["audio", "meeting"].includes(e.source ?? "") && Number.isFinite(Date.parse(e.timestamp)));
        if (!entry || !platform.loadWorkflowRecording) throw new Error("Missing capture");
        media = await platform.loadWorkflowRecording(entry.timestamp, entry.app);
        if (!media) throw new Error("Capture unavailable");
        await platform.openCapturedMoment(media.frameId, media.timestamp);
      }
    } catch { setOpenError(true); }
    finally {
      setOpening(false);
      if (media?.url.startsWith("blob:")) URL.revokeObjectURL(media.url);
      else if (media?.url && platform.releaseWorkflowRecording) void platform.releaseWorkflowRecording(media.url).catch(() => {});
    }
  };
  return <section ref={preview.ref} onKeyDown={event => {
    if (event.key === "Escape") { setSelectedImage(null); event.stopPropagation(); }
  }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setSelectedImage(null); }} onLoad={() => setPreviewHeight(preview.ref.current?.getBoundingClientRect().height ?? 0)} style={!attached.length && !screenshots.length && previewHeight ? { minHeight: previewHeight } : undefined} className={`${styles.evidence} ph-no-capture ph-mask`} aria-label={`References for ${stage.name}`}>
    {!playing && !available.length && <div className={styles.previewStatus} role="status">
      {preview.status === "loading" ? "Loading source screenshot…" : preview.status === "error" ? "Could not load the source screenshot." : "No screenshot available for this step."}
      {preview.canRetry && preview.status !== "loading" && <button type="button" onClick={preview.retry}>Retry screenshot</button>}
    </div>}
    {!playing && current && <div className={`${styles.carousel} ${count > 1 ? styles.paged : ""} ${enlarged.has(current.frameId) ? styles.carouselExpanded : ""}`} role="group" aria-roledescription="carousel" aria-label={`Captures for ${stage.name}`}
      tabIndex={count > 1 ? 0 : undefined} onKeyDown={count > 1 ? event => {
        if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
      } : undefined}>
      <EvidenceFigure key={`${current.frameId}:${current.timestamp}`} capture={current} stage={stage} platform={platform} suffix={suffix} expanded={enlarged.has(current.frameId)} selected={selectedImage === current.frameId} opening={opening} label={label}
        actions={onImageLayoutChange ? { remove: () => removeImage(current.frameId), up: () => moveImage(position, -1), down: () => moveImage(position, 1),
          upDisabled: position === 0 && layout.beforeText, downDisabled: position === screenshots.length - 1 && !layout.beforeText } : undefined}
        toggle={() => setEnlarged(previous => { const next = new Set(previous); if (!next.delete(current.frameId)) next.add(current.frameId); return next; })}
        select={() => setSelectedImage(current.frameId)}
        replay={!isEmbeddedScreenshot(current) && (canReplay || !!platform.openCapturedMoment) ? () => void openRecording(current) : undefined}
        resolved={current === preview.image} />
      {/* Outside the keyed figure, so focus stays on the control that was used. */}
      {count > 1 && <div className={styles.carouselNav}>
        <button type="button" aria-label={`Previous capture for ${stage.name}`} title="Previous capture" onClick={() => move(-1)}><ChevronLeft size={15} aria-hidden="true" /></button>
        <span aria-live="polite">{position + 1} / {count}</span>
        <button type="button" aria-label={`Next capture for ${stage.name}`} title="Next capture" onClick={() => move(1)}><ChevronRight size={15} aria-hidden="true" /></button>
      </div>}
    </div>}
    {!playing && onImageLayoutChange && layout.hidden.length > 0 && <button type="button" className={styles.restore} onClick={() => onImageLayoutChange({ ...layout, hidden: [] })}>Restore deleted images</button>}
    {playing && <div ref={playerRef} className={styles.player}>
      <button type="button" className={styles.close} aria-label={`Close recording for ${stage.name}`} title="Close recording" onClick={() => setPlaying(false)}><X size={15} /></button>
      <WorkflowReplay workflow={replay} loadRecording={platform.loadWorkflowRecording} releaseRecording={platform.releaseWorkflowRecording} openCapturedMoment={platform.openCapturedMoment} />
    </div>}
    <div className={styles.links}>
      {!screenshots.length && (canReplay || (screenshot && platform.openCapturedMoment)) && !playing && <RecordingButton label={label} opening={opening} onClick={() => void openRecording()}
        name={label ? `${label} : ${stage.name}` : `${platform.openCapturedMoment ? "Open" : "View"} recording for ${stage.name}`} />}
      {openError && <span role="alert">Could not open this capture. Try again.</span>}
    </div>
  </section>;
}

/** Opens or plays a capture; with a `label`, it opens the Timeline and says so in words. */
function RecordingButton({ label, name, opening, onClick }: {
  label?: string; name: string; opening: boolean; onClick: () => void;
}) {
  return <button className={label ? `${styles.recording} ${styles.labelled}` : styles.recording} title={label ? undefined : "Open recording"} type="button" disabled={opening} onClick={onClick} aria-label={name}>
    {opening ? <Loader2 size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{label}
  </button>;
}

function EvidenceFigure({ capture, stage, platform, suffix, expanded, selected, opening, label, toggle, select, actions, replay, resolved }: {
  capture: WorkflowScreenshot; stage: WorkflowStage; platform: WorkflowsPlatform; suffix: string;
  expanded: boolean; selected: boolean; opening: boolean; label?: string; toggle: () => void; select: () => void; replay?: () => void; resolved: boolean;
  actions?: { remove: () => void; up: () => void; down: () => void; upDisabled: boolean; downDisabled: boolean };
}) {
  const load = resolved || isEmbeddedScreenshot(capture) ? undefined : platform.loadWorkflowScreenshot;
  const preview = useSourceScreenshot(stage, !load, load, capture);
  // Desktop recorder frames always resolve through the recorder, including
  // legacy positive-ID copies. Only scripted negative-ID images use their own pixels.
  const url = load ? preview.image?.dataUrl : capture.dataUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  // A fixed frame keeps the page short and steady while captures load or change.
  // While authoring (`actions`), the image selects for the layout toolbar instead of zooming.
  return <figure ref={preview.ref} className={`${styles.figure} ${expanded ? styles.expanded : ""} ${selected ? styles.selected : ""} ${actions ? styles.selectable : ""}`}>
    {url && !failed ? <button className={styles.imageButton} type="button"
      aria-label={actions ? `Select screenshot${suffix} for ${stage.name}` : `${expanded ? "Reduce" : "Enlarge"} screenshot${suffix} for ${stage.name}`}
      aria-pressed={actions ? selected : undefined} aria-expanded={actions ? undefined : expanded}
      onClick={actions ? select : toggle}
      onKeyDown={actions ? event => {
        if (selected && ["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); actions.remove(); }
      } : undefined}>
      <img src={url} alt={`Captured reference${suffix} for ${stage.name}`} loading="lazy" decoding="async" draggable={false} data-lm-disable="true" onError={() => setFailed(true)} />
      {!actions && <span className={styles.zoom}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</span>}
    </button> : <div className={`${styles.previewStatus} ${styles.frameStatus}`} role="status">
      {failed || preview.status === "error" ? "Could not load the source screenshot." : preview.status === "loading" ? "Loading source screenshot…" : "This screenshot is no longer available."}
      {(failed || preview.status === "error") && load && <button onClick={() => { setFailed(false); preview.retry(); }}>Retry screenshot</button>}
    </div>}
    {selected && actions && <div className={styles.imageActions} role="toolbar" aria-label="Selected image">
      <button type="button" onClick={actions.up} disabled={actions.upDisabled} aria-label="Move image up"><ArrowUp size={15} />Move up</button>
      <button type="button" onClick={actions.down} disabled={actions.downDisabled} aria-label="Move image down"><ArrowDown size={15} />Move down</button>
      <button type="button" onClick={actions.remove} aria-label="Delete image"><Trash2 size={15} />Delete</button>
    </div>}
    <figcaption><span>{!capture.visualVerified ? "Source screenshot · " : ""}{capture.app} · {when(capture.timestamp)}</span>
      {replay && <RecordingButton label={label} opening={opening} onClick={replay}
        name={label ? `${label}${suffix} : ${stage.name}` : `${platform.openCapturedMoment ? "Open" : "View"} recording${suffix} for ${stage.name}`} />}
    </figcaption>
  </figure>;
}
