"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  Scissors, FolderOpen, Settings, Upload, Play, Pause,
  SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Volume2, LogOut, Film, Info, AlignJustify, Download,
  Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useEditorStore, type UploadStatus } from "@/store/useEditorStore";
import {
  bootstrapUser, createProject, uploadMedia, generateExport, downloadFile,
} from "@/lib/api";

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

const formatSize = (bytes: number) =>
  bytes < 1_000_000 ? `${(bytes / 1000).toFixed(0)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// Upload status badge
// ---------------------------------------------------------------------------

function UploadBadge({ status, progress }: { status: UploadStatus; progress: number }) {
  if (status === "idle") return null;

  const map: Record<UploadStatus, { icon: React.ReactNode; label: string; color: string }> = {
    idle: { icon: null, label: "", color: "" },
    uploading: {
      icon: <Loader2 size={10} className="animate-spin" />,
      label: `Uploading ${progress}%`,
      color: "text-violet-400",
    },
    processing: {
      icon: <Loader2 size={10} className="animate-spin" />,
      label: "Processing…",
      color: "text-yellow-400",
    },
    done: {
      icon: <CheckCircle2 size={10} />,
      label: "Ready",
      color: "text-emerald-400",
    },
    error: {
      icon: <AlertCircle size={10} />,
      label: "Failed",
      color: "text-red-400",
    },
  };

  const { icon, label, color } = map[status];
  return (
    <div className={`flex items-center gap-1 text-[10px] font-medium ${color}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function TopBar({ onExport, canExport }: { onExport: () => void; canExport: boolean }) {
  const logout = useEditorStore((s) => s.logout);
  const mediaId = useEditorStore((s) => s.mediaId);

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

      {mediaId && (
        <span className="text-[10px] text-zinc-600 font-mono ml-2">
          media:{mediaId.slice(0, 8)}…
        </span>
      )}

      <div className="flex-1" />

      <button
        onClick={onExport}
        disabled={!canExport}
        className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
      >
        <Download size={11} />
        Export FCP7-XML
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
// Media Bin
// ---------------------------------------------------------------------------

interface MediaBinProps {
  onFileSelect: (file: File) => void;
}

function MediaBin({ onFileSelect }: MediaBinProps) {
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const uploadStatus = useEditorStore((s) => s.uploadStatus);
  const uploadProgress = useEditorStore((s) => s.uploadProgress);
  const uploadError = useEditorStore((s) => s.uploadError);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
    e.target.value = "";
  };

  return (
    <aside
      className="flex flex-col h-full border-r shrink-0"
      style={{ width: 220, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Media
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploadStatus === "uploading" || uploadStatus === "processing"}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-violet-300 hover:text-white hover:bg-violet-600/30 transition-colors border border-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
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

      <div className="flex-1 p-2 overflow-y-auto">
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
            className="flex flex-col gap-2 p-2 rounded-md border"
            style={{ background: "#222", borderColor: "#333" }}
          >
            <div className="flex items-start gap-2">
              <div
                className="flex items-center justify-center rounded shrink-0"
                style={{ width: 36, height: 28, background: "#2d2d2d" }}
              >
                <Film size={14} className="text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-200 truncate leading-tight" title={mediaFile.name}>
                  {mediaFile.name}
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{formatSize(mediaFile.size)}</p>
              </div>
            </div>

            <UploadBadge status={uploadStatus} progress={uploadProgress} />

            {uploadStatus === "uploading" && (
              <div className="w-full h-0.5 rounded-full overflow-hidden" style={{ background: "#333" }}>
                <div
                  className="h-full bg-violet-500 transition-all duration-200 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}

            {uploadStatus === "error" && uploadError && (
              <p className="text-[10px] text-red-400 leading-tight">{uploadError}</p>
            )}
          </div>
        )}
      </div>

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
// Monitor
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
      <div
        className="flex items-center justify-between px-4 shrink-0 border-b"
        style={{ height: 28, borderColor: "#2a2a2a", background: "#161616" }}
      >
        <span className="text-[10px] font-mono text-violet-300 tracking-widest">{toTC(currentTime)}</span>
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Program</span>
        <span className="text-[10px] font-mono text-zinc-600 tracking-widest">{toTC(duration)}</span>
      </div>

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

      {videoUrl && duration > 0 && (
        <div className="px-3 py-2 shrink-0" style={{ background: "#161616" }}>
          <input
            type="range" min={0} max={duration} step={0.01} value={currentTime}
            onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }}
            className="w-full h-1 accent-violet-500 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({ mediaFile, duration }: { mediaFile: File | null; duration: number }) {
  const mediaId = useEditorStore((s) => s.mediaId);
  const transcriptId = useEditorStore((s) => s.transcriptId);
  const projectId = useEditorStore((s) => s.projectId);

  return (
    <aside
      className="flex flex-col h-full border-l shrink-0"
      style={{ width: 200, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      <div className="flex items-center px-3 py-2 border-b shrink-0" style={{ borderColor: "#2a2a2a" }}>
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">Inspector</span>
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
              ["Project ID", projectId ? projectId.slice(0, 12) + "…" : "—"],
              ["Media ID", mediaId ? mediaId.slice(0, 12) + "…" : "—"],
              ["Transcript ID", transcriptId ? transcriptId.slice(0, 12) + "…" : "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</p>
                <p className="text-[11px] text-zinc-300 truncate font-mono" title={value}>{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Transport
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

function TransportBar({ isPlaying, currentTime, duration, volume, onTogglePlay, onSkipBack, onSkipForward, onStepBack, onStepForward, onVolumeChange }: TransportProps) {
  return (
    <div
      className="flex items-center gap-4 px-4 shrink-0 border-t border-b"
      style={{ height: 44, background: "#161616", borderColor: "#2a2a2a" }}
    >
      <div className="flex items-center gap-0.5">
        {[
          { action: onSkipBack, Icon: SkipBack, title: "Go to start" },
          { action: onStepBack, Icon: ChevronLeft, title: "Step back 1 frame" },
        ].map(({ action, Icon, title }) => (
          <button key={title} onClick={action} title={title}
            className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded">
            <Icon size={13} />
          </button>
        ))}

        <button
          onClick={onTogglePlay}
          className="mx-1 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-500 active:bg-violet-700 transition-colors text-white"
          style={{ width: 28, height: 28 }}
        >
          {isPlaying ? <Pause size={12} fill="white" /> : <Play size={12} fill="white" />}
        </button>

        {[
          { action: onStepForward, Icon: ChevronRight, title: "Step forward 1 frame" },
          { action: onSkipForward, Icon: SkipForward, title: "Go to end" },
        ].map(({ action, Icon, title }) => (
          <button key={title} onClick={action} title={title}
            className="p-1.5 text-zinc-500 hover:text-white transition-colors rounded">
            <Icon size={13} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 px-2 py-1 rounded font-mono" style={{ background: "#0d0d0d", border: "1px solid #2a2a2a" }}>
        <span className="text-[12px] text-violet-300 tracking-widest">{toTC(currentTime)}</span>
        <span className="text-[10px] text-zinc-700 mx-1">/</span>
        <span className="text-[11px] text-zinc-600 tracking-widest">{toTC(duration)}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Volume2 size={12} className="text-zinc-600" />
        <input type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-20 h-1 accent-violet-500 cursor-pointer" />
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
    <div className="flex flex-col shrink-0 border-t overflow-hidden" style={{ height: 200, background: "#141414", borderColor: "#2a2a2a" }}>
      <div className="flex items-center border-b shrink-0" style={{ height: 24, borderColor: "#2a2a2a" }}>
        <div className="flex items-center px-3 shrink-0 border-r" style={{ width: HEADER_W, borderColor: "#2a2a2a" }}>
          <span className="text-[9px] font-semibold tracking-widest text-zinc-600 uppercase">Tracks</span>
        </div>
        <div className="flex-1 overflow-hidden relative" style={{ height: 24 }}>
          <div className="flex items-end h-full">
            {ticks.map((i) => (
              <div key={i} className="flex flex-col items-start justify-end shrink-0"
                style={{ width: 60, height: "100%", borderLeft: "1px solid #2a2a2a" }}>
                <span className="text-[9px] text-zinc-700 pl-1 pb-1 font-mono">
                  {`${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`}
                </span>
              </div>
            ))}
          </div>
          {duration > 0 && (
            <div className="absolute top-0 bottom-0 w-px bg-violet-400 pointer-events-none"
              style={{ left: `${(currentTime / duration) * 100}%` }} />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {tracks.map((track) => (
          <div key={track} className="flex border-b" style={{ height: 40, borderColor: "#1f1f1f" }}>
            <div className="flex items-center px-3 shrink-0 border-r"
              style={{ width: HEADER_W, background: "#1a1a1a", borderColor: "#2a2a2a" }}>
              <span className="text-[10px] font-mono text-zinc-600">{track}</span>
            </div>
            <div className="flex-1 relative overflow-hidden" style={{ background: "#141414" }}>
              <div className="absolute inset-0 flex pointer-events-none">
                {ticks.map((i) => (
                  <div key={i} className="shrink-0" style={{ width: 60, borderLeft: "1px solid #1e1e1e" }} />
                ))}
              </div>
              {mediaFile && track === "V1" && duration > 0 && (
                <div className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden"
                  style={{ left: 2, width: `calc(${(duration / tickCount) * 100}% - 4px)`, background: "rgba(109,40,217,0.35)", border: "1px solid rgba(139,92,246,0.5)" }}>
                  <span className="text-[10px] text-violet-300 truncate font-medium">{mediaFile.name}</span>
                </div>
              )}
              {mediaFile && track === "A1" && duration > 0 && (
                <div className="absolute top-1 bottom-1 rounded flex items-center px-2 overflow-hidden"
                  style={{ left: 2, width: `calc(${(duration / tickCount) * 100}% - 4px)`, background: "rgba(30,80,60,0.5)", border: "1px solid rgba(52,211,153,0.25)" }}>
                  <span className="text-[10px] text-emerald-500/70 truncate">audio</span>
                </div>
              )}
              {duration > 0 && (
                <div className="absolute top-0 bottom-0 w-px bg-violet-400/60 pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop overlay
// ---------------------------------------------------------------------------

function DropOverlay({ isDragActive }: { isDragActive: boolean }) {
  if (!isDragActive) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl"
        style={{ width: 360, height: 220, border: "2px dashed #7c3aed" }}>
        <Upload size={32} className="text-violet-400" />
        <p className="text-white text-base font-medium tracking-wide">Drop your video file</p>
        <p className="text-zinc-500 text-xs">MP4 · MOV · MXF · AVI · MKV</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root — upload pipeline
// ---------------------------------------------------------------------------

export default function MainEditor() {
  const store = useEditorStore();
  const { mediaFile, secretKey, userId, projectId, uploadStatus } = store;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (!mediaFile) { setVideoUrl(null); setDuration(0); setCurrentTime(0); return; }
    const url = URL.createObjectURL(mediaFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  // ── Full upload pipeline ─────────────────────────────────────────────────

  const runUploadPipeline = useCallback(async (file: File) => {
    store.setMediaFile(file);
    store.setUploadStatus("uploading");
    store.setUploadProgress(0);

    try {
      // 1. Bootstrap user (idempotent — reuses existing row)
      let uid = userId;
      if (!uid) {
        uid = await bootstrapUser(secretKey ?? "roughcut2025");
        store.setBackendIds({ userId: uid });
      }

      // 2. Create project (once per session)
      let pid = projectId;
      if (!pid) {
        pid = await createProject(uid, "Rough Cut Session");
        store.setBackendIds({ projectId: pid });
      }

      // 3. Upload media + mock transcription
      store.setUploadProgress(10);
      const { mediaId, transcriptId } = await uploadMedia(
        file,
        pid,
        (pct) => store.setUploadProgress(10 + Math.round(pct * 0.85))
      );

      store.setBackendIds({ mediaId, transcriptId });
      store.setUploadStatus("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      store.setUploadStatus("error", msg);
    }
  }, [userId, projectId, secretKey, store]);

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    const { mediaId } = useEditorStore.getState();
    if (!mediaId) return;
    try {
      const xml = await generateExport(mediaId, 0.5, 5);
      const stem = mediaFile?.name.replace(/\.[^.]+$/, "") ?? "export";
      downloadFile(xml, `${stem}.xml`, "application/xml");
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [mediaFile]);

  // ── Dropzone ─────────────────────────────────────────────────────────────

  const onDrop = useCallback((accepted: File[], _: FileRejection[]) => {
    if (accepted[0]) runUploadPipeline(accepted[0]);
  }, [runUploadPipeline]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".mxf", ".avi", ".mkv"] },
    noClick: true,
    multiple: false,
  });

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); }
    else { v.pause(); setIsPlaying(false); }
  };

  const canExport = !!store.mediaId && uploadStatus === "done";

  return (
    <div
      {...getRootProps()}
      className="h-screen w-screen overflow-hidden text-white flex flex-col outline-none"
      style={{ background: "#111111", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      <input {...getInputProps()} />
      <DropOverlay isDragActive={isDragActive} />

      <TopBar onExport={handleExport} canExport={canExport} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <MediaBin onFileSelect={(f) => runUploadPipeline(f)} />
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
        onSkipForward={() => { if (videoRef.current) { videoRef.current.currentTime = duration; setCurrentTime(duration); } }}
        onStepBack={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, currentTime - 1 / 24); }}
        onStepForward={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(duration, currentTime + 1 / 24); }}
        onVolumeChange={setVolume}
      />

      <Timeline mediaFile={mediaFile} currentTime={currentTime} duration={duration} />
    </div>
  );
}
