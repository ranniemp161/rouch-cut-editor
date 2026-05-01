"use client";

import { LogOut, Scissors } from "lucide-react";
import type { ExportFormat } from "@/lib/api";
import { useEditorStore } from "@/store/useEditorStore";
import { ExportMenu } from "./ExportMenu";

interface Props {
  onExport: (format: ExportFormat) => void;
  isExporting: boolean;
}

export function TopBar({ onExport, isExporting }: Props) {
  const logout = useEditorStore((s) => s.logout);
  const mediaId = useEditorStore((s) => s.mediaId);
  const pipelineStage = useEditorStore((s) => s.pipelineStage);

  const canExport = !!mediaId && pipelineStage === "ready";

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

      <ExportMenu onExport={onExport} disabled={!canExport} isExporting={isExporting} />

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
