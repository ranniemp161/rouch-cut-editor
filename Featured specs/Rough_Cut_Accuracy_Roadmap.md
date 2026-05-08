# Rough-Cut Accuracy Enhancement Roadmap: "The 90% Perfect Cut"

## Objective
The objective is to refine the automated cutting logic to achieve a **90% perfect rough cut**. This means the AI must be aggressive enough to remove almost all technical debt (silences, stutters, repetitions) while remaining contextually aware enough to preserve stylistic emphasis. 

We will achieve this by tightening our rule-based silence detection and empowering our **Semantic AI (Gemini)** to be more ruthless with repetitions and "thought loops."

---

## 1. Tightening Silence Detection (Zero-Gap Policy)

### Problem
Currently, short pauses or "dead air" are leaking through because the detection threshold (0.4s - 0.5s) is too conservative for modern fast-paced video content.

### Detailed Steps to Solve
1.  **Lower the Floor:**
    *   **File:** `app/services/media_service.py`
    *   **Change:** Reduce `silence_threshold_used` from `0.4` to **`0.3`**. 
    *   **Rationale:** A 300ms pause is already a lifetime in YouTube-style or TikTok-style content.
2.  **Enforce Auto-Cut on [SILENCE]:**
    *   **File:** `app/api/media.py`
    *   **Change:** In the `get_analysis` route, ensure every word marked with `is_silence: True` is automatically added to the `initial_deleted_ids` and its segment is marked as `is_cut: True`.
3.  **The "Breathing Room" Constant:**
    *   **Action:** Adjust the `silence_pad` (currently 0.05s) to be dynamic. For very short silences, reduce padding to 0.02s so we don't "keep" the silence we just detected.

---

## 2. Ruthless Repetition Logic (Semantic & Rule-Based)

### Problem
The current logic misses longer repetitions (sentences) and "near-synonym" re-takes where the speaker changes one or two words.

### Detailed Steps to Solve
1.  **Expand Rule-Based N-Grams:**
    *   **File:** `app/services/analysis_service.py`
    *   **Change:** Increase `max_n` from `6` to **`12`**. 
    *   **Fuzzy Logic:** Update `_ngram_match` to allow a **25% error rate** for phrases longer than 8 words. (e.g., if a 10-word phrase has 2 differences, it's still a repetition).
2.  **Aggressive Gemini Prompt Tuning:**
    *   **File:** `app/services/semantic_analyzer.py`
    *   **Update `_SYSTEM_INSTRUCTION`:**
        *   **New Directive:** "Target 'Thought Loops'. If a speaker explains the same concept twice in a row, even with different words, DELETE the first attempt. Only keep the most confident and concise version."
        *   **New Directive:** "Priority on RE-TAKES. Speakers often try a sentence 2-3 times before getting it right. Your job is to identify the 'Final Take' and aggressively prune everything leading up to it."
        *   **The 90% Mandate:** "Error on the side of CUTTING. It is easier for a human to restore a cut than to find a missed one."

---

## 3. The "Semantic Connector" Fix

### Problem
When the AI cuts a repetition, it often leaves a "hanging" connector word like *"So..."* or *"But..."* at the end of the previous sentence, making the edit sound jarring.

### Detailed Steps to Solve
1.  **Inter-Word Glue Logic:**
    *   **Logic:** If the AI cuts a word-sequence, it should automatically look at the single word *immediately preceding* the cut. If that word is a lone conjunction (and, but, so, because) and it's followed by a cut, mark it for deletion as well.
    *   **Implementation:** Add a post-processing pass in `semantic_analyzer.py` to "clean up the edges" of every cut.

---

## 4. Technical Refinement Checklist

- [ ] **FFmpeg Tuning:** Update `detect_silences` to use a noise floor of `-35dB` instead of `-30dB` to catch quieter "mouth noises" as silence.
- [ ] **Contextual Buffer:** Ensure Gemini receives at least 20 words of context *before* and *after* a potential repetition to avoid cutting deliberate rhetorical devices.
- [ ] **Batching:** If the video is >10 minutes, batch the Gemini calls in 5-minute overlapping chunks to prevent context-window "forgetfulness."

---

## Final Verification Goal
The "90% Perfect" rough cut should allow a creator to press **"Generate Rough Cut"** and immediately have a video that is tight, punchy, and free of all "Ums," "Ahs," and "I meant to say..." moments, requiring only minor manual polishing for pacing.
