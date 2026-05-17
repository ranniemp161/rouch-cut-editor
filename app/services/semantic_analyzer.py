"""
Semantic cutting via Gemini 1.5 Flash.

After Whisper produces word-level timestamps, this service asks Gemini to
identify filler words, false starts, stutters, verbal undo commands,
frustration / meta-talk, and earlier "takes" inside a take-cluster — so the
final rough cut keeps only the LAST clean attempt at every thought. We use
Gemini's native structured-output mode (response_mime_type + response_schema)
so the response is guaranteed to be JSON that validates against the
SmartCutResponse Pydantic model — no free-form text parsing required.

A heuristic Python pre-pass (`app.utils.text_utils`) catches obvious verbal
undo commands and meta-talk via regex. This keeps Gemini's input cleaner
(saves tokens) and means we still strip the worst chaos even when the API
key is missing or the call fails.

Failure mode: if GEMINI_API_KEY is missing or the API call fails, this
service returns whatever the heuristic pre-pass found (or empties). The
upload pipeline must remain functional even when the AI dependency is
unavailable.
"""

import logging
import os
from typing import Any

import google.generativeai as genai

from app.schemas.ai_schemas import SmartCutResponse
from app.utils.text_utils import detect_undo_and_markers, merge_cut_id_lists

logger = logging.getLogger(__name__)

# Configure the SDK at import time. If the key is missing we still let the
# module load — the function below short-circuits to a heuristic-only result
# so the rest of the app keeps working.
_API_KEY = os.getenv("GEMINI_API_KEY")
if _API_KEY:
    genai.configure(api_key=_API_KEY)
else:
    logger.warning("GEMINI_API_KEY not set — semantic_analyzer falls back to heuristic-only output")

