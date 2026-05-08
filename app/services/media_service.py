"""
Media processing service.

Writes the upload to a persistent location under UPLOADS_DIR so it can
be retrieved later for server-side rough-cut rendering.  Audio is extracted
to a temp file for Whisper and cleaned up immediately after transcription.
"""

import asyncio
import os
import uuid
from typing import Any

from fastapi import UploadFile

from app.services import ffmpeg as ffmpeg_service
from app.services import transcription as transcription_service

# Videos are stored here so the render endpoint can reach them later.
# Mount this directory as a Docker volume to survive container restarts.
UPLOADS_DIR = "/app/uploads"


def delete_asset_file(file_path: str | None) -> None:
    """Best-effort removal of an asset's video and any sibling .wav extract."""
    if not file_path:
        return
    for path in (file_path, file_path + ".wav"):
        try:
            if os.path.exists(path):
                os.unlink(path)
        except OSError:
            pass


def purge_uploads_dir() -> int:
    """Delete every file inside UPLOADS_DIR. Returns count removed."""
    if not os.path.isdir(UPLOADS_DIR):
        return 0
    removed = 0
    for entry in os.listdir(UPLOADS_DIR):
        path = os.path.join(UPLOADS_DIR, entry)
        try:
            if os.path.isfile(path):
                os.unlink(path)
                removed += 1
        except OSError:
            pass
    return removed


async def process_video(file: UploadFile) -> dict[str, Any]:
    """
    Probe *file* for media metadata and produce word-level timestamps.

    Returns a flat dict consumed directly by the upload route to build
    MediaAsset + Transcript rows.  Includes ``file_path`` so the caller
    can persist the location of the original video for later rendering.
    """
    os.makedirs(UPLOADS_DIR, exist_ok=True)

    filename = file.filename or "upload.mp4"
    ext = os.path.splitext(filename)[1] or ".mp4"
    asset_id = str(uuid.uuid4())
    video_path = os.path.join(UPLOADS_DIR, f"{asset_id}{ext}")
    audio_path = video_path + ".wav"

    try:
        content = await file.read()
        with open(video_path, "wb") as fh:
            fh.write(content)

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

        # 4. Audio-level silence detection — far more accurate than gap-between-
        #    words because Whisper often absorbs trailing pauses into the prior
        #    word's end timestamp, hiding the silence from arithmetic-only
        #    detection.
        silence_threshold_used = 0.3
        silences = ffmpeg_service.detect_silences(
            audio_path, min_duration=silence_threshold_used
        )

        return {
            "frame_rate": info.frame_rate,
            "total_frames": info.total_frames,
            "duration_seconds": info.duration_seconds,
            "word_level_data": word_data,
            "silence_threshold_used": silence_threshold_used,
            "silences": silences,
            "file_path": video_path,
        }

    finally:
        # Only clean up the temporary audio extract; keep the video for rendering.
        if os.path.exists(audio_path):
            os.unlink(audio_path)
