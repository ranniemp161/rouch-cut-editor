"use client";

import { useState } from "react";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import type { ExportFormat } from "@/lib/api";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "CMX3600-EDL", label: "CMX 3600 EDL" },
  { value: "FCP7-XML", label: "FCP7 XML" },
];

interface Props {
  onExport: (format: ExportFormat) => void;
  disabled: boolean;
  isExporting: boolean;
}

export function ExportMenu({ onExport, disabled, isExporting }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || isExporting}
        className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
      >
        {isExporting ? <Loader2 size={10} className="animate-spin" /> : <Download size={11} />}
        Export
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden shadow-xl z-50"
            style={{ background: "#1e1e1e", border: "1px solid #333", width: 160 }}
          >
            {FORMATS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => {
                  setOpen(false);
                  onExport(value);
                }}
                className="w-full text-left px-4 py-2.5 text-[11px] text-zinc-300 hover:bg-violet-600/20 hover:text-white transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
