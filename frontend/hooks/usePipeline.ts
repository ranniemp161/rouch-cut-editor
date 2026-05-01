import { useCallback, useState } from "react";
import {
  analyzeMedia, bootstrapUser, createProject, deleteMedia,
  downloadFile, generateExport, uploadMedia,
  type ExportFormat,
} from "@/lib/api";
import { useEditorStore } from "@/store/useEditorStore";

/**
 * High-level pipeline actions: upload+analyse, re-analyse on threshold change,
 * export to NLE format, and delete the asset from the database.
 *
 * State (progress, stage, segments) is owned by the Zustand store; this hook
 * only orchestrates the network calls and routes results into the store.
 */
export function usePipeline(onBeforeDelete?: () => void) {
  const store = useEditorStore();
  const [isExporting, setIsExporting] = useState(false);

  // ── Upload + analyse ──────────────────────────────────────────────────────

  const runPipeline = useCallback(async () => {
    const { mediaFile, secretKey, userId, projectId, silenceThreshold } =
      useEditorStore.getState();
    if (!mediaFile) return;

    try {
      store.setPipelineStage("uploading");
      store.setUploadProgress(0);

      let uid = userId;
      if (!uid) {
        uid = await bootstrapUser(secretKey ?? "roughcut2025");
        store.setBackendIds({ userId: uid });
      }

      let pid = projectId;
      if (!pid) {
        pid = await createProject(uid, "Rough Cut Session");
        store.setBackendIds({ projectId: pid });
      }

      const { mediaId, transcriptId } = await uploadMedia(
        mediaFile,
        pid,
        (pct) => {
          store.setUploadProgress(pct);
          // Once bytes reach 100%, the server starts Whisper —
          // flip to "transcribing" so the UI reflects the long wait ahead.
          if (pct >= 100) store.setPipelineStage("transcribing");
        }
      );
      store.setBackendIds({ mediaId, transcriptId });

      store.setPipelineStage("transcribing");
      const result = await analyzeMedia(mediaId, silenceThreshold);

      store.setAnalysis(result.words, result.segments, {
        frameRate: result.frame_rate,
        totalFrames: result.total_frames,
        durationSeconds: result.duration_seconds,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pipeline failed";
      store.setPipelineStage("error", msg);
    }
  }, [store]);

  // ── Re-analyse without re-uploading ───────────────────────────────────────

  const reanalyze = useCallback(
    async (threshold: number) => {
      const { mediaId, pipelineStage } = useEditorStore.getState();
      if (!mediaId || pipelineStage !== "ready") return;
      store.setSilenceThreshold(threshold);
      try {
        const result = await analyzeMedia(mediaId, threshold);
        store.setAnalysis(result.words, result.segments, {
          frameRate: result.frame_rate,
          totalFrames: result.total_frames,
          durationSeconds: result.duration_seconds,
        });
      } catch {
        /* keep existing segments on transient failure */
      }
    },
    [store]
  );

  // ── Export to NLE format ──────────────────────────────────────────────────

  const exportFile = useCallback(
    async (format: ExportFormat) => {
      const { mediaId, mediaFile, silenceThreshold } = useEditorStore.getState();
      if (!mediaId || isExporting) return;
      setIsExporting(true);
      try {
        const content = await generateExport(mediaId, silenceThreshold, 5, format);
        const stem = mediaFile?.name.replace(/\.[^.]+$/, "") ?? "export";
        const ext = format === "CMX3600-EDL" ? "edl" : "xml";
        const mime = format === "CMX3600-EDL" ? "text/plain" : "application/xml";
        downloadFile(content, `${stem}.${ext}`, mime);
      } catch (err) {
        console.error("Export failed:", err);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting]
  );

  // ── Delete current media (DB + local state) ───────────────────────────────

  const deleteCurrent = useCallback(async () => {
    const { mediaId } = useEditorStore.getState();
    const ok = window.confirm(
      "Remove this clip?\n\nThe transcript will be deleted from the database. The video file itself was never stored on disk."
    );
    if (!ok) return;
    onBeforeDelete?.();
    if (mediaId) {
      try {
        await deleteMedia(mediaId);
      } catch (err) {
        console.error("Delete failed:", err);
      }
    }
    store.clearMedia();
  }, [store, onBeforeDelete]);

  return { runPipeline, reanalyze, exportFile, deleteCurrent, isExporting };
}
