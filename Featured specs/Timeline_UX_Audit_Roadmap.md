# Timeline UX Audit & Feature Roadmap

## Objective
The primary goal is to transition the **Rough-Cut Timeline** from a functional prototype to a **Premium, High-Fidelity NLE (Non-Linear Editor) Interface**. This involves eliminating current state-sync bugs and implementing industry-standard visual feedback (waveforms, text overlays, and grabbable handles) to make the editing experience feel "alive" and precise.

---

## Part 1: Immediate Critical Fixes (The "Ghost Clip" Problem)

### Problem Statement
Currently, deleted words still render as solid blocks, and the playback engine "leaks" audio from cut sections.

### Detailed Implementation Steps
1.  **Strict State Filtering (Timeline.tsx):**
    *   **Action:** Modify the `clips` useMemo logic.
    *   **Logic:** A clip should ONLY be pushed to the rendering array if it contains at least one word that is NOT in the `deletedWordIds` set.
    *   **Result:** Deleting a word in the sidebar causes an immediate "gap" to appear in the timeline, providing instant visual confirmation.

2.  **Latency-Free Skip Engine (useVideoPlayer.ts):**
    *   **Action:** Remove `deletedRunsRef`.
    *   **Logic:** Force the `requestAnimationFrame` loop to read directly from the `editMapRef.current.deletedRegions`.
    *   **Optimization:** Increase the skip-ahead window to 120ms to compensate for browser decoding latency.
    *   **Result:** Silent, seamless jumps across cuts with zero audible "clicks" or "bleeds".

3.  **Trim Cleanup Policy (useEditorStore.ts):**
    *   **Action:** Implement `clearTrimsForIds` action.
    *   **Logic:** Automatically wipe any "clip trim" (sub-word padding) data when a word is marked as deleted.
    *   **Result:** Prevents deleted audio from being "padded back in" by the edge-drag system.

---

## Part 2: UX Enhancements (Phase 2 Roadmap)

### 1. Visual Content Representation
*   **Audio Waveforms (A1 Track):**
    *   **Objective:** Users cannot see where people are breathing or pausing without a waveform.
    *   **Step:** Implement a `WaveformCanvas` component that uses the `Web Audio API` to fetch the buffer and draw a peak-map.
    *   **Impact:** Allows tactical cutting on silences rather than just relying on the transcript.
*   **Word Overlays (V1 Track):**
    *   **Objective:** Purple blocks are anonymous.
    *   **Step:** Render the actual `word` text from the transcript inside each clip block.
    *   **Logic:** Use `overflow-hidden` and `text-ellipsis`. As the user zooms in, more words become visible.
    *   **Impact:** Immediate context of what part of the video is being edited.

### 2. Interaction & Navigation
*   **Enhanced Playhead UI:**
    *   **Objective:** The current playhead is a thin line that's hard to target.
    *   **Step:** Add a "Scrubber Head" (a purple diamond or inverted triangle) at the top of the ruler.
    *   **Feature:** Add a floating timecode tooltip that follows the playhead during drags.
*   **Magnetic Timeline Toggle:**
    *   **Objective:** Sometimes users want to leave a gap (Lift), sometimes they want to close it (Ripple).
    *   **Step:** Add a "Magnet" icon in the timeline toolbar.
    *   **Impact:** Gives the user control over the "Descript-style" ripple behavior.
*   **Clip Hover Info:**
    *   **Step:** Show a "Mini-Inspector" tooltip on hover that shows the exact start/end time and the first/last word of that clip.

### 3. Visual Polish & "Wow" Factor
*   **Ripple Animations:**
    *   **Objective:** The timeline "jumps" when words are deleted.
    *   **Step:** Use `framer-motion` (layout transitions) so that when a word is cut, the subsequent clips **slide** smoothly to the left.
    *   **Impact:** Makes the app feel premium and high-end.
*   **Glassmorphic Design:**
    *   **Step:** Apply `backdrop-blur` to the timeline ruler and the transport bar. Use a slightly deeper Zinc-950/900 palette with violet-500 accents to match the "Rough Cut" brand.

---

## Part 3: Technical Execution Checklist

- [ ] **Data Sync:** Ensure `useEditorStore` is the single source of truth for all components.
- [ ] **Performance:** Virtualize the Timeline rendering if the transcript exceeds 5,000 words.
- [ ] **Persistence:** Debounce the `localStorage` save (editsStorage.ts) so that rapid UX changes (like zooming/scrubbing) don't trigger heavy I/O.
- [ ] **Mobile/Touch:** Add basic touch support for scrolling the timeline on tablets.
