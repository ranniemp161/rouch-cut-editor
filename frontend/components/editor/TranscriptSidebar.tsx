"use client";

import type { TranscriptSegment } from "@/store/useEditorStore";
import type { WordItem } from "@/lib/api";
import { toTC } from "@/lib/timecode";

interface Props {
  segments: TranscriptSegment[];
  words: WordItem[];
  silenceThreshold: number;
  currentTime: number;
  onToggle: (startS: number) => void;
  onThresholdChange: (t: number) => void;
  onSeek: (t: number) => void;
}

export function TranscriptSidebar({
  segments, words, silenceThreshold, currentTime,
  onToggle, onThresholdChange, onSeek,
}: Props) {
  const cutCount = segments.filter((s) => s.isCut).length;
  const savedSec = segments
    .filter((s) => s.isCut)
    .reduce((a, s) => a + s.endS - s.startS, 0);

  return (
    <aside
      className="flex flex-col h-full border-l shrink-0"
      style={{ width: 260, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <Header cutCount={cutCount} savedSec={savedSec} />
      <ThresholdControl value={silenceThreshold} onChange={onThresholdChange} />

      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
        {segments.map((seg, idx) => (
          <SegmentRow
            key={`${seg.startS}-${idx}`}
            seg={seg}
            words={words}
            currentTime={currentTime}
            onToggle={onToggle}
            onSeek={onSeek}
          />
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({ cutCount, savedSec }: { cutCount: number; savedSec: number }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2 border-b shrink-0"
      style={{ borderColor: "#2a2a2a" }}
    >
      <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
        Transcript
      </span>
      {cutCount > 0 && (
        <span className="text-[10px] text-emerald-500 font-medium">
          {savedSec.toFixed(1)}s cut
        </span>
      )}
    </div>
  );
}

function ThresholdControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (t: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
      style={{ borderColor: "#2a2a2a" }}
    >
      <span className="text-[9px] text-zinc-600 uppercase tracking-wider shrink-0">Silence ≥</span>
      <input
        type="range"
        min={0.1}
        max={3}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-0.5 accent-violet-500 cursor-pointer"
      />
      <span className="text-[10px] font-mono text-zinc-500 w-8 shrink-0">
        {value.toFixed(1)}s
      </span>
    </div>
  );
}

interface SegmentRowProps {
  seg: TranscriptSegment;
  words: WordItem[];
  currentTime: number;
  onToggle: (startS: number) => void;
  onSeek: (t: number) => void;
}

function SegmentRow({ seg, words, currentTime, onToggle, onSeek }: SegmentRowProps) {
  const segWords = words.filter((w) => w.start >= seg.startS && w.end <= seg.endS + 0.05);
  const duration = seg.endS - seg.startS;
  const isActive = currentTime >= seg.startS && currentTime < seg.endS;

  // Pure silence / repetition gap with no words → minimal divider.
  if (seg.isCut && segWords.length === 0) {
    return (
      <div className="flex items-center gap-2 py-0.5 px-1">
        <div className="flex-1 h-px" style={{ background: "#282828" }} />
        <span className="text-[9px] text-zinc-700 shrink-0 font-mono">
          {seg.reason} {duration.toFixed(1)}s
        </span>
        <div className="flex-1 h-px" style={{ background: "#282828" }} />
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <div
        className="w-0.5 rounded-full shrink-0 mt-1"
        style={{ background: isActive ? "#7c3aed" : "transparent", minHeight: 16 }}
      />
      <button
        onClick={() => onToggle(seg.startS)}
        onDoubleClick={() => onSeek(seg.startS)}
        title="Click to toggle cut · Double-click to jump here"
        className="flex-1 text-left rounded px-2 py-1.5 transition-all group"
        style={{
          background: seg.isCut
            ? "rgba(239,68,68,0.07)"
            : isActive
            ? "rgba(124,58,237,0.12)"
            : "rgba(255,255,255,0.02)",
          border: `1px solid ${
            seg.isCut ? "rgba(239,68,68,0.18)" : isActive ? "rgba(124,58,237,0.3)" : "#232323"
          }`,
        }}
      >
        {seg.reason !== "keep" && <ReasonBadge reason={seg.reason} />}

        <p
          className="text-[11px] leading-relaxed break-words"
          style={{
            color: seg.isCut ? "#444" : "#bbb",
            textDecoration: seg.isCut ? "line-through" : "none",
          }}
        >
          {segWords.length > 0 ? (
            segWords.map((w) => w.word).join(" ")
          ) : (
            <span className="italic text-zinc-700">{duration.toFixed(1)}s gap</span>
          )}
        </p>

        <p className="text-[9px] text-zinc-700 mt-0.5 font-mono">
          {toTC(seg.startS)} – {toTC(seg.endS)}
        </p>

        <span
          className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 block"
          style={{ color: seg.isCut ? "#22c55e" : "#f87171" }}
        >
          {seg.isCut ? "↩ restore" : "✕ cut"}
        </span>
      </button>
    </div>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  const isRepetition = reason === "repetition";
  return (
    <span
      className="text-[8px] font-semibold uppercase tracking-widest mb-1 inline-block px-1 py-0.5 rounded"
      style={{
        background: isRepetition ? "rgba(251,191,36,0.12)" : "rgba(239,68,68,0.12)",
        color: isRepetition ? "#fbbf24" : "#f87171",
      }}
    >
      {reason}
    </span>
  );
}
