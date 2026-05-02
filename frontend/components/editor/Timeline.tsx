"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditorStore } from "@/store/useEditorStore";

const RULER_HEIGHT = 24;
const TRACK_HEIGHT = 38;
const TRACKS = ["V1", "A1"] as const;

export function Timeline() {
  const currentTime = useEditorStore((s) => s.currentTime);
  const duration = useEditorStore((s) => s.durationSeconds);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const splitMarkers = useEditorStore((s) => s.splitMarkers);

  const trackAreaRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Resolve a clientX into a clamped time in seconds against the track bbox.
  const timeFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = trackAreaRef.current;
      if (!el || duration <= 0) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, ratio));
      return clamped * duration;
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const t = timeFromClientX(e.clientX);
      if (t === null) return;
      setSeekTime(t);
      setIsDragging(true);
    },
    [setSeekTime, timeFromClientX],
  );

  // Window-level move/up listeners while scrubbing — guarantees we keep
  // tracking the pointer even if it leaves the timeline bounds.
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      const t = timeFromClientX(e.clientX);
      if (t !== null) setSeekTime(t);
    };
    const onUp = () => setIsDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, setSeekTime, timeFromClientX]);

  // Pre-bucket transcript words by deletion state so we don't run two map
  // passes through every word during render.
  const { activeWords, cutWords } = useMemo(() => {
    const active: typeof transcript = [];
    const cut: typeof transcript = [];
    for (const w of transcript) {
      (deletedWordIds.has(w.id) ? cut : active).push(w);
    }
    return { activeWords: active, cutWords: cut };
  }, [transcript, deletedWordIds]);

  const canRender = duration > 0;

  return (
    <div className="flex flex-col shrink-0 bg-zinc-900 border-t border-zinc-800 select-none">
      {/* Ruler */}
      <div
        className="relative border-b border-zinc-800"
        style={{ height: RULER_HEIGHT }}
      >
        <Ticks duration={duration} />
      </div>

      {/* Track area — owns pointer capture for scrubbing */}
      <div
        ref={trackAreaRef}
        onPointerDown={handlePointerDown}
        className={`relative ${isDragging ? "cursor-grabbing" : "cursor-pointer"}`}
        style={{ height: TRACKS.length * TRACK_HEIGHT, touchAction: "none" }}
      >
        {TRACKS.map((label, i) => (
          <TrackLane
            key={label}
            label={label}
            top={i * TRACK_HEIGHT}
            canRender={canRender}
            duration={duration}
            activeWords={activeWords}
            cutWords={cutWords}
          />
        ))}

        {/* Split markers — span the entire track stack */}
        {canRender &&
          splitMarkers.map((time, idx) => (
            <div
              key={`split-${idx}-${time}`}
              className="absolute top-0 bottom-0 w-[1px] bg-white z-10 pointer-events-none"
              style={{ left: `${(time / duration) * 100}%` }}
            />
          ))}

        {/* Playhead needle */}
        {canRender && (
          <div
            className="absolute top-0 bottom-0 z-20 pointer-events-none"
            style={{ left: `${playheadPct}%`, transform: "translateX(-50%)" }}
          >
            <div className="absolute left-1/2 -translate-x-1/2 -top-[6px] w-3 h-3 rounded-sm bg-purple-500 shadow-md shadow-purple-900/50" />
            <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[1.5px] bg-purple-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track lane: one horizontal row of clip blocks for the given track label.
// ---------------------------------------------------------------------------

interface TrackLaneProps {
  label: string;
  top: number;
  canRender: boolean;
  duration: number;
  activeWords: ReturnType<typeof useEditorStore.getState>["transcript"];
  cutWords: ReturnType<typeof useEditorStore.getState>["transcript"];
}

function TrackLane({
  label,
  top,
  canRender,
  duration,
  activeWords,
  cutWords,
}: TrackLaneProps) {
  return (
    <div
      className="absolute left-0 right-0 border-b border-zinc-800/60"
      style={{ top, height: TRACK_HEIGHT }}
    >
      <span className="absolute left-2 top-1 text-[9px] font-mono text-zinc-600 z-10 pointer-events-none">
        {label}
      </span>

      {canRender && (
        <>
          {cutWords.map((w) => (
            <div
              key={`cut-${w.id}`}
              className="absolute top-1 bottom-1 bg-red-900/30 border border-red-500/50 rounded-sm pointer-events-none"
              style={{
                left: `${(w.start / duration) * 100}%`,
                width: `${((w.end - w.start) / duration) * 100}%`,
              }}
            />
          ))}
          {activeWords.map((w) => (
            <div
              key={`act-${w.id}`}
              className="absolute top-1 bottom-1 bg-purple-600 border border-purple-400 rounded-sm pointer-events-none"
              style={{
                left: `${(w.start / duration) * 100}%`,
                width: `${((w.end - w.start) / duration) * 100}%`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ruler ticks — one label per second-ish, scaled to the visible width.
// ---------------------------------------------------------------------------

function Ticks({ duration }: { duration: number }) {
  const ticks = useMemo(() => {
    if (duration <= 0) return [] as number[];
    // Aim for ~10 labelled ticks regardless of clip length.
    const step = Math.max(1, Math.round(duration / 10));
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [duration]);

  if (duration <= 0) return null;

  return (
    <>
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute top-0 bottom-0 border-l border-zinc-800 pl-1 flex items-end pb-0.5"
          style={{ left: `${(t / duration) * 100}%` }}
        >
          <span className="text-[9px] font-mono text-zinc-600">
            {`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`}
          </span>
        </div>
      ))}
    </>
  );
}
