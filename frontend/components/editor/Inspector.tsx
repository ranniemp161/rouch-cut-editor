"use client";

import { useEditorStore } from "@/store/useEditorStore";
import { formatSize } from "@/lib/timecode";

interface Props {
  mediaFile: File | null;
  duration: number;
}

export function Inspector({ mediaFile, duration }: Props) {
  const mediaId = useEditorStore((s) => s.mediaId);
  const transcriptId = useEditorStore((s) => s.transcriptId);
  const projectId = useEditorStore((s) => s.projectId);
  const segments = useEditorStore((s) => s.segments);

  const cutCount = segments.filter((s) => s.isCut).length;
  const savedSec = segments.filter((s) => s.isCut).reduce((a, s) => a + s.endS - s.startS, 0);

  return (
    <aside
      className="flex flex-col h-full border-l shrink-0"
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
          <Fields
            rows={[
              ["Name", mediaFile.name],
              ["Size", formatSize(mediaFile.size)],
              ["Duration", duration > 0 ? `${duration.toFixed(2)}s` : "—"],
              ["Type", mediaFile.type || "video"],
              ["Project ID", projectId ? projectId.slice(0, 12) + "…" : "—"],
              ["Media ID", mediaId ? mediaId.slice(0, 12) + "…" : "—"],
              ["Transcript", transcriptId ? transcriptId.slice(0, 12) + "…" : "—"],
              ["Cuts", cutCount > 0 ? `${cutCount} (${savedSec.toFixed(1)}s)` : "—"],
            ]}
          />
        )}
      </div>
    </aside>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-0.5">{label}</p>
          <p className="text-[11px] text-zinc-300 truncate font-mono" title={value}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
