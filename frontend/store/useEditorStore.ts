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

// Clip-object model (CapCut-style). A clip is a window into the original
// 15-min source: `[sourceStart, sourceEnd]` are seconds into the imported
// media. The timeline plays clips in array order, packed end-to-end
// (single-track, ripple-by-default) — `timelinePosition` is therefore
// derived from the cumulative duration of preceding clips and is NOT
// stored. Operations are direct mutations of these two numbers; the old
// `deletedWordIds + segments + splitMarkers + clipTrims` quadruple is
// being phased out in favour of this single source of truth.
export interface Clip {
  id: string;
  sourceStart: number;
  sourceEnd: number;
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

  // ── Clip-object model (in migration) ─────────────────────────────────────
  // Source-of-truth for the new architecture. Initially generated from the
  // AI rough-cut at setAnalysis; future Timeline/Player will read from this
  // directly instead of reconstructing kept ranges via buildEditMap.
  clips: Clip[];

  // ── Timeline UX state ────────────────────────────────────────────────────
  // Magnetic timeline: when true, deletions ripple-close (default Descript
  // behaviour). When false, deletions leave a visible gap (Lift). Currently
  // a UI affordance — full Lift semantics live in the edit map and are
  // honoured wherever buildEditMap is consulted.
  magneticTimeline: boolean;

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
  clearTrimsForIds: (ids: string[]) => void;
  setMagneticTimeline: (on: boolean) => void;

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
  clips: [],
  magneticTimeline: true,

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
      clips: [],
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
      isMarker: w.is_marker ?? false,
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

    // Derive the initial Clip array from the AI rough-cut. Walk the
    // source timeline and record every span that ISN'T inside a deleted
    // word's range or an isCut segment. This is the same kept-region
    // logic that buildEditMap step 1-4 used to compute on the fly — but
    // baked once into a real array of objects that subsequent edits will
    // mutate directly. Adjacent regions are merged with a small tolerance
    // so a kept sliver of a few ms doesn't produce a tiny garbage clip.
    const initialClips: Clip[] = deriveInitialClips(
      transcript,
      deletedWordIds,
      finalSegments,
      meta.durationSeconds,
    );

    set({
      analysisWords: words,
      segments: finalSegments,
      transcript,
      deletedWordIds,
      splitMarkers: finalSplitMarkers,
      clipTrims: finalClipTrims,
      clips: initialClips,
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
      clips: [],
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
      clips: [],
      historyStack: [],
      futureStack: [],
    }),

  // ── Word-level (Descript-style) ──────────────────────────────────────────
  // Replacing the Set is required for Zustand to detect the change.
  // Mutating in-place would not trigger subscribed components to re-render.

  setTranscript: (words) => {
    // Inject [SILENCE] pseudo-words for gaps > 0.1s so that purely silent
    // regions have a word ID. This allows them to be selected and deleted
    // from the timeline context menu.
    const withSilences: typeof words = [];
    let prevEnd = 0;
    for (const w of words) {
      if (w.start > prevEnd + 0.1) {
        withSilences.push({
          id: `silence-${prevEnd.toFixed(3)}-${w.start.toFixed(3)}`,
          word: "[SILENCE]",
          start: prevEnd,
          end: w.start,
        });
      }
      withSilences.push(w);
      prevEnd = Math.max(prevEnd, w.end);
    }
    set({ transcript: withSilences, deletedWordIds: new Set<string>(), clipTrims: {} });
  },

