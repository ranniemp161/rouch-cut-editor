"""
Whisper transcription service (faster-whisper backend).

Uses a module-level singleton so the model weights are loaded from disk only
once per process lifetime. The first call downloads the model to
~/.cache/huggingface/hub/ (≈ 74 MB for "base").

Expected output shape per word:
    {"word": str, "start": float, "end": float, "probability": float}

The silence_threshold controls gap detection downstream: any inter-word gap
greater than the threshold (in seconds) is treated as a potential cut point.
"""

import os
from typing import Any

from faster_whisper import WhisperModel

# Configurable via env so production can bump to "small" or "medium".
_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(_MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


def transcribe(audio_path: str, silence_threshold: float = 0.5) -> list[dict[str, Any]]:
    """
    Transcribe *audio_path* and return word-level timestamps.

    faster-whisper yields segments lazily; we materialise them here so the
    caller gets a plain list that is safe to serialise to JSON/Postgres.
    """
    model = _get_model()
    segments, _ = model.transcribe(audio_path, word_timestamps=True)

    words: list[dict[str, Any]] = []
    for segment in segments:
        for w in segment.words or []:
            words.append(
                {
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 4),
                }
            )
    return words


def find_silence_gaps(
    word_level_data: list[dict[str, Any]],
    silence_threshold: float,
) -> list[tuple[float, float]]:
    """
    Return (start, end) tuples for every gap between consecutive words
    that exceeds *silence_threshold* seconds.
    """
    gaps: list[tuple[float, float]] = []
    for prev, curr in zip(word_level_data, word_level_data[1:]):
        gap_start = prev["end"]
        gap_end = curr["start"]
        if gap_end - gap_start >= silence_threshold:
            gaps.append((gap_start, gap_end))
    return gaps
