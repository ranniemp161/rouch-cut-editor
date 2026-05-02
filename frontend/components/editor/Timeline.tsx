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
import { Scissors, RotateCw, Minus, Plus } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { useContextMenu } from "@/hooks/useContextMenu";
import {
  buildEditMap,
  editedToSource,
  sourceToEdited,
  type KeptRange,
} from "@/lib/editMap";

type Lane = "V1" | "A1";

const ZOOM_MIN = 1;
const ZOOM_MAX = 20;
const ZOOM_STEP = 1.2;

interface MarqueeRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  width: number;
}

// A clip on the edited timeline = one kept range, with the underlying word
// IDs cached for selection.
interface Clip {
  range: KeptRange;
  wordIds: string[];
  anchorIndex: number;
}

export function Timeline() {
  const currentTime = useEditorStore((s) => s.currentTime);
  const sourceDuration = useEditorStore((s) => s.durationSeconds);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const segments = useEditorStore((s) => s.segments);
  const splitMarkers = useEditorStore((s) => s.splitMarkers);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const lastClickedIndex = useEditorStore((s) => s.lastClickedIndex);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setLastClickedIndex = useEditorStore((s) => s.setLastClickedIndex);
  const bulkToggleWords = useEditorStore((s) => s.bulkToggleWords);
  const addSplitMarker = useEditorStore((s) => s.addSplitMarker);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [zoom, setZoom] = useState(1);
  const pendingZoomCursor = useRef<{ time: number; cursorX: number } | null>(null);

  const menu = useContextMenu();

  // ── Edit map: source ↔ edited mapping ─────────────────────────────────────
  const editMap = useMemo(
    () => buildEditMap(transcript, deletedWordIds, segments, sourceDuration),
    [transcript, deletedWordIds, segments, sourceDuration],
  );
  const editedDuration = editMap.editedDuration;
  const canRender = editedDuration > 0;

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
        const ids: string[] = [];
        let anchor = -1;
        let j = wi;
        while (j < transcript.length && transcript[j].start < subEnd) {
          const w = transcript[j];
          if (w.start >= subStart && !deletedWordIds.has(w.id)) {
            ids.push(w.id);
            if (anchor === -1) anchor = j;
          }
          j++;
        }
        out.push({ range: subRange, wordIds: ids, anchorIndex: anchor === -1 ? wi : anchor });
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

  // Playhead position in edited coordinates.
  const playheadEdited = useMemo(() => {
    if (!canRender) return 0;
    const e = sourceToEdited(currentTime, editMap);
    return e ?? 0;
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
      if (ids.length > 0) bulkToggleWords(ids, isDeleted);
      setSelectedWords(new Set());
      menu.close();
    },
    [bulkToggleWords, menu, selectedWordIds, setSelectedWords],
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
      setMarquee((prev) => {
        if (!prev) return prev;
        const minX = Math.min(prev.startX, prev.currentX);
        const maxX = Math.max(prev.startX, prev.currentX);
        const dragged = maxX - minX > 2;
        if (!dragged) {
          setSelectedWords(new Set());
          return null;
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
        return null;
      });
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

      // Backspace / Delete — drop the currently-selected words (i.e. the
      // selected clip). Falls through if nothing is selected so the browser
      // can still handle the key elsewhere.
      if (e.key === "Backspace" || e.key === "Delete") {
        if (state.selectedWordIds.size === 0) return;
        e.preventDefault();
        bulkToggleWords(Array.from(state.selectedWordIds), true);
        setSelectedWords(new Set());
        return;
      }

      // S — splice the active clip at the playhead.
      if (k === "s") {
        e.preventDefault();
        const insideKept = editMap.keptRanges.some(
          (r) => now > r.sourceStart + 0.005 && now < r.sourceEnd - 0.005,
        );
        if (insideKept) addSplitMarker(now);
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
        bulkToggleWords(ids, true);
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
      if (ids.length > 0) bulkToggleWords(ids, true);
      // Land the playhead just inside the previous kept range so it doesn't
      // sit exactly on a boundary (which maps to null in source→edited).
      if (k === "q") setSeekTime(Math.max(0, prev - 0.001));
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [bulkToggleWords, setSeekTime, setSelectedWords, addSplitMarker, editMap]);

  // ── Ruler ticks (in edited-time) ──────────────────────────────────────────
  const rulerTicks = useMemo(() => {
    if (!canRender) return [] as number[];
    const target = 10 * zoom;
    const step = Math.max(1, Math.round(editedDuration / target));
    const out: number[] = [];
    for (let t = 0; t <= editedDuration; t += step) out.push(t);
    return out;
  }, [canRender, editedDuration, zoom]);

  // Split markers — keep only ones that survived the ripple, mapped to edited.
  const visibleSplitMarkers = useMemo(() => {
    if (!canRender) return [] as number[];
    return splitMarkers
      .map((s) => sourceToEdited(s, editMap))
      .filter((v): v is number => v !== null);
  }, [splitMarkers, editMap, canRender]);

  return (
    <div className="relative w-full h-40 bg-zinc-950 flex flex-col select-none">
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
      >
        <div
          className="relative h-full flex flex-col"
          style={{ width: `${zoom * 100}%`, minWidth: "100%" }}
        >
          {/* Ruler */}
          <div
            ref={rulerRef}
            onPointerDown={handleRulerPointerDown}
            className={`h-7 bg-zinc-900/60 border-b border-zinc-800/80 relative shrink-0 ${
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
              clips={clips}
              selectedWordIds={selectedWordIds}
              tone="video"
              onClipClick={handleClipClick}
              onClipContextMenu={handleClipContextMenu}
            />
            <TrackLane
              label="A1"
              top="50%"
              canRender={canRender}
              editedDuration={editedDuration}
              clips={clips}
              selectedWordIds={selectedWordIds}
              tone="audio"
              onClipClick={handleClipClick}
              onClipContextMenu={handleClipContextMenu}
            />

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
                  className="absolute z-30 border border-purple-400/70 bg-purple-400/10 pointer-events-none rounded-[2px]"
                  style={{ left, top, width, height }}
                />
              );
            })()}
          </div>

          {/* Playhead — distinct cap on the ruler + 1px line through the tracks */}
          {canRender && (
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none"
              style={{ left: `${playheadPct}%`, transform: "translateX(-50%)" }}
            >
              <div
                className="absolute left-1/2 -translate-x-1/2 top-0 h-3 w-3
                           rounded-sm bg-purple-400 shadow-[0_0_4px_rgba(192,132,252,0.8)]"
              />
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-purple-400" />
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

interface TrackLaneProps {
  label: Lane;
  top: number | string;
  canRender: boolean;
  editedDuration: number;
  clips: Clip[];
  selectedWordIds: Set<string>;
  tone: "video" | "audio";
  onClipClick: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onClipContextMenu: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
}

function TrackLane({
  label, top, canRender, editedDuration, clips, selectedWordIds, tone,
  onClipClick, onClipContextMenu,
}: TrackLaneProps) {
  return (
    <div className="absolute left-0 right-0 h-1/2" style={{ top }}>
      <span className="absolute left-2 top-1 text-[9px] font-mono text-zinc-700 z-10 pointer-events-none tracking-wider">
        {label}
      </span>

      {canRender &&
        clips.map((clip, i) => (
          <ClipBlock
            key={`${tone}-${clip.range.editedStart}`}
            clip={clip}
            editedDuration={editedDuration}
            isSelected={clip.wordIds.some((id) => selectedWordIds.has(id))}
            tone={tone}
            isFirst={i === 0}
            onClick={onClipClick}
            onContextMenu={onClipContextMenu}
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
  isSelected: boolean;
  tone: "video" | "audio";
  isFirst: boolean;
  onClick: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>, clip: Clip) => void;
}

function ClipBlock({
  clip, editedDuration, isSelected, tone, isFirst, onClick, onContextMenu,
}: ClipBlockProps) {
  const styleClasses =
    tone === "video"
      ? "bg-purple-600/85 hover:bg-purple-500"
      : "bg-emerald-600/70 hover:bg-emerald-500/90";
  const selectedRing = isSelected
    ? " ring-2 ring-white/95 shadow-[0_0_0_1px_rgba(168,85,247,0.5)] z-10"
    : "";
  const seam = isFirst ? "" : " border-l border-zinc-950/70";

  return (
    <div
      className={`absolute top-1.5 bottom-1.5 cursor-grab active:cursor-grabbing rounded-[2px] transition-colors duration-75 ${styleClasses}${selectedRing}${seam}`}
      style={{
        left: `${(clip.range.editedStart / editedDuration) * 100}%`,
        width: `${((clip.range.editedEnd - clip.range.editedStart) / editedDuration) * 100}%`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onClick(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
    >
      {/* Trim affordance — 4px hot zones at each edge show a resize cursor.
          Trimming itself isn't wired up yet; this is the visual hint only. */}
      <div className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize" />
      <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize" />
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
