"use client";

import { useRef } from "react";
import {
  AlertCircle, AlignJustify, CheckCircle2, Film, FolderOpen,
  Info, Loader2, Settings, Trash2, Upload,
} from "lucide-react";
import { useEditorStore } from "@/store/useEditorStore";
import { formatSize } from "@/lib/timecode";

interface Props {
  onFileSelect: (file: File) => void;
  onDelete: () => void;
}

const TABS = [
  { icon: Film, label: "Media", active: true },
  { icon: AlignJustify, label: "Timeline", active: false },
  { icon: Info, label: "Inspector", active: false },
  { icon: Settings, label: "Settings", active: false },
];

export function MediaBin({ onFileSelect, onDelete }: Props) {
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const pipelineStage = useEditorStore((s) => s.pipelineStage);
  const uploadProgress = useEditorStore((s) => s.uploadProgress);
  const pipelineError = useEditorStore((s) => s.pipelineError);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
    e.target.value = "";
  };

  const isProcessing = pipelineStage === "uploading" || pipelineStage === "transcribing";

  return (
    <aside
      className="flex flex-col h-full border-r shrink-0"
      style={{ width: 220, background: "#1a1a1a", borderColor: "#2a2a2a" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
          Media
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isProcessing}
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

      {/* Body */}
      <div className="flex-1 p-2 overflow-y-auto">
        {!mediaFile ? (
          <EmptyState onClick={() => inputRef.current?.click()} />
        ) : (
          <ClipCard
            file={mediaFile}
            stage={pipelineStage}
            progress={uploadProgress}
            error={pipelineError}
            isProcessing={isProcessing}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex items-center justify-around px-2 py-2 border-t shrink-0"
        style={{ borderColor: "#2a2a2a" }}
      >
        {TABS.map(({ icon: Icon, label, active }) => (
          <button
            key={label}
            title={label}
            className={[
              "p-1.5 rounded transition-colors",
              active ? "text-violet-400" : "text-zinc-600 hover:text-zinc-400",
            ].join(" ")}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept private to this file
// ---------------------------------------------------------------------------

function EmptyState({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 h-full text-center cursor-pointer rounded-lg border border-dashed transition-colors hover:border-violet-500/40"
      style={{ borderColor: "#333" }}
      onClick={onClick}
    >
      <FolderOpen size={22} className="text-zinc-700" />
      <p className="text-[11px] text-zinc-600">Click Import or drop a file</p>
    </div>
  );
}

interface ClipCardProps {
  file: File;
  stage: string;
  progress: number;
  error: string | null;
  isProcessing: boolean;
  onDelete: () => void;
}

function ClipCard({ file, stage, progress, error, isProcessing, onDelete }: ClipCardProps) {
  return (
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
          <p className="text-[11px] text-zinc-200 truncate leading-tight" title={file.name}>
            {file.name}
          </p>
          <p className="text-[10px] text-zinc-600 mt-0.5">{formatSize(file.size)}</p>
        </div>
        <button
          onClick={onDelete}
          disabled={isProcessing}
          title="Remove this clip and delete its transcript from the database"
          className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <StatusBadge stage={stage} progress={progress} error={error} />
    </div>
  );
}

function StatusBadge({ stage, progress, error }: { stage: string; progress: number; error: string | null }) {
  if (stage === "uploading") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[10px] text-violet-400">
          <Loader2 size={10} className="animate-spin" />
          <span>Uploading {progress}%</span>
        </div>
        <div className="w-full h-0.5 rounded-full overflow-hidden" style={{ background: "#333" }}>
          <div
            className="h-full bg-violet-500 transition-all duration-200 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }
  if (stage === "transcribing") {
    return (
      <div className="flex items-center gap-1 text-[10px] text-yellow-400">
        <Loader2 size={10} className="animate-spin" />
        <span>Transcribing…</span>
      </div>
    );
  }
  if (stage === "ready") {
    return (
      <div className="flex items-center gap-1 text-[10px] text-emerald-400">
        <CheckCircle2 size={10} />
        <span>Ready</span>
      </div>
    );
  }
  if (stage === "error") {
    return (
      <div className="flex items-center gap-1 text-[10px] text-red-400">
        <AlertCircle size={10} />
        <span className="truncate">{error ?? "Error"}</span>
      </div>
    );
  }
  if (stage === "file_selected") {
    return (
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        <span>Ready to cut</span>
      </div>
    );
  }
  return null;
}
