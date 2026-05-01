"use client";

import { Film } from "lucide-react";
import { toTC } from "@/lib/timecode";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  currentTime: number;
  duration: number;
  fps: number;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onSeek: (t: number) => void;
}

export function Monitor({
  videoRef, videoUrl, currentTime, duration, fps,
  onLoadedMetadata, onTimeUpdate, onEnded, onSeek,
}: Props) {
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "#111" }}>
      {/* Header timecodes */}
      <div
        className="flex items-center justify-between px-4 shrink-0 border-b"
        style={{ height: 28, borderColor: "#2a2a2a", background: "#161616" }}
      >
        <span className="text-[10px] font-mono text-violet-300 tracking-widest">
          {toTC(currentTime, fps)}
        </span>
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Program</span>
        <span className="text-[10px] font-mono text-zinc-600 tracking-widest">
          {toTC(duration, fps)}
        </span>
      </div>

      {/* Video stage */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="max-h-full max-w-full outline-none"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
          />
        ) : (
          <EmptyMonitor />
        )}
      </div>

      {/* Scrubber */}
      {videoUrl && duration > 0 && (
        <div className="px-3 py-2 shrink-0" style={{ background: "#161616" }}>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={currentTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full h-1 accent-violet-500 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

function EmptyMonitor() {
  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div
        className="flex items-center justify-center rounded-lg"
        style={{ width: 72, height: 54, background: "#1e1e1e", border: "1px solid #2d2d2d" }}
      >
        <Film size={24} className="text-zinc-700" />
      </div>
      <p className="text-[12px] text-zinc-700">No media loaded</p>
    </div>
  );
}
