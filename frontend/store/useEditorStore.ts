import { create } from "zustand";
import type { WordItem, AnalysisSegment } from "@/lib/api";
import type { WordTimestamp } from "@/types";

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

  // ── Analysis results (segment-level — silences + repetitions) ─────────────
  analysisWords: WordItem[];
  segments: TranscriptSegment[];
  silenceThreshold: number;
  frameRate: number;
  totalFrames: number;
  durationSeconds: number;

  // ── Word-level transcript (Descript / Gling-style click-to-cut) ───────────
  transcript: WordTimestamp[];
  deletedWordIds: Set<string>;

  // ── Selection / playback navigation ──────────────────────────────────────
  selectedWordIds: Set<string>;
  lastClickedIndex: number | null;
  seekTime: number | null;
  currentTime: number;
  splitMarkers: number[];

  // ── Actions ───────────────────────────────────────────────────────────────
  login: (secret: string) => void;
  logout: () => void;
  selectFile: (file: File) => void;
  setPipelineStage: (stage: PipelineStage, error?: string) => void;
  setUploadProgress: (pct: number) => void;
  setBackendIds: (ids: Partial<Pick<EditorStore, "userId" | "projectId" | "mediaId" | "transcriptId">>) => void;
  setAnalysis: (words: WordItem[], segments: AnalysisSegment[], meta: { frameRate: number; totalFrames: number; durationSeconds: number; initialDeletedIds: string[] }) => void;
  toggleSegment: (startS: number) => void;
  setSilenceThreshold: (t: number) => void;
  clearMedia: () => void;

  // Word-level actions
  setTranscript: (words: WordTimestamp[]) => void;
  toggleWordState: (wordId: string) => void;
  resetDeletedWords: () => void;

  // Selection / playback actions
  setSeekTime: (time: number | null) => void;
  setSelectedWords: (ids: Set<string>) => void;
  setLastClickedIndex: (index: number | null) => void;
  bulkToggleWords: (ids: string[], isDeleted: boolean) => void;
  setCurrentTime: (time: number) => void;
  addSplitMarker: (time: number) => void;
  removeSplitMarker: (time: number) => void;
  clearSplitMarkers: () => void;
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

  transcript: [],
  deletedWordIds: new Set<string>(),

  selectedWordIds: new Set<string>(),
  lastClickedIndex: null,
  seekTime: null,
  currentTime: 0,
  splitMarkers: [],

  // ── Auth ──────────────────────────────────────────────────────────────────

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
      transcript: [],
      deletedWordIds: new Set<string>(),
      selectedWordIds: new Set<string>(),
      lastClickedIndex: null,
      seekTime: null,
      currentTime: 0,
      splitMarkers: [],
    });
  },

  // ── Pipeline / file ───────────────────────────────────────────────────────

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

    // Prefer the backend-assigned ID (Gemini's reference space). Fall back
    // to a generated one only if older transcripts lack it.
    const transcript: WordTimestamp[] = words.map((w, i) => ({
      id: w.id ?? `w-${i}`,
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    // Seed the deletion set with whatever the backend flagged (AI semantic cuts
    // plus math-based silence gaps) so those appear struck-through immediately.
    // The user can still toggle any of them back on with a click.
    const deletedWordIds = new Set<string>(meta.initialDeletedIds);

    set({
      analysisWords: words,
      segments,
      transcript,
      deletedWordIds,
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
      transcript: [],
      deletedWordIds: new Set<string>(),
      selectedWordIds: new Set<string>(),
      lastClickedIndex: null,
      seekTime: null,
      currentTime: 0,
      splitMarkers: [],
    }),

  // ── Word-level (Descript-style) ──────────────────────────────────────────
  // Replacing the Set is required for Zustand to detect the change.
  // Mutating in-place would not trigger subscribed components to re-render.

  setTranscript: (words) =>
    set({ transcript: words, deletedWordIds: new Set<string>() }),

  toggleWordState: (wordId) =>
    set((s) => {
      const next = new Set(s.deletedWordIds);
      if (next.has(wordId)) {
        next.delete(wordId);
      } else {
        next.add(wordId);
      }
      return { deletedWordIds: next };
    }),

  resetDeletedWords: () => set({ deletedWordIds: new Set<string>() }),

  // ── Selection / playback navigation ──────────────────────────────────────

  setSeekTime: (time) => set({ seekTime: time }),

  setSelectedWords: (ids) => set({ selectedWordIds: ids }),

  setLastClickedIndex: (index) => set({ lastClickedIndex: index }),

  bulkToggleWords: (ids, isDeleted) =>
    set((s) => {
      const next = new Set(s.deletedWordIds);
      if (isDeleted) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return { deletedWordIds: next };
    }),

  setCurrentTime: (time) => set({ currentTime: time }),

  addSplitMarker: (time) =>
    set((s) => {
      // Dedupe within ~1 frame so a double-click doesn't stack markers.
      if (s.splitMarkers.some((m) => Math.abs(m - time) < 0.0005)) return s;
      const next = [...s.splitMarkers, time].sort((a, b) => a - b);
      return { splitMarkers: next };
    }),

  removeSplitMarker: (time) =>
    set((s) => ({
      splitMarkers: s.splitMarkers.filter((m) => Math.abs(m - time) >= 0.0005),
    })),

  clearSplitMarkers: () => set({ splitMarkers: [] }),
}));

export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
