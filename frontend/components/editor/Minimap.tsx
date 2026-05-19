"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditMap } from "@/lib/editMap";

interface MinimapProps {
  editMap: EditMap;
  /** Current zoom level of the main timeline (1 = fit). */
  zoom: number;
  /** The scroll container whose scrollLeft / scrollWidth this mirrors. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Editing duration in seconds – used to position the playhead pip. */
  editedDuration: number;
  /** Current playhead position in edited-time seconds. */
  playheadEdited: number;
}

const MINIMAP_HEIGHT = 24; // px

/**
 * Minimap — a 24px-high bird's-eye-view of the entire edited sequence.
 *
 * Kept ranges are painted as violet (video) bars. Deleted regions are dark.
 * A bright viewport window shows the portion currently visible in the main
 * timeline scroll container and can be dragged to instantly pan the view.
 * The playhead is a thin white line so the user never loses track of where
 * they are in the sequence.
 *
 * Interactivity:
 *  - Click anywhere → teleport the scroll container to that position.
 *  - Drag the viewport box → smooth 60fps panning (direct DOM mutation,
 *    no React state involved in the hot path).
 */
export function Minimap({ editMap, zoom, scrollRef, editedDuration, playheadEdited }: MinimapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Viewport box state: fractional [0..1] positions of left & right edges.
  const [viewportFrac, setViewportFrac] = useState<{ left: number; width: number }>({
    left: 0,
    width: 1,
  });

  // ── Sync viewport box with the scroll container ──────────────────────────
  // The outer scroll div's scrollLeft + clientWidth / scrollWidth gives us
  // the viewport fraction. We read from the DOM directly (not React state)
  // to avoid stale closure issues with the scroll handler.
  const syncViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sw = el.scrollWidth;
    if (sw <= 0) return;
    const left = el.scrollLeft / sw;
    const width = el.clientWidth / sw;
    setViewportFrac({ left, width });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Initial sync
    syncViewport();
    el.addEventListener("scroll", syncViewport, { passive: true });
    return () => el.removeEventListener("scroll", syncViewport);
  }, [scrollRef, syncViewport, zoom]);

  // Re-sync whenever zoom changes (scrollWidth recalculates on next paint).
  useEffect(() => {
    // Defer by one frame so the layout has committed the new width.
    const id = requestAnimationFrame(syncViewport);
    return () => cancelAnimationFrame(id);
  }, [zoom, syncViewport]);

  // ── Drag: viewport box → pan the scroll container ────────────────────────
  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const mm = containerRef.current;
      const sc = scrollRef.current;
      if (!mm || !sc) return;

      const mmRect = mm.getBoundingClientRect();
      const startX = e.clientX;
      const startScrollLeft = sc.scrollLeft;

      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX; // px delta on minimap
        const scrollDelta = (dx / mmRect.width) * sc.scrollWidth;
        sc.scrollLeft = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, startScrollLeft + scrollDelta));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [scrollRef],
  );

  // ── Click on minimap body → teleport scroll ───────────────────────────────
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const mm = containerRef.current;
      const sc = scrollRef.current;
      if (!mm || !sc) return;
      const rect = mm.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      // Centre the viewport on the clicked position.
      const targetScroll = frac * sc.scrollWidth - sc.clientWidth / 2;
      sc.scrollLeft = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, targetScroll));
    },
    [scrollRef],
  );

  if (editedDuration <= 0) return null;

  return (
    <div
      ref={containerRef}
      onClick={handleMinimapClick}
      className="relative w-full shrink-0 bg-zinc-900/80 border-b border-zinc-800/60 cursor-pointer overflow-hidden select-none"
      style={{ height: MINIMAP_HEIGHT }}
      title="Minimap — drag to pan, click to teleport"
    >
      {/* ── Kept ranges (clips) ── */}
      {editMap.keptRanges.map((r, i) => {
        const left = (r.editedStart / editedDuration) * 100;
        const width = ((r.editedEnd - r.editedStart) / editedDuration) * 100;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {/* Video bar — top half */}
            <div
              className="absolute left-0 right-0"
              style={{
                top: 0,
                height: "50%",
                background: "rgba(139, 92, 246, 0.65)", // violet-500/65
              }}
            />
            {/* Audio bar — bottom half */}
            <div
              className="absolute left-0 right-0"
              style={{
                bottom: 0,
                height: "50%",
                background: "rgba(16, 185, 129, 0.45)", // emerald-500/45
              }}
            />
          </div>
        );
      })}

      {/* ── Deleted regions — optional subtle tint so cuts are obvious ── */}
      {editMap.deletedRegions.map((r, i) => {
        const left = (r.start / editedDuration) * 100;
        const width = ((r.end - r.start) / editedDuration) * 100;
        return (
          <div
            key={`del-${i}`}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: "rgba(0,0,0,0.30)",
            }}
          />
        );
      })}

      {/* ── Playhead pip ── */}
      {editedDuration > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px pointer-events-none z-20"
          style={{
            left: `${(playheadEdited / editedDuration) * 100}%`,
            background: "rgba(167,139,250,0.95)", // violet-400
            boxShadow: "0 0 4px rgba(167,139,250,0.7)",
          }}
        />
      )}

      {/* ── Viewport window ── */}
      {zoom > 1 && (
        <div
          onPointerDown={handleViewportPointerDown}
          className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
          style={{
            left: `${viewportFrac.left * 100}%`,
            width: `${viewportFrac.width * 100}%`,
            background: "rgba(139, 92, 246, 0.12)",
            border: "1px solid rgba(139, 92, 246, 0.55)",
            boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.1)",
            borderRadius: 2,
          }}
          title="Drag to pan the timeline"
        />
      )}

      {/* ── Subtle center-line ── */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{ top: "50%", height: 1, background: "rgba(255,255,255,0.04)" }}
      />
    </div>
  );
}