# Override via GEMINI_MODEL if Google retires this one. As of mid-2026 the 1.5
# series is fully decommissioned; 2.5-flash is the current fast/cheap default.
_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_SYSTEM_INSTRUCTION = (
    "You are an expert, ruthless video editor targeting a 90% PERFECT rough cut "
    "from a CHAOTIC raw recording. The creator does multiple retakes, gives "
    "verbal instructions to the editor, and makes meta-comments about the "
    "recording process. Your job is to surface only the FINAL, successful take "
    "and strip every verbal 'undo' command, placeholder instruction, and "
    "frustration outburst.\n\n"

    "THE 90% MANDATE: Error on the side of CUTTING. It is easier for a human to "
    "restore a cut than to find a missed one. When in doubt, cut.\n\n"

    "CONFIDENCE MARKERS: Words tagged with [?] have low transcription confidence "
    "(the speech-to-text model is unsure what was said). Do NOT cut a [?] word "
    "unless it is clearly filler or part of a larger cut region. A [?] word in "
    "isolation is more likely a transcription error than actual garbage speech.\n\n"

    "Rule 1: Context is King. Do not cut pauses or repetition if they are CLEARLY "
    "stylistic (deliberate emphasis, rhetorical anaphora, list enumeration). "
    "Otherwise, cut.\n"
    "Rule 2: The Filler Mandate. Always target filler words ('um', 'uh', 'er', 'ah', "
    "'like', 'you know', 'I mean', 'sort of', 'kind of', 'basically', 'literally', "
    "'actually', 'right', 'okay so', 'well') unless they carry real structural "
    "meaning in the sentence.\n"
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
    "Rule 6: PRIORITY ON RE-TAKES — 'The Last Take' Algorithm. Speakers iterate on a "
    "sentence 2-4 times before getting it right. Cluster adjacent segments by INTENT "
    "(what they're trying to say). Within a Take Cluster, ALWAYS keep the LAST take "
    "and cut every earlier attempt — UNLESS the last take is interrupted, incomplete, "
    "or immediately followed by a frustration line ('oh my god this is a mess'). In "
    "that case, fall back to the second-to-last take, OR wait for an explicit reset "
    "signal ('start now', 'okay so', 'anyway') and use whatever comes after it.\n"
    "Rule 7: VERBAL COMMAND RECOGNITION. The creator will literally say 'cancel that "
    "last line', 'ignore that', 'scratch that', 'sorry let's redo that', 'start "
    "again', 'strike that', 'never mind', 'hold on let me redo'. Treat these as "
    "explicit DELETE commands. Cut the trigger phrase itself AND the entire preceding "
    "thought (back to the previous sentence boundary or significant pause), regardless "
    "of whether the retake matches the deleted text. Do not require text similarity "
    "to honour the command.\n"
    "Rule 8: META-TALK & FRUSTRATION. Identify speech directed at the creator "
    "themselves or the editor — 'sorry', 'oh my god', 'this is a mess', 'nonsense "
    "right now', 'what am I saying', 'wait wait wait', 'no no no', 'that's wrong', "
    "'that didn't make sense', 'let me think', 'how do I say this', 'what's the word'. "
    "CUT these with high priority. After a frustration block, search forward for the "
    "next clean sentence opening with a strong connector ('So,' 'Anyway,' 'Now,' "
    "'Okay,' 'Alright,' 'The point is,'). Cut everything from the frustration trigger "
    "up to (but not including) that reset connector.\n"
    "Rule 9: ACTION MARKERS — DO NOT CUT, TAG. Phrases like 'play clip 2 here', "
    "'insert b-roll', 'include the substack call to action', 'cut to b-roll' are "
    "instructions to a future editor. They are NOT part of the spoken script and "
    "should NOT appear in `words_to_cut`. Instead, return the IDs of every word "
    "inside the marker phrase in `action_marker_ids`. The frontend will render "
    "these in a distinct colour as a timeline anchor; the audio is hidden but the "
    "marker stays visible.\n"
    "Rule 10: Completeness. When you cut a false start or earlier repetition, also "
    "cut any trailing filler/connector words ('so', 'and', 'but', 'um') that bridge "
    "to the clean take, AND any leading orphaned articles/prepositions ('the', 'a', "
    "'to', 'of') that precede the cut region and no longer attach to anything "
    "meaningful. The final edit must read as a seamless, natural sentence.\n\n"

    "--- FEW-SHOT EXAMPLE ---\n"
    "INPUT:\n"
    "[ID: 1] So [ID: 2] um [ID: 3] today [ID: 4] we're [ID: 5] going "
    "[ID: 6] to [ID: 7] talk [ID: 8] about [ID: 9] uh [ID: 10] we're "
    "[ID: 11] going [ID: 12] to [ID: 13] talk [ID: 14] about [ID: 15] the "
    "[ID: 16] new [ID: 17] feature. [ID: 18] Oh [ID: 19] my [ID: 20] god "
    "[ID: 21] that [ID: 22] was [ID: 23] terrible. [ID: 24] Okay [ID: 25] so "
    "[ID: 26] today [ID: 27] we're [ID: 28] launching [ID: 29] a [ID: 30] brand "
    "[ID: 31] new [ID: 32] feature. [ID: 33] Insert [ID: 34] b-roll "
    "[ID: 35] here.\n"
    "OUTPUT:\n"
    '{"words_to_cut": ["1","2","3","4","5","6","7","8","9","10","11","12",'
    '"13","14","15","16","17","18","19","20","21","22","23"],'
    '"action_marker_ids": ["33","34","35"]}\n'
    "EXPLANATION: IDs 1-17 = false start + filler (Rule 3). IDs 18-23 = "
    "frustration/meta-talk (Rule 8). IDs 24-32 = kept (clean final take). "
    "IDs 33-35 = action marker, NOT cut (Rule 9).\n"
    "--- END EXAMPLE ---\n\n"

    "Return a JSON object with `words_to_cut` (array of Word IDs to delete) and "
    "`action_marker_ids` (array of Word IDs to tag as markers — these are NOT cut). "
    "An ID must appear in at most one of the two lists."
)

# Lone connector words that, when stranded immediately before a cut region,
# create a jarring "hanging" edit ("So... [cut]"). Post-processing trims them.
_HANGING_CONNECTORS = {"so", "but", "and", "because", "or", "well", "now", "then", "yet", "also"}

# Orphaned articles/prepositions left dangling after a cut region.
# "...the [CUT]" or "...to [CUT]" sounds broken — absorb them into the cut.
_TRAILING_ORPHANS = {"the", "a", "an", "to", "of", "for", "in", "on", "at", "with", "by", "from"}

