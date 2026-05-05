"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useEditorStore } from "@/store/useEditorStore";
import { saveEdits } from "@/lib/editsStorage";
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
  const mediaFile = useEditorStore((s) => s.mediaFile);
  const pipelineStage = useEditorStore((s) => s.pipelineStage);
  const uploadProgress = useEditorStore((s) => s.uploadProgress);
  const segments = useEditorStore((s) => s.segments);
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
    noKeyboard: true,
    multiple: false,
  });

  // Global Spacebar → play/pause. Ignored when typing into a field. Without
  // this, the focused dropzone input would consume Space and pop the OS
  // file picker (browser-native behavior on focused <input type="file">).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      player.togglePlay();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [player]);

  // Autosave the user's edits (deletions + AI segment cut-state + splits) to
  // localStorage on every change, debounced via rAF so a long drag doesn't
  // flood storage. Keyed by transcriptId so projects don't bleed into each
  // other. The store re-hydrates from this on next setAnalysis.
  useEffect(() => {
    let raf = 0;
    let lastDel: Set<string> | null = null;
    let lastSegs: unknown = null;
    let lastSplits: unknown = null;

    const unsubscribe = useEditorStore.subscribe((state) => {
      const tid = state.transcriptId;
      if (!tid) return;
      // Skip when nothing user-editable changed (cheap reference checks —
      // the store always replaces these by reference on edit).
      if (
        state.deletedWordIds === lastDel &&
        state.segments === lastSegs &&
        state.splitMarkers === lastSplits
      ) return;
      lastDel = state.deletedWordIds;
      lastSegs = state.segments;
      lastSplits = state.splitMarkers;

      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        saveEdits(tid, {
          deletedWordIds: state.deletedWordIds,
          segments: state.segments,
          splitMarkers: state.splitMarkers,
        });
      });
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, []);

  const TIMELINE_MIN = 160;
  const TIMELINE_MAX = 600;
  const [timelineHeight, setTimelineHeight] = useState(280);
  const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStateRef.current = { startY: e.clientY, startH: timelineHeight };
    const onMove = (ev: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const next = Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, s.startH - (ev.clientY - s.startY)));
      setTimelineHeight(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [timelineHeight]);

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

      <TopBar
        onExport={pipeline.exportFile}
        isExporting={pipeline.isExporting}
        onDeleteAll={pipeline.deleteAll}
        onRenderMp4={pipeline.renderMp4}
        isRendering={pipeline.isRendering}
      />

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
          <TranscriptSidebar />
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

      <div
        onPointerDown={handleResizeDown}
        className="h-1.5 mx-6 cursor-row-resize group flex items-center justify-center bg-[#111111]"
        title="Drag to resize timeline"
      >
        <div className="h-px w-full bg-zinc-800 group-hover:bg-purple-500/60 transition-colors" />
      </div>
      <div className="px-6 pb-3 bg-[#111111]" style={{ height: timelineHeight }}>
        <Timeline />
      </div>
    </div>
  );
}
