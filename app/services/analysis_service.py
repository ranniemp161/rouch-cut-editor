"""
Analysis service: identifies cut candidates in word-level transcript data.

Two kinds of cuts are detected:
  - Silence gaps: inter-word pauses longer than silence_threshold seconds.
  - Consecutive repetitions: the same sequence of 2-6 words appearing back-to-back
    (the first occurrence is marked for removal, the cleaner re-take is kept).

Returns a flat, time-ordered list of segments alternating between keep and cut
so the frontend can render them as toggleable transcript blocks.
"""

from typing import Any


def analyze_transcript(
    words: list[dict[str, Any]],
    duration_seconds: float,
    silence_threshold: float = 0.5,
) -> list[dict[str, Any]]:
    """
    Return a time-ordered list of segment dicts:
        {"start_s": float, "end_s": float, "reason": str, "is_cut": bool}

    Segments cover the entire timeline from the first word to the last word.
    """
    if not words:
        return [{"start_s": 0.0, "end_s": duration_seconds, "reason": "keep", "is_cut": False}]

    # Collect all cut events then invert to build the full segment list.
    silence_cuts = _find_silence_cuts(words, silence_threshold)
    repetition_cuts = _find_repetition_cuts(words)

    all_cuts = _merge_overlapping(sorted(silence_cuts + repetition_cuts, key=lambda x: x["start_s"]))

    return _build_segment_list(words, all_cuts)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_silence_cuts(words: list[dict], threshold: float) -> list[dict]:
    cuts = []
    # Exclude [SILENCE] marker words — they sit inside the gap and would split
    # it into two sub-threshold halves, preventing gap detection entirely.
    spoken = [w for w in words if not w.get("is_silence")]
    for prev, curr in zip(spoken, spoken[1:]):
        gap_start = prev["end"]
        gap_end = curr["start"]
        if gap_end - gap_start >= threshold:
            cuts.append({"start_s": gap_start, "end_s": gap_end, "reason": "silence"})
    return cuts


# Filler tokens that often sit *between* a stumble and its clean retake
# ("I think — um, I think we should…"). When matching repeated n-grams we
# allow up to MAX_FILLER_GAP of these to appear in the gap between the two
# occurrences and still treat them as a single repetition (the first phrase
# AND the intervening filler are cut together).
_FILLERS = {
    "um", "uh", "er", "ah", "hmm", "mm", "mmm",
    "like", "so", "and", "but", "or",
    "you", "know", "i", "mean",  # "you know", "I mean" — matched as tokens
    "well", "okay", "ok", "right",
    "basically", "actually", "literally", "really",
    "sort", "kind", "of",  # "sort of", "kind of"
}
_MAX_FILLER_GAP = 4  # tokens of filler allowed between the two occurrences


def _find_repetition_cuts(words: list[dict], min_n: int = 2, max_n: int = 12) -> list[dict]:
    """
    Detect consecutive (or near-consecutive) n-gram repetitions and mark the
    *first* occurrence — plus any intervening filler — as the cut.

    Catches three patterns:
      1. Exact back-to-back: "we need to, we need to ship"
      2. Filler-separated:   "I think — um — I think we should"
      3. Near-exact:         "let's go to the next slide, let's go to the slide"
         (n-grams of length >= 4 may differ by one token)
    """
    reps = []
    # Exclude silence markers — they carry no spoken content and would corrupt
    # n-gram matching across pause boundaries.
    words = [w for w in words if not w.get("is_silence")]
    norms = [_norm(w["word"]) for w in words]

    i = 0
    while i < len(words):
        matched = False
        for n in range(max_n, min_n - 1, -1):
            if i + n > len(words):
                continue
            pattern = norms[i : i + n]
            # Walk forward up to MAX_FILLER_GAP filler tokens before the candidate
            # second occurrence. gap == 0 is the original exact-adjacency case.
            for gap in range(_MAX_FILLER_GAP + 1):
                j = i + n + gap
                if j + n > len(words):
                    break
                if gap > 0 and not all(t in _FILLERS for t in norms[i + n : j]):
                    break  # non-filler token in the gap → not a stumble
                following = norms[j : j + n]
                if _ngram_match(pattern, following, n):
                    # Cut from start of the first occurrence through the end of
                    # the gap (i.e. right up to where the clean retake begins).
                    reps.append(
                        {
                            "start_s": words[i]["start"],
                            "end_s": words[j - 1]["end"] if gap > 0 else words[i + n - 1]["end"],
                            "reason": "repetition",
                        }
                    )
                    i = j  # resume scanning at the clean retake
                    matched = True
                    break
            if matched:
                break
        if not matched:
            i += 1
    return reps


def _ngram_match(a: list[str], b: list[str], n: int) -> bool:
    """
    Tolerance scales with phrase length:
      - n <  4: exact match required.
      - n in [4, 8]: allow 1 differing token (near-synonym restatements).
      - n >  8: allow up to 25% differing tokens (long sentence retakes where
        the speaker swaps a word or two but the thought is identical).
    """
    if a == b:
        return True
    if n < 4:
        return False
    diffs = sum(1 for x, y in zip(a, b) if x != y)
    if n > 8:
        return diffs <= int(n * 0.25)
    return diffs <= 1


def _norm(word: str) -> str:
    return word.lower().strip(".,!?;:\"'")


def _merge_overlapping(segments: list[dict]) -> list[dict]:
    if not segments:
        return []
    merged = [segments[0].copy()]
    for seg in segments[1:]:
        last = merged[-1]
        if seg["start_s"] <= last["end_s"]:
            last["end_s"] = max(last["end_s"], seg["end_s"])
        else:
            merged.append(seg.copy())
    return merged


def _build_segment_list(words: list[dict], cuts: list[dict]) -> list[dict]:
    """
    Interleave keep and cut segments covering [first_word_start, last_word_end].
    """
    segments: list[dict] = []
    spoken = [w for w in words if not w.get("is_silence")]
    if not spoken:
        return []
    cursor = spoken[0]["start"]
    clip_end = spoken[-1]["end"]

    for cut in cuts:
        if cut["start_s"] > cursor:
            segments.append(
                {"start_s": cursor, "end_s": cut["start_s"], "reason": "keep", "is_cut": False}
            )
        segments.append({**cut, "is_cut": True})
        cursor = cut["end_s"]

    if cursor < clip_end:
        segments.append({"start_s": cursor, "end_s": clip_end, "reason": "keep", "is_cut": False})

    return segments
