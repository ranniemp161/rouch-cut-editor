"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Scissors, RotateCw, Minus, Plus, Magnet, Maximize2 } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { useContextMenu } from "@/hooks/useContextMenu";
import {
  editedToSource,
  sourceToEdited,
  type KeptRange,
} from "@/lib/editMap";
import { useEditMap } from "@/hooks/useEditMap";
import { WaveformCanvas } from "./WaveformCanvas";
import { FrameStrip } from "./FrameStrip";

type Lane = "V1" | "A1";

const ZOOM_MIN = 1;
const ZOOM_MAX = 20;
const ZOOM_STEP = 1.2;

const LANE_HEIGHT = 56;

interface MarqueeRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  width: number;
}

// A persistent edited-time range painted on the tracks after the user
// finishes a drag. Cleared on next click / Backspace.
interface RangeSelection {
  editedStart: number;
  editedEnd: number;
}

// A clip on the edited timeline = one kept range, with the underlying word
// IDs cached for selection.
interface Clip {
  range: KeptRange;
  wordIds: string[];
  keptWordIds: string[];
  anchorIndex: number;
  // Pre-joined transcript text and first/last word labels — computed once
  // here so ClipBlock can render overlays and hover info without re-walking
  // the transcript on every paint.
  text: string;
  firstWord: string;
  lastWord: string;
}

