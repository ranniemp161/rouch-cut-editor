"use client";

import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { RotateCcw, Scissors, RotateCw } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { useContextMenu } from "@/hooks/useContextMenu";
import type { WordTimestamp } from "@/types";

/**
 * Word-level interactive transcript (Descript / Gling style).
 *
 * Interactions:
 *  - Click           → seek video to word.start, clear multi-selection.
 *  - Shift+Click     → extend selection from lastClickedIndex (no seek).
 *  - Right-click     → open context menu; selects the word if not already selected.
 */
export function TranscriptSidebar() {
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const selectedWordIds = useEditorStore((s) => s.selectedWordIds);
  const lastClickedIndex = useEditorStore((s) => s.lastClickedIndex);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setLastClickedIndex = useEditorStore((s) => s.setLastClickedIndex);
  const bulkToggleWords = useEditorStore((s) => s.bulkToggleWords);
  const clearTrimsForIds = useEditorStore((s) => s.clearTrimsForIds);
  const resetDeletedWords = useEditorStore((s) => s.resetDeletedWords);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const menu = useContextMenu();

  // Stable index lookup so Shift-click can resolve range without an O(n) scan
  // on every interaction.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    transcript.forEach((w, i) => m.set(w.id, i));
    return m;
  }, [transcript]);

  const paragraphs = useMemo(() => groupIntoParagraphs(transcript), [transcript]);

  // Karaoke-style active word, found via a walking cursor instead of an
  // O(n) scan on every timeupdate. Playback is monotonic 99% of the time, so
  // the cursor advances by ~1 word per call. We walk in either direction to
  // tolerate seeks.
  const cursorRef = useRef(0);
  const activeWordId = useMemo(() => {
    if (transcript.length === 0) return null;
    let i = Math.min(cursorRef.current, transcript.length - 1);
    while (i < transcript.length - 1 && transcript[i].end < currentTime) i++;
    while (i > 0 && transcript[i].start > currentTime) i--;
    cursorRef.current = i;
    const w = transcript[i];
    if (w.word === "[SILENCE]") return null;
    if (w.start <= currentTime && w.end >= currentTime) return w.id;
    return null;
  }, [transcript, currentTime]);

  // Auto-scroll the sidebar so the active word stays in view as playback
  // moves on. We hold a ref keyed by word id; the active word updates the ref
  // and we scroll into view on change.
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!activeWordId) return;
    const el = activeWordRef.current;
    if (!el) return;
    // Only scroll when the word is actually near the edge of (or outside)
    // the scroll container — otherwise every word change triggers a smooth
    // scroll animation and the sidebar jitters.
    const container = el.closest(".overflow-y-auto") as HTMLElement | null;
    if (!container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const margin = 48;
    if (elRect.top < cRect.top + margin || elRect.bottom > cRect.bottom - margin) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeWordId]);
  // Exclude [SILENCE] markers from counts — they aren't real words.
  const spokenCount = useMemo(() => transcript.filter((w) => w.word !== "[SILENCE]").length, [transcript]);
  const deletedCount = useMemo(
    () => transcript.filter((w) => w.word !== "[SILENCE]" && deletedWordIds.has(w.id)).length,
    [transcript, deletedWordIds]
  );

  const handleWordClick = (e: MouseEvent<HTMLSpanElement>, word: WordTimestamp) => {
    const index = indexById.get(word.id);
    if (index === undefined) return;

    if (e.shiftKey && lastClickedIndex !== null) {
      const [from, to] =
        lastClickedIndex < index ? [lastClickedIndex, index] : [index, lastClickedIndex];
      const next = new Set<string>();
      for (let i = from; i <= to; i++) next.add(transcript[i].id);
      setSelectedWords(next);
      return;
    }

    setSelectedWords(new Set());
    setLastClickedIndex(index);
    setSeekTime(word.start);
  };

  const handleContextMenu = (e: MouseEvent<HTMLSpanElement>, word: WordTimestamp) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selectedWordIds.has(word.id)) {
      setSelectedWords(new Set([word.id]));
      const index = indexById.get(word.id);
      if (index !== undefined) setLastClickedIndex(index);
    }

    menu.open(e.clientX, e.clientY);
  };

  const applyAndClose = (isDeleted: boolean) => {
    const ids = Array.from(selectedWordIds);
    if (ids.length > 0) {
      pushHistory();
      bulkToggleWords(ids, isDeleted);
      if (isDeleted) clearTrimsForIds(ids);
    }
    setSelectedWords(new Set());
    menu.close();
  };

  const handleReset = () => {
    pushHistory();
    resetDeletedWords();
  };

  return (
    <aside
      className="flex flex-col h-full border-l shrink-0"
      style={{ width: 280, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <Header
        total={spokenCount}
        deleted={deletedCount}
        onReset={handleReset}
      />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {paragraphs.length === 0 ? (
          <p className="text-[12px] text-zinc-700 text-center mt-6">No transcript</p>
        ) : (
          paragraphs.map((paragraph, i) => (
            <p
              key={`p-${i}`}
              className="text-[13px] leading-[1.85] mb-5 last:mb-0"
            >
              {paragraph.map((word) => {
                const isActive = activeWordId === word.id;
                return (
                  <Word
                    key={word.id}
                    word={word}
                    isDeleted={deletedWordIds.has(word.id)}
                    isSelected={selectedWordIds.has(word.id)}
                    isActive={isActive}
                    isMarker={word.isMarker === true}
                    refCb={isActive ? (el) => { activeWordRef.current = el; } : undefined}
                    onClick={(e) => handleWordClick(e, word)}
                    onContextMenu={(e) => handleContextMenu(e, word)}
                  />
                );
              })}
            </p>
          ))
        )}
      </div>

      {deletedCount > 0 && <Footer total={spokenCount} deleted={deletedCount} />}

      {menu.isOpen && (
        <div
          // Stop the global mousedown closer from firing before our buttons run.
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[160px] py-1 bg-zinc-800 border border-zinc-700 shadow-xl rounded-md text-[12px] text-zinc-200"
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
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Word — the only thing that owns the click handler
// ---------------------------------------------------------------------------

interface WordProps {
  word: WordTimestamp;
  isDeleted: boolean;
  isSelected: boolean;
  isActive: boolean;
  isMarker: boolean;
  refCb?: (el: HTMLSpanElement | null) => void;
  onClick: (e: MouseEvent<HTMLSpanElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLSpanElement>) => void;
}

function Word({ word, isDeleted, isSelected, isActive, isMarker, refCb, onClick, onContextMenu }: WordProps) {
  const base =
    "inline-block px-1 py-0.5 mr-1 rounded cursor-pointer select-none transition-colors duration-100";

  // Action Markers ("play clip 2", "insert b-roll", "call to action") get a
  // distinct amber treatment instead of strike-through — they are NOT
  // deletions, they are anchors telling the editor where to drop external
  // assets. Selection / active states still win visually so user intent is
  // never masked.
  const selectionClasses = isSelected
    ? "bg-purple-600/40 text-purple-100"
    : isActive
      ? "bg-purple-600/50 text-white shadow-sm"
      : isMarker
        ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25"
        : isDeleted
          ? "opacity-40 line-through text-red-400/70"
          : "text-zinc-200 hover:bg-purple-900/50 hover:text-purple-300";

  const deletedOverlay = isSelected && isDeleted ? " line-through opacity-70" : "";

  const titleSuffix = isMarker ? " · action marker" : "";
  return (
    <span
      ref={refCb}
      className={`${base} ${selectionClasses}${deletedOverlay}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s${titleSuffix}`}
    >
      {word.word}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Header / Footer
// ---------------------------------------------------------------------------

function Header({
  total,
  deleted,
  onReset,
}: {
  total: number;
  deleted: number;
  onReset: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
      style={{ borderColor: "#2a2a2a" }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Transcript
        </span>
        <span className="text-[10px] text-zinc-700">{total} words</span>
      </div>

      {deleted > 0 && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-purple-300 transition-colors"
          title="Restore all deleted words"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      )}
    </div>
  );
}

function Footer({ total, deleted }: { total: number; deleted: number }) {
  const kept = total - deleted;
  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-t shrink-0"
      style={{ borderColor: "#2a2a2a", background: "#161616" }}
    >
      <span className="text-[10px] text-red-400/80">
        <span className="font-semibold">{deleted}</span> cut
      </span>
      <span className="text-[10px] text-zinc-700">·</span>
      <span className="text-[10px] text-emerald-400/80">
        <span className="font-semibold">{kept}</span> kept
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function groupIntoParagraphs(words: WordTimestamp[]): WordTimestamp[][] {
  // Strip [SILENCE] tokens — they're an internal marker, not readable text.
  const spoken = words.filter((w) => w.word !== "[SILENCE]");
  const groups: WordTimestamp[][] = [];
  let current: WordTimestamp[] = [];

  for (const w of spoken) {
    current.push(w);
    if (/[.!?]["')\]]?$/.test(w.word)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}
