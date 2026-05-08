"""
Semantic cutting via Gemini 1.5 Flash.

After Whisper produces word-level timestamps, this service asks Gemini to
identify filler words, false starts, and stutters that should be deleted to
make the speaker sound fluent. We use Gemini's native structured-output mode
(response_mime_type + response_schema) so the response is guaranteed to be
JSON that validates against the SmartCutResponse Pydantic model — no
free-form text parsing required.

Failure mode: if GEMINI_API_KEY is missing or the API call fails, this
service returns an empty list. The upload pipeline must remain functional
even when the AI dependency is unavailable.
"""

import logging
import os
from typing import Any

import google.generativeai as genai

from app.schemas.ai_schemas import SmartCutResponse

logger = logging.getLogger(__name__)

# Configure the SDK at import time. If the key is missing we still let the
# module load — the function below short-circuits to an empty result so
# the rest of the app keeps working.
_API_KEY = os.getenv("GEMINI_API_KEY")
if _API_KEY:
    genai.configure(api_key=_API_KEY)
else:
    logger.warning("GEMINI_API_KEY not set — semantic_analyzer will return [] for every call")

# Override via GEMINI_MODEL if Google retires this one. As of mid-2026 the 1.5
# series is fully decommissioned; 2.5-flash is the current fast/cheap default.
_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_SYSTEM_INSTRUCTION = (
    "You are an expert, ruthless video editor targeting a 90% PERFECT rough cut. "
    "Analyze this raw transcript and delete every disfluency so the speaker sounds "
    "fluent and confident.\n"
    "THE 90% MANDATE: Error on the side of CUTTING. It is easier for a human to "
    "restore a cut than to find a missed one. When in doubt, cut.\n"
    "Rule 1: Context is King. Do not cut pauses or repetition if they are CLEARLY "
    "stylistic (deliberate emphasis, rhetorical anaphora, list enumeration). "
    "Otherwise, cut.\n"
    "Rule 2: The Filler Mandate. Always target filler words ('um', 'uh', 'er', 'ah', "
    "'like', 'you know', 'I mean', 'sort of', 'kind of', 'basically', 'literally', "
    "'actually') unless they carry real structural meaning in the sentence.\n"
    "Rule 3: False Starts. If a speaker stutters or restarts a sentence "
    "('So if we look at... if we look at the data'), cut the first failed attempt and "
    "keep the final clean delivery.\n"
    "Rule 4: Repetitive Phrases — be AGGRESSIVE. Flag and cut the EARLIER (weaker) "
    "occurrence whenever the speaker:\n"
    "  (a) Repeats the same phrase back-to-back, exactly or nearly exactly.\n"
    "  (b) Restates the same idea with slightly different wording within ~10 seconds. "
    "      Keep the cleaner take.\n"
    "  (c) Repeats a phrase with filler or a short interruption between. Cut the first "
    "      phrase AND the filler.\n"
    "  (d) Re-runs the same sentence frame with a different ending. Cut the abandoned "
    "      frame.\n"
    "Rule 5: TARGET 'THOUGHT LOOPS'. If a speaker explains the same concept twice in a "
    "row, even with completely different words, DELETE the first attempt. Only keep the "
    "most confident and concise version.\n"
    "Rule 6: PRIORITY ON RE-TAKES. Speakers often try a sentence 2-3 times before getting "
    "it right. Your job is to identify the 'Final Take' and aggressively prune everything "
    "leading up to it.\n"
    "Rule 7: Completeness. When you cut a false start or earlier repetition, also cut any "
    "trailing filler/connector words ('so', 'and', 'but', 'um') that bridge to the clean "
    "take, so the final edit reads seamlessly.\n"
    "Return ONLY a JSON array of the specific Word IDs to be deleted."
)

# Lone connector words that, when stranded immediately before a cut region,
# create a jarring "hanging" edit ("So... [cut]"). Post-processing trims them.
_HANGING_CONNECTORS = {"so", "but", "and", "because", "or", "well", "now", "then"}

# Long-form videos exceed Gemini's effective context-recall window. We chunk
# by spoken-word time into overlapping windows so every region is analysed
# with adequate surrounding context, then merge cut IDs across chunks.
_LONG_VIDEO_THRESHOLD_S = 600.0   # 10 minutes
_CHUNK_DURATION_S = 300.0         # 5 minutes
_CHUNK_OVERLAP_S = 30.0           # 30s overlap to avoid context-window forgetfulness


