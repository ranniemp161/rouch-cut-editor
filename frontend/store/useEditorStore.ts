import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  // ── Media ─────────────────────────────────────────────────────────────────
  mediaFile: File | null;

  // ── Timeline (mock) ───────────────────────────────────────────────────────
  timelineState: TimelineState;

  // ── Actions ───────────────────────────────────────────────────────────────
  login: (secret: string) => void;
  logout: () => void;
  setMediaFile: (file: File) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_KEY = "EDITOR_AUTH";
export const VALID_SECRET =
  process.env.NEXT_PUBLIC_EDITOR_SECRET ?? "roughcut2025";

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
  // Always start as false — page.tsx rehydrates from localStorage after mount
  // so server and client render identically on the first pass.
  isAuthenticated: false,
  secretKey: null,

  mediaFile: null,
  timelineState: defaultTimeline,

  login: (secret: string) => {
    if (secret !== VALID_SECRET) return;
    localStorage.setItem(LS_KEY, "true");
    set({ isAuthenticated: true, secretKey: secret });
  },

  logout: () => {
    localStorage.removeItem(LS_KEY);
    set({ isAuthenticated: false, secretKey: null, mediaFile: null });
  },

  setMediaFile: (file: File) => set({ mediaFile: file }),
}));

// Exported so page.tsx can rehydrate after mount without coupling to LS_KEY.
export const rehydrateAuth = () => {
  if (localStorage.getItem(LS_KEY) === "true") {
    useEditorStore.setState({ isAuthenticated: true });
  }
};
