"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  Scissors, FolderOpen, Settings, Upload, Play, Pause,
  SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Volume2, LogOut, Film, Info, AlignJustify, Download,
} from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toTC = (seconds: number, fps = 23.976): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return [h, m, s, f].map((n) => String(n).padStart(2, "0")).join(":");
};

const formatSize = (bytes: number): string => {
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function TopBar() {
  const logout = useEditorStore((s) => s.logout);
  return (
    <header
      className="flex items-center gap-3 px-4 shrink-0 border-b"
      style={{ height: 40, background: "#161616", borderColor: "#2a2a2a" }}
    >
      <Scissors size={14} className="text-violet-400" />
      <span className="text-[11px] font-semibold tracking-[0.25em] text-white uppercase">
        Rough Cut
      </span>

      <div className="w-px h-4 bg-zinc-700 mx-2" />

      <span className="text-[12px] text-zinc-400">Untitled Project</span>

      <div className="flex-1" />

      <button className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors">
        <Download size={11} />
        Export
      </button>

      <button
        onClick={logout}
        className="p-1.5 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
        title="Sign out"
      >
        <LogOut size={13} />
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Media Bin (left panel)
// ---------------------------------------------------------------------------

interface MediaBinProps {
  onFileSelect: (file: File) => void;
}

function MediaBin({ onFileSelect }: MediaBinProps) {
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
    e.target.value = "";
  };

  return (
    <aside
      className="flex flex-col h-full border-r shrink-0 overflow-hidden"
      style={{ width: 220, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Media
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-violet-300 hover:text-white hover:bg-violet-600/30 transition-colors border border-violet-500/30"
        >
          <Upload size={9} />
          Import
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.mxf,.avi,.mkv"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Bin contents */}
      <div className="flex-1 overflow-y-auto p-2">
        {!mediaFile ? (
          <div
            className="flex flex-col items-center justify-center gap-2 h-full text-center cursor-pointer rounded-lg border border-dashed transition-colors hover:border-violet-500/40"
            style={{ borderColor: "#333" }}
            onClick={() => inputRef.current?.click()}
          >
            <FolderOpen size={22} className="text-zinc-700" />
            <p className="text-[11px] text-zinc-600">Click Import or drop a file</p>
          </div>
        ) : (
          <div
            className="flex items-start gap-2 p-2 rounded-md border cursor-default select-none"
            style={{ background: "#222", borderColor: "#333" }}
          >
            <div
              className="flex items-center justify-center rounded shrink-0"
              style={{ width: 36, height: 28, background: "#2d2d2d" }}
            >
              <Film size={14} className="text-violet-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-200 truncate leading-tight" title={mediaFile.name}>
                {mediaFile.name}
              </p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{formatSize(mediaFile.size)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav icons */}
      <div
        className="flex items-center justify-around px-2 py-2 border-t shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        {[
          { icon: Film, label: "Media", active: true },
          { icon: AlignJustify, label: "Timeline", active: false },
          { icon: Info, label: "Inspector", active: false },
          { icon: Settings, label: "Settings", active: false },
        ].map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            title={label}
            className={["p-1.5 rounded transition-colors", active ? "text-violet-400" : "text-zinc-600 hover:text-zinc-400"].join(" ")}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Program Monitor (center)
// ---------------------------------------------------------------------------

interface MonitorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  currentTime: number;
  duration: number;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
}

function Monitor({ videoRef, videoUrl, currentTime, duration, onLoadedMetadata, onTimeUpdate, onEnded }: MonitorProps) {
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "#111" }}>
      {/* Timecode strip */}
      <div
        className="flex items-center justify-between px-4 shrink-0 border-b"
        style={{ height: 28, borderColor: "#2a2a2a", background: "#161616" }}
      >
        <span className="text-[10px] font-mono text-violet-300 tracking-widest">
          {toTC(currentTime)}
        </span>
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Program</span>
        <span className="text-[10px] font-mono text-zinc-600 tracking-widest">
          {toTC(duration)}
        </span>
      </div>

      {/* Video area */}
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
          <div className="flex flex-col items-center gap-3 select-none">
            <div
              className="flex items-center justify-center rounded-lg"
              style={{ width: 72, height: 54, background: "#1e1e1e", border: "1px solid #2d2d2d" }}
            >
              <Film size={24} className="text-zinc-700" />
            </div>
            <p className="text-[12px] text-zinc-700">No media loaded</p>
          </div>
        )}
      </div>

      {/* Scrub bar */}
      {videoUrl && duration > 0 && (
        <div className="px-3 py-2 shrink-0" style={{ background: "#161616" }}>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={currentTime}
            onChange={(e) => {
              if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
            }}
            className="w-full h-1 accent-violet-500 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector (right panel)
// ---------------------------------------------------------------------------

function Inspector({ mediaFile, duration }: { mediaFile: File | null; duration: number }) {
  return (
    <aside
      className="flex flex-col h-full border-l shrink-0 overflow-hidden"
      style={{ width: 200, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <div
        className="flex items-center px-3 py-2 border-b shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Inspector
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!mediaFile ? (
          <p className="text-[11px] text-zinc-700 mt-2">No clip selected</p>
        ) : (
          <div className="flex flex-col gap-3">
            {[
              ["Name", mediaFile.name],
              ["Size", formatSize(mediaFile.size)],
              ["Duration", duration > 0 ? `${duration.toFixed(2)}s` : "—"],
              ["Type", mediaFile.type || "video"],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</p>
                <p className="text-[11px] text-zinc-300 truncate" title={value}>{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Transport Controls
// ---------------------------------------------------------------------------

interface TransportProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onVolumeChange: (v: number) => void;
}

function TransportBar({
  isPlaying, currentTime, duration, volume,
  onTogglePlay, onSkipBack, onSkipForward, onStepBack, onStepForward, onVolumeChange,
}: TransportProps) {
  return (
    <div
      className="flex items-center gap-4 px-4 shrink-0 border-t border-b"
      style={{ height: 44, background: "#161616", borderColor: "#2a2a2a" }}
    >
      {/* Step / skip controls */}
      <div className="flex items-center gap-0.5">
        <button onClick={onSkipBack} className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded" title="Go to start">
          <SkipBack size={13} />
        </button>
        <button onClick={onStepBack} className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded" title="Step back">
          <ChevronLeft size={13} />
        </button>
        <button
          onClick={onTogglePlay}
          className="mx-1 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-500 active:bg-violet-700 transition-colors text-white"
          style={{ width: 28, height: 28 }}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" />}
        </button>
        <button onClick={onStepForward} className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded" title="Step forward">
          <ChevronRight size={13} />
        </button>
        <button onClick={onSkipForward} className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded" title="Go to end">
          <SkipForward size={13} />
        </button>
      </div>

      {/* Timecode */}
      <div
        className="flex items-center gap-1 px-2 py-1 rounded font-mono"
        style={{ background: "#0d0d0d", border: "1px solid #2a2a2a" }}
      >
        <span className="text-[12px] text-violet-300 tracking-widest">{toTC(currentTime)}</span>
        <span className="text-[10px] text-zinc-700 mx-1">/</span>
        <span className="text-[11px] text-zinc-600 tracking-widest">{toTC(duration)}</span>
      </div>

      <div className="flex-1" />

      {/* Volume */}
      <div className="flex items-center gap-2">
        <Volume2 size={12} className="text-zinc-600" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-20 h-1 accent-violet-500 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function Timeline({ mediaFile, currentTime, duration }: { mediaFile: File | null; currentTime: number; duration: number }) {
  const HEADER_W = 72;
  const tracks = ["V2", "V1", "A1", "A2"];
  const tickCount = Math.max(20, Math.ceil(duration) + 4);
  const ticks = Array.from({ length: tickCount }, (_, i) => i);

  return (
    <div
      className="flex flex-col shrink-0 border-t overflow-hidden"
      style={{ height: 200, background: "#141414", borderColor: "#2a2a2a" }}
    >
      {/* Timeline header row */}
      <div
        className="flex items-center border-b shrink-0"
        style={{ height: 24, borderColor: "#2a2a2a" }}
      >
        <div
          className="flex items-center px-3 shrink-0 border-r"
          style={{ width: HEADER_W, borderColor: "#2a2a2a" }}
        >
          <span className="text-[9px] font-semibold tracking-widest text-zinc-600 uppercase">Tracks</span>
        </div>
        {/* Ruler */}
        <div className="flex-1 overflow-hidden relative" style={{ height: 24 }}>
          <div className="flex items-end h-full" style={{ minWidth: "100%" }}>
            {ticks.map((i) => (
              <div
                key={i}
                className="flex flex-col items-start justify-end shrink-0"
                style={{ width: 60, height: "100%", borderLeft: "1px solid #2a2a2a" }}
              >
                <span className="text-[9px] text-zinc-700 pl-1 pb-1 font-mono">
                  {`${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`}
                </span>
              </div>
            ))}
          </div>
          {/* Playhead */}
          {duration > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-violet-400 pointer-events-none"
              style={{ left: `${(currentTime / duration) * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* Track lanes */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {tracks.map((track) => (
          <div
            key={track}
            className="flex border-b"
            style={{ height: 40, borderColor: "#1f1f1f" }}
          >
            {/* Track header */}
            <div
              className="flex items-center px-3 shrink-0 border-r"
              style={{ width: HEADER_W, background: "#1a1a1a", borderColor: "#2a2a2a" }}
            >
              <span className="text-[10px] font-mono text-zinc-600">{track}</span>
            </div>
            {/* Track lane */}
            <div className="flex-1 relative overflow-hidden" style={{ background: "#141414" }}>
              {/* Grid lines */}
              <div className="absolute inset-0 flex pointer-events-none">
                {ticks.map((i) => (
                  <div key={i} className="shrink-0" style={{ width: 60, borderLeft: "1px solid #1e1e1e" }} />
                ))}
              </div>

              {/* Clip block on V1 */}
              {mediaFile && track === "V1" && duration > 0 && (
                <div
                  className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden"
                  style={{
                    left: 2,
                    width: `calc(${(duration / tickCount) * 100}% - 4px)`,
                    background: "rgba(109,40,217,0.35)",
                    border: "1px solid rgba(139,92,246,0.5)",
                  }}
                >
                  <span className="text-[10px] text-violet-300 truncate font-medium">
                    {mediaFile.name}
                  </span>
                </div>
              )}

              {/* Audio clip on A1 */}
              {mediaFile && track === "A1" && duration > 0 && (
                <div
                  className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden"
                  style={{
                    left: 2,
                    width: `calc(${(duration / tickCount) * 100}% - 4px)`,
                    background: "rgba(30,80,60,0.5)",
                    border: "1px solid rgba(52,211,153,0.25)",
                  }}
                >
                  <span className="text-[10px] text-emerald-500/70 truncate">audio</span>
                </div>
              )}

              {/* Playhead line */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-violet-400/60 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop Overlay
// ---------------------------------------------------------------------------

function DropOverlay({ isDragActive }: { isDragActive: boolean }) {
  if (!isDragActive) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}>
      <div
        className="flex flex-col items-center justify-center gap-4 rounded-2xl"
        style={{ width: 360, height: 220, border: "2px dashed #7c3aed" }}
      >
        <Upload size={32} className="text-violet-400" />
        <p className="text-white text-base font-medium tracking-wide">Drop your video file</p>
        <p className="text-zinc-500 text-xs">MP4 · MOV · MXF · AVI · MKV</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root Editor
// ---------------------------------------------------------------------------

export default function MainEditor() {
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const setMediaFile = useEditorStore((s) => s.setMediaFile);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  // Create / revoke object URL whenever mediaFile changes
  useEffect(() => {
    if (!mediaFile) { setVideoUrl(null); setDuration(0); setCurrentTime(0); return; }
    const url = URL.createObjectURL(mediaFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  // Sync volume to video element
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  // Global drag-and-drop
  const onDrop = useCallback((accepted: File[], _: FileRejection[]) => {
    if (accepted[0]) setMediaFile(accepted[0]);
  }, [setMediaFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".mxf", ".avi", ".mkv"] },
    noClick: true,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className="h-screen w-screen overflow-hidden text-white flex flex-col outline-none"
      style={{ background: "#111111", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      <input {...getInputProps()} />
      <DropOverlay isDragActive={isDragActive} />

      <TopBar />

      {/* Main content: Media Bin | Monitor | Inspector */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <MediaBin onFileSelect={setMediaFile} />
        <Monitor
          videoRef={videoRef}
          videoUrl={videoUrl}
          currentTime={currentTime}
          duration={duration}
          onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onEnded={() => setIsPlaying(false)}
        />
        <Inspector mediaFile={mediaFile} duration={duration} />
      </div>

      <TransportBar
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        onTogglePlay={togglePlay}
        onSkipBack={() => { if (videoRef.current) { videoRef.current.currentTime = 0; setCurrentTime(0); } }}
        onSkipForward={() => { if (videoRef.current && duration) { videoRef.current.currentTime = duration; setCurrentTime(duration); } }}
        onStepBack={() => { if (videoRef.current) { videoRef.current.currentTime = Math.max(0, currentTime - 1 / 24); } }}
        onStepForward={() => { if (videoRef.current) { videoRef.current.currentTime = Math.min(duration, currentTime + 1 / 24); } }}
        onVolumeChange={setVolume}
      />

      <Timeline mediaFile={mediaFile} currentTime={currentTime} duration={duration} />
    </div>
  );
}
