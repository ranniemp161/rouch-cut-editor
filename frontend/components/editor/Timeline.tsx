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
import { Scissors, RotateCw, Minus, Plus, Magnet } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { useContextMenu } from "@/hooks/useContextMenu";
import {
  buildEditMap,
  editedToSource,
  sourceToEdited,
  type KeptRange,
} from "@/lib/editMap";
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
  // Source-time of the active snap target during a trim drag, or null when
  // the cursor is between snap candidates. Drives the cyan guide line.
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const pendingZoomCursor = useRef<{ time: number; cursorX: number } | null>(null);

  const menu = useContextMenu();

  // ── Edit map: source ↔ edited mapping ─────────────────────────────────────
  const editMap = useMemo(
    () => buildEditMap(transcript, deletedWordIds, segments, sourceDuration, clipTrims),
    [transcript, deletedWordIds, segments, sourceDuration, clipTrims],
  );
  const editedDuration = editMap.editedDuration;
  const canRender = editedDuration > 0;

  // Diagnostic readout: total cut duration and trim entry count. If the user
  // can't see deletions taking effect, this surfaces whether the edit map
  // actually contains them — and whether stale per-clip pads are swallowing
  // them. Renders as a tiny mono badge in the toolbar.
  const cutStats = useMemo(() => {
    let totalCutS = 0;
    for (const r of editMap.deletedRegions) totalCutS += r.end - r.start;
    return {
      regions: editMap.deletedRegions.length,
      totalS: totalCutS,
      trims: Object.keys(clipTrims).length,
    };
  }, [editMap, clipTrims]);

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
      const leftLimit =
        prev && Math.abs(prev.range.sourceEnd - c.range.sourceStart) < SEAM_EPS
          ? c.range.sourceStart
          : prev?.range.sourceEnd ?? 0;
      const rightLimit =
        next && Math.abs(next.range.sourceStart - c.range.sourceEnd) < SEAM_EPS
          ? c.range.sourceEnd
          : next?.range.sourceStart ?? sourceDuration;
      return { leftLimit, rightLimit };
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

  const handleRulerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const et = editedTimeFromClientX(e.clientX);
      if (et === null) return;
      setSeekTime(editedToSource(et, editMap));
      setIsScrubbing(true);
    },
    [editMap, editedTimeFromClientX, setSeekTime],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: PointerEvent) => {
      const et = editedTimeFromClientX(e.clientX);
      if (et !== null) setSeekTime(editedToSource(et, editMap));
    };
    const onUp = () => setIsScrubbing(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isScrubbing, editMap, editedTimeFromClientX, setSeekTime]);

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

      // Shift+Arrow — symmetric edge nudging on the current selection
      // (or playhead if none). The arrow direction picks which edge of the
      // selection is being moved; Alt picks the direction of motion:
      //
      //   Shift+→        Extend right edge: restore the next deleted word
      //                  past the selection's right side.
      //   Shift+←        Extend left edge: restore the previous deleted word
      //                  before the selection's left side.
      //   Shift+Alt+→    Shrink right edge: cut the rightmost word of the
      //                  selection. Selection contracts inward.
      //   Shift+Alt+←    Shrink left edge: cut the leftmost word of the
      //                  selection.
      //
      // Each press rolls the affected word into / out of the selection so
      // the same key can be tapped repeatedly to keep moving the same edge.
      // [SILENCE] markers are skipped on extend (restoring is meaningless)
      // but counted on shrink so the user always converges.
      if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const dir: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
        const shrink = e.altKey;
        const sel = state.selectedWordIds;
        const transcript = state.transcript;
        const deleted = state.deletedWordIds;

        // ── Shrink path ────────────────────────────────────────────────
        // Cut the right-most (dir=1) or left-most (dir=-1) currently kept
        // word in the selection. Without a selection there's nothing to
        // shrink — bail silently.
        if (shrink) {
          if (sel.size === 0) return;
          let target: typeof transcript[number] | null = null;
          if (dir === 1) {
            for (let i = transcript.length - 1; i >= 0; i--) {
              const w = transcript[i];
              if (!sel.has(w.id) || deleted.has(w.id)) continue;
              if (w.word === "[SILENCE]") continue;
              target = w; break;
            }
          } else {
            for (let i = 0; i < transcript.length; i++) {
              const w = transcript[i];
              if (!sel.has(w.id) || deleted.has(w.id)) continue;
              if (w.word === "[SILENCE]") continue;
              target = w; break;
            }
          }
          if (!target) return;
          e.preventDefault();
          pushHistory();
          bulkToggleWords([target.id], true);
          clearTrimsForIds([target.id]);
          // Drop the cut word from the selection so the next press finds
          // the new edge.
          const nextSel = new Set(sel);
          nextSel.delete(target.id);
          setSelectedWords(nextSel);
          return;
        }

        // ── Extend path ────────────────────────────────────────────────
        // Anchor source time. With a selection: the right (dir=1) or left
        // (dir=-1) bound of the selection. Without: the playhead.
        let anchor: number;
        if (sel.size > 0) {
          let lo = Infinity;
          let hi = -Infinity;
          for (const w of transcript) {
            if (!sel.has(w.id)) continue;
            if (w.start < lo) lo = w.start;
            if (w.end > hi) hi = w.end;
          }
          if (lo === Infinity) return;
          anchor = dir === 1 ? hi : lo;
        } else {
          anchor = now;
        }

        let target: typeof transcript[number] | null = null;
        if (dir === 1) {
          for (const w of transcript) {
            if (w.word === "[SILENCE]") continue;
            if (!deleted.has(w.id)) continue;
            if (w.start >= anchor - 0.005) { target = w; break; }
          }
        } else {
          for (let i = transcript.length - 1; i >= 0; i--) {
            const w = transcript[i];
            if (w.word === "[SILENCE]") continue;
            if (!deleted.has(w.id)) continue;
            if (w.end <= anchor + 0.005) { target = w; break; }
          }
        }
        if (!target) return;
        e.preventDefault();
        pushHistory();
        bulkToggleWords([target.id], false);
        const nextSel = new Set(sel);
        nextSel.add(target.id);
        setSelectedWords(nextSel);
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

      // With a selection, Q/W behave as "delete selection" — same shortcut,
      // applied to whatever the user has highlighted.
      if (state.selectedWordIds.size > 0) {
        const ids = Array.from(state.selectedWordIds);
        let lastEnd = 0;
        for (const w of state.transcript) {
          if (state.selectedWordIds.has(w.id) && w.end > lastEnd) lastEnd = w.end;
        }
        pushHistory();
        bulkToggleWords(ids, true);
        clearTrimsForIds(ids);
        setSelectedWords(new Set());
        if (k === "w" && lastEnd > 0) setSeekTime(lastEnd);
        return;
      }

      // Ripple from previous/next cut to the playhead.
      const cuts = cutBoundariesRef.current;
      let prev = 0;
      let next = state.durationSeconds || now;
      for (const c of cuts) {
        if (c < now - 0.001) prev = c;
        if (c > now + 0.001) { next = c; break; }
      }
      const lo = k === "q" ? prev : now;
      const hi = k === "q" ? now : next;
      const ids: string[] = [];
      for (const w of state.transcript) {
        if (state.deletedWordIds.has(w.id)) continue;
        // Word is "inside" the ripple range if it overlaps it materially.
        if (w.end > lo + 0.001 && w.start < hi - 0.001) ids.push(w.id);
      }
      if (ids.length > 0) {
        pushHistory();
        bulkToggleWords(ids, true);
        clearTrimsForIds(ids);
      }
      // Q: snap to the boundary of the new cut (i.e. `prev`), never to 0:00.
      // The source-time playhead stays where it was — the edited-time view
      // recomputes naturally from the updated edit map.
      if (k === "q" && prev > 0) setSeekTime(prev);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [bulkToggleWords, setSeekTime, setSelectedWords, addSplitMarker, editMap, pushHistory, undo, redo, clearTrimsForIds]);

  // ── Ruler ticks (in edited-time) ──────────────────────────────────────────
  const rulerTicks = useMemo(() => {
    if (!canRender) return [] as number[];
    const target = 10 * zoom;
    const step = Math.max(1, Math.round(editedDuration / target));
    const out: number[] = [];
    for (let t = 0; t <= editedDuration; t += step) out.push(t);
    return out;
  }, [canRender, editedDuration, zoom]);

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
            title="Cut regions • total cut seconds • per-clip trim entries"
          >
            {cutStats.regions}c · {cutStats.totalS.toFixed(1)}s · {cutStats.trims}t
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
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Zoom out (Ctrl+scroll)"
        >
          <Minus size={11} />
        </button>
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
            className={`h-7 bg-zinc-900/40 backdrop-blur-md border-b border-violet-500/15 relative shrink-0 ${
              isScrubbing ? "cursor-grabbing" : "cursor-text"
            }`}
            style={{ touchAction: "none" }}
          >
            {canRender &&
              rulerTicks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 pl-1.5 flex items-end pb-1 pointer-events-none"
                  style={{ left: `${(t / editedDuration) * 100}%` }}
                >
                  <div className="absolute left-0 top-2 bottom-1 w-px bg-zinc-800" />
                  <span className="text-[10px] font-mono text-zinc-500 relative">
                    {formatMMSS(t)}
                  </span>
                </div>
              ))}
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
                      title="Restore selection · Shift+←/→ extends one word at a time"
                    >
                      <RotateCw size={10} />
                      Restore
                    </button>
                    <button
                      onClick={handleSelectionDelete}
                      className="h-5 px-1.5 rounded text-[10px] font-medium text-zinc-300
                                 hover:bg-red-500/40 hover:text-red-100 transition-colors
                                 flex items-center gap-1"
                      title="Delete selection (Backspace) · Shift+Alt+←/→ shrinks one word at a time"
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
              while scrubbing (roadmap §2.2 Enhanced Playhead UI). */}
          {canRender && (
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none"
              style={{ left: `${playheadPct}%`, transform: "translateX(-50%)" }}
            >
              {/* Diamond cap: 10px square rotated 45°, sits half above the
                  ruler so it reads as a grab-target rather than a pixel. */}
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-[3px] h-[10px] w-[10px]
                           rotate-45 bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.85)]
                           ring-1 ring-violet-200/50"
              />
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
            key={`${tone}-${clip.keptWordIds[0] ?? clip.range.sourceStart}-${i}`}
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

  // Edge trim drag — extends/shrinks the clip's source-time bounds.
  // To restore content fully (CapCut-style "pull the clip out of its trim"),
  // we both un-mark word-level deletions AND un-cut any AI segments
  // (silence / repetition) that overlap the dragged range. Without the
  // segment step, restored words appear orphaned with gaps between them.
  //
  // pxPerSec is snapshotted at pointerdown and held constant for the drag.
  // Recomputing it from the live editedDuration would create a feedback
  // loop with restored content (drag outward → duration grows → pxPerSec
  // shrinks → drag becomes hyper-sensitive and overshoots).
  const handleEdgePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const clipEl = clipRef.current;
      const laneEl = clipEl?.parentElement as HTMLElement | null;
      if (!clipEl || !laneEl) return;

      const startX = e.clientX;
      const initSrc = side === "right" ? clip.range.sourceEnd : clip.range.sourceStart;
      const baselineDeleted = new Set(useEditorStore.getState().deletedWordIds);
      const baselineSegments = useEditorStore.getState().segments;
      const transcriptSnap = useEditorStore.getState().transcript;
      const clipMinSrc = clip.range.sourceStart;
      const clipMaxSrc = clip.range.sourceEnd;

      // Anchor word for this clip's trim record. We pick the first surviving
      // word inside the clip at pointerdown — it's stable for the lifetime
      // of the drag (and survives through buildEditMap's lookup, which
      // matches trim entries by word.start within the natural kept range).
      let anchorId: string | null = null;
      for (const w of transcriptSnap) {
        if (
          w.start >= clipMinSrc &&
          w.start < clipMaxSrc &&
          !baselineDeleted.has(w.id)
        ) {
          anchorId = w.id;
          break;
        }
      }
      const baselineTrim =
        (anchorId && useEditorStore.getState().clipTrims[anchorId]) ||
        { padStart: 0, padEnd: 0 };

      // Snap target: the outward neighbour-clip edge for *this* handle only.
      // On the right handle that's limits.rightLimit (anything past the
      // clip's natural end); on the left it's limits.leftLimit. Including
      // both edges would let a seam clip's "no-op limit" (which equals the
      // clip's opposite edge) yank the cursor across initSrc and invert
      // the drag — a click on the right handle of a small seam clip would
      // snap target back to sourceStart and delete the entire clip.
      // Word boundaries are intentionally excluded so sub-word pads stay
      // smooth; the pad system collapses to zero on word-aligned releases.
      const snapEdge = side === "right" ? limits.rightLimit : limits.leftLimit;
      const SNAP_PX = 8;

      // One history entry per drag (not per pointermove). Pushed before the
      // first mutation so undo restores the pre-drag state.
      useEditorStore.getState().pushHistory();

      // Snapshot the px/sec ratio at pointerdown and keep it fixed for the
      // entire drag. Recomputing on every pointermove caused a feedback
      // loop: dragging outward restored content → editedDuration grew →
      // pxPerSec shrank → the next pixel of cursor motion mapped to *more*
      // seconds → the drag accelerated and overshot. With a frozen ratio,
      // 100 px of cursor motion always means the same source-time delta.
      const initLaneWidth = laneEl.getBoundingClientRect().width;
      const initEditedDuration = editedDurationRef.current || editedDuration;
      const initPxPerSec =
        initLaneWidth > 0 && initEditedDuration > 0
          ? initLaneWidth / initEditedDuration
          : 0;

      const onMove = (ev: PointerEvent) => {
        if (initPxPerSec <= 0) return;
        const pxPerSec = initPxPerSec;
        const dSec = (ev.clientX - startX) / pxPerSec;
        let target = initSrc + dSec;
        if (side === "right") {
          target = target > initSrc
            ? Math.min(target, limits.rightLimit)
            : Math.max(target, clipMinSrc);
        } else {
          target = target < initSrc
            ? Math.max(target, limits.leftLimit)
            : Math.min(target, clipMaxSrc);
        }

        // Magnetic snap to the outward neighbour edge. Only fires when the
        // candidate is on the same side of initSrc as the current drag
        // (i.e. an outward-extending drag can snap to an outward edge,
        // never to one behind the handle). Threshold is in pixels so it
        // tightens automatically as the user zooms in.
        const snapTol = SNAP_PX / pxPerSec;
        const candidateOutward = side === "right"
          ? snapEdge >= initSrc
          : snapEdge <= initSrc;
        let snapped: number | null = null;
        if (candidateOutward && Math.abs(snapEdge - target) <= snapTol) {
          snapped = snapEdge;
          target = snapped;
        }
        onSnapChange(snapped);

        // The source-time interval covered by this drag. `restoring` true
        // means the user dragged outward into the dead zone; false means
        // they pulled the edge inward to cut more.
        const lo = Math.min(initSrc, target);
        const hi = Math.max(initSrc, target);
        const restoring = side === "right" ? target > initSrc : target < initSrc;

        const nextDeleted = new Set(baselineDeleted);
        for (const w of transcriptSnap) {
          // Words whose timestamps fall inside the dragged range.
          if (w.start >= lo && w.end <= hi) {
            if (restoring) nextDeleted.delete(w.id);
            else nextDeleted.add(w.id);
          }
        }

        // Only restoring touches AI segment cuts. Shrinking just re-adds
        // word IDs; the segments stay as they were.
        let nextSegments = baselineSegments;
        if (restoring) {
          let mutated = false;
          const updated = baselineSegments.map((s) => {
            if (!s.isCut) return s;
            if (s.endS > lo && s.startS < hi) {
              mutated = true;
              return { ...s, isCut: false };
            }
            return s;
          });
          if (mutated) nextSegments = updated;
        }

        // Compute the kept range's *natural* boundary on the dragged side
        // after applying nextDeleted. The residual between target and that
        // boundary is the sub-word pad — the missing 30–150ms that lets
        // users catch a breath or trim a hard consonant without restoring
        // a whole word. Anything that aligns with a word boundary collapses
        // pad to ~0 and the entry is dropped by setClipTrim.
        let firstStart = Infinity;
        let lastEnd = -Infinity;
        for (const w of transcriptSnap) {
          if (nextDeleted.has(w.id)) continue;
          if (w.start < limits.leftLimit || w.start >= limits.rightLimit) continue;
          if (w.start < firstStart) firstStart = w.start;
          if (w.end > lastEnd) lastEnd = w.end;
        }
        if (firstStart === Infinity) firstStart = clipMinSrc;
        if (lastEnd === -Infinity) lastEnd = clipMaxSrc;

        const nextTrim =
          side === "right"
            ? { padStart: baselineTrim.padStart, padEnd: target - lastEnd }
            : { padStart: target - firstStart, padEnd: baselineTrim.padEnd };

        // Bundle all three updates into one setState so React batches the
        // re-render — avoids a flicker between the deletion + trim writes.
        const store = useEditorStore.getState();
        let nextTrims = store.clipTrims;
        if (anchorId) {
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
        }
        useEditorStore.setState({
          deletedWordIds: nextDeleted,
          segments: nextSegments,
          clipTrims: nextTrims,
        });
      };

      const onUp = () => {
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
        transitionDuration: "220ms, 220ms, 75ms, 75ms",
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
          clickable (zoom in with Ctrl+wheel to expose them). */}
      {showHandles && (
        <>
          <div
            className={`absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-20 transition-opacity duration-100
                        ${isSelected ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"}`}
            onPointerDown={(e) => handleEdgePointerDown(e, "left")}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim left edge · Shift+← extend · Shift+Alt+← shrink"
          >
            <div className="absolute inset-y-1 left-0 w-[3px] rounded-r-sm bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.4)]" />
          </div>
          <div
            className={`absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize z-20 transition-opacity duration-100
                        ${isSelected ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"}`}
            onPointerDown={(e) => handleEdgePointerDown(e, "right")}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim right edge · Shift+→ extend · Shift+Alt+→ shrink"
          >
            <div className="absolute inset-y-1 right-0 w-[3px] rounded-l-sm bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.4)]" />
          </div>
        </>
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

function formatTC(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