# Safety cap: if Gemini flags more than this fraction of spoken words, something
# is wrong (prompt injection, hallucination, or a degenerate transcript).
# We discard the Gemini result and fall back to heuristic-only.
_MAX_CUT_RATIO = 0.80

# Long-form videos exceed Gemini's effective context-recall window. We chunk
# by spoken-word time into overlapping windows so every region is analysed
# with adequate surrounding context, then merge cut IDs across chunks.
_LONG_VIDEO_THRESHOLD_S = 600.0   # 10 minutes
_CHUNK_DURATION_S = 300.0         # 5 minutes
_CHUNK_OVERLAP_S = 60.0           # 60s overlap — take clusters often span 30+ seconds


def analyze_transcript_for_mistakes(
    word_level_data: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """
    Send the transcript to Gemini and return ``(cut_ids, marker_ids)``.

    Each item in `word_level_data` must contain at least the keys
    `id` (str) and `word` (str). Items without an `id` are skipped because
    Gemini would have no way to refer back to them.

    Returns a 2-tuple:
      - cut_ids: deduplicated, in-order list of word IDs to delete
        (false starts, filler, repetitions, verbal undo + the thought it
        cancels, meta-talk / frustration, earlier retakes).
      - marker_ids: word IDs inside Action Marker phrases ("play clip 2",
        "insert b-roll", "call to action") — to be tagged ``is_marker``,
        NOT deleted.

    Soft-fail: if Gemini is unreachable, we still run the heuristic
    pre-pass and return whatever it caught.
    """
    if not word_level_data:
        return [], []

    valid_ids: set[str] = {str(w["id"]) for w in word_level_data if "id" in w}
    if not valid_ids:
        return [], []

    # 1. Heuristic pre-pass — cheap, deterministic, runs even without an API
    #    key. Catches the obvious verbal-undo / marker / meta-talk phrases.
    heuristic_cuts, heuristic_markers = detect_undo_and_markers(word_level_data)

    # 2. Gemini pass (skipped if no API key).
    gemini_cuts: list[str] = []
    gemini_markers: list[str] = []
    if _API_KEY:
        # Decide whether to send the whole transcript in one call or split it
        # into 5-minute overlapping chunks. The chunked path gives Gemini ample
        # surrounding context per call and avoids long-context "forgetfulness".
        duration = _approx_duration(word_level_data)
        if duration > _LONG_VIDEO_THRESHOLD_S:
            chunks = _chunk_words(word_level_data, _CHUNK_DURATION_S, _CHUNK_OVERLAP_S)
        else:
            chunks = [word_level_data]

        seen_cuts: set[str] = set()
        seen_markers: set[str] = set()
        for chunk in chunks:
            chunk_cuts, chunk_markers = _analyze_chunk(chunk)
            for wid in chunk_cuts:
                if wid in valid_ids and wid not in seen_cuts:
                    seen_cuts.add(wid)
                    gemini_cuts.append(wid)
            for wid in chunk_markers:
                if wid in valid_ids and wid not in seen_markers:
                    seen_markers.add(wid)
                    gemini_markers.append(wid)

    # 3. Merge heuristic + Gemini results. Cuts win over markers for any
    #    overlap (the cut-side is always the safer destructive action and a
    #    region tagged as both is almost certainly misclassified).
    cut_ids = merge_cut_id_lists(heuristic_cuts, gemini_cuts)
    cut_set = set(cut_ids)
    marker_ids = [
        mid for mid in merge_cut_id_lists(heuristic_markers, gemini_markers)
        if mid not in cut_set
    ]

    # Clean up "hanging" connector words on the edges of every cut region.
    cut_ids = _glue_connectors(word_level_data, cut_ids)
    return cut_ids, marker_ids


def _analyze_chunk(chunk: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Send a single chunk of words to Gemini and return (cuts, markers)."""
    if not chunk:
        return [], []
    chunk_ids = {str(w["id"]) for w in chunk if "id" in w}
    spoken_ids = {str(w["id"]) for w in chunk if "id" in w and not w.get("is_silence")}
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
                temperature=0.0,
            ),
        )
        result = SmartCutResponse.model_validate_json(response.text)
    except Exception as exc:  # noqa: BLE001 — soft-fail on any SDK / network error
        logger.warning("Gemini semantic-cut call failed: %r", exc)
        return [], []
    cuts = [wid for wid in dict.fromkeys(result.words_to_cut) if wid in chunk_ids]
    markers = [wid for wid in dict.fromkeys(result.action_marker_ids) if wid in chunk_ids]

    # Sanity check: if Gemini wants to cut > 80% of spoken words, something is
    # very wrong (hallucination, degenerate transcript, prompt injection).
    # Discard the result entirely and let the heuristic pre-pass handle it.
    if spoken_ids:
        cut_ratio = len(set(cuts) & spoken_ids) / len(spoken_ids)
        if cut_ratio > _MAX_CUT_RATIO:
            logger.warning(
                "Gemini flagged %.0f%% of spoken words for cutting — discarding "
                "as likely hallucination (chunk has %d spoken words)",
                cut_ratio * 100,
                len(spoken_ids),
            )
            return [], []

    return cuts, markers


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
    Post-processing pass: clean up the edges of every cut region.

    1. **Leading connectors**: if a lone connector ('so', 'but', …) sits
       immediately before a run of cut words, it would dangle — cut it.
    2. **Trailing orphans**: if a lone article/preposition ('the', 'a', 'to')
       sits immediately after a run of cut words, it's orphaned — cut it.

    Both passes run iteratively until no more changes are found (a connector
    absorbed by pass 1 may expose a new orphan for pass 2).
    """
    if not cut_ids or not words:
        return cut_ids
    cut_set = set(cut_ids)
    id_to_index = {str(w["id"]): i for i, w in enumerate(words) if "id" in w}
    index_to_id = {i: str(w["id"]) for i, w in enumerate(words) if "id" in w}
    extra: list[str] = []

    changed = True
    while changed:
        changed = False

        # Pass 1 — leading connectors (word BEFORE the first cut in a run).
        for cid in list(cut_set):
            idx = id_to_index.get(cid)
            if idx is None or idx == 0:
                continue
            prev_word = words[idx - 1]
            prev_id = str(prev_word.get("id", ""))
            if prev_id in cut_set:
                continue
            token = str(prev_word.get("word", "")).lower().strip(".,!?;:\"'")
            if token in _HANGING_CONNECTORS:
                extra.append(prev_id)
                cut_set.add(prev_id)
                changed = True

        # Pass 2 — trailing orphans (word AFTER the last cut in a run).
        for cid in list(cut_set):
            idx = id_to_index.get(cid)
            if idx is None or idx >= len(words) - 1:
                continue
            next_word = words[idx + 1]
            next_id = str(next_word.get("id", ""))
            if next_id in cut_set:
                continue
            token = str(next_word.get("word", "")).lower().strip(".,!?;:\"'")
            if token in _TRAILING_ORPHANS:
                # Only absorb if the NEXT-next word is also cut or doesn't exist
                # (i.e. the orphan truly dangles — it doesn't attach to a kept word).
                idx2 = idx + 2
                if idx2 >= len(words) or index_to_id.get(idx2, "") not in cut_set:
                    # Check: does the orphan start a kept phrase? If the word
                    # after it is kept, the article likely belongs to it.
                    if idx2 < len(words) and index_to_id.get(idx2, "") not in cut_set:
                        continue
                extra.append(next_id)
                cut_set.add(next_id)
                changed = True

    if not extra:
        return cut_ids
    return cut_ids + extra


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_LOW_CONFIDENCE_THRESHOLD = 0.5


def _format_transcript(words: list[dict[str, Any]]) -> str:
    """
    Render the word list as the inline ID-tagged string Gemini expects.

    Words with low Whisper confidence (probability < 0.5) are flagged with a
    ``[?]`` marker so Gemini knows the transcription may be wrong and can avoid
    making aggressive cut decisions on phantom words::

        [ID: 1] So [ID: 2] um [ID: 3][?] I [ID: 4] think ...
    """
    parts: list[str] = []
    for w in words:
        if "id" not in w:
            continue
        prob = w.get("probability")
        low_conf = (
            isinstance(prob, (int, float)) and prob < _LOW_CONFIDENCE_THRESHOLD
        )
        tag = f"[ID: {w['id']}]{'[?]' if low_conf else ''}"
        parts.append(f"{tag} {w['word']}")
    return " ".join(parts)
