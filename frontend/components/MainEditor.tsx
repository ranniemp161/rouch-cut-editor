"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useEditorStore } from "@/store/useEditorStore";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import { usePipeline } from "@/hooks/usePipeline";

import { TopBar } from "./editor/TopBar";
import { MediaBin } from "./editor/MediaBin";
import { Monitor } from "./editor/Monitor";
import { Inspector } from "./editor/Inspector";
import { TranscriptSidebar } from "./editor/TranscriptSidebar";
import { TransportBar } from "./editor/TransportBar";
import { Timeline } from "./editor/Timeline";
import { DropOverlay } from "./editor/DropOverlay";
import { PipelineOverlay } from "./editor/PipelineOverlay";

export default function MainEditor() {
  const selectFile = useEditorStore((s) => s.selectFile);
  const toggleSegment = useEditorStore((s) => s.toggleSegment);
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const pipelineStage = useEditorStore((s) => s.pipelineStage);
  const uploadProgress = useEditorStore((s) => s.uploadProgress);
  const segments = useEditorStore((s) => s.segments);
  const analysisWords = useEditorStore((s) => s.analysisWords);
  const silenceThreshold = useEditorStore((s) => s.silenceThreshold);
  const frameRate = useEditorStore((s) => s.frameRate);
  const durationSeconds = useEditorStore((s) => s.durationSeconds);

  const player = useVideoPlayer(mediaFile, segments);
  const pipeline = usePipeline(player.pause);

  // Dropzone — file becomes "selected" but pipeline only runs when user clicks Cut.
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) selectFile(accepted[0]);
    },
    [selectFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".mxf", ".avi", ".mkv"] },
    noClick: true,
    multiple: false,
  });

  const fps = frameRate || 23.976;
  const activeDuration = player.duration || durationSeconds;
  const isCutting = pipelineStage === "uploading" || pipelineStage === "transcribing";
  const canCut = !!mediaFile && (pipelineStage === "file_selected" || pipelineStage === "error");
  const showTranscript = pipelineStage === "ready" && segments.length > 0;

  return (
    <div
      {...getRootProps()}
      className="h-screen w-screen overflow-hidden text-white flex flex-col outline-none"
      style={{ background: "#111111", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      <input {...getInputProps()} />

      <DropOverlay isDragActive={isDragActive} />
      {isCutting && (
        <PipelineOverlay
          stage={pipelineStage as "uploading" | "transcribing"}
          progress={uploadProgress}
          durationSeconds={Math.round(player.duration || durationSeconds || 0)}
        />
      )}

      <TopBar onExport={pipeline.exportFile} isExporting={pipeline.isExporting} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <MediaBin onFileSelect={selectFile} onDelete={pipeline.deleteCurrent} />

        <Monitor
          videoRef={player.videoRef}
          videoUrl={player.videoUrl}
          currentTime={player.currentTime}
          duration={activeDuration}
          fps={fps}
          onLoadedMetadata={player.handleLoadedMetadata}
          onTimeUpdate={player.handleTimeUpdate}
          onEnded={player.handleEnded}
          onSeek={player.seekTo}
        />

        {showTranscript ? (
          <TranscriptSidebar
            segments={segments}
            words={analysisWords}
            silenceThreshold={silenceThreshold}
            currentTime={player.currentTime}
            onToggle={toggleSegment}
            onThresholdChange={pipeline.reanalyze}
            onSeek={player.seekTo}
          />
        ) : (
          <Inspector mediaFile={mediaFile} duration={activeDuration} />
        )}
      </div>

      <TransportBar
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={activeDuration}
        volume={player.volume}
        fps={fps}
        onTogglePlay={player.togglePlay}
        onSkipBack={player.skipBack}
        onSkipForward={player.skipForward}
        onStepBack={() => player.stepBack(fps)}
        onStepForward={() => player.stepForward(fps)}
        onVolumeChange={player.setVolume}
        canCut={canCut}
        isCutting={isCutting}
        onCut={pipeline.runPipeline}
      />

      <Timeline
        mediaFile={mediaFile}
        currentTime={player.currentTime}
        duration={activeDuration}
        segments={segments}
      />
    </div>
  );
}
