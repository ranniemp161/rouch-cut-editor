"use client";

import type { TranscriptSegment } from "@/store/useEditorStore";

interface Props {
  mediaFile: File | null;
  currentTime: number;
  duration: number;
  segments: TranscriptSegment[];
}

const HEADER_W = 72;
const TRACKS = ["V2", "V1", "A1", "A2"] as const;
const TICK_PX = 60;

export function Timeline({ mediaFile, currentTime, duration, segments }: Props) {
  const tickCount = Math.max(20, Math.ceil(duration) + 4);
  const ticks = Array.from({ length: tickCount }, (_, i) => i);
  const cutSegs = segments.filter((s) => s.isCut);

  return (
    <div
      className="flex flex-col shrink-0 border-t overflow-hidden"
      style={{ height: 180, background: "#141414", borderColor: "#2a2a2a" }}
    >
      <Ruler ticks={ticks} duration={duration} currentTime={currentTime} />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {TRACKS.map((track) => (
          <TrackLane
            key={track}
            track={track}
            ticks={ticks}
            tickCount={tickCount}
            duration={duration}
            currentTime={currentTime}
            mediaFile={mediaFile}
            cutSegs={cutSegs}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Ruler({
  ticks, duration, currentTime,
}: {
  ticks: number[];
  duration: number;
  currentTime: number;
}) {
  return (
    <div className="flex items-center border-b shrink-0" style={{ height: 24, borderColor: "#2a2a2a" }}>
      <div
        className="flex items-center px-3 shrink-0 border-r"
        style={{ width: HEADER_W, borderColor: "#2a2a2a" }}
      >
        <span className="text-[9px] font-semibold tracking-widest text-zinc-600 uppercase">
          Tracks
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative" style={{ height: 24 }}>
        <div className="flex items-end h-full">
          {ticks.map((i) => (
            <div
              key={i}
              className="flex flex-col items-start justify-end shrink-0"
              style={{ width: TICK_PX, height: "100%", borderLeft: "1px solid #2a2a2a" }}
            >
              <span className="text-[9px] text-zinc-700 pl-1 pb-1 font-mono">
                {`${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`}
              </span>
            </div>
          ))}
        </div>
        {duration > 0 && (
          <Playhead position={(currentTime / duration) * 100} className="bg-violet-400" />
        )}
      </div>
    </div>
  );
}

interface TrackLaneProps {
  track: string;
  ticks: number[];
  tickCount: number;
  duration: number;
  currentTime: number;
  mediaFile: File | null;
  cutSegs: TranscriptSegment[];
}

function TrackLane({
  track, ticks, tickCount, duration, currentTime, mediaFile, cutSegs,
}: TrackLaneProps) {
  return (
    <div className="flex border-b" style={{ height: 38, borderColor: "#1f1f1f" }}>
      <div
        className="flex items-center px-3 shrink-0 border-r"
        style={{ width: HEADER_W, background: "#1a1a1a", borderColor: "#2a2a2a" }}
      >
        <span className="text-[10px] font-mono text-zinc-600">{track}</span>
      </div>
      <div className="flex-1 relative overflow-hidden" style={{ background: "#141414" }}>
        {/* Grid */}
        <div className="absolute inset-0 flex pointer-events-none">
          {ticks.map((i) => (
            <div key={i} className="shrink-0" style={{ width: TICK_PX, borderLeft: "1px solid #1e1e1e" }} />
          ))}
        </div>

        {/* Cut overlays on V1 */}
        {track === "V1" && duration > 0 &&
          cutSegs.map((seg, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `${(seg.startS / duration) * 100}%`,
                width: `${((seg.endS - seg.startS) / duration) * 100}%`,
                background: "rgba(239,68,68,0.25)",
                borderLeft: "1px solid rgba(239,68,68,0.5)",
                borderRight: "1px solid rgba(239,68,68,0.5)",
              }}
            />
          ))}

        {/* Clip blocks */}
        {mediaFile && track === "V1" && duration > 0 && (
          <ClipBlock
            label={mediaFile.name}
            durationRatio={duration / tickCount}
            background="rgba(109,40,217,0.35)"
            border="rgba(139,92,246,0.5)"
            color="text-violet-300"
          />
        )}
        {mediaFile && track === "A1" && duration > 0 && (
          <ClipBlock
            label="audio"
            durationRatio={duration / tickCount}
            background="rgba(30,80,60,0.5)"
            border="rgba(52,211,153,0.25)"
            color="text-emerald-500/70"
          />
        )}

        {/* Playhead */}
        {duration > 0 && (
          <Playhead position={(currentTime / duration) * 100} className="bg-violet-400/60" />
        )}
      </div>
    </div>
  );
}

function ClipBlock({
  label, durationRatio, background, border, color,
}: {
  label: string;
  durationRatio: number;
  background: string;
  border: string;
  color: string;
}) {
  return (
    <div
      className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden"
      style={{
        left: 2,
        width: `calc(${durationRatio * 100}% - 4px)`,
        background,
        border: `1px solid ${border}`,
      }}
    >
      <span className={`text-[10px] truncate font-medium ${color}`}>{label}</span>
    </div>
  );
}

function Playhead({ position, className }: { position: number; className: string }) {
  return (
    <div
      className={`absolute top-0 bottom-0 w-px pointer-events-none ${className}`}
      style={{ left: `${position}%` }}
    />
  );
}
