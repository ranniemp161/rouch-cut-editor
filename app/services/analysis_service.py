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
    for prev, curr in zip(words, words[1:]):
        gap_start = prev["end"]
        gap_end = curr["start"]
        if gap_end - gap_start >= threshold:
            cuts.append({"start_s": gap_start, "end_s": gap_end, "reason": "silence"})
    return cuts


def _find_repetition_cuts(words: list[dict], min_n: int = 2, max_n: int = 6) -> list[dict]:
    """
    Detect immediately consecutive n-gram repetitions.
    Marks the *first* occurrence as the cut (assumed to be the stumble/false start).
    """
    reps = []
    i = 0
    while i < len(words):
        matched = False
        for n in range(max_n, min_n - 1, -1):
            if i + 2 * n > len(words):
                continue
            pattern = [_norm(w["word"]) for w in words[i : i + n]]
            following = [_norm(w["word"]) for w in words[i + n : i + 2 * n]]
            if pattern == following:
                reps.append(
                    {
                        "start_s": words[i]["start"],
                        "end_s": words[i + n - 1]["end"],
                        "reason": "repetition",
                    }
                )
                i += n
                matched = True
                break
        if not matched:
            i += 1
    return reps


def _norm(word: str) -> str:
    return word.lower().strip(".,!?;:")


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
    cursor = words[0]["start"]
    clip_end = words[-1]["end"]

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
