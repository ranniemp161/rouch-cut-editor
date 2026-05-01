"use client";

import {
  ChevronLeft, ChevronRight, Loader2, Pause, Play,
  SkipBack, SkipForward, Volume2, Wand2,
} from "lucide-react";
import { toTC } from "@/lib/timecode";

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  fps: number;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onVolumeChange: (v: number) => void;
  canCut: boolean;
  isCutting: boolean;
  onCut: () => void;
}

export function TransportBar({
  isPlaying, currentTime, duration, volume, fps,
  onTogglePlay, onSkipBack, onSkipForward, onStepBack, onStepForward, onVolumeChange,
  canCut, isCutting, onCut,
}: Props) {
  return (
    <div
      className="flex items-center gap-4 px-4 shrink-0 border-t border-b"
      style={{ height: 44, background: "#161616", borderColor: "#2a2a2a" }}
    >
      <PlaybackControls
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onSkipBack={onSkipBack}
        onSkipForward={onSkipForward}
        onStepBack={onStepBack}
        onStepForward={onStepForward}
      />

      <TimecodeReadout currentTime={currentTime} duration={duration} fps={fps} />

      <div className="flex-1" />

      {canCut && <CutButton onClick={onCut} isCutting={isCutting} />}

      <VolumeControl value={volume} onChange={onVolumeChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PlaybackProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
}

function PlaybackControls({
  isPlaying, onTogglePlay, onSkipBack, onSkipForward, onStepBack, onStepForward,
}: PlaybackProps) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton onClick={onSkipBack} title="Go to start" Icon={SkipBack} />
      <IconButton onClick={onStepBack} title="Step back 1 frame" Icon={ChevronLeft} />

      <button
        onClick={onTogglePlay}
        className="mx-1 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-500 active:bg-violet-700 transition-colors text-white"
        style={{ width: 28, height: 28 }}
      >
        {isPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" />}
      </button>

      <IconButton onClick={onStepForward} title="Step forward 1 frame" Icon={ChevronRight} />
      <IconButton onClick={onSkipForward} title="Go to end" Icon={SkipForward} />
    </div>
  );
}

function IconButton({
  onClick, title, Icon,
}: {
  onClick: () => void;
  title: string;
  Icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded"
    >
      <Icon size={13} />
    </button>
  );
}

function TimecodeReadout({
  currentTime, duration, fps,
}: {
  currentTime: number;
  duration: number;
  fps: number;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded font-mono"
      style={{ background: "#0d0d0d", border: "1px solid #2a2a2a" }}
    >
      <span className="text-[12px] text-violet-300 tracking-widest">{toTC(currentTime, fps)}</span>
      <span className="text-[10px] text-zinc-700 mx-1">/</span>
      <span className="text-[11px] text-zinc-600 tracking-widest">{toTC(duration, fps)}</span>
    </div>
  );
}

function CutButton({ onClick, isCutting }: { onClick: () => void; isCutting: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={isCutting}
      className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[11px] font-semibold text-white transition-all bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isCutting ? (
        <>
          <Loader2 size={11} className="animate-spin" /> Cutting…
        </>
      ) : (
        <>
          <Wand2 size={11} /> Cut
        </>
      )}
    </button>
  );
}

function VolumeControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Volume2 size={12} className="text-zinc-600" />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 h-1 accent-violet-500 cursor-pointer"
      />
    </div>
  );
}
