import { create } from "zustand";
import type { WordItem, AnalysisSegment } from "@/lib/api";
import type { WordTimestamp } from "@/types";
import { loadEdits } from "@/lib/editsStorage";

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

// Per-clip sub-word edge nudges in seconds. padStart is added to the clip's
// natural sourceStart (negative pulls the edge earlier — restoring a few
// frames of breath before a word); padEnd is added to the natural sourceEnd
// (positive extends past the consonant tail). Keyed by an anchor word ID
// belonging to the clip — see Timeline's trim-drag handler for the rule.
export interface ClipTrim {
  padStart: number;
  padEnd: number;
}

/**
 * Snapshot of just the user-editable fields. Selection / playhead / history
 * itself stay out — undo should not move the cursor or wipe what's selected.
 */
interface EditSnapshot {
  deletedWordIds: Set<string>;
  segments: TranscriptSegment[];
  splitMarkers: number[];
  clipTrims: Record<string, ClipTrim>;
}

const HISTORY_LIMIT = 50;

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
  clipTrims: Record<string, ClipTrim>;

  // ── Undo / redo (snapshot-based) ──────────────────────────────────────────
  historyStack: EditSnapshot[];
  futureStack: EditSnapshot[];

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
  resetProjectScope: () => void;

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
  setClipTrim: (anchorId: string, trim: ClipTrim) => void;
  clearClipTrim: (anchorId: string) => void;

  // History
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
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
  clipTrims: {},

  historyStack: [],
  futureStack: [],

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
      clipTrims: {},
      historyStack: [],
      futureStack: [],
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

    // Seed deletions with the backend's analysis (semantic + silence cuts).
    let deletedWordIds = new Set<string>(meta.initialDeletedIds);
    let finalSegments = segments;
    let finalSplitMarkers: number[] = [];
    let finalClipTrims: Record<string, ClipTrim> = {};

    // Restore the user's prior session for this transcript if one exists.
    // Keyed by transcriptId so each project has its own saved edit state.
    const tId = useEditorStore.getState().transcriptId;
    if (tId) {
      const saved = loadEdits(tId);
      if (saved) {
        deletedWordIds = saved.deletedWordIds;
        // Merge saved segment cut-state by (startS,endS) so newly analysed
        // segments stay in their post-AI default if the saved set is partial.
        const byKey = new Map<string, TranscriptSegment>();
        for (const s of saved.segments) byKey.set(`${s.startS}_${s.endS}`, s);
        finalSegments = segments.map((s) => {
          const found = byKey.get(`${s.startS}_${s.endS}`);
          return found ? { ...s, isCut: found.isCut } : s;
        });
        finalSplitMarkers = saved.splitMarkers;
        finalClipTrims = saved.clipTrims ?? {};
      }
    }

    set({
      analysisWords: words,
      segments: finalSegments,
      transcript,
      deletedWordIds,
      splitMarkers: finalSplitMarkers,
      clipTrims: finalClipTrims,
      frameRate: meta.frameRate,
      totalFrames: meta.totalFrames,
      durationSeconds: meta.durationSeconds,
      pipelineStage: "ready",
      historyStack: [],
      futureStack: [],
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
      clipTrims: {},
      historyStack: [],
      futureStack: [],
    }),

  resetProjectScope: () =>
    set({
      projectId: null,
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
      clipTrims: {},
      historyStack: [],
      futureStack: [],
    }),

  // ── Word-level (Descript-style) ──────────────────────────────────────────
  // Replacing the Set is required for Zustand to detect the change.
  // Mutating in-place would not trigger subscribed components to re-render.

  setTranscript: (words) =>
    set({ transcript: words, deletedWordIds: new Set<string>(), clipTrims: {} }),

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

  setClipTrim: (anchorId, trim) =>
    set((s) => {
      // Drop the entry entirely when both pads collapse to ~0 — keeps the
      // record sparse so unrelated lookups stay fast.
      if (Math.abs(trim.padStart) < 0.0005 && Math.abs(trim.padEnd) < 0.0005) {
        if (!(anchorId in s.clipTrims)) return s;
        const next = { ...s.clipTrims };
        delete next[anchorId];
        return { clipTrims: next };
      }
      return { clipTrims: { ...s.clipTrims, [anchorId]: trim } };
    }),

  clearClipTrim: (anchorId) =>
    set((s) => {
      if (!(anchorId in s.clipTrims)) return s;
      const next = { ...s.clipTrims };
      delete next[anchorId];
      return { clipTrims: next };
    }),

  // ── History ───────────────────────────────────────────────────────────────
  // Snapshot the three editable fields. Callers invoke pushHistory() *before*
  // the mutation, so an undo can restore exactly the prior state.

  pushHistory: () =>
    set((s) => {
      const snap: EditSnapshot = {
        deletedWordIds: new Set(s.deletedWordIds),
        segments: s.segments.map((seg) => ({ ...seg })),
        splitMarkers: [...s.splitMarkers],
        clipTrims: { ...s.clipTrims },
      };
      const next = [...s.historyStack, snap];
      // Bound memory — drop the oldest entry once the cap is hit. 50 is
      // plenty for an editing session and avoids unbounded growth.
      if (next.length > HISTORY_LIMIT) next.shift();
      return { historyStack: next, futureStack: [] };
    }),

  undo: () =>
    set((s) => {
      if (s.historyStack.length === 0) return s;
      const prev = s.historyStack[s.historyStack.length - 1];
      const current: EditSnapshot = {
        deletedWordIds: new Set(s.deletedWordIds),
        segments: s.segments.map((seg) => ({ ...seg })),
        splitMarkers: [...s.splitMarkers],
        clipTrims: { ...s.clipTrims },
      };
      return {
        historyStack: s.historyStack.slice(0, -1),
        futureStack: [...s.futureStack, current],
        deletedWordIds: prev.deletedWordIds,
        segments: prev.segments,
        splitMarkers: prev.splitMarkers,
        clipTrims: prev.clipTrims,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.futureStack.length === 0) return s;
      const next = s.futureStack[s.futureStack.length - 1];
      const current: EditSnapshot = {
        deletedWordIds: new Set(s.deletedWordIds),
        segments: s.segments.map((seg) => ({ ...seg })),
        splitMarkers: [...s.splitMarkers],
        clipTrims: { ...s.clipTrims },
      };
      return {
        futureStack: s.futureStack.slice(0, -1),
        historyStack: [...s.historyStack, current],
        deletedWordIds: next.deletedWordIds,
        segments: next.segments,
        splitMarkers: next.splitMarkers,
        clipTrims: next.clipTrims,
      };
    }),

  clearHistory: () => set({ historyStack: [], futureStack: [] }),
}));

export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
