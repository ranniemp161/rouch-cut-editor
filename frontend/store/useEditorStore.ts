import { create } from "zustand";
import type { WordItem, AnalysisSegment } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "idle"
  | "file_selected"
  | "uploading"
  | "transcribing"
  | "ready"
  | "error";

export interface TranscriptSegment {
  startS: number;
  endS: number;
  reason: "silence" | "repetition" | "keep";
  isCut: boolean;
}

interface EditorStore {
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  secretKey: string | null;

  // ── Backend IDs ───────────────────────────────────────────────────────────
  userId: string | null;
  projectId: string | null;
  mediaId: string | null;
  transcriptId: string | null;

  // ── File (local reference — never written to disk) ────────────────────────
  mediaFile: File | null;

  // ── Pipeline ──────────────────────────────────────────────────────────────
  pipelineStage: PipelineStage;
  uploadProgress: number;
  pipelineError: string | null;

  // ── Analysis results ──────────────────────────────────────────────────────
  analysisWords: WordItem[];
  segments: TranscriptSegment[];   // source of truth; user can toggle isCut
  silenceThreshold: number;
  frameRate: number;
  totalFrames: number;
  durationSeconds: number;

  // ── Actions ───────────────────────────────────────────────────────────────
  login: (secret: string) => void;
  logout: () => void;
  selectFile: (file: File) => void;
  setPipelineStage: (stage: PipelineStage, error?: string) => void;
  setUploadProgress: (pct: number) => void;
  setBackendIds: (ids: Partial<Pick<EditorStore, "userId" | "projectId" | "mediaId" | "transcriptId">>) => void;
  setAnalysis: (words: WordItem[], segments: AnalysisSegment[], meta: { frameRate: number; totalFrames: number; durationSeconds: number }) => void;
  toggleSegment: (startS: number) => void;
  setSilenceThreshold: (t: number) => void;
  clearMedia: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_KEY = "EDITOR_AUTH";
export const VALID_SECRET = process.env.NEXT_PUBLIC_EDITOR_SECRET ?? "roughcut2025";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorStore>((set) => ({
  isAuthenticated: false,
  secretKey: null,

  userId: null,
  projectId: null,
  mediaId: null,
  transcriptId: null,

  mediaFile: null,

  pipelineStage: "idle",
  uploadProgress: 0,
  pipelineError: null,

  analysisWords: [],
  segments: [],
  silenceThreshold: 0.5,
  frameRate: 23.976,
  totalFrames: 0,
  durationSeconds: 0,

  login: (secret) => {
    if (secret !== VALID_SECRET) return;
    localStorage.setItem(LS_KEY, "true");
    set({ isAuthenticated: true, secretKey: secret });
  },

  logout: () => {
    localStorage.removeItem(LS_KEY);
    set({
      isAuthenticated: false,
      secretKey: null,
      mediaFile: null,
      userId: null,
      projectId: null,
      mediaId: null,
      transcriptId: null,
      pipelineStage: "idle",
      uploadProgress: 0,
      pipelineError: null,
      analysisWords: [],
      segments: [],
    });
  },

  selectFile: (file) =>
    set({ mediaFile: file, pipelineStage: "file_selected", pipelineError: null }),

  setPipelineStage: (stage, error?) =>
    set({ pipelineStage: stage, pipelineError: error ?? null }),

  setUploadProgress: (pct) => set({ uploadProgress: pct }),

  setBackendIds: (ids) => set((s) => ({ ...s, ...ids })),

  setAnalysis: (words, rawSegments, meta) => {
    const segments: TranscriptSegment[] = rawSegments.map((s) => ({
      startS: s.start_s,
      endS: s.end_s,
      reason: s.reason as TranscriptSegment["reason"],
      isCut: s.is_cut,
    }));
    set({
      analysisWords: words,
      segments,
      frameRate: meta.frameRate,
      totalFrames: meta.totalFrames,
      durationSeconds: meta.durationSeconds,
      pipelineStage: "ready",
    });
  },

  toggleSegment: (startS) =>
    set((s) => ({
      segments: s.segments.map((seg) =>
        seg.startS === startS ? { ...seg, isCut: !seg.isCut } : seg
      ),
    })),

  setSilenceThreshold: (t) => set({ silenceThreshold: t }),

  clearMedia: () =>
    set({
      mediaFile: null,
      mediaId: null,
      transcriptId: null,
      pipelineStage: "idle",
      uploadProgress: 0,
      pipelineError: null,
      analysisWords: [],
      segments: [],
      totalFrames: 0,
      durationSeconds: 0,
    }),
}));

export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
