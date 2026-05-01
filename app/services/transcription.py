"""
Whisper transcription service.

Wraps the openai-whisper (or faster-whisper) library to produce word-level
timestamp data that is stored as JSON in the Transcript table.

Expected output shape per word:
    {"word": str, "start": float, "end": float, "probability": float}

The silence_threshold controls gap detection downstream: any inter-word gap
greater than the threshold (in seconds) is treated as a potential cut point.
"""

from typing import Any


def transcribe(audio_path: str, silence_threshold: float = 0.5) -> list[dict[str, Any]]:
    """
    Transcribe *audio_path* and return word-level timestamps.

    Implementation outline:
        import whisper  # pip install openai-whisper
        model = whisper.load_model("base")
        result = model.transcribe(audio_path, word_timestamps=True)

        words = []
        for segment in result["segments"]:
            for w in segment.get("words", []):
                words.append({
                    "word": w["word"].strip(),
                    "start": w["start"],
                    "end": w["end"],
                    "probability": w["probability"],
                })
        return words
    """
    raise NotImplementedError("transcribe requires openai-whisper installed: pip install openai-whisper")


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