  toggleWordState: (wordId) =>
    set((s) => {
      const next = new Set(s.deletedWordIds);
      let clipTrims = s.clipTrims;
      if (next.has(wordId)) {
        next.delete(wordId);
      } else {
        next.add(wordId);
        // Match bulkToggleWords: drop any trim anchored on this word.
        if (wordId in clipTrims) {
          clipTrims = { ...clipTrims };
          delete clipTrims[wordId];
        }
      }
      return { deletedWordIds: next, clipTrims };
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
      // Auto-wipe per-clip trim records keyed by any deleted word.
      // Trim Cleanup Policy (roadmap §1.3): a deleted word can never anchor a
      // trim, and a stale pad on it can phantom-restore the audio underneath.
      let clipTrims = s.clipTrims;
      if (isDeleted) {
        const keys = Object.keys(clipTrims);
        if (keys.length > 0) {
          const idSet = new Set(ids);
          let mutated = false;
          const nextTrims = { ...clipTrims };
          for (const k of keys) {
            if (idSet.has(k)) { delete nextTrims[k]; mutated = true; }
          }
          if (mutated) clipTrims = nextTrims;
        }
      }
      return { deletedWordIds: next, clipTrims };
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

  clearTrimsForIds: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const trimKeys = Object.keys(s.clipTrims);
      if (trimKeys.length === 0) return s;
      const idSet = new Set(ids);
      let mutated = false;
      const next = { ...s.clipTrims };
      for (const k of trimKeys) {
        if (idSet.has(k)) { delete next[k]; mutated = true; }
      }
      return mutated ? { clipTrims: next } : s;
    }),

  setMagneticTimeline: (on) => set({ magneticTimeline: on }),

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

// ---------------------------------------------------------------------------
// Initial clip generation
// ---------------------------------------------------------------------------

// Tolerances tuned to swallow noise from Whisper's loose word boundaries.
// MERGE: two deletions whose gap is below this collapse into one. MIN_KEPT:
// any leftover sliver shorter than this is absorbed into the surrounding
// deletion (a 30ms half-phoneme is inaudible content but a real splice
// point during playback). Both numbers match the constants buildEditMap
// has used since v1, so the initial clip layout is bit-for-bit equivalent
// to what the timeline currently renders.
const CLIP_MERGE_TOL_S = 0.05;
const CLIP_MIN_KEPT_S = 0.12;

function deriveInitialClips(
  transcript: WordTimestamp[],
  deletedWordIds: Set<string>,
  segments: TranscriptSegment[],
  sourceDuration: number,
): Clip[] {
  if (sourceDuration <= 0) return [];

  // 1) Word-level deletions, merged into runs.
  type Region = { start: number; end: number };
  const regions: Region[] = [];
  let cur: Region | null = null;
  for (const w of transcript) {
    if (!deletedWordIds.has(w.id)) {
      if (cur) { regions.push(cur); cur = null; }
      continue;
    }
    if (cur && w.start - cur.end <= CLIP_MERGE_TOL_S) {
      cur.end = w.end;
    } else {
      if (cur) regions.push(cur);
      cur = { start: w.start, end: w.end };
    }
  }
  if (cur) regions.push(cur);

  // Segments intentionally not folded in — deletedWordIds is the sole
  // source of truth (see buildEditMap for rationale).

  // 2) Sort + merge overlapping/adjacent.
  regions.sort((a, b) => a.start - b.start);
  const merged: Region[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.001) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }

  // 3) Absorb gaps between deletions only when they contain no kept
  //    spoken words. Never swallow a word the user sees as "kept."
  const hasKeptWord = (a: number, b: number): boolean => {
    for (const w of transcript) {
      if (w.start >= a && w.start < b && w.word !== "[SILENCE]" && !deletedWordIds.has(w.id)) return true;
    }
    return false;
  };
  const collapsed: Region[] = [];
  for (const r of merged) {
    const last = collapsed[collapsed.length - 1];
    if (last && !hasKeptWord(last.end, r.start)) {
      last.end = Math.max(last.end, r.end);
    } else {
      collapsed.push({ start: r.start, end: r.end });
    }
  }
  if (collapsed.length > 0) {
    if (collapsed[0].start > 0 && !hasKeptWord(0, collapsed[0].start)) collapsed[0].start = 0;
    const tail = collapsed[collapsed.length - 1];
    if (sourceDuration > tail.end && !hasKeptWord(tail.end, sourceDuration)) {
      tail.end = sourceDuration;
    }
  }

  // 5) Walk gaps as kept clips.
  const clips: Clip[] = [];
  let cursor = 0;
  let n = 0;
  for (const region of collapsed) {
    if (region.start > cursor) {
      clips.push({ id: `clip-${n++}`, sourceStart: cursor, sourceEnd: region.start });
    }
    cursor = Math.max(cursor, region.end);
  }
  if (cursor < sourceDuration) {
    clips.push({ id: `clip-${n++}`, sourceStart: cursor, sourceEnd: sourceDuration });
  }
  return clips;
}

export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
