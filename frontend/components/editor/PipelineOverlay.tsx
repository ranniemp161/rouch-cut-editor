"use client";

import { Loader2 } from "lucide-react";

interface Props {
  stage: "uploading" | "transcribing";
  progress: number;
  durationSeconds: number;
}

export function PipelineOverlay({ stage, progress, durationSeconds }: Props) {
  // Whisper "base" int8 on CPU runs roughly at realtime — give the user an estimate.
  const etaMin = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex flex-col items-center gap-6 rounded-2xl px-10 py-10"
        style={{ width: 460, background: "#161616", border: "1px solid #2a2a2a" }}
      >
        <Loader2 size={42} className="text-violet-400 animate-spin" />

        {stage === "uploading" ? (
          <UploadingBody progress={progress} />
        ) : (
          <TranscribingBody etaMin={etaMin} />
        )}

        <p className="text-[10px] text-zinc-700 text-center max-w-[340px]">
          Your video is processed in memory and deleted after transcription. Only the transcript is saved.
        </p>
      </div>
    </div>
  );
}

function UploadingBody({ progress }: { progress: number }) {
  return (
    <>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-white">Uploading your video</p>
        <p className="text-[11px] text-zinc-500 mt-1.5">Sending to the server · {progress}%</p>
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "#222" }}>
        <div
          className="h-full bg-violet-500 transition-all duration-200 rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}

function TranscribingBody({ etaMin }: { etaMin: number | null }) {
  return (
    <>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-white">Transcribing with Whisper AI</p>
        <p className="text-[11px] text-zinc-500 mt-1.5">
          Detecting every word, silence, and repetition
        </p>
        {etaMin !== null && (
          <p className="text-[10px] text-zinc-600 mt-2">
            ≈ {etaMin} minute{etaMin !== 1 ? "s" : ""} for this video — please wait
          </p>
        )}
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "#222" }}>
        <div className="h-full bg-violet-500 rounded-full animate-pulse" style={{ width: "100%" }} />
      </div>
    </>
  );
}
