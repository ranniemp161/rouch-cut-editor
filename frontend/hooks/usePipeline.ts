import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  analyzeMedia, bootstrapUser, createProject, deleteMedia,
  downloadBlob, downloadFile, generateExport, renderRoughCut, uploadMedia,
  type ExportFormat,
} from "@/lib/api";
import { useEditorStore } from "@/store/useEditorStore";

const FORMAT_LABEL: Record<ExportFormat, string> = {
  "CMX3600-EDL": "CMX 3600 EDL",
  "FCP7-XML": "FCP7 XML",
  "FFMPEG-SCRIPT": "FFmpeg script",
  MP4: "FFmpeg render script",
};

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
  const [isRendering, setIsRendering] = useState(false);

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
        initialDeletedIds: result.initial_deleted_ids,
      });
      // Belt-and-suspenders: explicitly hydrate the deletion set so the
      // backend-flagged silences + Gemini repetitions appear cut on first paint.
      useEditorStore.setState({
        deletedWordIds: new Set(result.initial_deleted_ids ?? []),
      });

      const cutCount = (result.initial_deleted_ids ?? []).length;
      toast.success("Rough cut ready", {
        description: cutCount > 0
          ? `${cutCount} word${cutCount === 1 ? "" : "s"} flagged — silences, fillers, and repetitions.`
          : "Transcript analyzed. No automatic cuts suggested.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pipeline failed";
      store.setPipelineStage("error", msg);
      toast.error("Upload failed", { description: msg });
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
          initialDeletedIds: result.initial_deleted_ids,
        });
        useEditorStore.setState({
          deletedWordIds: new Set(result.initial_deleted_ids ?? []),
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
      const { mediaId, silenceThreshold } = useEditorStore.getState();
      if (!mediaId || isExporting) return;
      setIsExporting(true);
      const toastId = toast.loading(`Generating ${FORMAT_LABEL[format]}…`, {
        description: "Building edit list from your cuts.",
      });
      try {
        const deletedWordIds = Array.from(store.deletedWordIds);
        const content = await generateExport(mediaId, silenceThreshold, 5, deletedWordIds, format);
        let ext = "txt";
        let mime = "text/plain";
        if (format === "FCP7-XML") { ext = "xml"; mime = "application/xml"; }
        if (format === "CMX3600-EDL") { ext = "edl"; }
        if (format === "FFMPEG-SCRIPT") { ext = "sh"; }
        if (format === "MP4") { ext = "sh"; } // FFMPEG-SCRIPT and MP4 return bash script for safety
        const filename = `export.${ext}`;
        downloadFile(content, filename, mime);
        toast.success("Export complete", {
          id: toastId,
          description: `${filename} downloaded — ready to import.`,
        });
      } catch (err) {
        console.error("Export failed:", err);
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        toast.error("Export failed", { id: toastId, description: msg });
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, store]
  );

  // ── Delete current media (DB + local state) ───────────────────────────────

  const deleteCurrent = useCallback(async () => {
    const { mediaId } = useEditorStore.getState();
    const ok = window.confirm(
      "Remove this clip?\n\nThe transcript and the underlying video file on the server will both be deleted."
    );
    if (!ok) return;
    onBeforeDelete?.();
    if (mediaId) {
      try {
        await deleteMedia(mediaId);
        toast.success("Clip removed", {
          description: "Video and transcript deleted from the server.",
        });
      } catch (err) {
        console.error("Delete failed:", err);
        const msg = err instanceof Error ? err.message : "Could not reach the server.";
        toast.error("Delete failed", { description: msg });
      }
    }
    store.clearMedia();
  }, [store, onBeforeDelete]);

  const deleteAll = useCallback(async () => {
    const ok = window.confirm(
      "Are you sure you want to delete ALL projects and their media? This cannot be undone."
    );
    if (!ok) return;
    const toastId = toast.loading("Wiping all projects…");
    try {
      const { deleteAllProjects } = await import("@/lib/api");
      await deleteAllProjects();
      store.resetProjectScope();
      toast.success("All projects deleted", {
        id: toastId,
        description: "Workspace is empty — drop a video to start over.",
      });
    } catch (err) {
      console.error("Delete all failed:", err);
      const msg = err instanceof Error ? err.message : "Server rejected the request.";
      toast.error("Couldn't delete projects", { id: toastId, description: msg });
    }
  }, [store]);

  // ── Render rough-cut MP4 on the server ───────────────────────────────────

  const renderMp4 = useCallback(async () => {
    const { mediaId, silenceThreshold } = useEditorStore.getState();
    if (!mediaId || isRendering) return;
    setIsRendering(true);
    const toastId = toast.loading("Rendering MP4…", {
      description: "Stitching kept ranges with FFmpeg. This may take a minute.",
    });
    try {
      const deletedWordIds = Array.from(store.deletedWordIds);
      const blob = await renderRoughCut(mediaId, silenceThreshold, 5, deletedWordIds);
      downloadBlob(blob, "roughcut.mp4");
      const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
      toast.success("Rough cut rendered", {
        id: toastId,
        description: `roughcut.mp4 (${sizeMb} MB) downloaded.`,
      });
    } catch (err) {
      console.error("Render failed:", err);
      const msg = err instanceof Error ? err.message : "FFmpeg returned an error.";
      toast.error("Render failed", { id: toastId, description: msg });
    } finally {
      setIsRendering(false);
    }
  }, [isRendering, store]);

  return { runPipeline, reanalyze, exportFile, renderMp4, deleteCurrent, deleteAll, isExporting, isRendering };
}
