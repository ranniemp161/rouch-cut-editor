"use client";

import { useMemo, type MouseEvent } from "react";
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
  const setSeekTime = useEditorStore((s) => s.setSeekTime);
  const setSelectedWords = useEditorStore((s) => s.setSelectedWords);
  const setLastClickedIndex = useEditorStore((s) => s.setLastClickedIndex);
  const bulkToggleWords = useEditorStore((s) => s.bulkToggleWords);
  const resetDeletedWords = useEditorStore((s) => s.resetDeletedWords);

  const menu = useContextMenu();

  // Stable index lookup so Shift-click can resolve range without an O(n) scan
  // on every interaction.
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    transcript.forEach((w, i) => m.set(w.id, i));
    return m;
  }, [transcript]);

  const paragraphs = useMemo(() => groupIntoParagraphs(transcript), [transcript]);
  const deletedCount = deletedWordIds.size;

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
    if (ids.length > 0) bulkToggleWords(ids, isDeleted);
    setSelectedWords(new Set());
    menu.close();
  };

  return (
    <aside
      className="flex flex-col h-full border-l shrink-0"
      style={{ width: 320, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <Header
        total={transcript.length}
        deleted={deletedCount}
        onReset={resetDeletedWords}
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
              {paragraph.map((word) => (
                <Word
                  key={word.id}
                  word={word}
                  isDeleted={deletedWordIds.has(word.id)}
                  isSelected={selectedWordIds.has(word.id)}
                  onClick={(e) => handleWordClick(e, word)}
                  onContextMenu={(e) => handleContextMenu(e, word)}
                />
              ))}
            </p>
          ))
        )}
      </div>

      {deletedCount > 0 && <Footer total={transcript.length} deleted={deletedCount} />}

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
  onClick: (e: MouseEvent<HTMLSpanElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLSpanElement>) => void;
}

function Word({ word, isDeleted, isSelected, onClick, onContextMenu }: WordProps) {
  const base =
    "inline-block px-1 py-0.5 mr-1 rounded cursor-pointer select-none transition-colors duration-100";

  // Selection wins on the background; deletion still applies its strikethrough
  // on top so a selected-and-deleted word reads correctly.
  const selectionClasses = isSelected
    ? "bg-purple-600/40 text-purple-100"
    : isDeleted
      ? "opacity-40 line-through text-red-400/70"
      : "text-zinc-200 hover:bg-purple-900/50 hover:text-purple-300";

  const deletedOverlay = isSelected && isDeleted ? " line-through opacity-70" : "";

  return (
    <span
      className={`${base} ${selectionClasses}${deletedOverlay}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s`}
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
  const groups: WordTimestamp[][] = [];
  let current: WordTimestamp[] = [];

  for (const w of words) {
    current.push(w);
    if (/[.!?]["')\]]?$/.test(w.word)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}
