"""
Media processing service.

Writes the upload to a temporary file, runs ffprobe to extract stream
metadata, extracts mono 16 kHz audio via ffmpeg, then transcribes with
Whisper. The Whisper call is dispatched to a thread-pool executor so it
does not block FastAPI's async event loop.

Temporary files are always cleaned up in the finally block regardless of
whether processing succeeds or fails.
"""

import asyncio
import os
import tempfile
from typing import Any

from fastapi import UploadFile

from app.services import ffmpeg as ffmpeg_service
from app.services import transcription as transcription_service


async def process_video(file: UploadFile) -> dict[str, Any]:
    """
    Probe *file* for media metadata and produce word-level timestamps.

    Returns a flat dict consumed directly by the upload route to build
    MediaAsset + Transcript rows — the caller should not need to know the
    internal model structure.
    """
    filename = file.filename or "upload.mp4"
    ext = os.path.splitext(filename)[1] or ".mp4"

    # Write upload to a named temp file so ffprobe/ffmpeg can path-address it.
    tmp_video = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    video_path = tmp_video.name
    audio_path = video_path + ".wav"

    try:
        content = await file.read()
        tmp_video.write(content)
        tmp_video.close()

        # 1. Extract stream metadata (fast, sync is fine).
        info = ffmpeg_service.probe_media(video_path)

        # 2. Demux audio to mono 16 kHz WAV for Whisper.
        ffmpeg_service.extract_audio(video_path, audio_path)

        # 3. Transcribe — CPU-bound, run in the default thread-pool executor
        #    so uvicorn's event loop stays responsive during a long transcription.
        loop = asyncio.get_event_loop()
        word_data: list[dict[str, Any]] = await loop.run_in_executor(
            None,
            transcription_service.transcribe,
            audio_path,
        )

        return {
            "frame_rate": info.frame_rate,
            "total_frames": info.total_frames,
            "duration_seconds": info.duration_seconds,
            "word_level_data": word_data,
            "silence_threshold_used": 0.5,
        }

    finally:
        if os.path.exists(video_path):
            os.unlink(video_path)
        if os.path.exists(audio_path):
            os.unlink(audio_path)
