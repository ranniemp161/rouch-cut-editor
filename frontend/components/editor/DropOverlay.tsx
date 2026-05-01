"use client";

import { Upload } from "lucide-react";

export function DropOverlay({ isDragActive }: { isDragActive: boolean }) {
  if (!isDragActive) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
    >
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
