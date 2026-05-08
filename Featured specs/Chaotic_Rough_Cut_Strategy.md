# Chaotic Rough-Cut Strategy: "The Editor's Mind"

## Objective
The objective is to handle "chaotic" recordings where the creator performs multiple retakes, gives verbal instructions to the editor, and makes meta-comments about the recording process (e.g., "this is a mess," "cancel that"). The goal is to automatically identify and keep only the **final, successful take** while stripping out all verbal "undo" commands and placeholder instructions.

---

## 1. Verbal Command Recognition (VCR)

### Problem
The creator uses phrases like "cancel that last line" or "ignore that" to indicate a mistake. Standard repetition detection might miss these if the wording of the retake is significantly different.

### Detailed Steps to Solve
1.  **Instruction Keyword Extraction:**
    *   **File:** `app/services/semantic_analyzer.py`
    *   **Implementation:** Add a set of "Editing Trigger Phrases" to the Gemini prompt:
        *   "Cancel that last [line/bit/part]"
        *   "Ignore that last sentence"
        *   "Start again/now"
        *   "Sorry, let's redo that"
    *   **Logic:** When Gemini detects these phrases, it must interpret them as a command to delete the preceding semantic block, regardless of whether it matches the following text.
2.  **Backwards Deletion Range:**
    *   **Logic:** If a "cancel" command is found, the AI should look back to the nearest significant pause or the start of the current "thought" and mark that entire range for deletion.

---

## 2. The "Last Take" Preference Algorithm

### Problem
Creators often iterate on a sentence 3-4 times, progressively getting better. The AI needs to prioritize the *last* one as the "intended" version.

### Detailed Steps to Solve
1.  **Semantic Clustering:**
    *   **Implementation:** Use Gemini to cluster adjacent segments by "Intent." If segments 3, 4, and 5 all have the intent "Describe South Africa's president," they are part of a Take Cluster.
2.  **Take Selection:**
    *   **Rule:** Within a Take Cluster, always default to keeping the **LAST** take unless it is marked as incomplete or interrupted.
    *   **Exception Handling:** If the last take is followed by "oh my god this is a mess," move to the second-to-last take or wait for the "Start now" signal.

---

## 3. Placeholder & Clip Marker Handling

### Problem
Phrases like "play Clip 2 here" or "include the substack call to action" are markers for the final edit but should not be in the rough cut itself.

### Detailed Steps to Solve
1.  **Action Marker Tagging:**
    *   **Implementation:** Identify phrases starting with "Play clip," "Insert," or "Call to action."
2.  **Timeline Anchoring:**
    *   **Logic:** Instead of just deleting these, tag them as `is_marker: True` in the metadata. This allows the frontend to show a visual indicator on the timeline (e.g., "Clip 3 goes here") even if the audio is cut.

---

## 4. Meta-Talk & Frustration Filtering

### Problem
Spontaneous comments like "oh my god," "nonsense right now," or "this is a mess" pollute the transcript and the rough cut.

### Detailed Steps to Solve
1.  **Frustration Sentiment Detection:**
    *   **Change:** Update the Gemini prompt to detect "Meta-Speech." 
    *   **Directive:** "Identify speech that is directed at the creator themselves or the editor (e.g., 'sorry,' 'nonsense,' 'this is a mess'). These segments should be marked for deletion with high priority."
2.  **Contextual Recovery:** 
    *   **Action:** If a frustration block is detected, search for the next "clean" sentence starting with a strong connector or a reset (e.g., "So," "Anyway," "Now"). Delete everything between the frustration point and the reset.

---

## Implementation Checklist

- [ ] **Prompt Engineering:** Update `app/services/semantic_analyzer.py` with the "Chaotic Handling" directives.
- [ ] **Heuristic Filters:** Add a Python utility to `app/utils/text_utils.py` to catch common verbal undo commands using regex before sending to Gemini to save tokens/time.
- [ ] **Frontend Markers:** Update the `TranscriptSidebar` to highlight "Action Markers" (e.g., "Play Clip 3") in a different color instead of just striking them through.