def analyze_transcript_for_mistakes(word_level_data: list[dict[str, Any]]) -> list[str]:
    """
    Send the transcript to Gemini and return the IDs of words to cut.

    Each item in `word_level_data` must contain at least the keys
    `id` (str) and `word` (str). Items without an `id` are skipped because
    Gemini would have no way to refer back to them.

    Returns the deduplicated list of IDs Gemini flagged as filler/false
    starts, filtered to those that exist in the input. Returns an empty
    list on any failure — callers should treat this as a soft-fail.
    """
    if not _API_KEY or not word_level_data:
        return []

    valid_ids: set[str] = {str(w["id"]) for w in word_level_data if "id" in w}
    if not valid_ids:
        return []

    # Decide whether to send the whole transcript in one call or split it into
    # 5-minute overlapping chunks. The chunked path gives Gemini ample
    # surrounding context per call and avoids long-context "forgetfulness".
    duration = _approx_duration(word_level_data)
    if duration > _LONG_VIDEO_THRESHOLD_S:
        chunks = _chunk_words(word_level_data, _CHUNK_DURATION_S, _CHUNK_OVERLAP_S)
    else:
        chunks = [word_level_data]

    cut_ids_ordered: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        for wid in _analyze_chunk(chunk):
            if wid in valid_ids and wid not in seen:
                seen.add(wid)
                cut_ids_ordered.append(wid)

    # Clean up "hanging" connector words on the edges of every cut region.
    cut_ids_ordered = _glue_connectors(word_level_data, cut_ids_ordered)
    return cut_ids_ordered


def _analyze_chunk(chunk: list[dict[str, Any]]) -> list[str]:
    """Send a single chunk of words to Gemini and return its cut IDs."""
    if not chunk:
        return []
    chunk_ids = {str(w["id"]) for w in chunk if "id" in w}
    formatted = _format_transcript(chunk)
    try:
        model = genai.GenerativeModel(
            _MODEL_NAME,
            system_instruction=_SYSTEM_INSTRUCTION,
        )
        response = model.generate_content(
            formatted,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=SmartCutResponse,
            ),
        )
        result = SmartCutResponse.model_validate_json(response.text)
    except Exception as exc:  # noqa: BLE001 — soft-fail on any SDK / network error
        logger.warning("Gemini semantic-cut call failed: %r", exc)
        return []
    return [wid for wid in dict.fromkeys(result.words_to_cut) if wid in chunk_ids]


def _approx_duration(words: list[dict[str, Any]]) -> float:
    """Return the wall-clock span covered by these words (0.0 if empty)."""
    times = [w.get("end") for w in words if isinstance(w.get("end"), (int, float))]
    starts = [w.get("start") for w in words if isinstance(w.get("start"), (int, float))]
    if not times or not starts:
        return 0.0
    return max(times) - min(starts)


def _chunk_words(
    words: list[dict[str, Any]],
    chunk_s: float,
    overlap_s: float,
) -> list[list[dict[str, Any]]]:
    """
    Split *words* into time-windowed chunks of ``chunk_s`` seconds with an
    ``overlap_s`` overlap between adjacent chunks. The overlap doubles as the
    "contextual buffer" so Gemini sees ~20+ words around every cut candidate.
    """
    if not words:
        return []
    starts = [w["start"] for w in words if "start" in w]
    if not starts:
        return [words]
    t0 = min(starts)
    t_end = max(w.get("end", w.get("start", t0)) for w in words)
    chunks: list[list[dict[str, Any]]] = []
    cursor = t0
    step = max(chunk_s - overlap_s, 1.0)
    while cursor < t_end:
        window_end = cursor + chunk_s
        chunk = [w for w in words if w.get("start", 0.0) >= cursor and w.get("start", 0.0) < window_end]
        if chunk:
            chunks.append(chunk)
        cursor += step
    return chunks or [words]


def _glue_connectors(
    words: list[dict[str, Any]],
    cut_ids: list[str],
) -> list[str]:
    """
    Post-processing pass: clean up the edges of every cut region. If a lone
    connector word ('so', 'but', 'and', 'because', …) sits immediately before
    a run of cut words, it would dangle as a hanging edit — so cut it too.
    """
    if not cut_ids or not words:
        return cut_ids
    cut_set = set(cut_ids)
    id_to_index = {str(w["id"]): i for i, w in enumerate(words) if "id" in w}
    extra: list[str] = []
    for cid in cut_ids:
        idx = id_to_index.get(cid)
        if idx is None or idx == 0:
            continue
        # Only act on the FIRST cut of a contiguous cut run.
        prev_word = words[idx - 1]
        prev_id = str(prev_word.get("id", ""))
        if prev_id in cut_set:
            continue
        token = str(prev_word.get("word", "")).lower().strip(".,!?;:\"'")
        if token in _HANGING_CONNECTORS and prev_id not in cut_set:
            extra.append(prev_id)
            cut_set.add(prev_id)
    if not extra:
        return cut_ids
    # Preserve original order, append new connector cuts at the end.
    return cut_ids + extra


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _format_transcript(words: list[dict[str, Any]]) -> str:
    """
    Render the word list as the inline ID-tagged string Gemini expects:
        "[ID: 1] So [ID: 2] um [ID: 3] I [ID: 4] think ..."
    """
    return " ".join(f"[ID: {w['id']}] {w['word']}" for w in words if "id" in w)
