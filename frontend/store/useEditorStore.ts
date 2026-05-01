import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus = "idle" | "uploading" | "processing" | "done" | "error";

interface Clip {
  id: string;
  filename: string;
  startFrame: number;
  endFrame: number;
  trackIndex: number;
}

interface TimelineState {
  clips: Clip[];
  currentFrame: number;
  durationFrames: number;
  fps: number;
  zoom: number;
}

interface EditorStore {
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  secretKey: string | null;

  // ── Backend IDs (set after API calls succeed) ─────────────────────────────
  userId: string | null;
  projectId: string | null;
  mediaId: string | null;
  transcriptId: string | null;

  // ── Media (local File reference for the video player) ─────────────────────
  mediaFile: File | null;

  // ── Upload pipeline state ─────────────────────────────────────────────────
  uploadStatus: UploadStatus;
  uploadProgress: number;   // 0-100
  uploadError: string | null;

  // ── Timeline (mock) ───────────────────────────────────────────────────────
  timelineState: TimelineState;

  // ── Actions ───────────────────────────────────────────────────────────────
  login: (secret: string) => void;
  logout: () => void;
  setMediaFile: (file: File) => void;
  setBackendIds: (ids: Partial<Pick<EditorStore, "userId" | "projectId" | "mediaId" | "transcriptId">>) => void;
  setUploadStatus: (status: UploadStatus, error?: string) => void;
  setUploadProgress: (pct: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_KEY = "EDITOR_AUTH";
export const VALID_SECRET = process.env.NEXT_PUBLIC_EDITOR_SECRET ?? "roughcut2025";

const defaultTimeline: TimelineState = {
  clips: [],
  currentFrame: 0,
  durationFrames: 0,
  fps: 23.976,
  zoom: 1,
};

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

  uploadStatus: "idle",
  uploadProgress: 0,
  uploadError: null,

  timelineState: defaultTimeline,

  login: (secret: string) => {
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
      uploadStatus: "idle",
      uploadProgress: 0,
      uploadError: null,
    });
  },

  setMediaFile: (file: File) => set({ mediaFile: file }),

  setBackendIds: (ids) => set((s) => ({ ...s, ...ids })),

  setUploadStatus: (status, error = null) =>
    set({ uploadStatus: status, uploadError: error }),

  setUploadProgress: (pct) => set({ uploadProgress: pct }),
}));

export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
