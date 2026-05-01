"""
Media processing service.

In production this module runs ffprobe to extract stream metadata and then
feeds the audio track through Whisper to produce word-level timestamps.
Both operations are CPU/IO-bound and should be offloaded to a thread pool
or task queue (e.g. Celery, ARQ) before going to production.

The mock below returns deterministic data so the routing layer and DB
persistence can be developed and tested independently of the ML pipeline.
"""

from fastapi import UploadFile


async def process_video(file: UploadFile) -> dict:
    """
    Extract media metadata and transcribe speech from *file*.

    Returns a dict that the upload route uses to persist MediaAsset +
    Transcript rows.  Shape is intentionally flat so the caller does not
    need to know the internal model structure.

    Production implementation outline:
        1. Write the upload to a temp file (tempfile.NamedTemporaryFile).
        2. Run ffprobe via asyncio.create_subprocess_exec to get frame_rate,
           total_frames, and duration_seconds from the video stream.
        3. Extract audio with ffmpeg -vn -acodec pcm_s16le.
        4. Load openai-whisper model and call model.transcribe(audio_path,
           word_timestamps=True).
        5. Flatten segment["words"] across all segments into word_level_data.
        6. Clean up temp files.
    """

    # -------------------------------------------------------------------------
    # MOCK — replace with real ffprobe + Whisper calls described above.
    # -------------------------------------------------------------------------
    return {
        "frame_rate": 23.976,
        "total_frames": 1440,
        "duration_seconds": 60.06,
        "word_level_data": [
            {"word": "Hello", "start": 0.0, "end": 0.42, "probability": 0.99},
            {"word": "world", "start": 0.50, "end": 0.91, "probability": 0.97},
            {"word": "this", "start": 1.80, "end": 2.01, "probability": 0.98},
            {"word": "is", "start": 2.05, "end": 2.18, "probability": 0.99},
            {"word": "a", "start": 2.20, "end": 2.28, "probability": 0.96},
            {"word": "test", "start": 2.30, "end": 2.71, "probability": 0.98},
        ],
        "silence_threshold_used": 0.5,
    }
