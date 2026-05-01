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

_MODEL_NAME = "gemini-1.5-flash"

_SYSTEM_INSTRUCTION = (
    "You are an expert, ruthless video editor. Analyze this raw transcript. "
    "Identify false starts, filler words (um, uh, like), and awkward stutters. "
    "Return ONLY the IDs of the words that should be deleted to make the "
    "speaker sound perfectly fluent and confident."
)


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

    formatted = _format_transcript(word_level_data)

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

    # Defensive: drop any IDs Gemini hallucinated that don't match an input word.
    return [wid for wid in dict.fromkeys(result.words_to_cut) if wid in valid_ids]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _format_transcript(words: list[dict[str, Any]]) -> str:
    """
    Render the word list as the inline ID-tagged string Gemini expects:
        "[ID: 1] So [ID: 2] um [ID: 3] I [ID: 4] think ..."
    """
    return " ".join(f"[ID: {w['id']}] {w['word']}" for w in words if "id" in w)
