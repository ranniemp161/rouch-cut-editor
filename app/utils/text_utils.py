"""
Heuristic text filters for the chaotic rough-cut pipeline.

Run BEFORE handing the transcript to Gemini so the model has fewer obvious
junk regions to reason about, and so we still strip these regions even when
the GEMINI_API_KEY is missing or the call fails. Patterns implement the
Chaotic Rough-Cut Strategy (sections 1, 3, 4):

  - Verbal undo commands: "cancel that", "ignore that", "let's redo that",
    "start again", "scratch that", "sorry let me redo that".
  - Action markers (NOT cuts — tagged is_marker=True): "play clip 2",
    "insert b-roll", "call to action", "include the substack call to action".
  - Frustration / meta-talk: "this is a mess", "oh my god", "nonsense".

Returns word-id sets so callers can merge with Gemini's output.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Phrases that mean "delete what I just said". Each pattern is matched against
# the joined-word string of a sliding window. When matched we cut (a) the
# matched phrase itself and (b) the preceding "thought" — see
# _backwards_thought_range below.
_UNDO_PHRASES: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bcancel that(?:\s+last\s+(?:line|bit|part|sentence|thing))?\b", re.I),
    re.compile(r"\bignore (?:that|the last)(?:\s+(?:line|bit|part|sentence|thing))?\b", re.I),
    re.compile(r"\bscratch that\b", re.I),
    re.compile(r"\bstrike that\b", re.I),
    re.compile(r"\b(?:let'?s|let me|i'?ll)\s+redo (?:that|this)\b", re.I),
    re.compile(r"\bsorry,?\s+(?:let'?s|let me)\s+(?:redo|try (?:that|this) again)\b", re.I),
    re.compile(r"\bstart (?:again|over|now)\b", re.I),
    re.compile(r"\bredo (?:that|this|the last)\b", re.I),
)

# Markers — NOT cuts. The frontend renders these in a distinct colour to show
# the editor where to drop a clip / asset / CTA.
_MARKER_PHRASES: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bplay\s+clip\s*\d*\b", re.I),
    re.compile(r"\binsert\s+(?:clip|b-?roll|footage|video)\b", re.I),
    re.compile(r"\b(?:include|add)\s+(?:the\s+)?(?:\w+\s+)?call\s+to\s+action\b", re.I),
    re.compile(r"\bcall\s+to\s+action\b", re.I),
    re.compile(r"\b(?:cut\s+)?to\s+b-?roll\b", re.I),
    re.compile(r"\bsubstack\s+(?:plug|cta)\b", re.I),
)

# Meta-talk / frustration. These are speech the creator directs at themselves
# or the editor — never part of the final cut.
_META_PHRASES: tuple[re.Pattern[str], ...] = (
    re.compile(r"\boh my god\b", re.I),
    re.compile(r"\bthis is a mess\b", re.I),
    re.compile(r"\bnonsense (?:right )?now\b", re.I),
    re.compile(r"\bwhat am i (?:saying|doing)\b", re.I),
    re.compile(r"\bi'?m (?:so )?(?:tired|lost|confused)\b", re.I),
    re.compile(r"\b(?:ugh|jeez|christ)\b", re.I),
)

# When backing up to find the start of the "preceding thought", we stop at:
#   - a sentence boundary in the word text, or
#   - a silence gap >= this many seconds, or
#   - a hard cap of this many words.
_THOUGHT_PAUSE_S = 0.7
_THOUGHT_MAX_WORDS = 25

# Connector words used to detect a "reset" after a frustration block. We keep
# scanning forward through frustration speech until we hit one of these at the
# start of a new sentence — everything between the frustration trigger and
# the connector is cut.
_RESET_CONNECTORS = {"so", "anyway", "now", "okay", "alright", "right"}
_RESET_MAX_WORDS = 30


def detect_undo_and_markers(
    words: list[dict[str, Any]],
) -> tuple[set[str], set[str]]:
    """
    Scan *words* (spoken-only — silence rows must be excluded by the caller)
    and return ``(cut_ids, marker_ids)``.

    cut_ids: word IDs to delete (verbal undo phrases + the thought they undo,
             plus frustration/meta-talk regions up to the next reset connector).
    marker_ids: word IDs to tag with ``is_marker=True`` — NOT cuts. The frontend
                renders these specially so the editor knows where to drop an
                external clip / B-roll / CTA.
    """
    cut_ids: set[str] = set()
    marker_ids: set[str] = set()
    if not words:
        return cut_ids, marker_ids

    n = len(words)

    # 1. Action markers (sliding 4-gram window — most marker phrases are 2–4 words).
    for i in range(n):
        for span in (2, 3, 4, 5):
            j = i + span
            if j > n:
                break
            phrase = " ".join(_token(w) for w in words[i:j])
            if any(p.search(phrase) for p in _MARKER_PHRASES):
                for w in words[i:j]:
                    if "id" in w:
                        marker_ids.add(str(w["id"]))

    # 2. Verbal undo commands → cut the phrase + the preceding thought.
    i = 0
    while i < n:
        matched_span = 0
        for span in (2, 3, 4, 5, 6):
            j = i + span
            if j > n:
                break
            phrase = " ".join(_token(w) for w in words[i:j])
            if any(p.search(phrase) for p in _UNDO_PHRASES):
                matched_span = span
                break
        if matched_span:
            j = i + matched_span
            # Cut the trigger phrase itself.
            for w in words[i:j]:
                if "id" in w:
                    cut_ids.add(str(w["id"]))
            # Cut the preceding "thought".
            start = _backwards_thought_range(words, i)
            for w in words[start:i]:
                if "id" in w:
                    cut_ids.add(str(w["id"]))
            i = j
            continue
        i += 1

    # 3. Frustration / meta-talk → cut up to the next reset connector.
    i = 0
    while i < n:
        matched_span = 0
        for span in (1, 2, 3, 4):
            j = i + span
            if j > n:
                break
            phrase = " ".join(_token(w) for w in words[i:j])
            if any(p.search(phrase) for p in _META_PHRASES):
                matched_span = span
                break
        if matched_span:
            end = _forward_to_reset(words, i + matched_span)
            for w in words[i:end]:
                if "id" in w:
                    cut_ids.add(str(w["id"]))
            i = end
            continue
        i += 1

    # Markers should never overlap with cuts — if a region is both an undo and
    # a marker, the cut wins (it's almost certainly a misclassified phrase).
    marker_ids.difference_update(cut_ids)
    return cut_ids, marker_ids


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^\w']+")


def _token(word: dict[str, Any]) -> str:
    return _PUNCT_RE.sub("", str(word.get("word", ""))).lower()


def _is_sentence_end(word: dict[str, Any]) -> bool:
    text = str(word.get("word", "")).rstrip()
    return bool(text) and text[-1] in ".!?"


def _backwards_thought_range(words: list[dict[str, Any]], idx: int) -> int:
    """
    Walk backwards from *idx* (the start of an undo phrase) to the start of
    the preceding spoken "thought". A thought ends at the previous sentence-
    terminal punctuation, a silence gap >= _THOUGHT_PAUSE_S, or a hard cap of
    _THOUGHT_MAX_WORDS — whichever comes first.
    """
    if idx <= 0:
        return 0
    start = idx
    for k in range(idx - 1, max(idx - _THOUGHT_MAX_WORDS, -1), -1):
        if _is_sentence_end(words[k]):
            start = k + 1
            break
        # Pause between this word's end and the next word's start.
        next_start = words[k + 1].get("start") if k + 1 < len(words) else None
        cur_end = words[k].get("end")
        if isinstance(next_start, (int, float)) and isinstance(cur_end, (int, float)):
            if next_start - cur_end >= _THOUGHT_PAUSE_S:
                start = k + 1
                break
        start = k
    return max(start, 0)


def _forward_to_reset(words: list[dict[str, Any]], start_idx: int) -> int:
    """
    Walk forward from *start_idx* until we hit a "reset connector" at the
    start of a new clause, OR _RESET_MAX_WORDS words have passed. Return the
    index OF that connector (exclusive end of the cut region) so the connector
    survives into the final transcript.
    """
    n = len(words)
    cap = min(start_idx + _RESET_MAX_WORDS, n)
    for k in range(start_idx, cap):
        token = _token(words[k])
        if token in _RESET_CONNECTORS:
            # Only treat it as a reset if it's at the start of a new clause —
            # i.e. the previous word ended a sentence OR there was a pause.
            if k == 0:
                return k
            prev = words[k - 1]
            if _is_sentence_end(prev):
                return k
            cur_start = words[k].get("start")
            prev_end = prev.get("end")
            if isinstance(cur_start, (int, float)) and isinstance(prev_end, (int, float)):
                if cur_start - prev_end >= _THOUGHT_PAUSE_S:
                    return k
    return cap


def merge_cut_id_lists(*sources: Iterable[str]) -> list[str]:
    """Merge several cut-id iterables, preserving first-seen order, deduped."""
    seen: set[str] = set()
    out: list[str] = []
    for src in sources:
        for cid in src:
            if cid not in seen:
                seen.add(cid)
                out.append(cid)
    return out
