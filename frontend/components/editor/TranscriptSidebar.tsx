"use client";

import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import type { WordTimestamp } from "@/types";

/**
 * Word-level interactive transcript (Descript / Gling style).
 * Each word is an independent <span> — clicking it toggles its membership
 * in `deletedWordIds`. Deleted words remain in the visual flow so users
 * can restore them, but get a strikethrough + muted styling.
 *
 * Words are visually grouped into paragraphs by sentence-ending punctuation
 * (`.`, `?`, `!`). The click handler is always on the inner <span>, never
 * on the paragraph wrapper.
 */
export function TranscriptSidebar() {
  const transcript = useEditorStore((s) => s.transcript);
  const deletedWordIds = useEditorStore((s) => s.deletedWordIds);
  const toggleWordState = useEditorStore((s) => s.toggleWordState);
  const resetDeletedWords = useEditorStore((s) => s.resetDeletedWords);

  const paragraphs = useMemo(() => groupIntoParagraphs(transcript), [transcript]);
  const deletedCount = deletedWordIds.size;

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
                  onClick={() => toggleWordState(word.id)}
                />
              ))}
            </p>
          ))
        )}
      </div>

      {deletedCount > 0 && <Footer total={transcript.length} deleted={deletedCount} />}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Word — the only thing that owns the click handler
// ---------------------------------------------------------------------------

interface WordProps {
  word: WordTimestamp;
  isDeleted: boolean;
  onClick: () => void;
}

function Word({ word, isDeleted, onClick }: WordProps) {
  const base =
    "inline-block px-1 py-0.5 mr-1 rounded cursor-pointer select-none transition-colors duration-100";

  const stateClasses = isDeleted
    ? "opacity-40 line-through text-red-400/70"
    : "text-zinc-200 hover:bg-purple-900/50 hover:text-purple-300";

  return (
    <span
      className={`${base} ${stateClasses}`}
      onClick={onClick}
      title={`${word.start.toFixed(2)}s – ${word.end.toFixed(2)}s${isDeleted ? "  ·  click to restore" : "  ·  click to cut"}`}
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

/**
 * Split the flat word list into visual paragraphs at sentence-ending
 * punctuation. The click handler stays on each individual <span>, so the
 * grouping is purely cosmetic and does not affect interaction.
 */
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