export function Timeline() {
  const currentTime = useEditorStore((s) => s.currentTime);
  const sourceDuration = useEditorStore((s) => s.durationSeconds);
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const magneticTimeline = useEditorStore((s) => s.magneticTimeline);
  const setMagneticTimeline = useEditorStore((s) => s.setMagneticTimeline);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const setClipTrim = useEditorStore((s) => s.setClipTrim);
  const frameRate = useEditorStore((s) => s.frameRate);
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const segments = useEditorStore((s) => s.segments);
  const splitMarkers = useEditorStore((s) => s.splitMarkers);
  const clipTrims = useEditorStore((s) => s.clipTrims);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const lastClickedIndex = useEditorStore((s) => s.lastClickedIndex);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setLastClickedIndex = useEditorStore((s) => s.setLastClickedIndex);
  const bulkToggleWords = useEditorStore((s) => s.bulkToggleWords);
  const clearTrimsForIds = useEditorStore((s) => s.clearTrimsForIds);
  const addSplitMarker = useEditorStore((s) => s.addSplitMarker);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [rangeSelection, setRangeSelection] = useState<RangeSelection | null>(null);
  const [zoom, setZoom] = useState(1);
  // Cursor-hover preview on the ruler. Stored as an edited-time value (null
  // while the cursor is elsewhere). CapCut shows a faint guideline + tooltip
  // wherever the cursor hovers the ruler so you can read the exact time
  // before committing to a scrub.
  const [hoverEdited, setHoverEdited] = useState<number | null>(null);
  // Source-time of the active snap target during a trim drag, or null when
  // the cursor is between snap candidates. Drives the cyan guide line.
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const pendingZoomCursor = useRef<{ time: number; cursorX: number } | null>(null);

  const menu = useContextMenu();

  // ── Edit map: source ↔ edited mapping ─────────────────────────────────────
  const editMap = useEditMap(transcript, deletedWordIds, segments, sourceDuration, clipTrims);
  const editedDuration = editMap.editedDuration;
  const canRender = editedDuration > 0;

  // Diagnostic readout: total cut duration and trim entry count. If the user
  // can't see deletions taking effect, this surfaces whether the edit map
  // actually contains them — and whether stale per-clip pads are swallowing
  // them. Renders as a tiny mono badge in the toolbar.
  const newModelClips = useEditorStore((s) => s.clips);
  const cutStats = useMemo(() => {
    let totalCutS = 0;
    for (const r of editMap.deletedRegions) totalCutS += r.end - r.start;
    return {
      regions: editMap.deletedRegions.length,
      totalS: totalCutS,
      trims: Object.keys(clipTrims).length,
      newClips: newModelClips.length,
    };
  }, [editMap, clipTrims, newModelClips]);

  // Live edited-duration handle for the trim-drag handler — that handler runs
  // on pointermove and needs the *current* pxPerSec, not the value at
  // pointerdown (the timeline rescales as words are restored).
  const editedDurationRef = useRef(editedDuration);
  useEffect(() => {
    editedDurationRef.current = editedDuration;
  }, [editedDuration]);

  // The persisted range-selection box is anchored in *edited time*; once any
  // edit shifts the edit map, those coordinates point at the wrong source
  // range. Clear the box on any underlying edit so we never paint a stale
  // overlay. (Marquee-during-drag is unaffected — it lives in pixel space.)
  useEffect(() => {
    setRangeSelection(null);
  }, [deletedWordIds, segments, splitMarkers]);

  // After any edit, if the source-time playhead now falls inside a deleted
  // region, jump the video forward to the next kept range. Without this the
  // video element would happily play (and render audio for) freshly cut
  // content the moment the user hits play. Fires only on edit-map changes,
  // not on every timeupdate tick.
  const lastEditMapRef = useRef(editMap);
  useEffect(() => {
    if (lastEditMapRef.current === editMap) return;
    lastEditMapRef.current = editMap;
    if (!canRender) return;
    const nowSrc = useEditorStore.getState().currentTime;
    const e = sourceToEdited(nowSrc, editMap);
    if (e !== null) return;
    for (const r of editMap.keptRanges) {
      if (r.sourceStart >= nowSrc) {
        setSeekTime(r.sourceStart);
        return;
      }
    }
    const last = editMap.keptRanges[editMap.keptRanges.length - 1];
    if (last) setSeekTime(last.sourceEnd);
  }, [editMap, canRender, setSeekTime]);

  // Build clip metadata once per edit-map change. Each kept range is further
  // subdivided by any split markers that fall inside it — a split turns one
  // visual block into two adjacent blocks sharing a seam at the split time.
  const clips = useMemo<Clip[]>(() => {
    if (editMap.keptRanges.length === 0) return [];
    const out: Clip[] = [];
    let wi = 0;
    for (const range of editMap.keptRanges) {
      const splitsIn = splitMarkers
        .filter((s) => s > range.sourceStart + 0.0005 && s < range.sourceEnd - 0.0005)
        .sort((a, b) => a - b);
      const boundaries = [range.sourceStart, ...splitsIn, range.sourceEnd];

      while (wi < transcript.length && transcript[wi].start < range.sourceStart) wi++;

      for (let bi = 0; bi < boundaries.length - 1; bi++) {
        const subStart = boundaries[bi];
        const subEnd = boundaries[bi + 1];
        const subRange: KeptRange = {
          sourceStart: subStart,
          sourceEnd: subEnd,
          editedStart: range.editedStart + (subStart - range.sourceStart),
          editedEnd: range.editedStart + (subEnd - range.sourceStart),
        };
        // Include EVERY transcript word whose start lies inside the sub-clip,
        // regardless of deletion state. The deletion filter we used to apply
        // here turned trim-extended kept ranges into "phantom clips" with no
        // wordIds — right-click → Delete on those silently failed because
        // bulkToggleWords was called with []. Including the deleted words
        // means Delete/Restore always has something to act on; the actual
        // visible state of each word is still driven by deletedWordIds in
        // the transcript sidebar and the player skip.
        const allIds: string[] = [];
        const keptIds: string[] = [];
        let anchor = -1;
        let j = wi;
        while (j < transcript.length && transcript[j].start < subEnd) {
          const w = transcript[j];
          if (w.start >= subStart) {
            allIds.push(w.id);
            if (!deletedWordIds.has(w.id)) {
              keptIds.push(w.id);
              if (anchor === -1) anchor = j;
            }
          }
          j++;
        }
        // Render every sub-clip whose span has real duration. Deletions are
        // already excluded at the edit-map level (deleted regions truncate
        // the parent kept range), so a sub-clip surviving to here represents
        // playable timeline real estate — even if its only contents are
        // silence or [SILENCE] markers. Filtering here would punch visible
        // gaps in the timeline at silence boundaries between split markers,
        // which the user reads as broken layout. Keep the clip; the actual
        // audio for any deleted words inside it is silent thanks to the
        // edit-map's deleted-region skip.
        if (subEnd - subStart > 0.0005) {
          const keptSet = new Set(keptIds);
          const keptWords: string[] = [];
          for (let k = 0; k < transcript.length; k++) {
            const w = transcript[k];
            if (!keptSet.has(w.id)) continue;
            if (w.word === "[SILENCE]") continue;
            keptWords.push(w.word);
          }
          out.push({
            range: subRange,
            wordIds: allIds,
            keptWordIds: keptIds,
            anchorIndex: anchor === -1 ? wi : anchor,
            text: keptWords.join(" "),
            firstWord: keptWords[0] ?? "",
            lastWord: keptWords[keptWords.length - 1] ?? "",
          });
        }
        // Advance wi past this sub-clip so the next sub starts after it.
        while (wi < transcript.length && transcript[wi].start < subEnd) wi++;
      }
    }
    return out;
  }, [editMap, transcript, deletedWordIds, splitMarkers]);

  // Word index lookup for shift-click range math.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    transcript.forEach((w, i) => m.set(w.id, i));
    return m;
  }, [transcript]);

  // Per-clip trim limits in source-time. The trim handler clamps against
  // these so a wild outward drag can't silently absorb the neighboring
  // clip's content. Split-seam edges (where two clips share an exact
  // source-time edge) get a no-op limit on that side — there's no dead
  // zone there to restore from.
  const clipLimits = useMemo(() => {
    const SEAM_EPS = 0.001;
    return clips.map((c, i) => {
      const prev = clips[i - 1];
      const next = clips[i + 1];
      const leftIsSeam = !!(prev && Math.abs(prev.range.sourceEnd - c.range.sourceStart) < SEAM_EPS);
      const rightIsSeam = !!(next && Math.abs(next.range.sourceStart - c.range.sourceEnd) < SEAM_EPS);
      const leftLimit = leftIsSeam ? c.range.sourceStart : prev?.range.sourceEnd ?? 0;
      const rightLimit = rightIsSeam ? c.range.sourceEnd : next?.range.sourceStart ?? sourceDuration;
      return { leftLimit, rightLimit, leftIsSeam, rightIsSeam };
    });
  }, [clips, sourceDuration]);

  // Playhead position in edited coordinates.
  // If the user just deleted the region the playhead sits in, the source
  // time maps to "nowhere" — snap it to the seam between adjacent kept
  // ranges so the cursor stays put visually instead of slamming back to 0.
  const playheadEdited = useMemo(() => {
    if (!canRender) return 0;
    const e = sourceToEdited(currentTime, editMap);
    if (e !== null) return e;
    for (const r of editMap.keptRanges) {
      if (r.sourceStart >= currentTime) return r.editedStart;
    }
    return editMap.editedDuration;
  }, [currentTime, editMap, canRender]);
  const playheadPct = canRender ? (playheadEdited / editedDuration) * 100 : 0;

  // ── Scrubbing (ruler) — operates in EDITED time ───────────────────────────
  const editedTimeFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = rulerRef.current;
      if (!el || editedDuration <= 0) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return percent * editedDuration;
    },
    [editedDuration],
  );

  // Edited-time positions of every cut boundary the playhead should snap to
  // (kept-range edges + split markers). Used by both the ruler scrub and the
  // direct playhead drag — Alt held during a drag disables snap, matching
  // CapCut's "free scrub" override.
  const SCRUB_SNAP_PX = 8;
  const snapPlayhead = useCallback(
    (et: number, alt: boolean): { et: number; snappedSource: number | null } => {
      if (alt) return { et, snappedSource: null };
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || editedDuration <= 0) {
        return { et, snappedSource: null };
      }
      const pxPerSec = rect.width / editedDuration;
      const tolSec = SCRUB_SNAP_PX / pxPerSec;
      let bestEt = et;
      let bestSrc: number | null = null;
      let bestDist = Infinity;
      for (const c of cutBoundariesRef.current) {
        const ce = sourceToEdited(c, editMap);
        if (ce === null) continue;
        const d = Math.abs(ce - et);
        if (d < bestDist && d <= tolSec) {
          bestDist = d;
          bestEt = ce;
          bestSrc = c;
        }
      }
      return { et: bestEt, snappedSource: bestSrc };
    },
    [editMap, editedDuration],
  );

  // Shared scrub starter — used by both the ruler pointerdown and the
  // playhead-head pointerdown. seekFromClientX=false means "enter scrub mode
  // without jumping" (clicking the playhead itself shouldn't teleport it).
  const startScrubbing = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, seekFromClientX: boolean) => {
      if (e.button !== 0) return;
      if (seekFromClientX) {
        const et = editedTimeFromClientX(e.clientX);
        if (et !== null) {
          const { et: snappedEt, snappedSource } = snapPlayhead(et, e.altKey);
          setSeekTime(editedToSource(snappedEt, editMap));
          setSnapGuide(snappedSource);
        }
      }
      setIsScrubbing(true);
    },
    [editMap, editedTimeFromClientX, setSeekTime, snapPlayhead],
  );

  const handleRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => startScrubbing(e, true),
    [startScrubbing],
  );

  const handlePlayheadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      startScrubbing(e, false);
    },
    [startScrubbing],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: PointerEvent) => {
      const et = editedTimeFromClientX(e.clientX);
      if (et === null) return;
      const { et: snappedEt, snappedSource } = snapPlayhead(et, e.altKey);
      setSeekTime(editedToSource(snappedEt, editMap));
      setSnapGuide(snappedSource);
    };
    const onUp = () => {
      setIsScrubbing(false);
      setSnapGuide(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isScrubbing, editMap, editedTimeFromClientX, setSeekTime, snapPlayhead]);

  // ── Clip click + shift-click ──────────────────────────────────────────────
  const handleClipClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => {
      if (e.shiftKey && lastClickedIndex !== null) {
        const target = clip.anchorIndex;
        const [from, to] =
          lastClickedIndex < target ? [lastClickedIndex, target] : [target, lastClickedIndex];
        const next = new Set<string>();
        for (let i = from; i <= to; i++) next.add(transcript[i].id);
        setSelectedWords(next);
        return;
      }
      setSelectedWords(new Set(clip.wordIds));
      setLastClickedIndex(clip.anchorIndex);
      setSeekTime(clip.range.sourceStart);
    },
    [lastClickedIndex, setLastClickedIndex, setSeekTime, setSelectedWords, transcript],
  );

  const handleClipContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => {
      e.preventDefault();
      e.stopPropagation();
      const anyAlreadySelected = clip.wordIds.some((id) => selectedWordIds.has(id));
      if (!anyAlreadySelected) {
        setSelectedWords(new Set(clip.wordIds));
        setLastClickedIndex(clip.anchorIndex);
      }
      menu.open(e.clientX, e.clientY);
    },
    [menu, selectedWordIds, setLastClickedIndex, setSelectedWords],
  );

  const applyAndClose = useCallback(
    (isDeleted: boolean) => {
      const ids = Array.from(selectedWordIds);
      if (ids.length > 0) {
        pushHistory();
        bulkToggleWords(ids, isDeleted);
        if (isDeleted) clearTrimsForIds(ids);
      }
      setSelectedWords(new Set());
      menu.close();
    },
    [bulkToggleWords, clearTrimsForIds, menu, pushHistory, selectedWordIds, setSelectedWords],
  );

  // ── Marquee — edited-time range, mapped back to source words ──────────────
  const handleTracksPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = tracksRef.current;
      if (!el || editedDuration <= 0) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      // Clear any persistent range selection from a previous drag.
      setRangeSelection(null);
      setMarquee({ startX, startY, currentX: startX, currentY: startY, width: rect.width });
    },
    [editedDuration],
  );

  useEffect(() => {
    if (!marquee) return;
    const el = tracksRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const onMove = (e: PointerEvent) => {
      setMarquee((prev) =>
        prev
          ? {
              ...prev,
              currentX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
              currentY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
            }
          : prev,
      );
    };

    const onUp = () => {
      // Read marquee from the closure (it's the active drag) rather than
      // computing it inside a setMarquee updater — calling other setState
      // functions from within an updater is unsafe under StrictMode.
      const prev = marquee;
      setMarquee(null);
      if (!prev) return;

      const minX = Math.min(prev.startX, prev.currentX);
      const maxX = Math.max(prev.startX, prev.currentX);
      const dragged = maxX - minX > 2;
      if (!dragged) {
        setSelectedWords(new Set());
        setRangeSelection(null);
        return;
      }
      const eStart = (minX / prev.width) * editedDuration;
      const eEnd = (maxX / prev.width) * editedDuration;
      const next = new Set<string>();
      for (const w of transcript) {
        if (deletedWordIds.has(w.id)) continue;
        const we = sourceToEdited(w.start, editMap);
        if (we === null) continue;
        if (we >= eStart && we <= eEnd) next.add(w.id);
      }
      setSelectedWords(next);
      // Persist the box visually until the user clicks elsewhere or
      // hits Backspace — matches NLE-style range deletion UX.
      setRangeSelection({ editedStart: eStart, editedEnd: eEnd });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [marquee, editedDuration, transcript, deletedWordIds, editMap, setSelectedWords]);

  // ── Zoom (Ctrl/Cmd + wheel) ───────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (editedDuration <= 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const innerWidth = rect.width * zoom;
      const cursorTime = ((el.scrollLeft + cursorX) / innerWidth) * editedDuration;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
      if (newZoom === zoom) return;
      pendingZoomCursor.current = { time: cursorTime, cursorX };
      setZoom(newZoom);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoom, editedDuration]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingZoomCursor.current;
    if (!el || !pending || editedDuration <= 0) return;
    const rect = el.getBoundingClientRect();
    const innerWidth = rect.width * zoom;
    const newScrollLeft = (pending.time / editedDuration) * innerWidth - pending.cursorX;
    el.scrollLeft = Math.max(0, newScrollLeft);
    pendingZoomCursor.current = null;
  }, [zoom, editedDuration]);

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  }, []);

  // Fit-to-window resets zoom to 1×, which makes the inner track div exactly
  // span the viewport (width: `${zoom * 100}%`). Also zeros scroll so the
  // start of the timeline is visible. Keyboard shortcut: Shift+Z.
  const fitToWindow = useCallback(() => {
    setZoom(1);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, []);

  // ── Cut boundaries in source-time (kept-range edges + split markers) ──────
  // Q/W ripple-delete uses these to find the previous/next "cut" relative
  // to the playhead. The list is sorted and deduped.
  const cutBoundaries = useMemo(() => {
    const set = new Set<number>();
    set.add(0);
    if (sourceDuration > 0) set.add(sourceDuration);
    for (const r of editMap.keptRanges) {
      set.add(r.sourceStart);
      set.add(r.sourceEnd);
    }
    for (const s of splitMarkers) set.add(s);
    return Array.from(set).sort((a, b) => a - b);
  }, [editMap, splitMarkers, sourceDuration]);

  const cutBoundariesRef = useRef(cutBoundaries);
  useEffect(() => { cutBoundariesRef.current = cutBoundaries; }, [cutBoundaries]);

  // ── S / Q / W / Backspace keyboard actions ────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const state = useEditorStore.getState();
      const now = state.currentTime;
      const k = e.key.toLowerCase();

      // Undo / redo. Cmd on macOS, Ctrl elsewhere. Shift+Z and Y both redo.
      if ((e.metaKey || e.ctrlKey) && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        setSelectedWords(new Set());
        setRangeSelection(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        setSelectedWords(new Set());
        setRangeSelection(null);
        return;
      }

      // Backspace / Delete — drop the currently-selected words (i.e. the
      // selected clip). Falls through if nothing is selected so the browser
      // can still handle the key elsewhere.
      if (e.key === "Backspace" || e.key === "Delete") {
        if (state.selectedWordIds.size === 0) return;
        e.preventDefault();
        const delIds = Array.from(state.selectedWordIds);
        pushHistory();
        bulkToggleWords(delIds, true);
        clearTrimsForIds(delIds);
        setSelectedWords(new Set());
        setRangeSelection(null);
        return;
      }

      // Shift+Arrow — frame-step edge nudge on the selected clip's pad.
      // Acts on the same `clipTrims` system the drag uses, so a press is
      // equivalent to a one-frame drag of the corresponding edge:
      //
      //   Shift+→        Extend right edge by 1 frame (+padEnd).
      //   Shift+←        Extend left edge by 1 frame (-padStart).
      //   Shift+Alt+→    Shrink right edge by 1 frame (-padEnd).
      //   Shift+Alt+←    Shrink left edge by 1 frame (+padStart).
      //
      // Selection picks the target clip: Shift+→ nudges the clip whose
      // right edge sits at the selection's rightmost word.end; Shift+←
      // does the same against the selection's leftmost word.start. With
      // no selection we bail — there's no defined edge to move.
      if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const dir: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
        const inward = e.altKey;
        const sel = state.selectedWordIds;
        if (sel.size === 0) return;

        // Selection bounds in source-time. The relevant bound is the side
        // we're moving — right for →, left for ←.
        let selLo = Infinity;
        let selHi = -Infinity;
        for (const w of state.transcript) {
          if (!sel.has(w.id)) continue;
          if (w.start < selLo) selLo = w.start;
          if (w.end > selHi) selHi = w.end;
        }
        if (selLo === Infinity) return;
        const targetTime = dir === 1 ? selHi : selLo;

        // Find the kept range that owns this edge. Tolerate a 1ms slack
        // on each side so a word ending exactly at sourceEnd still maps
        // to its own clip rather than the seam neighbour.
        const range = editMap.keptRanges.find(
          (r) => targetTime >= r.sourceStart - 0.001 && targetTime <= r.sourceEnd + 0.001,
        );
        if (!range) return;

        // Anchor word: first kept (non-deleted) word in the range. This
        // is what buildEditMap step 5 looks up to find the trim entry.
        let anchorId: string | null = null;
        for (const w of state.transcript) {
          if (w.start < range.sourceStart || w.start >= range.sourceEnd) continue;
          if (state.deletedWordIds.has(w.id)) continue;
          anchorId = w.id;
          break;
        }
        if (!anchorId) return;

        const stepS = 1 / (frameRate || 24);
        const baselineTrim = state.clipTrims[anchorId] ?? { padStart: 0, padEnd: 0 };
        // Sign of the pad delta. Outward (extending) is the default; Alt
        // inverts it. The pad sign convention itself differs by side:
        // padEnd is added to sourceEnd (positive = right edge moves
        // right), padStart is added to sourceStart (negative = left edge
        // moves left), so an outward Shift+← needs a negative padStart
        // delta.
        const delta = inward ? -stepS : stepS;
        const newTrim =
          dir === 1
            ? { padStart: baselineTrim.padStart, padEnd: baselineTrim.padEnd + delta }
            : { padStart: baselineTrim.padStart - delta, padEnd: baselineTrim.padEnd };

        e.preventDefault();
        pushHistory();
        setClipTrim(anchorId, newTrim);
        return;
      }

      // Shift+Z — fit timeline to viewport. CapCut shortcut. Guarded above
      // by the ctrl/meta+shift+z (redo) check so plain Shift+Z is safe.
      if (e.shiftKey && k === "z") {
        e.preventDefault();
        fitToWindow();
        return;
      }

      // S — splice the active clip at the playhead.
      if (k === "s") {
        e.preventDefault();
        const insideKept = editMap.keptRanges.some(
          (r) => now > r.sourceStart + 0.005 && now < r.sourceEnd - 0.005,
        );
        if (insideKept) {
          pushHistory();
          addSplitMarker(now);
        }
        return;
      }

      if (k !== "q" && k !== "w") return;
      e.preventDefault();

      // ── CapCut / DaVinci-style ripple trim to playhead ────────────
      // Q = trim from clip-start to playhead  (delete head of clip).
      // W = trim from playhead to clip-end    (delete tail of clip).
      //
      // Computed directly from editMap.keptRanges (captured in the
      // useEffect closure, always current) + splitMarkers from store.
      // Each kept range is subdivided by any split markers inside it
      // to form clip boundaries — Q/W only operates within the single
      // sub-clip the playhead sits in.

      // 1. Find the kept range the playhead is in.
      let activeRange: KeptRange | null = null;
      for (const r of editMap.keptRanges) {
        if (now >= r.sourceStart - 0.001 && now <= r.sourceEnd + 0.001) {
          activeRange = r;
          break;
        }
      }
      // Playhead is in a deleted region — nothing to trim.
      if (!activeRange) return;

      // 2. Subdivide by split markers to find exact clip boundaries.
      const rangeStart = activeRange.sourceStart;
      const rangeEnd = activeRange.sourceEnd;
      const splitsIn = state.splitMarkers
        .filter((s: number) => s > rangeStart + 0.0005 && s < rangeEnd - 0.0005)
        .sort((a: number, b: number) => a - b);
      const boundaries = [rangeStart, ...splitsIn, rangeEnd];

      let clipStart = rangeStart;
      let clipEnd = rangeEnd;
      for (let i = 0; i < boundaries.length - 1; i++) {
        if (now >= boundaries[i] - 0.001 && now <= boundaries[i + 1] + 0.001) {
          clipStart = boundaries[i];
          clipEnd = boundaries[i + 1];
          break;
        }
      }

      // Playhead flush with the trimming edge — nothing to cut.
      if (k === "q" && now - clipStart < 0.005) return;
      if (k === "w" && clipEnd - now < 0.005) return;

      const lo = k === "q" ? clipStart : now;
      const hi = k === "q" ? now : clipEnd;

      const ids: string[] = [];
      for (const w of state.transcript) {
        if (state.deletedWordIds.has(w.id)) continue;
        if (w.end > lo + 0.001 && w.start < hi - 0.001) ids.push(w.id);
      }
      if (ids.length === 0) return;

      pushHistory();
      bulkToggleWords(ids, true);
      clearTrimsForIds(ids);
      setSelectedWords(new Set());
      setRangeSelection(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [bulkToggleWords, setSeekTime, setSelectedWords, addSplitMarker, editMap, pushHistory, undo, redo, clearTrimsForIds, setClipTrim, frameRate, fitToWindow]);

  // ── Ruler ticks (in edited-time) ──────────────────────────────────────────
  // Pick a "nice" step from a fixed ladder so labels stay round (1s, 0.5s,
  // 0.1s, …) while density tracks zoom. The previous Math.round(... / target)
  // floored at 1 s, which meant no sub-second grid at any zoom — a frame-
  // level trim had no visual reference. Each tick carries a `major` flag so
  // the renderer can de-emphasise mid-ticks at fine resolutions.
  const rulerTickInfo = useMemo(() => {
    if (!canRender) return { ticks: [] as { t: number; major: boolean }[], step: 1 };
    const niceSteps = [60, 30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
    const targetCount = Math.max(6, Math.floor(10 * zoom));
    const rough = editedDuration / targetCount;
    let step = niceSteps[0];
    for (const s of niceSteps) {
      if (s <= rough) break;
      step = s;
    }
    // Major every 5th tick, so the user always has a denser-but-readable
    // grid: at 0.1s step, majors land on every 0.5s.
    const ticks: { t: number; major: boolean }[] = [];
    const eps = step * 0.001;
    for (let i = 0; i * step <= editedDuration + eps; i++) {
      ticks.push({ t: i * step, major: i % 5 === 0 });
    }
    return { ticks, step };
  }, [canRender, editedDuration, zoom]);
  const rulerStep = rulerTickInfo.step;

  // Selection bounds in edited time — feeds the floating toolbar position.
  // Falls back across deleted words: if a selected word has been cut, its
  // source time has no edited mapping; we then snap to the start of the
  // next kept range so the toolbar still has somewhere to anchor for
  // Restore. Selections with zero kept-or-snappable words hide the toolbar.
  const selectionBounds = useMemo(() => {
    if (selectedWordIds.size === 0 || !canRender) return null;
    const idLookup = new Map<string, number>();
    transcript.forEach((w, i) => idLookup.set(w.id, i));

    let minE = Infinity;
    let maxE = -Infinity;
    let count = 0;
    for (const id of selectedWordIds) {
      const idx = idLookup.get(id);
      if (idx === undefined) continue;
      const w = transcript[idx];
      const s = sourceToEdited(w.start, editMap);
      const e = sourceToEdited(Math.max(w.start, w.end - 0.001), editMap);
      // For a deleted word, both mappings will be null. Snap to the nearest
      // kept-range edge so the toolbar still anchors meaningfully.
      let lo = s;
      let hi = e;
      if (lo === null && hi === null) {
        for (const r of editMap.keptRanges) {
          if (r.sourceStart >= w.start) { lo = r.editedStart; hi = r.editedStart; break; }
        }
      }
      if (lo !== null) { minE = Math.min(minE, lo); count++; }
      if (hi !== null) { maxE = Math.max(maxE, hi); }
    }
    if (count === 0 || minE === Infinity) return null;
    if (maxE === -Infinity) maxE = minE;
    return { startE: minE, endE: maxE, count: selectedWordIds.size };
  }, [selectedWordIds, transcript, editMap, canRender]);

  const handleSelectionDelete = useCallback(() => {
    const ids = Array.from(selectedWordIds);
    if (ids.length === 0) return;
    pushHistory();
    bulkToggleWords(ids, true);
    clearTrimsForIds(ids);
    setSelectedWords(new Set());
    setRangeSelection(null);
  }, [bulkToggleWords, clearTrimsForIds, pushHistory, selectedWordIds, setSelectedWords]);

  const handleSelectionRestore = useCallback(() => {
    const ids = Array.from(selectedWordIds);
    if (ids.length === 0) return;
    pushHistory();
    bulkToggleWords(ids, false);
  }, [bulkToggleWords, pushHistory, selectedWordIds]);

  const handleSplitAtPlayhead = useCallback(() => {
    const state = useEditorStore.getState();
    const now = state.currentTime;
    const insideKept = editMap.keptRanges.some(
      (r) => now > r.sourceStart + 0.005 && now < r.sourceEnd - 0.005,
    );
    if (!insideKept) return;
    pushHistory();
    addSplitMarker(now);
  }, [addSplitMarker, editMap, pushHistory]);

  // Split markers — keep only ones that survived the ripple, mapped to edited.
  const visibleSplitMarkers = useMemo(() => {
    if (!canRender) return [] as number[];
    return splitMarkers
      .map((s) => sourceToEdited(s, editMap))
      .filter((v): v is number => v !== null);
  }, [splitMarkers, editMap, canRender]);

  return (
    <div className="relative w-full h-full bg-zinc-950 flex flex-col select-none">
      {/* Toolbar: edited length + zoom */}
      <div className="absolute top-1 right-2 z-40 flex items-center gap-2 text-zinc-400">
        {canRender && (
          <span
            className="text-[10px] font-mono text-zinc-500 tabular-nums"
            title="Edited length / source length"
          >
            {formatTC(editedDuration)} / {formatTC(sourceDuration)}
          </span>
        )}
        {canRender && (
          <span
            className="text-[10px] font-mono text-zinc-500 tabular-nums"
            title="Cut regions • total cut seconds • per-clip trim entries • new-model clips"
          >
            {cutStats.regions}c · {cutStats.totalS.toFixed(1)}s · {cutStats.trims}t · {cutStats.newClips}cl
          </span>
        )}
        {cutStats.trims > 0 && (
          <button
            onClick={() => {
              if (confirm(`Reset all ${cutStats.trims} per-clip trims? This restores every clip's edges to their natural word boundaries.`)) {
                pushHistory();
                useEditorStore.setState({ clipTrims: {} });
              }
            }}
            className="text-[10px] px-1.5 h-5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-amber-300 transition-colors"
            title="Clear all per-clip edge trims (use when stale pads are masking deletions)"
          >
            Reset trims
          </button>
        )}
        <button
          onClick={() => setMagneticTimeline(!magneticTimeline)}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
            magneticTimeline
              ? "bg-violet-500/30 text-violet-200 hover:bg-violet-500/40"
              : "bg-zinc-800/80 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          }`}
          title={magneticTimeline ? "Magnetic timeline ON — deletions ripple-close" : "Magnetic timeline OFF — deletions leave gaps"}
          aria-pressed={magneticTimeline}
        >
          <Magnet size={11} />
        </button>
        <button
          onClick={fitToWindow}
          disabled={zoom === ZOOM_MIN}
          className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Fit to window (Shift+Z)"
        >
          <Maximize2 size={10} />
        </button>
        <button
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Zoom out (Ctrl+scroll)"
        >
          <Minus size={11} />
        </button>
        {/* Continuous zoom slider — log scale so the cursor moves with
            perceived zoom rather than tracking the raw 1–20 linear range
            (which spends ~50% of its travel between 10× and 20×). */}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(
            (Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 1000,
          )}
          onChange={(e) => {
            const t = Number(e.target.value) / 1000;
            setZoom(ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t));
          }}
          className="w-20 h-1 accent-violet-400 cursor-ew-resize"
          title="Zoom"
        />
        <span className="text-[10px] font-mono w-10 text-center tabular-nums">
          {zoom.toFixed(1)}×
        </span>
        <button
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Zoom in (Ctrl+scroll)"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Scroll viewport */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden timeline-scroll"
        // Roadmap §3 Mobile/Touch: allow native pan-x scrolling on touch
        // devices while keeping pinch-zoom available for the OS. Pointer
        // events on the ruler/tracks already handle precise interactions.
        style={{ touchAction: "pan-x pinch-zoom" }}
      >
        <div
          className="relative h-full flex flex-col"
          style={{ width: `${zoom * 100}%`, minWidth: "100%" }}
        >
          {/* Ruler — glassmorphic per roadmap §2.3 */}
          <div
            ref={rulerRef}
            onPointerDown={handleRulerPointerDown}
            onPointerMove={(e) => {
              if (isScrubbing) return;
              const et = editedTimeFromClientX(e.clientX);
              if (et !== null) setHoverEdited(et);
            }}
            onPointerLeave={() => setHoverEdited(null)}
            className={`h-7 bg-zinc-900/40 backdrop-blur-md border-b border-violet-500/15 relative shrink-0 ${
              isScrubbing ? "cursor-grabbing" : "cursor-text"
            }`}
            style={{ touchAction: "none" }}
          >
            {canRender &&
              rulerTickInfo.ticks.map(({ t, major }) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 pl-1.5 flex items-end pb-1 pointer-events-none"
                  style={{ left: `${(t / editedDuration) * 100}%` }}
                >
                  <div
                    className={`absolute left-0 w-px ${major ? "top-1.5 bottom-1 bg-zinc-700" : "top-3.5 bottom-1 bg-zinc-800"}`}
                  />
                  {major && (
                    <span className="text-[10px] font-mono text-zinc-500 relative">
                      {formatTick(t, rulerStep)}
                    </span>
                  )}
                </div>
              ))}

            {/* Hover preview — small tooltip showing the time the cursor
                is over, with a faint guideline. Hidden during active scrub
                (the scrub badge takes over there). */}
            {hoverEdited !== null && !isScrubbing && canRender && (
              <>
                <div
                  className="absolute top-0 bottom-0 w-px bg-zinc-400/40 pointer-events-none"
                  style={{ left: `${(hoverEdited / editedDuration) * 100}%` }}
                />
                <div
                  className="absolute -top-5 px-1.5 py-0.5 rounded
                             bg-zinc-900/95 backdrop-blur-md border border-zinc-700
                             text-[10px] font-mono text-zinc-300 tabular-nums
                             whitespace-nowrap pointer-events-none shadow-lg
                             -translate-x-1/2"
                  style={{ left: `${(hoverEdited / editedDuration) * 100}%` }}
                >
                  {formatTC(hoverEdited)}
                </div>
              </>
            )}
          </div>

          {/* Tracks */}
          <div
            ref={tracksRef}
            onPointerDown={handleTracksPointerDown}
            className="flex-1 relative overflow-hidden bg-zinc-950"
            style={{ touchAction: "none" }}
          >
            <TrackLane
              label="V1"
              top={0}
              canRender={canRender}
              editedDuration={editedDuration}
              editedDurationRef={editedDurationRef}
              clips={clips}
              clipLimits={clipLimits}
              selectedWordIds={selectedWordIds}
              tone="video"
              mediaFile={mediaFile}
              onClipClick={handleClipClick}
              onClipContextMenu={handleClipContextMenu}
              onSnapChange={setSnapGuide}
            />
            <TrackLane
              label="A1"
              top={LANE_HEIGHT}
              canRender={canRender}
              editedDuration={editedDuration}
              editedDurationRef={editedDurationRef}
              clips={clips}
              clipLimits={clipLimits}
              selectedWordIds={selectedWordIds}
              tone="audio"
              mediaFile={mediaFile}
              onClipClick={handleClipClick}
              onClipContextMenu={handleClipContextMenu}
              onSnapChange={setSnapGuide}
            />

            {/* Floating selection toolbar — CapCut-style contextual bar
                that follows the centroid of the current selection. Hidden
                when nothing is selected. Buttons mirror the right-click
                menu plus Split-at-playhead for quick clip slicing. */}
            {selectionBounds && canRender && (() => {
              const midPct = ((selectionBounds.startE + selectionBounds.endE) / 2 / editedDuration) * 100;
              return (
                <div
                  className="absolute z-40 pointer-events-none"
                  style={{ left: `${midPct}%`, top: 4 }}
                >
                  <div
                    className="absolute -translate-x-1/2 flex items-center gap-0.5 px-1 py-0.5
                               rounded-md bg-zinc-900/95 backdrop-blur-md
                               border border-violet-500/40 shadow-2xl
                               pointer-events-auto whitespace-nowrap"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="text-[10px] font-mono text-violet-300 px-1.5 select-none tabular-nums">
                      {selectionBounds.count}
                    </span>
                    <div className="w-px h-3.5 bg-zinc-700/80" />
                    <button
                      onClick={handleSplitAtPlayhead}
                      className="h-5 px-1.5 rounded text-[10px] font-medium text-zinc-300
                                 hover:bg-violet-500/30 hover:text-violet-100 transition-colors
                                 flex items-center gap-1"
                      title="Split at playhead (S)"
                    >
                      <Scissors size={10} />
                      Split
                    </button>
                    <button
                      onClick={handleSelectionRestore}
                      className="h-5 px-1.5 rounded text-[10px] font-medium text-zinc-300
                                 hover:bg-emerald-500/30 hover:text-emerald-100 transition-colors
                                 flex items-center gap-1"
                      title="Restore selection · Shift+←/→ nudges the matching clip edge by one frame"
                    >
                      <RotateCw size={10} />
                      Restore
                    </button>
                    <button
                      onClick={handleSelectionDelete}
                      className="h-5 px-1.5 rounded text-[10px] font-medium text-zinc-300
                                 hover:bg-red-500/40 hover:text-red-100 transition-colors
                                 flex items-center gap-1"
                      title="Delete selection (Backspace) · Shift+Alt+←/→ shrinks the matching clip edge by one frame"
                    >
                      <Scissors size={10} />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })()}

            {snapGuide !== null && canRender && (() => {
              const editedSnap = sourceToEdited(snapGuide, editMap);
              if (editedSnap === null) return null;
              return (
                <div
                  className="absolute top-0 bottom-0 w-px bg-cyan-400 z-40 pointer-events-none shadow-[0_0_6px_rgba(34,211,238,0.9)]"
                  style={{ left: `${(editedSnap / editedDuration) * 100}%` }}
                />
              );
            })()}

            {canRender &&
              visibleSplitMarkers.map((time, idx) => (
                <div
                  key={`split-${idx}-${time}`}
                  className="absolute top-0 bottom-0 w-px bg-white/70 z-10 pointer-events-none"
                  style={{ left: `${(time / editedDuration) * 100}%` }}
                />
              ))}

            {marquee && (() => {
              const left = Math.min(marquee.startX, marquee.currentX);
              const top = Math.min(marquee.startY, marquee.currentY);
              const width = Math.abs(marquee.currentX - marquee.startX);
              const height = Math.abs(marquee.currentY - marquee.startY);
              if (width < 2 && height < 2) return null;
              return (
                <div
                  className="absolute z-30 border border-white/50 bg-white/20 pointer-events-none rounded-[2px]"
                  style={{ left, top, width, height }}
                />
              );
            })()}

            {/* Persistent range-selection box (shown until Backspace or
                next click). Spans full track height so it visually scopes
                the deletion area. */}
            {rangeSelection && canRender && (
              <div
                className="absolute top-0 bottom-0 z-30 border border-white/50 bg-white/20 pointer-events-none rounded-[2px]"
                style={{
                  left: `${(rangeSelection.editedStart / editedDuration) * 100}%`,
                  width: `${((rangeSelection.editedEnd - rangeSelection.editedStart) / editedDuration) * 100}%`,
                }}
              />
            )}
          </div>

          {/* Playhead — diamond scrubber head + 1px line + floating timecode
              while scrubbing (roadmap §2.2 Enhanced Playhead UI). The outer
              container is pointer-events:none so the playhead line never
              eats clicks meant for clips beneath it; the diamond + a small
              ruler-level grab band are the only interactive areas. */}
          {canRender && (
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none"
              style={{ left: `${playheadPct}%`, transform: "translateX(-50%)" }}
            >
              {/* Diamond cap: 16×16 hit area around a visible 10×10 diamond,
                  so the head is forgiving to grab without forcing clip
                  hit-targets to shrink. Cursor flips to grabbing while a
                  scrub is active. */}
              <div
                onPointerDown={handlePlayheadPointerDown}
                className={`absolute left-1/2 -translate-x-1/2 -top-[6px] w-[16px] h-[16px]
                            pointer-events-auto flex items-center justify-center z-10
                            ${isScrubbing ? "cursor-grabbing" : "cursor-grab"}`}
                title="Drag to scrub · hold Alt to disable snap"
              >
                <div
                  className="h-[10px] w-[10px] rotate-45 bg-violet-400
                             shadow-[0_0_8px_rgba(167,139,250,0.85)]
                             ring-1 ring-violet-200/50"
                />
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-violet-400/90" />

              {isScrubbing && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 -top-6 px-1.5 py-0.5 rounded
                             bg-violet-500/90 backdrop-blur-sm text-[10px] font-mono text-white
                             tabular-nums whitespace-nowrap shadow-lg pointer-events-none"
                >
                  {formatTC(playheadEdited)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {menu.isOpen && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[150px] py-1 bg-zinc-800 border border-zinc-700 shadow-xl rounded-md text-[12px] text-zinc-200"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            onClick={() => applyAndClose(true)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-700/70 hover:text-red-300 transition-colors"
          >
            <Scissors size={12} />
            Delete
          </button>
          <button
            onClick={() => applyAndClose(false)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-700/70 hover:text-emerald-300 transition-colors"
          >
            <RotateCw size={12} />
            Restore
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrackLane
// ---------------------------------------------------------------------------

interface ClipLimits {
  leftLimit: number;
  rightLimit: number;
  // True when this edge is a split-seam shared with the adjacent clip.
  // Convention: seam control belongs to the LEFT clip's right handle, so the
  // RIGHT clip hides its left handle to avoid both clips claiming the same
  // pixel — without this, a click meant for clip A's right edge frequently
  // lands on clip B's left edge, and dragging right gets interpreted as
  // "shrink clip B inward" (i.e. delete clip B's leading words).
  leftIsSeam: boolean;
  rightIsSeam: boolean;
}

interface TrackLaneProps {
  label: Lane;
  top: number | string;
  canRender: boolean;
  editedDuration: number;
  editedDurationRef: React.RefObject<number>;
  clips: Clip[];
  clipLimits: ClipLimits[];
  selectedWordIds: Set<string>;
  tone: "video" | "audio";
  mediaFile: File | null;
  onClipClick: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onClipContextMenu: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onSnapChange: (sourceTime: number | null) => void;
}

function TrackLane({
  label, top, canRender, editedDuration, editedDurationRef, clips, clipLimits, selectedWordIds, tone, mediaFile,
  onClipClick, onClipContextMenu, onSnapChange,
}: TrackLaneProps) {
  return (
    <div className="absolute left-0 right-0" style={{ top, height: LANE_HEIGHT }}>
      <span className="absolute left-2 top-1 text-[9px] font-mono text-zinc-700 z-10 pointer-events-none tracking-wider">
        {label}
      </span>

      {canRender &&
        clips.map((clip, i) => (
          <ClipBlock
            // Keyed on the clip's source-start (immutable for a trim drag) so
            // edge dragging never remounts the component mid-gesture. Keying
            // on keptWordIds[0] caused unmount/mount cycles whenever the
            // first kept word toggled, resetting isDragging and re-firing the
            // 220ms CSS transition.
            key={`${tone}-${clip.range.sourceStart.toFixed(4)}-${i}`}
            clip={clip}
            editedDuration={editedDuration}
            editedDurationRef={editedDurationRef}
            limits={clipLimits[i] ?? { leftLimit: 0, rightLimit: clip.range.sourceEnd }}
            isSelected={clip.keptWordIds.some((id) => selectedWordIds.has(id))}
            tone={tone}
            mediaFile={mediaFile}
            isFirst={i === 0}
            onClick={onClipClick}
            onContextMenu={onClipContextMenu}
            onSnapChange={onSnapChange}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClipBlock
// ---------------------------------------------------------------------------

interface ClipBlockProps {
  clip: Clip;
  editedDuration: number;
  editedDurationRef: React.RefObject<number>;
  limits: ClipLimits;
  isSelected: boolean;
  tone: "video" | "audio";
  mediaFile: File | null;
  isFirst: boolean;
  onClick: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onSnapChange: (sourceTime: number | null) => void;
}

function ClipBlock({
  clip, editedDuration, editedDurationRef, limits, isSelected, tone, mediaFile, isFirst, onClick, onContextMenu, onSnapChange,
}: ClipBlockProps) {
  const styleClasses =
    tone === "video"
      ? "bg-purple-600/85 hover:bg-purple-500"
      : "bg-emerald-600/70 hover:bg-emerald-500/90";
  const selectedRing = isSelected
    ? " ring-2 ring-white/95 shadow-[0_0_0_1px_rgba(168,85,247,0.5)] z-10"
    : " hover:ring-1 hover:ring-white/60 hover:z-10";
  const seam = isFirst ? "" : " border-l border-zinc-950/70";

  const clipRef = useRef<HTMLDivElement | null>(null);

  // Duration shown in the hover tooltip — helps users decide whether a tiny
  // sliver is worth keeping. Sub-second clips display in ms.
  const durationS = clip.range.sourceEnd - clip.range.sourceStart;
  const durationLabel = durationS < 1
    ? `${Math.round(durationS * 1000)} ms`
    : `${durationS.toFixed(2)} s`;

  // Measure actual rendered pixel width so we can hide trim handles on
  // clips too narrow for them to coexist with a clickable body. Without
  // this, a 6px clip is 100% trim-handle and the user can never *select*
  // it — only accidentally trim it. Matches CapCut: tiny clips are
  // body-only; zoom in to expose handles.
  const [hasRoomForHandles, setHasRoomForHandles] = useState(true);
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // 24px = 10px-each handles + 4px center body. Below that, body
      // selection wins; user must zoom in to trim.
      setHasRoomForHandles(w >= 24);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Edge trim drag — PURE NON-DESTRUCTIVE trim, CapCut-style.
  //
  // The drag does ONE thing: it writes a new `clipTrims[anchorId]` record.
  // It never touches `deletedWordIds`, never flips `segments[].isCut`, and
  // never collapses the clip. The clipTrims system in buildEditMap step 5
  // already does the right thing: padStart < 0 / padEnd > 0 extend the
  // kept range past the natural word boundaries (absorbing any deleted
  // regions in their path), and positive padStart / negative padEnd pull
  // the visible boundary inward. Words "inside" the trim but outside the
  // new bounds aren't deleted — they're just outside the play window, and
  // dragging the edge back out reveals them instantly.
  //
  // Why this matters for the user: every previous design tried to be
  // clever and mark words as deleted while the cursor moved. That meant
  // dragging an edge inward could (and did) collapse the entire clip into
  // a delete the moment the cursor swept past the last word. The fix
  // isn't a tighter floor — it's removing the deletion path from the
  // drag entirely. Delete is now exclusively an explicit action
  // (Backspace, right-click → Delete).
  //
  // pxPerSec is snapshotted at pointerdown to avoid the feedback loop
  // where outward drag → editedDuration grows → pxPerSec shrinks → cursor
  // motion accelerates the drag. With a frozen ratio, 1 px of cursor
  // travel always equals the same number of source seconds.
  const handleEdgePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const clipEl = clipRef.current;
      const laneEl = clipEl?.parentElement as HTMLElement | null;
      if (!clipEl || !laneEl) return;

      const startX = e.clientX;
      const clipMinSrc = clip.range.sourceStart;
      const clipMaxSrc = clip.range.sourceEnd;
      const initSrc = side === "right" ? clipMaxSrc : clipMinSrc;

      // Find the anchor word — the first surviving word inside the visible
      // clip range. buildEditMap matches clipTrims entries by the anchor's
      // start time falling inside the *natural* kept range, so we need a
      // stable anchor for our writes to land. If there's no surviving word
      // (degenerate clip), we abort the drag — there's nothing to anchor
      // a trim to, and trimming wouldn't be meaningful anyway.
      const store0 = useEditorStore.getState();
      const transcriptSnap = store0.transcript;
      const deletedSnap = store0.deletedWordIds;
      let anchorId: string | null = null;
      for (const w of transcriptSnap) {
        if (w.start < clipMinSrc || w.start >= clipMaxSrc) continue;
        if (deletedSnap.has(w.id)) continue;
        anchorId = w.id;
        break;
      }
      if (!anchorId) return;

      // Baseline trim record. We compute the *natural* (pre-trim) kept-
      // range boundaries from this so our writes use the correct origin —
      // padStart/padEnd are deltas from natural, not from the currently
      // displayed edges.
      const baselineTrim = store0.clipTrims[anchorId] ?? { padStart: 0, padEnd: 0 };
      const naturalStart = clipMinSrc - baselineTrim.padStart;
      const naturalEnd = clipMaxSrc - baselineTrim.padEnd;

      const SNAP_PX = 8;
      const snapEdge = side === "right" ? limits.rightLimit : limits.leftLimit;

      // One history entry per drag — pushed before the first mutation so
      // a single Cmd+Z restores the pre-drag bounds.
      store0.pushHistory();

      const initLaneWidth = laneEl.getBoundingClientRect().width;
      const initEditedDuration = editedDurationRef.current || editedDuration;
      const initPxPerSec =
        initLaneWidth > 0 && initEditedDuration > 0
          ? initLaneWidth / initEditedDuration
          : 0;

      // Minimum surviving clip width. 100ms keeps the clip clickable at any
      // zoom level so the user always has a handle to grab and pull back
      // out. The drag is purely visual; this just bounds how thin the clip
      // can get on screen.
      const MIN_DRAG_CLIP = 0.10;

      isDraggingRef.current = true;
      setIsDraggingRender(true);

      let rafId: number | null = null;
      let pendingTrims: Record<string, { padStart: number; padEnd: number }> | null = null;
      const flush = () => {
        rafId = null;
        if (pendingTrims) {
          useEditorStore.setState({ clipTrims: pendingTrims });
          pendingTrims = null;
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (initPxPerSec <= 0) return;
        const dSec = (ev.clientX - startX) / initPxPerSec;
        let target = initSrc + dSec;

        // Clamp against the neighbour edges (outward) and against the
        // opposite edge minus MIN_DRAG_CLIP (inward). The inward clamp is
        // purely a width floor — no word logic involved.
        if (side === "right") {
          target = target > initSrc
            ? Math.min(target, limits.rightLimit)
            : Math.max(target, clipMinSrc + MIN_DRAG_CLIP);
        } else {
          target = target < initSrc
            ? Math.max(target, limits.leftLimit)
            : Math.min(target, clipMaxSrc - MIN_DRAG_CLIP);
        }

        // Magnetic snap to the outward neighbour edge only — never to the
        // opposite side of initSrc (a seam clip's no-op limit equals the
        // opposite edge and would otherwise pull the drag through itself).
        const snapTol = SNAP_PX / initPxPerSec;
        const candidateOutward =
          side === "right" ? snapEdge >= initSrc : snapEdge <= initSrc;
        let snapped: number | null = null;
        if (candidateOutward && Math.abs(snapEdge - target) <= snapTol) {
          snapped = snapEdge;
          target = snapped;
        }
        onSnapChange(snapped);

        // Compute the new visible bounds + the trim record. The pad is a
        // signed delta from the natural boundary; positive padEnd extends
        // past the natural right edge into deleted territory, negative
        // padEnd pulls the right edge inward.
        const newStart = side === "left" ? target : clipMinSrc;
        const newEnd = side === "right" ? target : clipMaxSrc;
        const nextTrim = {
          padStart: newStart - naturalStart,
          padEnd: newEnd - naturalEnd,
        };

        // Direction flag drives the directional tint. "extending" means the
        // edge is moving away from initSrc (clip grows); "trimming" means
        // moving toward the opposite edge (clip shrinks). These are now
        // purely visual labels — no destructive semantics.
        const extending = side === "right" ? target > initSrc : target < initSrc;
        setDragRestoring(extending);

        const newDurationS = newEnd - newStart;
        setDragInfo({
          side,
          durationS: newDurationS,
          deltaS: newDurationS - (clipMaxSrc - clipMinSrc),
        });

        // Apply / clear the trim entry. We delete the entry when both pads
        // collapse to ~0 so the buildEditMap step-5 loop has nothing to do
        // for clips at their natural bounds.
        const store = useEditorStore.getState();
        let nextTrims = store.clipTrims;
        const collapse =
          Math.abs(nextTrim.padStart) < 0.0005 &&
          Math.abs(nextTrim.padEnd) < 0.0005;
        if (collapse) {
          if (anchorId in nextTrims) {
            nextTrims = { ...nextTrims };
            delete nextTrims[anchorId];
          }
        } else {
          nextTrims = { ...nextTrims, [anchorId]: nextTrim };
        }
        // Coalesce writes to one per animation frame — without rAF
        // batching the whole Timeline re-renders on every pointermove
        // (100+ Hz mice) and the drag stutters under load.
        pendingTrims = nextTrims;
        if (rafId === null) {
          rafId = window.requestAnimationFrame(flush);
        }
      };

      const onUp = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        flush();
        isDraggingRef.current = false;
        setIsDraggingRender(false);
        setDragRestoring(null);
        setDragInfo(null);
        onSnapChange(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [clip, editedDuration, editedDurationRef, limits, onSnapChange],
  );

  // Show trim handles when: clip is wide enough AND (selected OR hovered).
  // Body click is therefore the default action — handles are an opt-in
  // affordance the user has to deliberately reach for.
  const showHandles = hasRoomForHandles;

  // Track measured pixel size for the waveform canvas (CSS percent widths
  // can't be passed straight to a canvas — it needs integer pixels).
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hover state drives the mini-inspector tooltip (roadmap §2.2 Clip Hover
  // Info). Off by default so we don't render a floating element above every
  // clip; only the one the cursor is over.
  const [isHover, setIsHover] = useState(false);

  // Disables the 220ms ripple transitions while an edge is being dragged so
  // the clip tracks the cursor pixel-for-pixel. Without this, the same easing
  // that makes post-edit ripple feel premium turns live drags into a
  // "rubbery" lag.
  //
  // Stored as both a ref (survives StrictMode double-invocation and any
  // edge-case remounts) and a state mirror (so the style object actually
  // re-renders when drag flips on/off). Style reads from the state mirror.
  const isDraggingRef = useRef(false);
  const [isDraggingRender, setIsDraggingRender] = useState(false);

  // Active drag direction overlay: null while idle, true while expanding
  // (restoring content — green tint), false while shrinking (cutting more —
  // red tint). Gives the user immediate, unambiguous feedback about what
  // their drag will do, so a trim no longer looks identical to a delete.
  const [dragRestoring, setDragRestoring] = useState<boolean | null>(null);

  // Live trim readout: the new clip duration and signed delta vs the
  // original. Rendered as a small badge above the dragged edge so the user
  // sees exactly how much they're adding or trimming in real time.
  const [dragInfo, setDragInfo] = useState<{
    side: "left" | "right";
    durationS: number;
    deltaS: number;
  } | null>(null);

  return (
    <div
      ref={clipRef}
      className={`group absolute top-1.5 bottom-1.5 cursor-pointer active:cursor-grabbing rounded-[2px] overflow-hidden ${styleClasses}${selectedRing}${seam}`}
      // Smooth ripple motion (roadmap §2.3): when an edit shifts the layout,
      // the new left/width animate in instead of snapping. transition-all is
      // overridden here so we control timing — 220ms ease feels premium
      // without lagging behind aggressive scrubbing.
      style={{
        left: `${(clip.range.editedStart / editedDuration) * 100}%`,
        width: `${((clip.range.editedEnd - clip.range.editedStart) / editedDuration) * 100}%`,
        minWidth: 3,
        transitionProperty: "left, width, background-color, box-shadow",
        transitionDuration: isDraggingRender ? "0ms" : "220ms, 220ms, 75ms, 75ms",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onClick(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
      onPointerEnter={() => setIsHover(true)}
      onPointerLeave={() => setIsHover(false)}
    >
      {/* A1 → audio waveform peaks (roadmap §2.1). V1 → word-text overlay. */}
      {tone === "audio" && size.w > 0 && size.h > 0 && (
        <div className="absolute inset-0 pointer-events-none opacity-80">
          <WaveformCanvas
            mediaFile={mediaFile}
            sourceStart={clip.range.sourceStart}
            sourceEnd={clip.range.sourceEnd}
            width={size.w}
            height={size.h}
            color="rgba(220, 252, 231, 0.85)"
          />
        </div>
      )}

      {tone === "video" && size.w > 0 && size.h > 0 && (
        <>
          <FrameStrip
            mediaFile={mediaFile}
            sourceStart={clip.range.sourceStart}
            sourceEnd={clip.range.sourceEnd}
            width={size.w}
            height={size.h}
          />
          {/* Caption strip — sits along the bottom edge with a gradient
              backdrop so the text reads against any thumbnail. Hidden on
              clips too narrow to fit a few characters. */}
          {clip.text && size.w >= 28 && (
            <div
              className="absolute left-0 right-0 bottom-0 px-1 pt-2 pb-0.5 pointer-events-none
                         text-[10px] leading-none font-medium text-white
                         overflow-hidden whitespace-nowrap"
              style={{
                textOverflow: "ellipsis",
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 100%)",
              }}
            >
              <span className="truncate select-none block">{clip.text}</span>
            </div>
          )}
          {/* Faint violet tint over the thumbnails to keep the brand color
              readable across mixed-luminance content. */}
          <div
            className="absolute inset-0 pointer-events-none mix-blend-overlay"
            style={{ background: "rgba(139, 92, 246, 0.12)" }}
          />
        </>
      )}

      {/* Directional trim overlay — cyan while extending (clip is growing),
          violet while shrinking (clip is being trimmed inward). Both are
          fully reversible; no destructive red. Mounted only during an
          active edge drag, sits above thumbnails but below handles and the
          mini-inspector. */}
      {dragRestoring !== null && (
        <div
          className="absolute inset-0 pointer-events-none rounded-[2px] z-10"
          style={{
            background: dragRestoring
              ? "rgba(34, 211, 238, 0.20)"   // cyan-400 — clip is growing
              : "rgba(139, 92, 246, 0.22)",  // violet-500 — clip is shrinking
          }}
        />
      )}

      {/* Live trim readout — new clip duration + signed delta vs pre-drag
          length, plus a reassurance hint reminding the user that trims are
          reversible. The hint is the visual contract that distinguishes
          this from a delete: even after dragging halfway across the clip,
          you can drag back the same distance and the content reappears. */}
      {dragInfo && (
        <div
          className={`absolute -top-8 z-40 pointer-events-none px-2 py-0.5 rounded-md
                      bg-zinc-900/95 backdrop-blur-md
                      border border-violet-400/50 shadow-xl
                      text-[10px] font-mono text-zinc-100 tabular-nums whitespace-nowrap
                      flex items-center gap-1.5`}
          style={dragInfo.side === "right" ? { right: 0 } : { left: 0 }}
        >
          <span>
            {dragInfo.durationS < 1
              ? `${Math.round(dragInfo.durationS * 1000)} ms`
              : `${dragInfo.durationS.toFixed(2)} s`}
          </span>
          <span
            className={dragInfo.deltaS >= 0 ? "text-cyan-300" : "text-violet-300"}
          >
            {dragInfo.deltaS >= 0 ? "+" : ""}
            {Math.abs(dragInfo.deltaS) < 1
              ? `${Math.round(dragInfo.deltaS * 1000)} ms`
              : `${dragInfo.deltaS.toFixed(2)} s`}
          </span>
          <span className="text-zinc-500 text-[9px] tracking-wider uppercase">
            {dragInfo.deltaS < 0 ? "trim · drag back to restore" : "extending"}
          </span>
        </div>
      )}

      {/* Mini-inspector — only mounted while hovered, suppressed during
          active selection so it doesn't fight the trim handles. */}
      {isHover && !isSelected && size.w >= 40 && (
        <div
          className="absolute -top-9 left-1/2 -translate-x-1/2 z-30
                     px-2 py-1 rounded bg-zinc-900/95 backdrop-blur-md
                     border border-violet-500/30 shadow-xl
                     text-[10px] font-mono text-zinc-200 whitespace-nowrap pointer-events-none"
        >
          <div className="tabular-nums text-violet-300">
            {formatTC(clip.range.sourceStart)} → {formatTC(clip.range.sourceEnd)}
            <span className="text-zinc-500 ml-1.5">({durationLabel})</span>
          </div>
          {(clip.firstWord || clip.lastWord) && (
            <div className="text-zinc-400 truncate max-w-[260px]">
              <span className="text-emerald-300">{clip.firstWord}</span>
              {clip.firstWord !== clip.lastWord && (
                <>
                  <span className="text-zinc-600 mx-1">…</span>
                  <span className="text-emerald-300">{clip.lastWord}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edge trim handles — 6px wide, only interactive on hover or when
          selected. Hidden entirely on tiny clips so the body remains
          clickable (zoom in with Ctrl+wheel to expose them).
          At a split-seam, ONLY the left clip's right handle is rendered —
          rendering both clips' adjacent handles caused them to compete for
          the same pixel (z-20 on both), so a click meant for the left clip's
          right edge often hit the right clip's left handle instead. Dragging
          right then ran the inward-floor branch and silently deleted the
          right clip's leading words. */}
      {/* Bracket-style trim handles. CapCut's hallmark: a clear white grip
          that fills the full height of the clip on hover/select, so the
          user always knows where the edge is. The 10px hit area sits over a
          4px white inset bar (was 3px) and a tinted backdrop strip on
          hover, which gives the eye a clear "this edge is grabbable" cue
          without flashing the affordance on every clip the cursor passes. */}
      {showHandles && !limits.leftIsSeam && (
        <div
          className={`absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-20 transition-opacity duration-100
                      ${isSelected || isDraggingRender
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"}`}
          onPointerDown={(e) => handleEdgePointerDown(e, "left")}
          onClick={(e) => e.stopPropagation()}
          title="Trim left edge — non-destructive · pull back out to restore · Shift+← / Shift+Alt+← for frame nudge"
        >
          <div className="absolute inset-y-0 left-0 w-2 bg-white/10 group-hover:bg-white/15" />
          <div
            className={`absolute inset-y-0 left-0 w-[4px] rounded-r-[2px] shadow-[0_0_6px_rgba(255,255,255,0.55)]
                        ${isSelected || isDraggingRender ? "bg-white" : "bg-white/85"}`}
          />
          {/* Grip dots — two short vertical bars inside the bracket so the
              handle reads as "drag me" rather than "decorative border". */}
          <div className="absolute left-[2px] top-1/2 -translate-y-1/2 flex flex-col gap-[2px] pointer-events-none">
            <div className="w-px h-1 bg-zinc-900/60" />
            <div className="w-px h-1 bg-zinc-900/60" />
            <div className="w-px h-1 bg-zinc-900/60" />
          </div>
        </div>
      )}
      {showHandles && (
        <div
          className={`absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-20 transition-opacity duration-100
                      ${isSelected || isDraggingRender
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"}`}
          onPointerDown={(e) => handleEdgePointerDown(e, "right")}
          onClick={(e) => e.stopPropagation()}
          title="Trim right edge — non-destructive · pull back out to restore · Shift+→ / Shift+Alt+→ for frame nudge"
        >
          <div className="absolute inset-y-0 right-0 w-2 bg-white/10 group-hover:bg-white/15" />
          <div
            className={`absolute inset-y-0 right-0 w-[4px] rounded-l-[2px] shadow-[0_0_6px_rgba(255,255,255,0.55)]
                        ${isSelected || isDraggingRender ? "bg-white" : "bg-white/85"}`}
          />
          <div className="absolute right-[2px] top-1/2 -translate-y-1/2 flex flex-col gap-[2px] pointer-events-none">
            <div className="w-px h-1 bg-zinc-900/60" />
            <div className="w-px h-1 bg-zinc-900/60" />
            <div className="w-px h-1 bg-zinc-900/60" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMMSS(t: number): string {
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

// Ruler-tick labeller. Picks resolution from `step` so sub-second zooms
// show fractional seconds (e.g. "12.5s" / "12.50s") rather than rounding
// everything to whole-second labels.
function formatTick(t: number, step: number): string {
  if (step >= 1) return formatMMSS(t);
  const decimals = step < 0.1 ? 2 : 1;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m === 0) return `${s.toFixed(decimals)}s`;
  return `${m}:${s.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

function formatTC(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
